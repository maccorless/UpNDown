import type { ResultRow } from '@upndown/shared-types';

const KEY = 'upndown.history.v1';
const CORRUPT_KEY = `${KEY}.corrupt`;
export const LOCAL_HISTORY_CAP = 5_000;
export const LOCAL_HISTORY_WARN_AT = 4_500;

interface Data {
  v: 1;
  profileId: string;
  createdAtMs: number;
  rows: ResultRow[];
  // Rows the server refused when they were moved to an account. Kept, shown, never retried on their own.
  rejected: ResultRow[];
  // Badges the player has been shown, by id, at the highest tier.
  seen: Record<string, number>;
  // The last time the "sign in to keep this" nudge was shown.
  nudgedAtMs?: number;
}

// ok: saved in the browser. memory: the browser would not store it (private window, policy), so it lasts until the tab closes.
// full: the device is out of storage. corrupt-reset: what was there could not be read; a copy was kept and a fresh history began.
export type HistoryStatus = 'ok' | 'memory' | 'full' | 'corrupt-reset';
export type AddResult = 'added' | 'duplicate' | 'full-cap';

export interface LocalHistory {
  load(): { rows: ResultRow[]; rejected: ResultRow[]; status: HistoryStatus; profileId: string };
  add(row: ResultRow): AddResult;
  removeConfirmed(gameIds: readonly string[]): void;
  markRejected(gameIds: readonly string[]): void;
  discardRejected(): void;
  // "Erase history on this device".
  clear(): void;
  seen(): Record<string, number>;
  setSeen(map: Record<string, number>): void;
  // Forgets which badges were shown (after the games behind them were moved to an account).
  resetSeen(): void;
  nudgedAtMs(): number | null;
  setNudgedAtMs(ms: number): void;
  requestPersistence(): void;
  // Called when history changes in this tab or in another one.
  subscribe(listener: () => void): () => void;
}

const newId = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const fresh = (): Data => ({ v: 1, profileId: newId(), createdAtMs: Date.now(), rows: [], rejected: [], seen: {} });
const isData = (x: unknown): x is Data => {
  const d = x as Partial<Data> | null;
  return !!d && typeof d === 'object' && d.v === 1 && typeof d.profileId === 'string' && Array.isArray(d.rows) && Array.isArray(d.rejected) && typeof d.seen === 'object' && d.seen !== null;
};

export function createLocalHistory(storage: Storage | null = typeof window !== 'undefined' ? safeStorage() : null): LocalHistory {
  let memory: Data | null = null;
  let status: HistoryStatus = 'ok';
  let corruptNotice = false;
  const listeners = new Set<() => void>();
  // Rows this instance added. If another tab's write overwrote one (two tabs finishing at the same moment), the next read puts it back.
  const own = new Map<string, ResultRow>();

  function read(): Data {
    if (!storage) return (memory ??= fresh());
    let raw: string | null;
    try {
      raw = storage.getItem(KEY);
    } catch {
      status = 'memory';
      return (memory ??= fresh());
    }
    if (raw === null) return memory ?? fresh();
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isData(parsed)) return parsed;
    } catch { /* fall through to the corrupt path */ }
    // Unreadable, or from a version this code does not know: keep the bytes, start again, say so.
    try { storage.setItem(CORRUPT_KEY, raw); } catch { /* nothing more can be done */ }
    corruptNotice = true;
    return fresh();
  }

  function write(data: Data): void {
    memory = data;
    if (!storage) { status = 'memory'; return; }
    try {
      storage.setItem(KEY, JSON.stringify(data));
      if (status === 'full') status = 'ok';
    } catch (err) {
      status = (err as { name?: string } | null)?.name === 'QuotaExceededError' ? 'full' : 'memory';
    }
  }

  // Reads, lets `change` edit the copy, writes. Rows this instance added that another tab overwrote are put back first.
  function mutate<T>(change: (d: Data) => T): T {
    const data = read();
    const have = new Set(data.rows.map((r) => r.gameId));
    const rejected = new Set(data.rejected.map((r) => r.gameId));
    for (const [id, r] of own) if (!have.has(id) && !rejected.has(id) && data.rows.length < LOCAL_HISTORY_CAP) data.rows.push(r);
    const result = change(data);
    write(data);
    listeners.forEach((l) => l());
    return result;
  }

  const onStorage = (e: StorageEvent): void => { if (e.key === KEY || e.key === null) listeners.forEach((l) => l()); };
  let watching = false;
  const watch = (): void => {
    if (watching || typeof window === 'undefined') return;
    watching = true;
    window.addEventListener('storage', onStorage);
  };

  return {
    load() {
      const data = read();
      const missing = [...own.keys()].some((id) => !data.rows.some((r) => r.gameId === id) && !data.rejected.some((r) => r.gameId === id));
      if (missing) mutate(() => undefined);
      const current = memory && !storage ? memory : read();
      const effective: HistoryStatus = corruptNotice ? 'corrupt-reset' : status;
      return { rows: current.rows, rejected: current.rejected, status: effective, profileId: current.profileId };
    },
    add(row) {
      return mutate((d) => {
        if (d.rows.some((r) => r.gameId === row.gameId) || d.rejected.some((r) => r.gameId === row.gameId)) return 'duplicate' as const;
        if (d.rows.length >= LOCAL_HISTORY_CAP) return 'full-cap' as const;
        d.rows.push(row);
        own.set(row.gameId, row);
        return 'added' as const;
      });
    },
    removeConfirmed(ids) {
      const gone = new Set(ids);
      ids.forEach((id) => own.delete(id));
      mutate((d) => { d.rows = d.rows.filter((r) => !gone.has(r.gameId)); });
    },
    markRejected(ids) {
      const refused = new Set(ids);
      ids.forEach((id) => own.delete(id));
      mutate((d) => {
        d.rejected.push(...d.rows.filter((r) => refused.has(r.gameId) && !d.rejected.some((x) => x.gameId === r.gameId)));
        d.rows = d.rows.filter((r) => !refused.has(r.gameId));
      });
    },
    discardRejected() { mutate((d) => { d.rejected = []; }); },
    clear() {
      own.clear();
      mutate((d) => { d.rows = []; d.rejected = []; d.seen = {}; });
    },
    seen: () => read().seen,
    setSeen(map) {
      mutate((d) => { for (const [id, tier] of Object.entries(map)) d.seen[id] = Math.max(d.seen[id] ?? 0, tier); });
    },
    resetSeen() { mutate((d) => { d.seen = {}; }); },
    nudgedAtMs: () => read().nudgedAtMs ?? null,
    setNudgedAtMs(ms) { mutate((d) => { d.nudgedAtMs = ms; }); },
    requestPersistence() {
      try { void navigator.storage?.persist?.(); } catch { /* not available */ }
    },
    subscribe(listener) {
      watch();
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }
  };
}

function safeStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
