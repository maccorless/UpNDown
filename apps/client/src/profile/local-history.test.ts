import type { ResultRow } from '@upndown/shared-types';
import { describe, expect, it } from 'vitest';
import { createLocalHistory, LOCAL_HISTORY_CAP } from './local-history.js';

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  throwOnSet: Error | null = null;
  throwOnGet = false;
  // Runs between a getItem and the setItem that follows, to play the part of another tab.
  afterGet: (() => void) | null = null;
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string): void { this.map.delete(k); }
  getItem(k: string): string | null {
    if (this.throwOnGet) throw new Error('blocked');
    const v = this.map.get(k) ?? null;
    const hook = this.afterGet;
    if (hook && k === 'upndown.history.v1') { this.afterGet = null; hook(); }
    return v;
  }
  setItem(k: string, v: string): void {
    if (this.throwOnSet) throw this.throwOnSet;
    this.map.set(k, v);
  }
}

const row = (gameId: string, over: Partial<ResultRow> = {}): ResultRow => ({
  gameId, mode: 'solitaire', outcome: 'won', startedAtMs: 1, endedAtMs: 61, durationMs: 60, turns: 5, playerCount: 1, robotCount: 0, cardsTotal: 98, cardsLeft: 0,
  cardsPlayed: 98, totalMovement: 100, specialPlays: 0, skips: 0, trades: 0, lookups: 0, hints: 0, undos: 0, marks: 0, playedLastCard: true, lifelines: null, markFollows: null,
  handSize: 7, minCardsPerTurn: 2, maxCard: 99, cheatsAllowed: false, undoAllowed: false, ...over
});

describe('the guest history store', () => {
  it('keeps a finished game and gives it back after a reload, and ignores the same game sent twice', () => {
    const storage = new FakeStorage();
    expect(createLocalHistory(storage).add(row('a'))).toBe('added');
    expect(createLocalHistory(storage).add(row('a'))).toBe('duplicate');
    expect(createLocalHistory(storage).load().rows.map((r) => r.gameId)).toEqual(['a']);
  });

  it('keeps both games when two tabs finish at once, even when the second tab\'s write lands between the first one\'s read and write', () => {
    const storage = new FakeStorage();
    const a = createLocalHistory(storage);
    const b = createLocalHistory(storage);
    a.add(row('seed'));
    storage.afterGet = () => { b.add(row('from-b')); };
    a.add(row('from-a'));
    // a's write overwrote b's. Each tab puts back what it added the next time it reads.
    expect(new Set(b.load().rows.map((r) => r.gameId))).toEqual(new Set(['seed', 'from-a', 'from-b']));
    expect(new Set(createLocalHistory(storage).load().rows.map((r) => r.gameId))).toEqual(new Set(['seed', 'from-a', 'from-b']));
  });

  it('does not bring back a game that was moved to an account (removal is on purpose)', () => {
    const storage = new FakeStorage();
    const a = createLocalHistory(storage);
    a.add(row('x'));
    a.removeConfirmed(['x']);
    expect(a.load().rows).toEqual([]);
  });

  it('erases everything on request, including what the other tab added', () => {
    const storage = new FakeStorage();
    const a = createLocalHistory(storage);
    a.add(row('x'));
    a.clear();
    expect(createLocalHistory(storage).load().rows).toEqual([]);
  });

  it('keeps going in memory when the browser blocks storage, and says so, without throwing', () => {
    const storage = new FakeStorage();
    storage.throwOnSet = new Error('blocked');
    const h = createLocalHistory(storage);
    expect(() => h.add(row('a'))).not.toThrow();
    expect(h.load()).toMatchObject({ status: 'memory', rows: [expect.objectContaining({ gameId: 'a' })] });
  });

  it('reports a full device apart from a blocked one', () => {
    const storage = new FakeStorage();
    storage.throwOnSet = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    const h = createLocalHistory(storage);
    h.add(row('a'));
    expect(h.load().status).toBe('full');
  });

  it('works in memory when storage cannot even be read', () => {
    const storage = new FakeStorage();
    storage.throwOnGet = true;
    const h = createLocalHistory(storage);
    h.add(row('a'));
    expect(h.load()).toMatchObject({ status: 'memory' });
  });

  it('keeps a copy of unreadable data and starts fresh instead of overwriting it', () => {
    const storage = new FakeStorage();
    storage.setItem('upndown.history.v1', '{not json');
    const h = createLocalHistory(storage);
    expect(h.load()).toMatchObject({ status: 'corrupt-reset', rows: [] });
    expect(storage.getItem('upndown.history.v1.corrupt')).toBe('{not json');
  });

  it('treats a newer version as unreadable and never rewrites it as the old one', () => {
    const storage = new FakeStorage();
    const future = JSON.stringify({ v: 2, rows: [] });
    storage.setItem('upndown.history.v1', future);
    createLocalHistory(storage).add(row('a'));
    expect(storage.getItem('upndown.history.v1.corrupt')).toBe(future);
  });

  it('stops at 5,000 games and says so, without storing the 5,001st', () => {
    const storage = new FakeStorage();
    const h = createLocalHistory(storage);
    storage.setItem('upndown.history.v1', JSON.stringify({ v: 1, profileId: 'p', createdAtMs: 0, rows: Array.from({ length: LOCAL_HISTORY_CAP }, (_v, i) => row(`g${i}`)), rejected: [], seen: {} }));
    expect(h.add(row('one-more'))).toBe('full-cap');
    expect(h.load().rows).toHaveLength(LOCAL_HISTORY_CAP);
  });

  it('moves a refused game aside instead of deleting it, and does not count it again', () => {
    const h = createLocalHistory(new FakeStorage());
    h.add(row('old'));
    h.markRejected(['old']);
    expect(h.load()).toMatchObject({ rows: [], rejected: [expect.objectContaining({ gameId: 'old' })] });
    expect(h.add(row('old'))).toBe('duplicate');
  });

  it('remembers the highest tier shown for each badge', () => {
    const h = createLocalHistory(new FakeStorage());
    h.setSeen({ regular: 2 });
    h.setSeen({ regular: 1, duet: 1 });
    expect(h.seen()).toEqual({ regular: 2, duet: 1 });
  });

  it('tells subscribers when history changes', () => {
    const h = createLocalHistory(new FakeStorage());
    let calls = 0;
    const off = h.subscribe(() => { calls += 1; });
    h.add(row('a'));
    off();
    h.add(row('b'));
    expect(calls).toBe(1);
  });
});
