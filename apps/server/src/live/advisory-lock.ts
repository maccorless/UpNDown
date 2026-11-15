import pg from 'pg';

// The key is distinct from the migration runner's (db/migrate.ts), so a migration never waits on, or is held up by, this lock.
export const LIVE_GAMES_LOCK_KEY = 7_265_002;

export interface WriterLock {
  // True when this process now holds the lock.
  tryAcquire(): Promise<boolean>;
  release(): Promise<void>;
  // Called when a lock that was held is lost (the connection died).
  onLost(listener: () => void): void;
}

// A Postgres session-level advisory lock on its own dedicated connection, not the shared pool: a pool may drop an idle
// client, which would release the lock without anyone noticing. When this connection ends the lock is gone, and the
// listener is told, so the process stops writing at once. Correctness does not rest on the lock alone: writes also carry a
// version (see GameStore), so a stale writer cannot overwrite a newer state whatever the lock does.
export class AdvisoryLock implements WriterLock {
  private client: pg.Client | undefined;
  private readonly listeners: Array<() => void> = [];

  constructor(private readonly connectionString: string, private readonly key: number = LIVE_GAMES_LOCK_KEY) {}

  onLost(listener: () => void): void {
    this.listeners.push(listener);
  }

  async tryAcquire(): Promise<boolean> {
    if (this.client) return true;
    const client = new pg.Client({ connectionString: this.connectionString, connectionTimeoutMillis: 5000, keepAlive: true });
    // An error on an idle connection must not crash the process; it means the lock is lost.
    client.on('error', () => this.lose(client));
    client.on('end', () => this.lose(client));
    try {
      await client.connect();
      const { rows } = await client.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [this.key]);
      if (!rows[0]?.ok) {
        client.removeAllListeners();
        client.on('error', () => undefined);
        await client.end().catch(() => undefined);
        return false;
      }
      this.client = client;
      return true;
    } catch {
      client.removeAllListeners();
      client.on('error', () => undefined);
      await client.end().catch(() => undefined);
      return false;
    }
  }

  private lose(client: pg.Client): void {
    if (this.client !== client) return;
    this.client = undefined;
    for (const listener of this.listeners) listener();
  }

  async release(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (!client) return;
    client.removeAllListeners();
    client.on('error', () => undefined);
    await client.query('select pg_advisory_unlock($1)', [this.key]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
