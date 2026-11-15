import { useCallback, useEffect, useRef, useState } from 'react';

// A tab "claims" what it is using (a solitaire game, a multiplayer seat) with a Web Lock, which the browser releases by
// itself when the tab closes, crashes or navigates away. Other tabs read the held locks to see what is open elsewhere and
// what is orphaned, so a new tab behaves like a different browser but can still pick up what was left behind.
// Without Web Locks nothing is ever claimed: a tab may then offer something another tab has open.
const locks = (): LockManager | undefined => (typeof navigator !== 'undefined' ? navigator.locks : undefined);

// Holds `name` until the returned function is called. Does nothing if another tab already holds it.
export function holdClaim(name: string): () => void {
  const manager = locks();
  if (!manager) return () => undefined;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  void manager.request(name, { ifAvailable: true }, (lock) => (lock ? held : undefined)).catch(() => undefined);
  return () => release();
}

export async function claimedNames(): Promise<Set<string>> {
  const manager = locks();
  if (!manager) return new Set();
  try {
    const { held } = await manager.query();
    return new Set((held ?? []).map((lock) => lock.name ?? ''));
  } catch {
    return new Set();
  }
}

export const isClaimed = async (name: string): Promise<boolean> => (await claimedNames()).has(name);

interface Claimable { claimId: string }

// The saved items no other tab has open, newest first as given. Rechecked when the tab is shown again, when storage changes
// in another tab, and when `enabled` flips on, because lock changes raise no event of their own.
export function useUnclaimed<T extends Claimable>(
  list: () => T[],
  claimPrefix: string,
  storagePrefix: string,
  enabled: boolean,
  excludeClaimId?: string
): [T[], () => void] {
  const [items, setItems] = useState<T[]>(() => (locks() ? [] : list().filter((item) => item.claimId !== excludeClaimId)));
  const latest = useRef({ list, excludeClaimId });
  latest.current = { list, excludeClaimId };

  const refresh = useCallback((): void => {
    const { list: current, excludeClaimId: exclude } = latest.current;
    const saved = current().filter((item) => item.claimId !== exclude);
    if (!locks()) { setItems(saved); return; }
    void claimedNames().then((held) => setItems(saved.filter((item) => !held.has(claimPrefix + item.claimId))));
  }, [claimPrefix]);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, excludeClaimId, refresh]);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === null || event.key.startsWith(storagePrefix)) refresh();
    };
    const onShown = (): void => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onShown);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onShown);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh, storagePrefix]);

  return [items, refresh];
}
