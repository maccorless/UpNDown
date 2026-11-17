import type { SolitaireResultPayload } from '@upndown/shared-types';

export type SendResult = 'ok' | 'retry' | 'permanent';
const keyOf = (userId: string): string => `upndown.outbox.v1.${userId}`;

export interface Outbox {
  enqueue(p: SolitaireResultPayload): void;
  pending(): SolitaireResultPayload[];
  remove(gameId: string): void;
}

// Finished solitaire games that could not be sent yet, kept for one account only. A game is removed only when the server
// answered for it (saved, or refused for good), so a lost connection never loses a game.
export function createOutbox(userId: string, storage: Storage | null = typeof window !== 'undefined' ? safe() : null): Outbox {
  const read = (): SolitaireResultPayload[] => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(keyOf(userId)) ?? '[]');
      return Array.isArray(parsed) ? (parsed as SolitaireResultPayload[]) : [];
    } catch { return []; }
  };
  const write = (list: SolitaireResultPayload[]): void => {
    try { storage?.setItem(keyOf(userId), JSON.stringify(list)); } catch { /* storage is blocked or full: the game stays in memory below */ }
  };
  return {
    enqueue(p) { const list = read(); if (!list.some((x) => x.gameId === p.gameId)) write([...list, p]); },
    pending: read,
    remove(gameId) { write(read().filter((x) => x.gameId !== gameId)); }
  };
}

export interface Drain { kick(): void; stop(): void }

// Sends what is waiting, one at a time. On a failure that may pass (offline, throttled, signed out) it stops and tries again later,
// waiting longer each time, and also whenever the browser says it is back online.
export function startOutboxDrain(outbox: Outbox, send: (p: SolitaireResultPayload) => Promise<SendResult>, timers: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout }): Drain {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = false;
  let delay = 2_000;

  const run = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      for (const entry of outbox.pending()) {
        const result = await send(entry);
        if (stopped) return;
        if (result === 'retry') {
          timer = timers.set(() => { timer = null; void run(); }, delay);
          delay = Math.min(delay * 2, 60_000);
          return;
        }
        outbox.remove(entry.gameId);
        delay = 2_000;
      }
    } finally {
      running = false;
    }
  };
  const kick = (): void => {
    if (timer) { timers.clear(timer); timer = null; }
    void run();
  };
  const onOnline = (): void => { delay = 2_000; kick(); };
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
  return {
    kick,
    stop() {
      stopped = true;
      if (timer) timers.clear(timer);
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    }
  };
}

function safe(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
