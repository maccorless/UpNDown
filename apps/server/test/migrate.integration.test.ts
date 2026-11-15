import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { MIGRATIONS } from '../src/db/migrations.js';

// Needs a real Postgres (CI service container). Set TEST_DATABASE_URL to run locally.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('migrations against Postgres', () => {
  const schema = `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const makePool = () => new pg.Pool({ connectionString: url, max: 3, options: `-c search_path=${schema}` });
  let admin: pg.Pool;
  let pool: pg.Pool;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`create schema ${schema}`);
    pool = makePool();
  });
  afterAll(async () => {
    await pool.end();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  });

  it('applies every migration once and applies nothing the second time', async () => {
    expect(await migrate(pool)).toEqual(MIGRATIONS.map((m) => m.id));
    expect(await migrate(pool)).toEqual([]);
    const tables = await pool.query<{ table_name: string }>('select table_name from information_schema.tables where table_schema = $1', [schema]);
    expect(tables.rows.map((r) => r.table_name)).toEqual(expect.arrayContaining(['users', 'identities', 'sessions', 'game_results', 'schema_migrations']));
  });

  // Two containers run during a redeploy. Without the advisory lock the second one fails on "table already exists".
  it('lets two containers migrate at the same time without error', async () => {
    const other = `${schema}_b`;
    await admin.query(`create schema ${other}`);
    const a = new pg.Pool({ connectionString: url, max: 2, options: `-c search_path=${other}` });
    const b = new pg.Pool({ connectionString: url, max: 2, options: `-c search_path=${other}` });
    try {
      const [first, second] = await Promise.all([migrate(a), migrate(b)]);
      expect([first.length, second.length].sort()).toEqual([0, MIGRATIONS.length]);
    } finally {
      await a.end();
      await b.end();
      await admin.query(`drop schema ${other} cascade`);
    }
  });

  it('rolls a failing migration back completely and records nothing', async () => {
    const bad = [{ id: 'bad', sql: 'create table half_made (id int); select 1/0;' }];
    await expect(migrate(pool, bad)).rejects.toThrow(/division by zero/);
    const left = await pool.query("select to_regclass('half_made') as t");
    expect(left.rows[0].t).toBeNull();
    const recorded = await pool.query("select 1 from schema_migrations where id = 'bad'");
    expect(recorded.rowCount).toBe(0);
  });

  // Accounts made before the column existed must come out unconfirmed, so their owners are asked once.
  it('adds name_confirmed as false to accounts that already existed', async () => {
    const other = `${schema}_c`;
    await admin.query(`create schema ${other}`);
    const p = new pg.Pool({ connectionString: url, max: 2, options: `-c search_path=${other}` });
    try {
      await migrate(p, [MIGRATIONS[0]!]);
      const { rows } = await p.query<{ id: string }>('insert into users default values returning id');
      expect(await migrate(p)).toEqual(['002_name_confirmed', '003_cheats_in_results']);
      const after = await p.query('select name_confirmed from users where id = $1', [rows[0]!.id]);
      expect(after.rows[0].name_confirmed).toBe(false);
    } finally {
      await p.end();
      await admin.query(`drop schema ${other} cascade`);
    }
  });

  const addUser = async () => (await pool.query<{ id: string }>('insert into users default values returning id')).rows[0]!.id;
  const addResult = (userId: string, gameId: string, outcome = 'won') => pool.query(
    `insert into game_results (user_id, game_id, mode, outcome, started_at, ended_at, duration_ms, turns, player_count,
       cards_total, cards_left, my_cards_played, my_total_movement, my_special_plays, my_nas_cheats, hand_size,
       min_cards_per_turn, max_card, settings)
     values ($1, $2, 'multiplayer', $3, now(), now(), 1000, 5, 2, 98, 0, 20, 100, 1, 0, 7, 2, 99, '{}')`,
    [userId, gameId, outcome]
  );

  // The privacy page promises deletion removes everything. The cascade is what keeps that true.
  it('deleting a user removes their identities, sessions and results', async () => {
    const id = await addUser();
    await pool.query("insert into identities (provider, provider_user_id, user_id) values ('google', 'g-123', $1)", [id]);
    await pool.query("insert into sessions (token_hash, user_id, expires_at) values ('\\x01', $1, now() + interval '1 day')", [id]);
    await addResult(id, 'run-1');
    await pool.query('delete from users where id = $1', [id]);
    for (const table of ['identities', 'sessions', 'game_results']) {
      expect((await pool.query(`select 1 from ${table} where user_id = $1`, [id])).rowCount).toBe(0);
    }
  });

  // A retried write of the same game must not double count in someone's stats.
  it('rejects a second result row for the same user and game', async () => {
    const id = await addUser();
    await addResult(id, 'run-2');
    await expect(addResult(id, 'run-2')).rejects.toThrow(/duplicate key/);
  });

  it('rejects an unknown outcome and an unknown provider', async () => {
    const id = await addUser();
    await expect(addResult(id, 'run-3', 'tied')).rejects.toThrow(/check constraint/);
    await expect(pool.query("insert into identities (provider, provider_user_id, user_id) values ('facebook', 'f-1', $1)", [id])).rejects.toThrow(/check constraint/);
  });

  it('allows one identity per Google account', async () => {
    const a = await addUser();
    const b = await addUser();
    await pool.query("insert into identities (provider, provider_user_id, user_id) values ('google', 'same', $1)", [a]);
    await expect(pool.query("insert into identities (provider, provider_user_id, user_id) values ('google', 'same', $1)", [b])).rejects.toThrow(/duplicate key/);
  });
});
