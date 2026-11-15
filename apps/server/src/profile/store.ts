import type { Pool, PoolClient } from 'pg';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface GameResultRow {
  userId: string;
  // The run id of a started game (see GameManager), never the room code: a code is reused across games and rooms.
  gameId: string;
  mode: 'solitaire' | 'multiplayer';
  outcome: 'won' | 'lost' | 'abandoned';
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  turns: number;
  playerCount: number;
  cardsTotal: number;
  cardsLeft: number;
  myCardsPlayed: number;
  myTotalMovement: number;
  mySpecialPlays: number;
  myNasCheats: number;
  handSize: number;
  minCardsPerTurn: number;
  maxCard: number;
  settings: Record<string, unknown>;
}

// `duplicate` is the same game written twice. `user_missing` is an account deleted after joining: permanent, never retried.
export type RecordOutcome = 'inserted' | 'duplicate' | 'user_missing' | 'failed';

export interface StoredSession {
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

// Session lifetime rules live in auth/sessions.ts. The store only reads and writes rows.
export interface ProfileStore {
  findOrCreateUser(provider: 'google', providerUserId: string): Promise<{ userId: string }>;
  getSettings(userId: string): Promise<Record<string, unknown> | null>;
  // Sets the player name only if the account has none, and returns the name the account ends up with
  // (null if the account is gone). Two tabs signing in together cannot overwrite each other's choice.
  ensurePlayerName(userId: string, candidate: string): Promise<string | null>;
  // `confirmName` marks the name as chosen by the player; it never un-marks one.
  replaceSettings(userId: string, settings: Record<string, unknown>, options?: { confirmName?: boolean }): Promise<void>;
  getNameConfirmed(userId: string): Promise<boolean | null>;
  // Stores a name the player chose and marks it confirmed. False when the account is gone.
  confirmPlayerName(userId: string, name: string): Promise<boolean>;
  createSession(userId: string, tokenHash: Buffer, expiresAt: Date): Promise<void>;
  findSession(tokenHash: Buffer, now: Date): Promise<StoredSession | null>;
  touchSession(tokenHash: Buffer, lastSeenAt: Date, expiresAt: Date): Promise<void>;
  revokeSession(tokenHash: Buffer): Promise<void>;
  deleteExpiredSessions(now: Date): Promise<number>;
  // One row at a time, so one bad row never costs the others theirs. Never throws for a row: the outcome says what happened.
  recordResults(rows: GameResultRow[]): Promise<Array<{ userId: string; outcome: RecordOutcome; code?: string }>>;
  countResults(userId: string, mode: 'solitaire' | 'multiplayer'): Promise<number>;
}

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

export class PgProfileStore implements ProfileStore {
  constructor(private readonly pool: Pool) {}

  async findOrCreateUser(provider: 'google', providerUserId: string): Promise<{ userId: string }> {
    const existing = await this.lookupIdentity(this.pool, provider, providerUserId);
    if (existing) return { userId: existing };

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const userId = (await client.query<{ id: string }>('insert into users default values returning id')).rows[0]!.id;
      await client.query('insert into identities (provider, provider_user_id, user_id) values ($1, $2, $3)', [provider, providerUserId, userId]);
      await client.query('commit');
      return { userId };
    } catch (err) {
      await client.query('rollback');
      // Two callbacks for the same new Google account raced: the loser rolls back and uses the winner's user.
      // It reads on the connection it already holds. Asking the pool for a second one deadlocks a small pool
      // once enough racing callers each hold one and wait for another.
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        const winner = await this.lookupIdentity(client, provider, providerUserId);
        if (winner) return { userId: winner };
      }
      throw err;
    } finally {
      client.release();
    }
  }

  private async lookupIdentity(db: Queryable, provider: string, providerUserId: string): Promise<string | undefined> {
    return (await db.query<{ user_id: string }>(
      'select user_id from identities where provider = $1 and provider_user_id = $2', [provider, providerUserId]
    )).rows[0]?.user_id;
  }

  async getSettings(userId: string): Promise<Record<string, unknown> | null> {
    const row = (await this.pool.query<{ settings: Record<string, unknown> }>('select settings from users where id = $1', [userId])).rows[0];
    return row?.settings ?? null;
  }

  async ensurePlayerName(userId: string, candidate: string): Promise<string | null> {
    const updated = await this.pool.query<{ name: string }>(
      `update users set settings = jsonb_set(settings, '{playerName}', to_jsonb($2::text))
       where id = $1 and not (settings ? 'playerName') returning settings->>'playerName' as name`,
      [userId, candidate]
    );
    if (updated.rows[0]) return updated.rows[0].name;
    const existing = await this.pool.query<{ name: string | null }>("select settings->>'playerName' as name from users where id = $1", [userId]);
    return existing.rows[0]?.name ?? null;
  }

  async replaceSettings(userId: string, settings: Record<string, unknown>, options: { confirmName?: boolean } = {}): Promise<void> {
    await this.pool.query(
      'update users set settings = $2::jsonb, name_confirmed = name_confirmed or $3 where id = $1',
      [userId, JSON.stringify(settings), options.confirmName === true]
    );
  }

  async getNameConfirmed(userId: string): Promise<boolean | null> {
    const row = (await this.pool.query<{ name_confirmed: boolean }>('select name_confirmed from users where id = $1', [userId])).rows[0];
    return row ? row.name_confirmed : null;
  }

  async confirmPlayerName(userId: string, name: string): Promise<boolean> {
    const result = await this.pool.query(
      `update users set settings = jsonb_set(settings, '{playerName}', to_jsonb($2::text)), name_confirmed = true where id = $1`,
      [userId, name]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createSession(userId: string, tokenHash: Buffer, expiresAt: Date): Promise<void> {
    await this.pool.query('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [tokenHash, userId, expiresAt]);
  }

  async findSession(tokenHash: Buffer, now: Date): Promise<StoredSession | null> {
    const row = (await this.pool.query<{ user_id: string; created_at: Date; last_seen_at: Date; expires_at: Date }>(
      'select user_id, created_at, last_seen_at, expires_at from sessions where token_hash = $1 and expires_at > $2', [tokenHash, now]
    )).rows[0];
    return row ? { userId: row.user_id, createdAt: row.created_at, lastSeenAt: row.last_seen_at, expiresAt: row.expires_at } : null;
  }

  async touchSession(tokenHash: Buffer, lastSeenAt: Date, expiresAt: Date): Promise<void> {
    await this.pool.query('update sessions set last_seen_at = $2, expires_at = $3 where token_hash = $1', [tokenHash, lastSeenAt, expiresAt]);
  }

  async revokeSession(tokenHash: Buffer): Promise<void> {
    await this.pool.query('delete from sessions where token_hash = $1', [tokenHash]);
  }

  async recordResults(rows: GameResultRow[]): Promise<Array<{ userId: string; outcome: RecordOutcome; code?: string }>> {
    const results: Array<{ userId: string; outcome: RecordOutcome; code?: string }> = [];
    for (const row of rows) {
      try {
        const inserted = await this.pool.query(
          `insert into game_results (user_id, game_id, mode, outcome, started_at, ended_at, duration_ms, turns, player_count,
             cards_total, cards_left, my_cards_played, my_total_movement, my_special_plays, my_nas_cheats, hand_size,
             min_cards_per_turn, max_card, settings)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb)
           on conflict (user_id, game_id) do nothing`,
          [row.userId, row.gameId, row.mode, row.outcome, row.startedAt, row.endedAt, row.durationMs, row.turns, row.playerCount,
            row.cardsTotal, row.cardsLeft, row.myCardsPlayed, row.myTotalMovement, row.mySpecialPlays, row.myNasCheats, row.handSize,
            row.minCardsPerTurn, row.maxCard, JSON.stringify(row.settings)]
        );
        results.push({ userId: row.userId, outcome: (inserted.rowCount ?? 0) > 0 ? 'inserted' : 'duplicate' });
      } catch (err) {
        const code = (err as { code?: string }).code;
        // The account was deleted after the player joined. That is permanent, so it is skipped rather than retried.
        results.push({ userId: row.userId, outcome: code === FOREIGN_KEY_VIOLATION ? 'user_missing' : 'failed', ...(code ? { code } : {}) });
      }
    }
    return results;
  }

  async countResults(userId: string, mode: 'solitaire' | 'multiplayer'): Promise<number> {
    const row = (await this.pool.query<{ n: number }>('select count(*)::int as n from game_results where user_id = $1 and mode = $2', [userId, mode])).rows[0];
    return row?.n ?? 0;
  }

  async deleteExpiredSessions(now: Date): Promise<number> {
    return (await this.pool.query('delete from sessions where expires_at <= $1', [now])).rowCount ?? 0;
  }
}
