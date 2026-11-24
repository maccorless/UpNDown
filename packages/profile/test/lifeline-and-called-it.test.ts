import { describe, expect, it } from 'vitest';
import { evaluateAchievements } from '../src/achievements.js';
import { at, row } from './helpers.js';

const ctx = { tz: 'UTC', now: at('2026-12-31T00:00:00Z'), signedIn: false };
const tierOf = (id: string, rows: ReturnType<typeof row>[]): number => evaluateAchievements(rows, ctx).find((b) => b.id === id)!.tier;

describe('Lifeline and Called It', () => {
  it('does not count a backward 10 that had another play, because only the rescues are a lifeline (Rewind already counts every backward 10)', () => {
    expect(tierOf('lifeline', [row({ specialPlays: 4, lifelines: 0 })])).toBe(0);
  });

  it('reads a game from before these counters existed as no lifelines and no follows, so old games never break a badge', () => {
    expect(tierOf('lifeline', [row({ lifelines: null, markFollows: null })])).toBe(0);
    expect(tierOf('called-it', [row({ lifelines: null, markFollows: null })])).toBe(0);
  });

  it('adds lifelines across games, so a player who finds five over several games reaches Silver', () => {
    expect(tierOf('lifeline', Array.from({ length: 5 }, () => row({ lifelines: 1 })))).toBe(2);
  });

  it('adds follows across games, so Called It grows the way the other team badges do', () => {
    expect(tierOf('called-it', Array.from({ length: 10 }, () => row({ markFollows: 1 })))).toBe(2);
  });
});
