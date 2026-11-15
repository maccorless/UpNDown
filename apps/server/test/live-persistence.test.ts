import { afterEach, describe, expect, it } from 'vitest';
import { GameManager } from '../src/game-manager.js';
import { MemoryGameStore } from '../src/live/game-store.js';
import { LivePersistence, LIVE_RETENTION_MS } from '../src/live/persistence.js';
import { FakeLock } from './helpers/fake-lock.js';
import { lobbyWithUsers } from './helpers/rig.js';

const quiet = (): void => undefined;
const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });
const until = async (check: () => boolean | Promise<boolean>, ms = 2000): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end && !(await check())) await wait(5);
  expect(await check()).toBe(true);
};

// Saving games in progress. What matters: a game comes back after a restart with its players able to take their seats back,
// a game that ended is never brought back, and a database that fails never touches play.
describe('saving games in progress', () => {
  const running: LivePersistence[] = [];
  afterEach(async () => { await Promise.all(running.splice(0).map((p) => p.stop())); });

  const start = (manager: GameManager, store: MemoryGameStore, lock = new FakeLock(), extra: Partial<ConstructorParameters<typeof LivePersistence>[0]> = {}) => {
    const live = new LivePersistence({ manager, store, lock, log: quiet, intervalMs: 10, retryMs: 10, ...extra });
    running.push(live);
    live.start();
    return { live, lock };
  };
  const playing = () => {
    const l = lobbyWithUsers([{ id: 'p1', userId: 'u1', name: 'Ann' }, { id: 'p2', userId: 'u2', name: 'Bob' }, { id: 'p3', name: 'Cy' }]);
    l.manager.startGame('p1', l.gameId);
    return l;
  };

  it('saves a game being played, but not a lobby', async () => {
    const store = new MemoryGameStore();
    const lobby = lobbyWithUsers([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    start(lobby.manager, store);
    await wait(60);
    expect(store.rows.size).toBe(0);
    lobby.manager.startGame('a', lobby.gameId);
    await until(() => store.rows.has(lobby.gameId));
  });

  it('writes again only when the game changed, and every change is saved', async () => {
    const store = new MemoryGameStore();
    const l = playing();
    start(l.manager, store);
    await until(() => store.rows.has(l.gameId));
    const first = store.rows.get(l.gameId)!.version;
    await wait(80);
    expect(store.rows.get(l.gameId)!.version).toBe(first); // nothing changed, nothing written
    const hand = l.room().gameState.players[0]!.hand[0]!;
    l.manager.playCard('p1', { gameId: l.gameId, cardId: hand.id, pileId: 0 });
    await until(() => store.rows.get(l.gameId)!.version > first);
    expect(store.rows.get(l.gameId)!.room.state.foundationPiles[0]!.topCard.id).toBe(hand.id);
  });

  it('removes a game from the store when it ends or is left behind, and never brings it back', async () => {
    const store = new MemoryGameStore();
    const l = playing();
    start(l.manager, store);
    await until(() => store.rows.has(l.gameId));
    l.manager.endGame('p1', l.gameId);
    await until(() => !store.rows.has(l.gameId));
    await wait(60);
    expect(store.rows.has(l.gameId)).toBe(false);
  });

  it('does not save a game that was deleted while its write was waiting', async () => {
    const store = new MemoryGameStore();
    const l = playing();
    const { live } = start(l.manager, store);
    await until(() => store.rows.has(l.gameId));
    const hand = l.room().gameState.players[0]!.hand[0]!;
    l.manager.playCard('p1', { gameId: l.gameId, cardId: hand.id, pileId: 0 });
    // The game ends before the sweep gets to the change: the queued write finds no game and writes nothing.
    l.manager.endGame('p1', l.gameId);
    await live.sweep();
    await wait(40);
    expect(store.rows.has(l.gameId)).toBe(false);
  });

  it('brings a game back after a restart with every seat disconnected, and each token still works', async () => {
    const store = new MemoryGameStore();
    const first = playing();
    const tokens = Object.fromEntries(['p1', 'p2', 'p3'].map((id) => [id, first.manager.getRejoinToken(first.gameId, id)]));
    start(first.manager, store);
    await until(() => store.rows.has(first.gameId));

    // A new process: new manager, same store.
    const manager = new GameManager();
    const loaded: string[][] = [];
    start(manager, store, new FakeLock(), { onLoaded: (ids) => loaded.push(ids) });
    await until(() => manager.peekState(first.gameId) !== undefined);
    expect(loaded).toEqual([[first.gameId]]);
    const state = manager.peekState(first.gameId)!;
    expect(state.players.map((p) => p.name)).toEqual(['Ann', 'Bob', 'Cy']);
    expect(state.gamePhase).toBe('playing');
    // Everyone is a dropped connection until they come back: after the notice time the table is told.
    expect(manager.reconnectionFor(first.gameId, 'p1', Date.now() + 11_000)?.lost.map((x) => x.name)).toEqual(['Bob', 'Cy']);

    // A saved token still works though only its hash was stored, and a wrong one does not.
    expect(() => manager.rejoinPlayer(first.gameId, 'p3', 'p3-new', 'not-the-token')).toThrow('Unable to rejoin');
    const back = manager.rejoinPlayer(first.gameId, 'p3', 'p3-new', tokens.p3!);
    expect(back.players.some((p) => p.id === 'p3-new')).toBe(true);
    // A signed-in player comes back by account, with no token at all.
    expect(manager.rejoinByAccount('u2', 'p2-new').previousPlayerId).toBe('p2');
  });

  it('keeps who is signed in and the run id, so results are still recorded to the right accounts', async () => {
    const store = new MemoryGameStore();
    const first = playing();
    start(first.manager, store);
    await until(() => store.rows.has(first.gameId));
    const rows: string[] = [];
    const manager = new GameManager({ onResults: (r) => r.forEach((row) => rows.push(`${row.userId}:${row.gameId}`)) });
    start(manager, store);
    await until(() => manager.peekState(first.gameId) !== undefined);
    manager.endGame('p1', first.gameId); // an abandoned game by the host: recorded for the host's account only
    expect(rows).toEqual([`u1:${first.room().runId}`]);
  });

  it('drops a saved game this build cannot read, and carries on', async () => {
    const store = new MemoryGameStore();
    const first = playing();
    start(first.manager, store);
    await until(() => store.rows.has(first.gameId));
    const row = store.rows.get(first.gameId)!;
    (row.room.state as unknown as Record<string, unknown>).gamePhase = 'not-a-phase';
    const manager = new GameManager();
    start(manager, store);
    await until(() => !store.rows.has(first.gameId));
    expect(manager.peekState(first.gameId)).toBeUndefined();
  });

  it('keeps play going when the store fails, says so, and recovers by itself', async () => {
    const store = new MemoryGameStore();
    const l = playing();
    const { live } = start(l.manager, store);
    await until(() => store.rows.has(l.gameId));
    store.failWith = new Error('connection refused');
    const hand = l.room().gameState.players[0]!.hand[0]!;
    expect(() => l.manager.playCard('p1', { gameId: l.gameId, cardId: hand.id, pileId: 0 })).not.toThrow();
    await until(() => live.status() === 'down');
    expect(l.manager.peekState(l.gameId)!.foundationPiles[0]!.topCard.id).toBe(hand.id);
    store.failWith = null;
    await until(() => live.status() === 'ok');
    expect(store.rows.get(l.gameId)!.room.state.foundationPiles[0]!.topCard.id).toBe(hand.id);
  });

  it('serves play from memory while another process holds the lock, then loads and writes once it has it', async () => {
    const store = new MemoryGameStore();
    const l = playing();
    const lock = new FakeLock();
    lock.grant = false;
    const { live } = start(l.manager, store, lock);
    await wait(60);
    expect(live.status()).toBe('waiting');
    expect(store.rows.size).toBe(0);
    expect(lock.attempts).toBeGreaterThan(1);
    lock.grant = true;
    await until(() => store.rows.has(l.gameId)); // the game made while waiting is saved too
    expect(live.status()).toBe('ok');
  });

  it('stops writing when the lock is lost, and starts again when it is back', async () => {
    const store = new MemoryGameStore();
    const l = playing();
    const lock = new FakeLock();
    const { live } = start(l.manager, store, lock);
    await until(() => store.rows.has(l.gameId));
    const before = store.rows.get(l.gameId)!.version;
    lock.grant = false;
    lock.lose();
    expect(live.status()).toBe('waiting');
    const hand = l.room().gameState.players[0]!.hand[0]!;
    l.manager.playCard('p1', { gameId: l.gameId, cardId: hand.id, pileId: 0 });
    await wait(60);
    expect(store.rows.get(l.gameId)!.version).toBe(before);
    lock.grant = true;
    await until(() => store.rows.get(l.gameId)!.version > before);
  });

  // The lock is a courtesy; the version is the guarantee. A process that lost its place cannot overwrite a newer state.
  it('refuses to overwrite a newer state written by another process, and stops writing', async () => {
    const store = new MemoryGameStore();
    const l = playing();
    const { live } = start(l.manager, store);
    await until(() => store.rows.has(l.gameId));
    const row = store.rows.get(l.gameId)!;
    store.rows.set(l.gameId, { ...row, version: row.version + 50 });
    const hand = l.room().gameState.players[0]!.hand[0]!;
    l.manager.playCard('p1', { gameId: l.gameId, cardId: hand.id, pileId: 0 });
    await until(() => live.status() === 'waiting');
    expect(store.rows.get(l.gameId)!.version).toBe(row.version + 50);
  });

  it('flushes one game at once, and gives up quickly when the store hangs', async () => {
    const store = new MemoryGameStore();
    const l = playing();
    const { live } = start(l.manager, store, new FakeLock(), { intervalMs: 60_000 });
    await until(() => live.status() === 'ok');
    await live.flush(l.gameId);
    expect(store.rows.has(l.gameId)).toBe(true);
    const slow = new MemoryGameStore();
    slow.upsert = () => new Promise(() => undefined);
    const other = playing();
    const { live: hanging } = start(other.manager, slow, new FakeLock(), { intervalMs: 60_000 });
    await until(() => hanging.status() === 'ok');
    const startedAt = Date.now();
    await hanging.flush(other.gameId, 100);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('keeps an abandoned game for a day once saving is on, instead of half an hour', async () => {
    const store = new MemoryGameStore();
    const l = playing();
    const { live } = start(l.manager, store);
    await until(() => live.status() === 'ok');
    const connected = new Set<string>();
    const nowMs = Date.now() + 2 * 60 * 60 * 1000;
    expect(l.manager.reapOrphanedRooms(connected, nowMs)).toEqual([]);
    expect(l.manager.reapOrphanedRooms(connected, Date.now() + LIVE_RETENTION_MS + 1000)).toEqual([l.gameId]);
    await until(() => !store.rows.has(l.gameId)); // and it leaves the store with it
  });
});
