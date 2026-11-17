import { describe, expect, it } from 'vitest';
import type { ResultRow } from '@upndown/shared-types';
import { evaluateAchievements } from '../src/achievements.js';
import { CATALOG, type Ctx } from '../src/catalog.js';
import { at, row } from './helpers.js';

const ctx: Ctx = { tz: 'UTC', now: at('2026-12-31T00:00:00Z'), signedIn: false };
const tierOf = (id: string, rows: ResultRow[], c: Partial<Ctx> = {}): number => evaluateAchievements(rows, { ...ctx, ...c }).find((b) => b.id === id)!.tier;
const many = (n: number, over: Partial<ResultRow> = {}): ResultRow[] => Array.from({ length: n }, () => row(over));
const lost = (over: Partial<ResultRow> = {}): ResultRow => row({ outcome: 'lost', cardsLeft: 5, ...over });
const days = (list: string[]): ResultRow[] => list.map((d) => row({ endedAtMs: at(`${d}T12:00:00Z`) }));

describe('every badge, at its first tier and one step short of it', () => {
  it.each<[string, ResultRow[], ResultRow[]]>([
    ['first-steps', [row()], [row({ outcome: 'abandoned', cardsLeft: 4 })]],
    ['regular', many(10), many(9)],
    ['long-haul', [row({ durationMs: 3_600_000 })], [row({ durationMs: 3_599_999 })]],
    ['card-shark', many(3, { cardsPlayed: 40 }), many(2, { cardsPlayed: 40 })],
    ['frequent-flyer', [row({ totalMovement: 1_000 })], [row({ totalMovement: 999 })]],
    ['habit', days(['2026-11-10', '2026-11-11', '2026-11-12']), days(['2026-11-10', '2026-11-11', '2026-11-13'])],
    ['up-and-away', [row()], [lost()]],
    ['hot-streak', many(3), [row(), row(), lost(), row()]],
    ['so-close', [lost({ cardsLeft: 1 })], [lost({ cardsLeft: 4 })]],
    ['comeback-kid', [lost(), lost(), lost(), row()], [lost(), lost(), row()]],
    ['light-packer', [row({ handSize: 5 })], [row({ handSize: 6 })]],
    ['closer', [row({ playedLastCard: true })], [row({ playedLastCard: null })]],
    ['rewind', many(10, { specialPlays: 1 }), many(9, { specialPlays: 1 })],
    ['time-machine', [row({ specialPlays: 3 })], many(2, { specialPlays: 2 })],
    ['solo-act', [row({ mode: 'solitaire', playerCount: 1 })], [row()]],
    ['duet', [row({ playerCount: 2 })], [row({ playerCount: 3 })]],
    ['full-table', [row({ playerCount: 6, robotCount: 2 })], [row({ playerCount: 5 })]],
    ['machine-learning', [row({ playerCount: 3, robotCount: 1 })], [row({ robotCount: 0 })]],
    ['outnumbered', [row({ playerCount: 3, robotCount: 2 })], [row({ playerCount: 4, robotCount: 2 })]],
    ['clean-hands', [row({ cheatsAllowed: true })], [row({ cheatsAllowed: false }), row({ cheatsAllowed: true, hints: 1 })]],
    ['over-my-shoulder', [row({ hints: 10 })], [row({ hints: 9 })]],
    ['swiss-army-knife', [row({ skips: 1, trades: 1, lookups: 1, hints: 1 })], [row({ skips: 1, trades: 1, lookups: 1 })]],
    ['backseat-driver', [row({ marks: 50 })], [row({ marks: 49 }), row({ marks: null })]],
    ['oops', [row({ undos: 10 })], [row({ undos: 9 }), row({ undos: null })]],
    ['no-take-backs', [row({ undoAllowed: true, undos: 0 })], [row({ undoAllowed: true, undos: null }), row({ undoAllowed: false, undos: 0 })]],
    ['marathon', [row({ durationMs: 3_600_001 })], [row({ durationMs: 3_600_000 })]],
    ['speedrunner', [row({ mode: 'solitaire', playerCount: 1, durationMs: 590_000 })], [row({ mode: 'solitaire', playerCount: 1, durationMs: 700_000 }), row({ mode: 'solitaire', playerCount: 1, durationMs: 100_000, hints: 1 }), row({ mode: 'solitaire', playerCount: 1, durationMs: 100_000, handSize: 9 })]],
    ['table-flip', [row({ mode: 'multiplayer', outcome: 'abandoned', cardsLeft: 40, cardsPlayed: 20 })], [row({ outcome: 'abandoned', cardsLeft: 40, cardsPlayed: 19 })]],
    ['ten-out-of-ten', [row({ specialPlays: 10 })], [row({ specialPlays: 11 })]]
  ])('%s', (id, earns, misses) => {
    expect(tierOf(id, earns)).toBeGreaterThanOrEqual(1);
    expect(tierOf(id, misses)).toBe(0);
  });
});

describe('badges that depend on the rules of the count', () => {
  it('counts an abandoned game\'s time and cards in the cumulative badges, but not as a finished game', () => {
    expect(tierOf('long-haul', [row({ outcome: 'abandoned', cardsLeft: 9, durationMs: 3_600_000 })])).toBe(1);
    expect(tierOf('regular', many(10, { outcome: 'abandoned', cardsLeft: 9 }))).toBe(0);
  });

  it('does not take distance away for a game that went backward', () => {
    expect(tierOf('frequent-flyer', [row({ totalMovement: 1_000 }), row({ totalMovement: -500 })])).toBe(1);
  });

  it('ends a win streak on an abandoned game as well as a loss (quitting is not winning)', () => {
    expect(tierOf('hot-streak', [row(), row(), row({ outcome: 'abandoned', cardsLeft: 3 }), row()])).toBe(0);
  });

  it('wants the three losses directly before the win', () => {
    expect(tierOf('comeback-kid', [lost(), lost(), lost(), row({ outcome: 'abandoned', cardsLeft: 3 }), row()])).toBe(0);
    expect(tierOf('comeback-kid', [row(), lost(), lost(), lost(), row()])).toBe(1);
  });

  it('ignores a game dated after now when counting days in a row (a wrong clock must not buy a streak)', () => {
    expect(tierOf('habit', days(['2026-12-30', '2027-01-01', '2027-01-02']))).toBe(0);
  });

  it('needs a game with cheats allowed for Clean Hands (a win with cheats off proves nothing)', () => {
    expect(tierOf('clean-hands', [row({ cheatsAllowed: false })])).toBe(0);
  });

  it('is earned by signing in, with no game and no date', () => {
    const made = evaluateAchievements([], { ...ctx, signedIn: true }).find((b) => b.id === 'made-official')!;
    expect(made).toMatchObject({ tier: 1, unlockedAtMs: [null] });
    expect(tierOf('made-official', [])).toBe(0);
  });

  it('gives Speedrunner a better tier for a smaller time', () => {
    const solo = (durationMs: number) => row({ mode: 'solitaire', playerCount: 1, durationMs });
    expect(tierOf('speedrunner', [solo(590_000)])).toBe(1);
    expect(tierOf('speedrunner', [solo(290_000)])).toBe(3);
  });
});

describe('time of day and calendar badges read the player\'s own clock', () => {
  const chicago = { tz: 'America/Chicago' };
  it('is a night owl at 02:30 in Chicago and not at 08:30 UTC, which is the same instant', () => {
    const r = [row({ endedAtMs: at('2026-11-10T08:30:00Z') })];
    expect(tierOf('night-owl', r, chicago)).toBe(1);
    expect(tierOf('night-owl', r)).toBe(0);
  });

  it('is an early bird from 05:00 to 06:59 only', () => {
    expect(tierOf('early-bird', [row({ endedAtMs: at('2026-11-10T06:59:00Z') })])).toBe(1);
    expect(tierOf('early-bird', [row({ endedAtMs: at('2026-11-10T07:00:00Z') })])).toBe(0);
  });

  it('notices a time that reads the same backward, and only that', () => {
    expect(tierOf('mirror-mirror', [row({ endedAtMs: at('2026-11-10T12:21:00Z') })])).toBe(1);
    expect(tierOf('mirror-mirror', [row({ endedAtMs: at('2026-11-10T20:02:00Z') })])).toBe(1);
    expect(tierOf('mirror-mirror', [row({ endedAtMs: at('2026-11-10T12:22:00Z') })])).toBe(0);
  });

  it('wants a win, not a loss, on Friday the 13th', () => {
    expect(tierOf('unlucky-for-some', [row({ endedAtMs: at('2026-11-13T15:00:00Z') })])).toBe(1);
    expect(tierOf('unlucky-for-some', [lost({ endedAtMs: at('2026-11-13T15:00:00Z') })])).toBe(0);
    expect(tierOf('unlucky-for-some', [row({ endedAtMs: at('2026-11-12T15:00:00Z') })])).toBe(0);
  });
});

describe('the evaluator as a whole', () => {
  const sample = [row({ endedAtMs: at('2026-11-10T12:00:00Z') }), lost({ endedAtMs: at('2026-11-11T12:00:00Z') }), row({ endedAtMs: at('2026-11-12T12:00:00Z'), hints: 3 })];

  it('gives the same answer in any order and when a game is sent twice (the guest move and every retry rely on it)', () => {
    const a = evaluateAchievements(sample, ctx);
    expect(evaluateAchievements([...sample].reverse().concat(sample[0]!), ctx)).toEqual(a);
  });

  it('dates a tier by the game that reached it', () => {
    const ten = many(10).map((r, i) => ({ ...r, endedAtMs: at('2026-11-01T12:00:00Z') + i * 3_600_000 }));
    const regular = evaluateAchievements(ten, ctx).find((b) => b.id === 'regular')!;
    expect(regular.unlockedAtMs).toEqual([ten[9]!.endedAtMs]);
    expect(regular.progress).toEqual({ value: 10, nextTarget: 50 });
  });

  it('never lowers a tier when newer games are added', () => {
    const before = evaluateAchievements(sample, ctx);
    const after = evaluateAchievements([...sample, lost({ endedAtMs: at('2026-11-20T12:00:00Z') })], ctx);
    before.forEach((b, i) => expect(after[i]!.tier).toBeGreaterThanOrEqual(b.tier));
  });

  it('never throws and never awards a badge from a fact that was not recorded', () => {
    const unknown = row({ robotCount: null, undos: null, marks: null, playedLastCard: null });
    const states = evaluateAchievements([unknown], ctx);
    expect(states).toHaveLength(CATALOG.length);
    for (const id of ['machine-learning', 'outnumbered', 'closer', 'oops', 'backseat-driver', 'no-take-backs']) {
      expect(states.find((b) => b.id === id)!.tier).toBe(0);
    }
  });

  it('gives a player with no games every badge locked, with no NaN', () => {
    const states = evaluateAchievements([], ctx);
    expect(states.every((b) => b.tier === 0)).toBe(true);
    expect(JSON.stringify(states)).not.toContain('NaN');
  });
});

describe('the catalog', () => {
  it('has 34 badges with unique ids', () => {
    expect(CATALOG).toHaveLength(34);
    expect(new Set(CATALOG.map((b) => b.id)).size).toBe(34);
  });

  it('has targets that climb for most badges and fall for the one where smaller is better', () => {
    for (const b of CATALOG) {
      for (let i = 1; i < b.targets.length; i += 1) {
        expect(b.direction === 'atLeast' ? b.targets[i]! > b.targets[i - 1]! : b.targets[i]! < b.targets[i - 1]!).toBe(true);
      }
    }
    expect(CATALOG.filter((b) => b.direction === 'atMost').map((b) => b.id)).toEqual(['speedrunner']);
  });

  it('has a name and a short blurb for every badge, a hint for every secret, and no em-dash anywhere', () => {
    for (const b of CATALOG) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.blurb.length).toBeLessThanOrEqual(90);
      if (b.secret) expect(b.hint).toBeTruthy();
      expect(`${b.name}${b.blurb}${b.hint ?? ''}`).not.toContain('—');
    }
  });
});
