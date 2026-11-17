import { describe, expect, it } from 'vitest';
import { computeStats } from '../src/stats.js';
import { at, row } from './helpers.js';

const opts = { tz: 'America/Chicago', now: at('2026-11-20T18:00:00Z') };

describe('computeStats', () => {
  it('gives zeros and nulls for a player with no games, and never NaN (a new profile is the first thing every player sees)', () => {
    const s = computeStats([], opts);
    expect(s.totals).toMatchObject({ games: 0, winRate: null, avgMovementPerCard: null, timePlayedMs: 0 });
    expect(s.streaks).toEqual({ currentWin: 0, bestWin: 0, currentDay: 0, bestDay: 0 });
    expect(s.records).toMatchObject({ fastestWinMs: null, fewestCardsLeftInLoss: null, biggestTableWon: 0 });
    expect(s.trend).toEqual([]);
    expect(JSON.stringify(s)).not.toContain('NaN');
  });

  it('counts abandoned games in totals but keeps them out of the win rate and the records', () => {
    const s = computeStats([row({ outcome: 'abandoned', cardsLeft: 30, cardsPlayed: 10, durationMs: 5_000, specialPlays: 4 })], opts);
    expect(s.totals).toMatchObject({ games: 1, abandoned: 1, winRate: null, cardsPlayed: 10, backwardTens: 4, timePlayedMs: 5_000 });
    expect(s.records.mostBackwardTens).toBe(0);
    expect(s.trend).toEqual(['A']);
  });

  it('is the same whatever order the rows arrive in, and counts a game sent twice once (retries and the guest move must not change anything)', () => {
    const rows = [row({ endedAtMs: at('2026-11-18T18:00:00Z') }), row({ outcome: 'lost', cardsLeft: 3, endedAtMs: at('2026-11-19T18:00:00Z') }), row({ endedAtMs: at('2026-11-20T01:00:00Z') })];
    const a = computeStats(rows, opts);
    const b = computeStats([...rows].reverse().concat(rows[0]!), opts);
    expect(b).toEqual(a);
    expect(a.totals.games).toBe(3);
  });

  it('extends a win streak with a win and resets it on a loss or an abandoned game (quitting is not winning)', () => {
    const t = (d: number) => at(`2026-11-${10 + d}T18:00:00Z`);
    const s = computeStats([row({ endedAtMs: t(0) }), row({ endedAtMs: t(1) }), row({ outcome: 'abandoned', cardsLeft: 9, endedAtMs: t(2) }), row({ endedAtMs: t(3) })], opts);
    expect(s.streaks).toMatchObject({ bestWin: 2, currentWin: 1 });
    expect(s.totals.winRate).toBe(1);
  });

  it('puts a game just before and just after local midnight on different days, wherever the server is', () => {
    const rows = [row({ endedAtMs: at('2026-11-11T05:50:00Z') }), row({ endedAtMs: at('2026-11-11T06:10:00Z') })]; // 23:50 and 00:10 in Chicago (CST)
    expect(computeStats(rows, { tz: 'America/Chicago', now: at('2026-11-11T12:00:00Z') }).streaks.bestDay).toBe(2);
    expect(computeStats(rows, { tz: 'UTC', now: at('2026-11-11T12:00:00Z') }).streaks.bestDay).toBe(1);
  });

  it('does not skip or double a day when daylight saving ends', () => {
    const rows = [at('2026-10-31T17:00:00Z'), at('2026-11-01T18:00:00Z'), at('2026-11-02T18:00:00Z')].map((endedAtMs) => row({ endedAtMs }));
    expect(computeStats(rows, { tz: 'America/Chicago', now: at('2026-11-02T20:00:00Z') }).streaks).toMatchObject({ currentDay: 3, bestDay: 3 });
  });

  it('keeps a day streak alive until the day after its last game ends, then drops it', () => {
    const rows = [row({ endedAtMs: at('2026-11-18T18:00:00Z') }), row({ endedAtMs: at('2026-11-19T18:00:00Z') })];
    expect(computeStats(rows, { tz: 'UTC', now: at('2026-11-20T09:00:00Z') }).streaks.currentDay).toBe(2);
    expect(computeStats(rows, { tz: 'UTC', now: at('2026-11-21T09:00:00Z') }).streaks).toMatchObject({ currentDay: 0, bestDay: 2 });
  });

  it('counts a game dated in the future in the totals but never lets it extend a day streak (a wrong clock must not buy a streak)', () => {
    const s = computeStats([row({ endedAtMs: at('2026-11-19T18:00:00Z') }), row({ endedAtMs: at('2026-12-25T18:00:00Z') })], { tz: 'UTC', now: at('2026-11-20T09:00:00Z') });
    expect(s.totals.games).toBe(2);
    expect(s.streaks).toMatchObject({ currentDay: 1, bestDay: 1 });
  });

  it('breaks results down by difficulty, table size and robots', () => {
    const s = computeStats([row({ handSize: 7, minCardsPerTurn: 2, maxCard: 99 }), row({ outcome: 'lost', cardsLeft: 2, playerCount: 3, robotCount: 1 }), row({ mode: 'solitaire', playerCount: 1, robotCount: null })], opts);
    expect(s.breakdowns.byDifficulty).toEqual([expect.objectContaining({ key: '7/2/99', games: 3 })]);
    expect(s.breakdowns.byPlayerCount.map((x) => x.key)).toEqual(['1', '2', '3']);
    expect(s.breakdowns.byRobots.map((x) => x.key).sort()).toEqual(['none', 'some', 'unknown']);
  });

  it('keeps only the last 20 games in the trend, oldest first', () => {
    const rows = Array.from({ length: 25 }, (_v, i) => row({ endedAtMs: at('2026-11-01T12:00:00Z') + i * 3_600_000, outcome: i === 24 ? 'lost' : 'won', cardsLeft: i === 24 ? 2 : 0 }));
    const trend = computeStats(rows, opts).trend;
    expect(trend).toHaveLength(20);
    expect(trend[19]).toBe('L');
  });
});
