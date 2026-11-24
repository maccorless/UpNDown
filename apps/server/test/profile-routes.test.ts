import type { AddressInfo } from 'node:net';
import { computeStats } from '@upndown/profile';
import type { ResultRow } from '@upndown/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthSettings } from '../src/auth/config.js';
import { hashToken } from '../src/auth/sessions.js';
import { createRealtimeServer } from '../src/index.js';
import { toStoredRow } from '../src/profile/rows.js';
import { createFakeProvider } from './helpers/fake-provider.js';
import { MemoryProfileStore } from './helpers/memory-store.js';

const BASE = 'https://upndown.cloud';
const settings: AuthSettings = { databaseUrl: 'unused', publicBaseUrl: BASE, stateSecret: 's'.repeat(40), googleClientId: 'id', googleClientSecret: 'secret', legacyHost: undefined };
const DAY = 24 * 3_600_000;
const json = { 'content-type': 'application/json', origin: BASE };

let n = 0;
const valid = (over: Partial<ResultRow> = {}): ResultRow => {
  n += 1;
  const endedAtMs = over.endedAtMs ?? Date.now() - 2 * DAY + n * 1000;
  return {
    gameId: `game-${n}`, mode: 'multiplayer', outcome: 'won', startedAtMs: endedAtMs - 600_000, endedAtMs, durationMs: 600_000, turns: 12,
    playerCount: 2, robotCount: 0, cardsTotal: 98, cardsLeft: 0, cardsPlayed: 40, totalMovement: 50, specialPlays: 1, skips: 0, trades: 0, lookups: 0, hints: 0,
    undos: 0, marks: 0, playedLastCard: false, lifelines: null, markFollows: null, handSize: 7, minCardsPerTurn: 2, maxCard: 99, cheatsAllowed: false, undoAllowed: false, ...over
  };
};

describe('profile routes', () => {
  let server: ReturnType<typeof createRealtimeServer>;
  let store: MemoryProfileStore;
  let url = '';

  beforeEach(async () => {
    process.env.ALLOWED_ORIGINS = 'https://upndown.cloud,http://localhost:5173';
    store = new MemoryProfileStore();
    server = createRealtimeServer(0, { settings, store, provider: createFakeProvider() });
    await server.auth.start();
    await new Promise<void>((resolve) => server.httpServer.listen(0, () => resolve()));
    url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    delete process.env.ALLOWED_ORIGINS;
    await server.auth.stop();
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  });

  const account = async (googleId: string): Promise<{ userId: string; cookie: string }> => {
    const { userId } = await store.findOrCreateUser('google', googleId);
    await store.createSession(userId, hashToken(`token-${googleId}`), new Date(Date.now() + 1e9));
    return { userId, cookie: `__Host-upndown_session=token-${googleId}` };
  };
  const get = (path: string, cookie?: string) => fetch(`${url}${path}`, { headers: cookie ? { cookie } : {} });
  const importRows = (cookie: string | undefined, rows: unknown[], headers: Record<string, string> = json) =>
    fetch(`${url}/api/me/history-import`, { method: 'POST', headers: { ...headers, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ rows }) });
  const seed = (userId: string, rows: ResultRow[]) => { for (const r of rows) store.results.push(toStoredRow(userId, r)); };

  it.each(['/api/me/stats', '/api/me/achievements', '/api/me/games'])('refuses %s to a guest', async (path) => {
    expect((await get(path)).status).toBe(401);
  });
  it('refuses an import from a guest', async () => {
    expect((await importRows(undefined, [valid()])).status).toBe(401);
  });

  it('refuses a time zone the platform does not know instead of guessing', async () => {
    const { cookie } = await account('g-tz');
    expect((await get('/api/me/stats?tz=Mars/Base', cookie)).status).toBe(400);
    expect((await get('/api/me/achievements?tz=Mars/Base', cookie)).status).toBe(400);
  });

  describe('statistics and badges', () => {
    it('give the account the same numbers the browser would compute from the same rows', async () => {
      const { userId, cookie } = await account('g-stats');
      const rows = [valid(), valid({ outcome: 'lost', cardsLeft: 3 })];
      seed(userId, rows);
      const body = await (await get('/api/me/stats?tz=UTC', cookie)).json() as { stats: unknown };
      expect(body.stats).toEqual(JSON.parse(JSON.stringify(computeStats(rows, { tz: 'UTC', now: Date.now() }))));
    });

    it('count signing in as a badge for an account', async () => {
      const { cookie } = await account('g-badge');
      const { badges } = await (await get('/api/me/achievements?tz=UTC', cookie)).json() as { badges: Array<{ id: string; tier: number }> };
      expect(badges).toHaveLength(36);
      expect(badges.find((b) => b.id === 'made-official')!.tier).toBe(1);
    });

    it('never show one account another\'s games', async () => {
      const a = await account('g-a');
      const b = await account('g-b');
      seed(a.userId, [valid(), valid()]);
      const { stats } = await (await get('/api/me/stats?tz=UTC', b.cookie)).json() as { stats: { totals: { games: number } } };
      expect(stats.totals.games).toBe(0);
    });
  });

  describe('history', () => {
    it('pages through every game once, newest first, including games that ended at the same instant', async () => {
      const { userId, cookie } = await account('g-page');
      const same = Date.now() - DAY;
      const rows = Array.from({ length: 120 }, (_v, i) => valid({ endedAtMs: i < 4 ? same : same - i * 1000, gameId: `page-${String(i).padStart(3, '0')}` }));
      seed(userId, rows);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard += 1) {
        const page = await (await get(`/api/me/games${cursor ? `?cursor=${cursor}` : ''}`, cookie)).json() as { rows: ResultRow[]; next: string | null };
        seen.push(...page.rows.map((r) => r.gameId));
        if (!page.next) break;
        cursor = page.next;
      }
      expect(seen).toHaveLength(120);
      expect(new Set(seen).size).toBe(120);
      const times = seen.map((id) => rows.find((r) => r.gameId === id)!.endedAtMs);
      expect(times).toEqual([...times].sort((x, y) => y - x));
    });

    it('refuses a malformed cursor', async () => {
      const { cookie } = await account('g-cursor');
      expect((await get('/api/me/games?cursor=nonsense', cookie)).status).toBe(400);
    });
  });

  describe('importing a guest\'s history', () => {
    it('adds the rows, reports each one, and does not add them twice when the same batch is sent again', async () => {
      const { userId, cookie } = await account('g-import');
      const rows = [valid(), valid(), valid()];
      const first = await (await importRows(cookie, rows)).json() as { results: Array<{ gameId: string; status: string }> };
      expect(first.results.map((r) => r.status)).toEqual(['inserted', 'inserted', 'inserted']);
      const second = await (await importRows(cookie, rows)).json() as { results: Array<{ status: string }> };
      expect(second.results.map((r) => r.status)).toEqual(['duplicate', 'duplicate', 'duplicate']);
      expect(store.results.filter((r) => r.userId === userId)).toHaveLength(3);
    });

    it('reads back exactly what was sent, so a guest\'s game comes out of the account as it went in', async () => {
      const { cookie } = await account('g-readback');
      const rows = [valid({ outcome: 'lost', cardsLeft: 4, undos: null, robotCount: 1, playerCount: 3, cheatsAllowed: true, undoAllowed: true, trades: 2 })];
      await importRows(cookie, rows);
      const page = await (await get('/api/me/games', cookie)).json() as { rows: ResultRow[] };
      expect(page.rows).toEqual(rows);
    });

    it('reports a bad row as rejected and still stores the rest', async () => {
      const { cookie } = await account('g-bad');
      const good = valid();
      const bad = { ...valid(), outcome: 'won', cardsLeft: 3 };
      const { results } = await (await importRows(cookie, [bad, good])).json() as { results: Array<{ status: string }> };
      expect(results.map((r) => r.status)).toEqual(['rejected', 'inserted']);
    });

    it('refuses a game dated more than two years back or more than five minutes ahead, and takes one just inside both', async () => {
      const { cookie } = await account('g-dates');
      const t = (ms: number) => valid({ endedAtMs: Date.now() + ms, startedAtMs: Date.now() + ms - 600_000 });
      const { results } = await (await importRows(cookie, [t(-731 * DAY), t(-729 * DAY), t(5 * 60_000 + 1000), t(4 * 60_000)])).json() as { results: Array<{ status: string }> };
      expect(results.map((r) => r.status)).toEqual(['rejected', 'inserted', 'rejected', 'inserted']);
    });

    it('stores a row under the signed-in account even if the row names someone else', async () => {
      const mine = await account('g-mine');
      const other = await account('g-other');
      await importRows(mine.cookie, [{ ...valid(), userId: other.userId }]);
      expect(store.results.filter((r) => r.userId === other.userId)).toHaveLength(0);
      expect(store.results.filter((r) => r.userId === mine.userId)).toHaveLength(1);
    });

    it('refuses more than 250 rows in one batch', async () => {
      const { cookie } = await account('g-big');
      expect((await importRows(cookie, Array.from({ length: 251 }, () => ({})))).status).toBe(400);
    });

    it('refuses a body over its own 90 KB bound, and one over the global 100 KB bound, through the real middleware', async () => {
      const { cookie } = await account('g-bytes');
      const padded = (kb: number) => [{ ...valid(), note: 'x'.repeat(kb * 1000) }];
      expect((await importRows(cookie, padded(95))).status).toBe(413);
      expect((await importRows(cookie, padded(150))).status).toBe(413);
    });

    it('stops adding at the account cap, but still answers a game it already has with duplicate', async () => {
      const { userId, cookie } = await account('g-cap');
      const held = Array.from({ length: 10_000 }, (_v, i) => valid({ gameId: `held-${i}` }));
      seed(userId, held);
      const { results } = await (await importRows(cookie, [valid(), { ...held[0]! }])).json() as { results: Array<{ status: string; reason?: string }> };
      expect(results).toEqual([expect.objectContaining({ status: 'rejected', reason: 'history full' }), expect.objectContaining({ status: 'duplicate' })]);
    });

    it('refuses a request from an origin that is allowed to call the server but is not the site itself', async () => {
      const { cookie } = await account('g-origin');
      expect((await importRows(cookie, [valid()], { 'content-type': 'application/json', origin: 'http://localhost:5173' })).status).toBe(403);
    });

    it('throttles a user who imports more than 30 times a minute', async () => {
      const { cookie } = await account('g-rate');
      const statuses: number[] = [];
      for (let i = 0; i < 31; i += 1) statuses.push((await importRows(cookie, [])).status);
      expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
      expect(statuses[30]).toBe(429);
    });
  });
});
