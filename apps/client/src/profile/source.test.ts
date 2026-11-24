import { computeStats, evaluateAchievements } from '@upndown/profile';
import type { ResultRow } from '@upndown/shared-types';
import { describe, expect, it } from 'vitest';
import { createLocalHistory } from './local-history.js';
import { createOutbox } from './outbox.js';
import { accountSource, localSource } from './source.js';

const row = (gameId: string, endedAtMs: number, over: Partial<ResultRow> = {}): ResultRow => ({
  gameId, mode: 'multiplayer', outcome: 'won', startedAtMs: endedAtMs - 600_000, endedAtMs, durationMs: 600_000, turns: 9, playerCount: 2, robotCount: 0, cardsTotal: 98,
  cardsLeft: 0, cardsPlayed: 40, totalMovement: 50, specialPlays: 1, skips: 0, trades: 0, lookups: 0, hints: 0, undos: 0, marks: 0, playedLastCard: false, lifelines: null, markFollows: null,
  handSize: 7, minCardsPerTurn: 2, maxCard: 99, cheatsAllowed: false, undoAllowed: false, ...over
});
const NOW = Date.parse('2026-11-20T12:00:00Z');

describe('the local profile source', () => {
  it('computes statistics and badges from the rows on the device', async () => {
    window.localStorage.clear();
    const history = createLocalHistory();
    history.add(row('a', NOW - 3_600_000));
    const data = await localSource(history, () => NOW).load('UTC');
    expect(data.stats.totals.games).toBe(1);
    expect(data.badges.find((b) => b.id === 'first-steps')!.tier).toBe(1);
    expect(data.badges.find((b) => b.id === 'made-official')!.tier).toBe(0);
    expect(data.waiting).toBe(0);
  });

  it('pages history newest first, each game once', async () => {
    window.localStorage.clear();
    const history = createLocalHistory();
    for (let i = 0; i < 120; i += 1) history.add(row(`g${String(i).padStart(3, '0')}`, NOW - i * 60_000));
    const source = localSource(history, () => NOW);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await source.history(cursor);
      seen.push(...page.rows.map((r) => r.gameId));
      if (!page.next) break;
      cursor = page.next;
    }
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect(seen[0]).toBe('g000');
  });
});

describe('the account profile source', () => {
  const store = (): Storage => { window.localStorage.clear(); return window.localStorage; };

  it('asks the server for statistics and badges in the device time zone, and reports games waiting to sync', async () => {
    const outbox = createOutbox('u1', store());
    outbox.enqueue({ gameId: 'w', outcome: 'won', startedAtMs: 1, endedAtMs: 2, turns: 1, cardsTotal: 98, cardsLeft: 0, cardsPlayed: 98, totalMovement: 1, specialPlays: 0, nasCheats: 0, skips: 0, trades: 0, lookups: 0, hints: 0, settings: {} as never });
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(url.includes('stats') ? { stats: computeStats([], { tz: 'UTC', now: NOW }) } : { badges: evaluateAchievements([], { tz: 'UTC', now: NOW, signedIn: true }) }), { status: 200 });
    }) as unknown as typeof fetch;
    const data = await accountSource(outbox, fetchImpl).load('America/Chicago');
    expect(calls.sort()).toEqual(['/api/me/achievements?tz=America%2FChicago', '/api/me/stats?tz=America%2FChicago']);
    expect(data.waiting).toBe(1);
  });

  it('fails, so the page can offer Retry, when the server does not answer well', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    await expect(accountSource(createOutbox('u1', store()), fetchImpl).load('UTC')).rejects.toThrow();
  });

  it('follows the cursor the server gave for history', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => { calls.push(url); return new Response(JSON.stringify({ rows: [], next: null }), { status: 200 }); }) as unknown as typeof fetch;
    await accountSource(createOutbox('u1', store()), fetchImpl).history('123:abc');
    expect(calls).toEqual(['/api/me/games?cursor=123%3Aabc']);
  });
});
