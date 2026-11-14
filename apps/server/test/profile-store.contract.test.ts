import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { PgProfileStore, type GameResultRow, type ProfileStore } from '../src/profile/store.js';
import { MemoryProfileStore } from './helpers/memory-store.js';

const url = process.env.TEST_DATABASE_URL;
const hash = (n: number): Buffer => Buffer.from(`token-hash-${n}`.padEnd(32, '0'));
const at = (iso: string): Date => new Date(iso);
const resultRow = (userId: string, gameId: string, over: Partial<GameResultRow> = {}): GameResultRow => ({
  userId, gameId, mode: 'multiplayer', outcome: 'won', startedAt: at('2030-01-01T10:00:00Z'), endedAt: at('2030-01-01T10:20:00Z'),
  durationMs: 1_200_000, turns: 14, playerCount: 3, cardsTotal: 98, cardsLeft: 0, myCardsPlayed: 30, myTotalMovement: -8,
  mySpecialPlays: 2, myNasCheats: 0, handSize: 7, minCardsPerTurn: 2, maxCard: 99, settings: { handSize: 7 }, ...over
});

// One set of rules, run against both stores, so route tests on the in-memory store say something about Postgres.
function contract(make: () => Promise<ProfileStore>): void {
  let store: ProfileStore;
  beforeAll(async () => { store = await make(); });

  it('gives the same user for the same Google account, and a new user for another one', async () => {
    const a = await store.findOrCreateUser('google', 'acct-a');
    expect((await store.findOrCreateUser('google', 'acct-a')).userId).toBe(a.userId);
    expect((await store.findOrCreateUser('google', 'acct-b')).userId).not.toBe(a.userId);
  });

  // Two callbacks for one new account (double click on the Google button) must not make two users.
  it('makes one user when the same new account signs in twice at once', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => store.findOrCreateUser('google', 'acct-race')));
    expect(new Set(results.map((r) => r.userId)).size).toBe(1);
  });

  it('starts new accounts with empty settings and reports a missing user as null', async () => {
    const { userId } = await store.findOrCreateUser('google', 'acct-settings');
    expect(await store.getSettings(userId)).toEqual({});
    expect(await store.getSettings('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('sets a name once: later candidates and later callers get the first name back', async () => {
    const { userId } = await store.findOrCreateUser('google', 'acct-name');
    expect(await store.ensurePlayerName(userId, 'Harry Truman')).toBe('Harry Truman');
    expect(await store.ensurePlayerName(userId, 'Other Name')).toBe('Harry Truman');
    expect((await store.getSettings(userId))?.playerName).toBe('Harry Truman');
  });

  it('keeps the rest of the settings when it adds a name, and reports a missing account as null', async () => {
    const { userId } = await store.findOrCreateUser('google', 'acct-name-keep');
    await store.replaceSettings(userId, { enableSounds: false });
    expect(await store.ensurePlayerName(userId, 'Gerald Ford')).toBe('Gerald Ford');
    expect(await store.getSettings(userId)).toEqual({ enableSounds: false, playerName: 'Gerald Ford' });
    expect(await store.ensurePlayerName('00000000-0000-0000-0000-000000000000', 'X Y')).toBeNull();
  });

  // Two tabs loading a brand new account at once must end up with one name, not two.
  it('gives every caller the same name when several race to name a new account', async () => {
    const { userId } = await store.findOrCreateUser('google', 'acct-name-race');
    const names = await Promise.all(Array.from({ length: 6 }, (_, i) => store.ensurePlayerName(userId, `Candidate ${i}`)));
    expect(new Set(names).size).toBe(1);
    expect((await store.getSettings(userId))?.playerName).toBe(names[0]);
  });

  it('starts every account unconfirmed, and confirming stores the name and marks it chosen', async () => {
    const { userId } = await store.findOrCreateUser('google', 'acct-confirm');
    expect(await store.getNameConfirmed(userId)).toBe(false);
    await store.ensurePlayerName(userId, 'Grover Arthur');
    expect(await store.getNameConfirmed(userId)).toBe(false);
    expect(await store.confirmPlayerName(userId, 'Pat')).toBe(true);
    expect(await store.getNameConfirmed(userId)).toBe(true);
    expect((await store.getSettings(userId))?.playerName).toBe('Pat');
  });

  it('keeps the other settings when a name is confirmed, and reports a missing account', async () => {
    const { userId } = await store.findOrCreateUser('google', 'acct-confirm-keep');
    await store.replaceSettings(userId, { playerName: 'A B', enableSounds: false });
    await store.confirmPlayerName(userId, 'C D');
    expect(await store.getSettings(userId)).toEqual({ playerName: 'C D', enableSounds: false });
    const ghost = '00000000-0000-0000-0000-000000000000';
    expect(await store.getNameConfirmed(ghost)).toBeNull();
    expect(await store.confirmPlayerName(ghost, 'X Y')).toBe(false);
  });

  it('confirms through replaceSettings only when asked, and never un-confirms', async () => {
    const { userId } = await store.findOrCreateUser('google', 'acct-confirm-replace');
    await store.replaceSettings(userId, { playerName: 'A B' });
    expect(await store.getNameConfirmed(userId)).toBe(false);
    await store.replaceSettings(userId, { playerName: 'A B' }, { confirmName: true });
    expect(await store.getNameConfirmed(userId)).toBe(true);
    await store.replaceSettings(userId, { playerName: 'A B', enableSounds: true }, { confirmName: false });
    expect(await store.getNameConfirmed(userId)).toBe(true);
  });

  it('records a result once: the same game written again is a duplicate, a different game is a new row', async () => {
    const { userId } = await store.findOrCreateUser('google', 'acct-results');
    expect(await store.recordResults([resultRow(userId, 'run-1')])).toEqual([{ userId, outcome: 'inserted' }]);
    expect(await store.recordResults([resultRow(userId, 'run-1')])).toEqual([{ userId, outcome: 'duplicate' }]);
    expect(await store.recordResults([resultRow(userId, 'run-2')])).toEqual([{ userId, outcome: 'inserted' }]);
  });

  // A player who deleted their account between joining and the end must not cost the others their result.
  it('skips a row whose account is gone and still records the rest of the game', async () => {
    const a = await store.findOrCreateUser('google', 'acct-res-a');
    const b = await store.findOrCreateUser('google', 'acct-res-b');
    const ghost = '00000000-0000-0000-0000-000000000000';
    const outcomes = await store.recordResults([resultRow(a.userId, 'run-3'), resultRow(ghost, 'run-3'), resultRow(b.userId, 'run-3')]);
    expect(outcomes.map((o) => o.outcome)).toEqual(['inserted', 'user_missing', 'inserted']);
  });

  it('records two players of the same game, each under their own account', async () => {
    const a = await store.findOrCreateUser('google', 'acct-res-c');
    const b = await store.findOrCreateUser('google', 'acct-res-d');
    const outcomes = await store.recordResults([resultRow(a.userId, 'run-4'), resultRow(b.userId, 'run-4')]);
    expect(outcomes.map((o) => o.outcome)).toEqual(['inserted', 'inserted']);
  });

  it('replaces the whole settings document', async () => {
    const { userId } = await store.findOrCreateUser('google', 'acct-replace');
    await store.replaceSettings(userId, { playerName: 'A B', enableSounds: false });
    await store.replaceSettings(userId, { playerName: 'C D' });
    expect(await store.getSettings(userId)).toEqual({ playerName: 'C D' });
  });

  it('finds a live session, hides an expired one, and forgets a revoked one', async () => {
    const { userId } = await store.findOrCreateUser('google', 'acct-sessions');
    await store.createSession(userId, hash(1), at('2030-01-10T00:00:00Z'));
    expect((await store.findSession(hash(1), at('2030-01-01T00:00:00Z')))?.userId).toBe(userId);
    expect(await store.findSession(hash(1), at('2030-01-10T00:00:01Z'))).toBeNull();
    await store.revokeSession(hash(1));
    expect(await store.findSession(hash(1), at('2030-01-01T00:00:00Z'))).toBeNull();
  });

  it('touch moves last seen and expiry', async () => {
    const { userId } = await store.findOrCreateUser('google', 'acct-touch');
    await store.createSession(userId, hash(2), at('2030-01-10T00:00:00Z'));
    await store.touchSession(hash(2), at('2030-01-05T00:00:00Z'), at('2030-04-05T00:00:00Z'));
    const session = await store.findSession(hash(2), at('2030-02-01T00:00:00Z'));
    expect(session?.lastSeenAt.toISOString()).toBe('2030-01-05T00:00:00.000Z');
    expect(session?.expiresAt.toISOString()).toBe('2030-04-05T00:00:00.000Z');
  });

  it('sweeps only expired sessions', async () => {
    const { userId } = await store.findOrCreateUser('google', 'acct-sweep');
    await store.createSession(userId, hash(3), at('2020-01-01T00:00:00Z'));
    await store.createSession(userId, hash(4), at('2099-01-01T00:00:00Z'));
    expect(await store.deleteExpiredSessions(at('2030-01-01T00:00:00Z'))).toBeGreaterThanOrEqual(1);
    expect(await store.findSession(hash(4), at('2030-01-01T00:00:00Z'))).not.toBeNull();
  });
}

describe('MemoryProfileStore', () => contract(async () => new MemoryProfileStore()));

describe.skipIf(!url)('PgProfileStore', () => {
  const schema = `s_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  contract(async () => {
    admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`create schema ${schema}`);
    pool = new pg.Pool({ connectionString: url, max: 6, options: `-c search_path=${schema}` });
    await migrate(pool);
    // Open every connection first. Lazily opened ones stagger the callers, and the race below never happens.
    await Promise.all(Array.from({ length: 6 }, () => pool.query('select pg_sleep(0.05)')));
    return new PgProfileStore(pool);
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`drop schema ${schema} cascade`);
    await admin?.end();
  });
});

// Production caps the pool at 3. A losing racer that asks the pool for a second connection while it holds
// one deadlocks once every connection is held by a loser, and the sign-in hangs until it times out.
describe.skipIf(!url)('PgProfileStore with a small pool', () => {
  const schema = `p_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`create schema ${schema}`);
    pool = new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 4000, options: `-c search_path=${schema}` });
    await migrate(pool);
    await Promise.all(Array.from({ length: 3 }, () => pool.query('select pg_sleep(0.05)')));
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  it('resolves many simultaneous first sign-ins for one account to one user, without hanging', async () => {
    const store = new PgProfileStore(pool);
    const results = await Promise.all(Array.from({ length: 8 }, () => store.findOrCreateUser('google', 'acct-small-pool')));
    expect(new Set(results.map((r) => r.userId)).size).toBe(1);
  }, 10_000);
});

describe.skipIf(!url)('PgProfileStore result rows', () => {
  const schema = `r_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let store: PgProfileStore;
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`create schema ${schema}`);
    pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` });
    await migrate(pool);
    store = new PgProfileStore(pool);
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  it('stores every field as given, including a negative net movement and the settings snapshot', async () => {
    const { userId } = await store.findOrCreateUser('google', 'pg-fields');
    await store.recordResults([resultRow(userId, 'run-fields', { myTotalMovement: -8, settings: { handSize: 7, allowUndo: true } })]);
    const { rows } = await pool.query('select * from game_results where user_id = $1', [userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      game_id: 'run-fields', mode: 'multiplayer', outcome: 'won', duration_ms: 1_200_000, turns: 14, player_count: 3,
      cards_total: 98, cards_left: 0, my_cards_played: 30, my_total_movement: -8, my_special_plays: 2, my_nas_cheats: 0,
      hand_size: 7, min_cards_per_turn: 2, max_card: 99, settings: { handSize: 7, allowUndo: true }
    });
    expect(rows[0].started_at.toISOString()).toBe('2030-01-01T10:00:00.000Z');
    expect(rows[0].ended_at.toISOString()).toBe('2030-01-01T10:20:00.000Z');
  });

  // One row the database refuses (here a made-up outcome) must be reported, and the neighbours must still be written.
  it('reports a row the database rejects as failed with its code, and still writes the rows around it', async () => {
    const a = await store.findOrCreateUser('google', 'pg-bad-a');
    const b = await store.findOrCreateUser('google', 'pg-bad-b');
    const outcomes = await store.recordResults([
      resultRow(a.userId, 'run-bad'),
      resultRow(b.userId, 'run-bad', { outcome: 'tied' as never }),
      resultRow(a.userId, 'run-bad-2')
    ]);
    expect(outcomes.map((o) => o.outcome)).toEqual(['inserted', 'failed', 'inserted']);
    expect(outcomes[1]?.code).toBe('23514');
    expect((await pool.query('select 1 from game_results where user_id = $1', [b.userId])).rowCount).toBe(0);
    expect((await pool.query('select 1 from game_results where user_id = $1', [a.userId])).rowCount).toBe(2);
  });

  // The same game arriving twice at once (a retry racing the original) must leave exactly one row.
  it('leaves one row when the same game is written many times at once', async () => {
    const { userId } = await store.findOrCreateUser('google', 'pg-concurrent');
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => store.recordResults([resultRow(userId, 'run-race')])));
    const flat = outcomes.flat().map((o) => o.outcome).sort();
    expect(flat.filter((o) => o === 'inserted')).toHaveLength(1);
    expect(flat.filter((o) => o === 'duplicate')).toHaveLength(5);
    expect((await pool.query('select 1 from game_results where user_id = $1', [userId])).rowCount).toBe(1);
  });
});

