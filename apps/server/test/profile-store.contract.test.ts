import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { PgProfileStore, type ProfileStore } from '../src/profile/store.js';
import { MemoryProfileStore } from './helpers/memory-store.js';

const url = process.env.TEST_DATABASE_URL;
const hash = (n: number): Buffer => Buffer.from(`token-hash-${n}`.padEnd(32, '0'));
const at = (iso: string): Date => new Date(iso);

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
