import { createStartedGameState, buildDeck } from '@upndown/engine';
import { defaultMultiplayerSettings } from '@upndown/shared-types';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import type { StoredRoom } from '../src/game-manager.js';
import { AdvisoryLock } from '../src/live/advisory-lock.js';
import { MemoryGameStore, PgGameStore, type GameStore } from '../src/live/game-store.js';

const url = process.env.TEST_DATABASE_URL;

const room = (gameId: string, over: Partial<StoredRoom> = {}): StoredRoom => ({
  gameId,
  state: createStartedGameState({
    gameId, hostId: 'p1', players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bob' }],
    settings: defaultMultiplayerSettings, isSolitaire: false, deck: buildDeck(defaultMultiplayerSettings)
  }),
  seatUsers: { p1: 'u1' },
  tokenHashes: { p1: 'h1', p2: 'h2' },
  runId: 'run-1',
  updatedAtMs: 1_000_000,
  ...over
});

// One set of rules, run against both stores, so tests on the memory store say something about Postgres.
function contract(make: () => Promise<GameStore>): void {
  it('stores a game and reads it back exactly, including who is signed in and the token hashes', async () => {
    const store = await make();
    expect(await store.upsert(room('AAAAAA'), 1)).toBe('written');
    const [row] = await store.loadRecent(0);
    expect(row!.version).toBe(1);
    expect(row!.room).toMatchObject({ gameId: 'AAAAAA', seatUsers: { p1: 'u1' }, tokenHashes: { p1: 'h1', p2: 'h2' }, runId: 'run-1', updatedAtMs: 1_000_000 });
    expect(row!.room.state.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
  });

  it('refuses a write that is not newer than what is stored, so a stale writer cannot overwrite', async () => {
    const store = await make();
    await store.upsert(room('BBBBBB', { runId: 'new' }), 5);
    expect(await store.upsert(room('BBBBBB', { runId: 'older' }), 5)).toBe('stale');
    expect(await store.upsert(room('BBBBBB', { runId: 'oldest' }), 4)).toBe('stale');
    expect((await store.loadRecent(0)).find((r) => r.room.gameId === 'BBBBBB')!.room.runId).toBe('new');
    expect(await store.upsert(room('BBBBBB', { runId: 'newest' }), 6)).toBe('written');
    expect((await store.loadRecent(0)).find((r) => r.room.gameId === 'BBBBBB')!.room.runId).toBe('newest');
  });

  it('removes a game, and only loads games touched recently enough', async () => {
    const store = await make();
    await store.upsert(room('CCCCCC', { updatedAtMs: 10_000 }), 1);
    await store.upsert(room('DDDDDD', { updatedAtMs: 90_000 }), 1);
    expect((await store.loadRecent(50_000)).map((r) => r.room.gameId)).toEqual(['DDDDDD']);
    await store.remove('DDDDDD');
    expect((await store.loadRecent(0)).map((r) => r.room.gameId)).toEqual(['CCCCCC']);
  });

  it('purges games left untouched, and says how many', async () => {
    const store = await make();
    await store.upsert(room('EEEEEE', { updatedAtMs: 10_000 }), 1);
    await store.upsert(room('FFFFFF', { updatedAtMs: 90_000 }), 1);
    expect(await store.purgeOlderThan(50_000)).toBe(1);
    expect((await store.loadRecent(0)).map((r) => r.room.gameId)).toEqual(['FFFFFF']);
  });
}

describe('MemoryGameStore', () => {
  contract(async () => new MemoryGameStore());
});

describe.skipIf(!url)('PgGameStore', () => {
  const schema = `l_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  contract(async () => {
    // A fresh table per test keeps the tests independent.
    await pool.query('truncate live_games');
    return new PgGameStore(pool);
  });
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`create schema ${schema}`);
    pool = new pg.Pool({ connectionString: url, max: 3, options: `-c search_path=${schema}` });
    await migrate(pool);
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`drop schema ${schema} cascade`);
    await admin?.end();
  });
});

describe.skipIf(!url)('the advisory lock', () => {
  let key = 9_100_000;
  const locks: AdvisoryLock[] = [];
  afterAll(async () => { await Promise.all(locks.map((l) => l.release())); });
  // Each test uses its own key, so a lock one test still holds cannot affect the next.
  const make = (k: number): AdvisoryLock => { const lock = new AdvisoryLock(url!, k); locks.push(lock); return lock; };

  it('lets one process hold it at a time, and the next take it when the first lets go', async () => {
    key += 1;
    const first = make(key);
    const second = make(key);
    expect(await first.tryAcquire()).toBe(true);
    expect(await second.tryAcquire()).toBe(false);
    await first.release();
    expect(await second.tryAcquire()).toBe(true);
  });

  it('tells its owner when the connection holding it dies, and frees it for the next process', async () => {
    key += 1;
    const first = make(key);
    let lost = 0;
    first.onLost(() => { lost += 1; });
    expect(await first.tryAcquire()).toBe(true);
    // Another session kills the lock holder's connection, as a database restart or a network drop would.
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query('select pg_terminate_backend(pid) from pg_locks where locktype = $1 and objid = $2 and granted', ['advisory', key]);
    for (let i = 0; i < 100 && lost === 0; i += 1) await new Promise((resolve) => { setTimeout(resolve, 20); });
    await admin.end();
    expect(lost).toBe(1);
    const second = make(key);
    expect(await second.tryAcquire()).toBe(true);
  });
});
