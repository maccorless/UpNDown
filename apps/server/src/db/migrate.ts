import type { Pool } from 'pg';
import { MIGRATIONS, type Migration } from './migrations.js';

// Two containers overlap during a Railway redeploy; the advisory lock makes the second wait, then find nothing to do.
const MIGRATION_LOCK_KEY = 7_265_001;

export async function migrate(pool: Pool, migrations: Migration[] = MIGRATIONS): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query('create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await client.query<{ id: string }>('select id from schema_migrations')).rows.map((row) => row.id));
    for (const migration of migrations) {
      if (done.has(migration.id)) continue;
      try {
        await client.query('begin');
        await client.query(migration.sql);
        await client.query('insert into schema_migrations (id) values ($1)', [migration.id]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
      applied.push(migration.id);
    }
    return applied;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
