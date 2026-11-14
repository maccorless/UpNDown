import { describe, expect, it } from 'vitest';
import type { AuthSettings } from '../src/auth/config.js';
import { createAuthRuntime } from '../src/auth/runtime.js';
import type { GameResultRow, RecordOutcome } from '../src/profile/store.js';
import { createFakeProvider } from './helpers/fake-provider.js';
import { MemoryProfileStore } from './helpers/memory-store.js';

const settings: AuthSettings = {
  databaseUrl: 'unused', publicBaseUrl: 'https://upndown.cloud', stateSecret: 's'.repeat(40),
  googleClientId: 'id', googleClientSecret: 'secret', legacyHost: undefined
};
const row = (userId: string, gameId = 'run-1'): GameResultRow => ({
  userId, gameId, mode: 'multiplayer', outcome: 'won', startedAt: new Date(0), endedAt: new Date(1000), durationMs: 1000, turns: 3,
  playerCount: 2, cardsTotal: 98, cardsLeft: 0, myCardsPlayed: 5, myTotalMovement: 5, mySpecialPlays: 0, myNasCheats: 0,
  handSize: 7, minCardsPerTurn: 2, maxCard: 99, settings: {}
});

type Entry = { level: string; event: string; fields?: Record<string, unknown> | undefined };
function setup(store: MemoryProfileStore, drainTimeoutMs = 100) {
  const logs: Entry[] = [];
  const log = (level: string, event: string, fields?: Record<string, unknown>) => { logs.push({ level, event, fields }); };
  const auth = createAuthRuntime({}, log as never, { overrides: { settings, store, provider: createFakeProvider() }, drainTimeoutMs });
  return { auth, logs };
}
const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

describe('recording through the runtime', () => {
  it('writes the rows and logs one summary per game: counts only, no account ids', async () => {
    const store = new MemoryProfileStore();
    const { userId } = await store.findOrCreateUser('google', 'g1');
    const { auth, logs } = setup(store);
    await auth.start();
    auth.recordResults([row(userId), row('00000000-0000-0000-0000-000000000000')]);
    await auth.stop();
    expect(store.results).toHaveLength(1);
    const summary = logs.find((l) => l.event === 'game.results_recorded');
    expect(summary?.fields).toMatchObject({ runId: 'run-1', rows: 2, inserted: 1, duplicate: 0, userMissing: 1, failed: 0 });
    expect(JSON.stringify(logs)).not.toContain(userId);
  });

  it('counts a repeat of the same game as a duplicate, not a second row', async () => {
    const store = new MemoryProfileStore();
    const { userId } = await store.findOrCreateUser('google', 'g1');
    const { auth, logs } = setup(store);
    await auth.start();
    auth.recordResults([row(userId)]);
    auth.recordResults([row(userId)]);
    await auth.stop();
    expect(store.results).toHaveLength(1);
    expect(logs.filter((l) => l.event === 'game.results_recorded').map((l) => l.fields?.duplicate)).toEqual([0, 1]);
  });

  // The error text of a database can carry the values being written, so a failure is logged by code alone.
  it('logs a failed write once, by code, and never throws', async () => {
    const store = new MemoryProfileStore();
    store.recordResults = async (rows) => rows.map((r) => ({ userId: r.userId, outcome: 'failed' as RecordOutcome, code: '23514' }));
    const { auth, logs } = setup(store);
    await auth.start();
    expect(() => auth.recordResults([row('u1'), row('u2')])).not.toThrow();
    await auth.stop();
    const warnings = logs.filter((l) => l.event === 'game.result_write_failed');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.fields).toMatchObject({ count: 2, codes: ['23514'] });
  });

  it('survives a store that throws outright, logging the error name only', async () => {
    const store = new MemoryProfileStore();
    store.recordResults = async () => { throw Object.assign(new Error('password=hunter2 in the message'), { name: 'ConnectionError' }); };
    const { auth, logs } = setup(store);
    await auth.start();
    auth.recordResults([row('u1')]);
    await auth.stop();
    const warning = logs.find((l) => l.event === 'game.result_write_failed');
    expect(warning?.fields?.codes).toEqual(['ConnectionError']);
    expect(JSON.stringify(logs)).not.toContain('hunter2');
  });

  it('does nothing, quietly, when auth is off', async () => {
    const logs: Entry[] = [];
    const auth = createAuthRuntime({}, ((level: string, event: string) => { logs.push({ level, event }); }) as never);
    await auth.start();
    expect(() => auth.recordResults([row('u1')])).not.toThrow();
    await auth.stop();
    expect(logs.map((l) => l.event)).toEqual(['auth.disabled']);
  });

  it('ignores an empty batch', async () => {
    const store = new MemoryProfileStore();
    const { auth, logs } = setup(store);
    await auth.start();
    auth.recordResults([]);
    await auth.stop();
    expect(logs.some((l) => l.event === 'game.results_recorded')).toBe(false);
  });
});

describe('shutdown', () => {
  // A redeploy must not drop a result that is mid-write.
  it('waits for a write in flight before it lets go of the database', async () => {
    const store = new MemoryProfileStore();
    const { userId } = await store.findOrCreateUser('google', 'g1');
    const inner = store.recordResults.bind(store);
    let finished = false;
    store.recordResults = async (rows) => { await sleep(40); const r = await inner(rows); finished = true; return r; };
    const { auth } = setup(store, 1000);
    await auth.start();
    auth.recordResults([row(userId)]);
    await auth.stop();
    expect(finished).toBe(true);
    expect(store.results).toHaveLength(1);
  });

  it('waits for a game that ends while it is already waiting', async () => {
    const store = new MemoryProfileStore();
    const a = await store.findOrCreateUser('google', 'g1');
    const b = await store.findOrCreateUser('google', 'g2');
    const inner = store.recordResults.bind(store);
    store.recordResults = async (rows) => { await sleep(40); return inner(rows); };
    const { auth } = setup(store, 1000);
    await auth.start();
    auth.recordResults([row(a.userId, 'run-a')]);
    const stopping = auth.stop();
    await sleep(10);
    auth.recordResults([row(b.userId, 'run-b')]);
    await stopping;
    expect(store.results.map((r) => r.gameId).sort()).toEqual(['run-a', 'run-b']);
  });

  // A database that never answers must not hold a redeploy hostage.
  it('gives up on a write that never finishes, after the timeout', async () => {
    const store = new MemoryProfileStore();
    store.recordResults = () => new Promise(() => undefined);
    const { auth } = setup(store, 120);
    await auth.start();
    auth.recordResults([row('u1')]);
    const started = Date.now();
    await auth.stop();
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(100);
    expect(took).toBeLessThan(1500);
  });

  it('stops at once when nothing is in flight', async () => {
    const { auth } = setup(new MemoryProfileStore(), 5000);
    await auth.start();
    const started = Date.now();
    await auth.stop();
    expect(Date.now() - started).toBeLessThan(500);
  });
});
