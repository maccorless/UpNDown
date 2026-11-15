import { describe, expect, it } from 'vitest';
import { scoreGame, type GameRecord } from '../src/simulate.js';

const record = (over: Partial<GameRecord>): GameRecord => ({ outcome: 'lost', cardsLeft: 0, drawLeft: 0, cardsTotal: 98, turns: 10, steps: 100, ...over });

// The score a training run is judged on: a win is the best, fewer cards left is always better, and a game that ends with the
// draw pile not emptied is worth half.
describe('scoring a game', () => {
  it('gives a win 100, whatever else is true', () => {
    expect(scoreGame(record({ outcome: 'won' }))).toBe(100);
  });

  it('always scores fewer cards left higher, so a better loss is never worth less', () => {
    const scores = [0, 1, 5, 20, 60, 98].map((left) => scoreGame(record({ cardsLeft: left })));
    for (let i = 1; i < scores.length; i += 1) expect(scores[i]!).toBeLessThan(scores[i - 1]!);
    expect(scores.at(-1)).toBe(0);
  });

  it('keeps every loss below a win, with a clear gap', () => {
    expect(scoreGame(record({ cardsLeft: 0 }))).toBeLessThanOrEqual(30);
    expect(100 - scoreGame(record({ cardsLeft: 1 }))).toBeGreaterThan(65);
  });

  it('halves a loss when the draw pile was not emptied', () => {
    const drained = scoreGame(record({ cardsLeft: 5, drawLeft: 0 }));
    const notDrained = scoreGame(record({ cardsLeft: 5, drawLeft: 3 }));
    expect(notDrained).toBeCloseTo(drained / 2, 10);
    expect(drained).toBeCloseTo(30 * 93 / 98, 10);
  });

  it('counts cards in the draw pile as cards left, so a game cannot score above its cards played', () => {
    expect(scoreGame(record({ cardsLeft: 40, drawLeft: 40 }))).toBeCloseTo(0.5 * 30 * 58 / 98, 10);
  });
});
