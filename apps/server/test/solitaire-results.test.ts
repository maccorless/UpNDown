import type { AddressInfo } from 'node:net';
import { normalSolitaireSettings } from '@upndown/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthSettings } from '../src/auth/config.js';
import { hashToken } from '../src/auth/sessions.js';
import { createRealtimeServer } from '../src/index.js';
import { createFakeProvider } from './helpers/fake-provider.js';
import { MemoryProfileStore } from './helpers/memory-store.js';

const BASE = 'https://upndown.cloud';
const settings: AuthSettings = {
  databaseUrl: 'unused', publicBaseUrl: BASE, stateSecret: 's'.repeat(40), googleClientId: 'id', googleClientSecret: 'secret', legacyHost: undefined
};
const MIN = 60_000;
const DAY = 24 * 3_600_000;

describe('POST /api/me/solitaire-results', () => {
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
  const result = (over: Record<string, unknown> = {}) => {
    const ended = Date.now() - 2 * MIN;
    return {
      gameId: 'a3f1c9d2-5b7e-4c1a-9f20-1d2e3f4a5b6c', outcome: 'won', startedAtMs: ended - 20 * MIN, endedAtMs: ended, turns: 0,
      cardsTotal: 98, cardsLeft: 0, cardsPlayed: 98, totalMovement: 411, specialPlays: 4, nasCheats: 0, settings: normalSolitaireSettings, ...over
    };
  };
  const post = (cookie: string | undefined, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json', origin: BASE }) =>
    fetch(`${url}/api/me/solitaire-results`, { method: 'POST', headers: { ...headers, ...(cookie ? { cookie } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });

  describe('saving a finished game', () => {
    it('stores the win under the signed-in account, as a one-player solitaire row', async () => {
      const { userId, cookie } = await account('g-ann');
      const body = result();
      const res = await post(cookie, body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ outcome: 'inserted' });
      expect(store.results).toHaveLength(1);
      expect(store.results[0]).toMatchObject({
        userId, gameId: body.gameId, mode: 'solitaire', outcome: 'won', playerCount: 1, cardsTotal: 98, cardsLeft: 0,
        myCardsPlayed: 98, myTotalMovement: 411, mySpecialPlays: 4, myNasCheats: 0, mySkips: 0, myTrades: 0, myLookups: 0, myHints: 0, handSize: normalSolitaireSettings.handSize,
        maxCard: normalSolitaireSettings.maxCardValue, durationMs: 20 * MIN
      });
      expect(store.results[0]!.endedAt.getTime()).toBe(body.endedAtMs);
      expect(store.results[0]!.startedAt.getTime()).toBe(body.startedAtMs);
    });

    it('stores a loss, with the cards that were left', async () => {
      const { cookie } = await account('g-ann');
      const res = await post(cookie, result({ outcome: 'lost', cardsLeft: 31, cardsPlayed: 67, specialPlays: 2 }));
      expect(res.status).toBe(200);
      expect(store.results[0]).toMatchObject({ outcome: 'lost', cardsLeft: 31, myCardsPlayed: 67 });
    });

    // A retry after a dropped connection must not count the game twice.
    it('treats the same game sent again as a duplicate, leaving one row', async () => {
      const { cookie } = await account('g-ann');
      expect(await (await post(cookie, result())).json()).toEqual({ outcome: 'inserted' });
      expect(await (await post(cookie, result())).json()).toEqual({ outcome: 'duplicate' });
      expect(store.results).toHaveLength(1);
    });

    it('keeps each account\'s games separate even if two browsers pick the same game id', async () => {
      const ann = await account('g-ann');
      const bob = await account('g-bob');
      await post(ann.cookie, result());
      await post(bob.cookie, result());
      expect(store.results.map((r) => r.userId).sort()).toEqual([ann.userId, bob.userId].sort());
    });

    it('reports an account that has been deleted as signed out, and stores nothing', async () => {
      const { userId, cookie } = await account('g-ann');
      store.users.delete(userId);
      const res = await post(cookie, result());
      expect(res.status).toBe(401);
      expect(store.results).toHaveLength(0);
    });
  });

  describe('a result that does not add up is refused and stores nothing', () => {
    it.each([
      ['an outcome other than won or lost (solitaire has no quits)', { outcome: 'abandoned' }],
      ['a win with cards left', { outcome: 'won', cardsLeft: 3, cardsPlayed: 95 }],
      ['a loss with no cards left', { outcome: 'lost', cardsLeft: 0 }],
      ['more cards played and left than the deck holds', { outcome: 'lost', cardsLeft: 60, cardsPlayed: 60 }],
      ['more special plays than plays', { specialPlays: 99, cardsPlayed: 98 }],
      ['an end before the start', { startedAtMs: Date.now(), endedAtMs: Date.now() - 10 * MIN }],
      ['more than 24 days of play, which the database column cannot hold', { startedAtMs: Date.now() - 27 * DAY, endedAtMs: Date.now() - 2 * MIN }],
      ['a deck size that does not match the settings', { cardsTotal: 200, cardsPlayed: 98 }],
      ['a game id with characters it should not have', { gameId: '../../etc/passwd' }],
      ['an empty game id', { gameId: '' }],
      ['a game id that is far too long', { gameId: 'a'.repeat(65) }],
      ['a negative number of cards', { cardsPlayed: -1 }],
      ['a fractional number', { turns: 1.5 }],
      ['text where a number belongs', { totalMovement: 'lots' }],
      ['settings that are not valid', { settings: { ...normalSolitaireSettings, handSize: 99 } }],
      ['settings missing', { settings: undefined }]
    ])('%s', async (_why, over) => {
      const { cookie } = await account('g-ann');
      const res = await post(cookie, result(over));
      expect(res.status).toBe(400);
      expect(store.results).toHaveLength(0);
    });

    it('a body that is not an object, or is missing most of it', async () => {
      const { cookie } = await account('g-ann');
      expect((await post(cookie, [])).status).toBe(400);
      expect((await post(cookie, { gameId: 'x' })).status).toBe(400);
      expect((await post(cookie, 'null')).status).toBe(400);
      expect(store.results).toHaveLength(0);
    });
  });

  // The browser's clock is trusted for when the game ended, but not blindly.
  describe('when the game ended', () => {
    it('allows a small clock difference, and a game finished offline and sent up to a month later', async () => {
      const { cookie } = await account('g-ann');
      const soon = Date.now() + 2 * MIN;
      expect((await post(cookie, result({ gameId: 'soon', startedAtMs: soon - 10 * MIN, endedAtMs: soon }))).status).toBe(200);
      const old = Date.now() - 30 * DAY;
      expect((await post(cookie, result({ gameId: 'old', startedAtMs: old - 10 * MIN, endedAtMs: old }))).status).toBe(200);
      expect(store.results).toHaveLength(2);
    });

    // A tab left open for weeks must be savable, up to the most the database can store, and never an insert error.
    it('stores a game of 24 days of play, the longest the database column can hold', async () => {
      const { cookie } = await account('g-ann');
      const ended = Date.now() - 2 * MIN;
      const res = await post(cookie, result({ startedAtMs: ended - 24 * DAY, endedAtMs: ended }));
      expect(res.status).toBe(200);
      expect(store.results[0]!.durationMs).toBe(24 * DAY);
      expect(store.results[0]!.durationMs).toBeLessThan(2 ** 31 - 1);
    });

    it('refuses a game that ends in the future, or long ago', async () => {
      const { cookie } = await account('g-ann');
      const future = Date.now() + 2 * 3_600_000;
      expect((await post(cookie, result({ startedAtMs: future - MIN, endedAtMs: future }))).status).toBe(400);
      const ancient = Date.now() - 500 * DAY;
      expect((await post(cookie, result({ startedAtMs: ancient - MIN, endedAtMs: ancient }))).status).toBe(400);
      expect(store.results).toHaveLength(0);
    });
  });

  describe('who may save', () => {
    it('a guest cannot: there is no account to save to', async () => {
      const res = await post(undefined, result());
      expect(res.status).toBe(401);
      expect(store.results).toHaveLength(0);
    });

    it('a forged session cookie is a guest', async () => {
      expect((await post('__Host-upndown_session=forged', result())).status).toBe(401);
    });

    it('needs the canonical Origin and a JSON body', async () => {
      const { cookie } = await account('g-ann');
      expect((await post(cookie, result(), { 'content-type': 'application/json', origin: 'http://localhost:5173' })).status).toBe(403);
      expect((await post(cookie, result(), { 'content-type': 'application/json' })).status).toBe(403);
      expect((await post(cookie, JSON.stringify(result()), { 'content-type': 'text/plain', origin: BASE })).status).toBe(403);
      expect(store.results).toHaveLength(0);
    });
  });

  describe('history size', () => {
    const fakeRow = (userId: string, n: number) => ({
      userId, gameId: `old-${n}`, mode: 'solitaire' as const, outcome: 'won' as const, startedAt: new Date(0), endedAt: new Date(1000), durationMs: 1000,
      turns: 0, playerCount: 1, cardsTotal: 98, cardsLeft: 0, myCardsPlayed: 98, myTotalMovement: 1, mySpecialPlays: 0, myNasCheats: 0, mySkips: 0, myTrades: 0, myLookups: 0, myHints: 0,
      handSize: 7, minCardsPerTurn: 1, maxCard: 99, settings: {}
    });

    // Every row is kept for good and nothing but this stops a script minting game ids. A real player never reaches it.
    it('stops saving at 5000 solitaire games for one account, and says so, while others can still save', async () => {
      const ann = await account('g-ann');
      const bob = await account('g-bob');
      for (let n = 0; n < 4999; n += 1) store.results.push(fakeRow(ann.userId, n));
      expect((await post(ann.cookie, result({ gameId: 'the-5000th' }))).status).toBe(200);
      const res = await post(ann.cookie, result({ gameId: 'the-5001st' }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'history full' });
      expect(store.results.some((r) => r.gameId === 'the-5001st')).toBe(false);
      expect((await post(bob.cookie, result({ gameId: 'bobs' }))).status).toBe(200);
    });

    it('counts solitaire games only, so multiplayer history never uses up the allowance', async () => {
      const ann = await account('g-ann');
      for (let n = 0; n < 5000; n += 1) store.results.push({ ...fakeRow(ann.userId, n), mode: 'multiplayer' });
      expect((await post(ann.cookie, result({ gameId: 'still-fine' }))).status).toBe(200);
    });
  });

  describe('limits', () => {
    it('refuses an oversized body outright', async () => {
      const { cookie } = await account('g-ann');
      const res = await post(cookie, { ...result(), padding: 'x'.repeat(5000) });
      expect(res.status).toBe(413);
      expect(store.results).toHaveLength(0);
    });

    it('stops one account at thirty saves a minute without touching another', async () => {
      const ann = await account('g-ann');
      const bob = await account('g-bob');
      const codes: number[] = [];
      for (let i = 0; i < 32; i += 1) codes.push((await post(ann.cookie, result({ gameId: `game-${i}` }))).status);
      expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
      expect(codes.slice(30)).toEqual([429, 429]);
      expect((await post(bob.cookie, result({ gameId: 'bobs' }))).status).toBe(200);
    });
  });
});
