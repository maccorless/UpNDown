import { randomUUID } from 'node:crypto';
import type { GameResultRow, ProfileStore, RecordOutcome, StoredSession } from '../../src/profile/store.js';

// In-memory ProfileStore for route tests. test/profile-store.contract.test.ts holds it to the same rules as Postgres.
export class MemoryProfileStore implements ProfileStore {
  readonly users = new Map<string, { settings: Record<string, unknown> }>();
  readonly identities = new Map<string, string>();
  readonly sessions = new Map<string, StoredSession>();

  async findOrCreateUser(provider: 'google', providerUserId: string): Promise<{ userId: string }> {
    const key = `${provider}:${providerUserId}`;
    let userId = this.identities.get(key);
    if (!userId) {
      userId = randomUUID();
      this.users.set(userId, { settings: {} });
      this.identities.set(key, userId);
    }
    return { userId };
  }

  async getSettings(userId: string): Promise<Record<string, unknown> | null> {
    return this.users.get(userId)?.settings ?? null;
  }

  async ensurePlayerName(userId: string, candidate: string): Promise<string | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    if (typeof user.settings.playerName !== 'string') user.settings = { ...user.settings, playerName: candidate };
    return user.settings.playerName as string;
  }

  readonly confirmed = new Set<string>();
  readonly results: GameResultRow[] = [];

  async recordResults(rows: GameResultRow[]): Promise<Array<{ userId: string; outcome: RecordOutcome; code?: string }>> {
    return rows.map((row) => {
      if (!this.users.has(row.userId)) return { userId: row.userId, outcome: 'user_missing' as const };
      if (this.results.some((r) => r.userId === row.userId && r.gameId === row.gameId)) return { userId: row.userId, outcome: 'duplicate' as const };
      this.results.push(row);
      return { userId: row.userId, outcome: 'inserted' as const };
    });
  }

  async replaceSettings(userId: string, settings: Record<string, unknown>, options: { confirmName?: boolean } = {}): Promise<void> {
    const user = this.users.get(userId);
    if (!user) return;
    user.settings = { ...settings };
    if (options.confirmName) this.confirmed.add(userId);
  }

  async getNameConfirmed(userId: string): Promise<boolean | null> {
    return this.users.has(userId) ? this.confirmed.has(userId) : null;
  }

  async confirmPlayerName(userId: string, name: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) return false;
    user.settings = { ...user.settings, playerName: name };
    this.confirmed.add(userId);
    return true;
  }

  async createSession(userId: string, tokenHash: Buffer, expiresAt: Date): Promise<void> {
    const now = new Date();
    this.sessions.set(tokenHash.toString('hex'), { userId, createdAt: now, lastSeenAt: now, expiresAt });
  }

  async findSession(tokenHash: Buffer, now: Date): Promise<StoredSession | null> {
    const session = this.sessions.get(tokenHash.toString('hex'));
    return session && session.expiresAt > now ? { ...session } : null;
  }

  async touchSession(tokenHash: Buffer, lastSeenAt: Date, expiresAt: Date): Promise<void> {
    const session = this.sessions.get(tokenHash.toString('hex'));
    if (session) Object.assign(session, { lastSeenAt, expiresAt });
  }

  async revokeSession(tokenHash: Buffer): Promise<void> {
    this.sessions.delete(tokenHash.toString('hex'));
  }

  async deleteExpiredSessions(now: Date): Promise<number> {
    let removed = 0;
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) { this.sessions.delete(key); removed += 1; }
    }
    return removed;
  }
}
