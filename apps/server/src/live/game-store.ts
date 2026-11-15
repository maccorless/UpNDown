import type { Pool } from 'pg';
import type { StoredRoom } from '../game-manager.js';

export interface StoredRow {
  room: StoredRoom;
  version: number;
}

// Where games being played are kept so they can survive a restart. Writes are ordered by a version: a write with a version
// that is not higher than the stored one is refused ('stale'), so a process that has lost its place can never overwrite
// a newer state.
export interface GameStore {
  upsert(room: StoredRoom, version: number): Promise<'written' | 'stale'>;
  remove(gameId: string): Promise<void>;
  loadRecent(sinceMs: number): Promise<StoredRow[]>;
  purgeOlderThan(cutoffMs: number): Promise<number>;
}

export class MemoryGameStore implements GameStore {
  readonly rows = new Map<string, StoredRow>();
  // Tests make it fail to see that a failing store never breaks play.
  failWith: Error | null = null;

  async upsert(room: StoredRoom, version: number): Promise<'written' | 'stale'> {
    if (this.failWith) throw this.failWith;
    const existing = this.rows.get(room.gameId);
    if (existing && existing.version >= version) return 'stale';
    this.rows.set(room.gameId, { room: structuredClone(room), version });
    return 'written';
  }

  async remove(gameId: string): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.rows.delete(gameId);
  }

  async loadRecent(sinceMs: number): Promise<StoredRow[]> {
    if (this.failWith) throw this.failWith;
    return [...this.rows.values()].filter((row) => row.room.updatedAtMs >= sinceMs).map((row) => structuredClone(row));
  }

  async purgeOlderThan(cutoffMs: number): Promise<number> {
    let removed = 0;
    for (const [id, row] of this.rows) {
      if (row.room.updatedAtMs < cutoffMs) { this.rows.delete(id); removed += 1; }
    }
    return removed;
  }
}

export class PgGameStore implements GameStore {
  constructor(private readonly pool: Pool) {}

  async upsert(room: StoredRoom, version: number): Promise<'written' | 'stale'> {
    const result = await this.pool.query(
      `insert into live_games (game_id, state, seat_users, token_hashes, run_id, version, updated_at)
       values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7)
       on conflict (game_id) do update
         set state = excluded.state, seat_users = excluded.seat_users, token_hashes = excluded.token_hashes,
             run_id = excluded.run_id, version = excluded.version, updated_at = excluded.updated_at
         where live_games.version < excluded.version`,
      [room.gameId, JSON.stringify(room.state), JSON.stringify(room.seatUsers), JSON.stringify(room.tokenHashes), room.runId, version, new Date(room.updatedAtMs)]
    );
    return (result.rowCount ?? 0) > 0 ? 'written' : 'stale';
  }

  async remove(gameId: string): Promise<void> {
    await this.pool.query('delete from live_games where game_id = $1', [gameId]);
  }

  async loadRecent(sinceMs: number): Promise<StoredRow[]> {
    const { rows } = await this.pool.query<{
      game_id: string; state: unknown; seat_users: Record<string, string>; token_hashes: Record<string, string>;
      run_id: string | null; version: number; updated_at: Date;
    }>('select game_id, state, seat_users, token_hashes, run_id, version, updated_at from live_games where updated_at >= $1', [new Date(sinceMs)]);
    return rows.map((row) => ({
      version: row.version,
      room: {
        gameId: row.game_id,
        state: row.state as StoredRoom['state'],
        seatUsers: row.seat_users,
        tokenHashes: row.token_hashes,
        runId: row.run_id,
        updatedAtMs: row.updated_at.getTime()
      }
    }));
  }

  async purgeOlderThan(cutoffMs: number): Promise<number> {
    const result = await this.pool.query('delete from live_games where updated_at < $1', [new Date(cutoffMs)]);
    return result.rowCount ?? 0;
  }
}
