import { describe, expect, it } from 'vitest';
import { cheatsAllowedBy, resultRowSchema } from '../src/index.js';

const base = {
  gameId: 'run-1', mode: 'multiplayer', outcome: 'lost', startedAtMs: 1_000, endedAtMs: 61_000, durationMs: 60_000, turns: 10,
  playerCount: 3, cardsTotal: 98, cardsLeft: 12, cardsPlayed: 20, totalMovement: 90, specialPlays: 2,
  skips: 0, trades: 0, lookups: 0, hints: 0, handSize: 7, minCardsPerTurn: 2, maxCard: 99, cheatsAllowed: false, undoAllowed: false
};

describe('resultRowSchema', () => {
  it('reads facts an older client did not send as unknown (null), not zero, so a badge needing them is never awarded by accident', () => {
    const row = resultRowSchema.parse(base);
    expect(row).toMatchObject({ robotCount: null, undos: null, marks: null, playedLastCard: null });
  });

  it.each([
    ['ends before it starts', { endedAtMs: 500, durationMs: -500 }],
    ['has a duration that does not match its times', { durationMs: 1 }],
    ['claims a win with cards left', { outcome: 'won', cardsLeft: 3 }],
    ['claims a loss with no cards left', { cardsLeft: 0 }],
    ['has more special plays than plays', { specialPlays: 21 }],
    ['has more cards than the deck', { cardsPlayed: 90, cardsLeft: 12 }],
    ['has a table of only robots', { robotCount: 3 }],
    ['is solitaire with several players', { mode: 'solitaire' }]
  ])('refuses a row that %s (an import must not corrupt an account)', (_name, change) => {
    expect(resultRowSchema.safeParse({ ...base, ...change }).success).toBe(false);
  });

  it('accepts an abandoned game with cards left', () => {
    expect(resultRowSchema.safeParse({ ...base, outcome: 'abandoned' }).success).toBe(true);
  });
});

describe('cheatsAllowedBy', () => {
  it('is false when every cheat is off and true when any one is on', () => {
    expect(cheatsAllowedBy({ allowCardLookup: false, cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off' } })).toBe(false);
    expect(cheatsAllowedBy({ allowCardLookup: false, cheatLimits: { lookup: 'off', skip: 'off', trade: 'once', hint: 'off' } })).toBe(true);
    expect(cheatsAllowedBy({ allowCardLookup: true })).toBe(true);
  });
});
