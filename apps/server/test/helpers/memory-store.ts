import { randomUUID } from 'node:crypto';
import type { ProfileStore, StoredSession } from '../../src/profile/store.js';

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
