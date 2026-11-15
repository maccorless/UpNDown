import { describe, expect, it } from 'vitest';
import { scoreGame, type GameRecord } from '../src/simulate.js';

const record = (over: Partial<GameRecord>): GameRecord => ({ outcome: 'lost', cardsLeft: 1, drawLeft: 0, cardsTotal: 98, turns: 10, steps: 100, ...over });

// The score a training run is judged on: a win is 100; one card left in the hands is 90 and each further one costs 1;
// every card left in the draw pile costs 2.
describe('scoring a game', () => {
  it('gives a win 100, whatever else is true', () => {
    expect(scoreGame(record({ outcome: 'won', cardsLeft: 0 }))).toBe(100);
  });

  it('gives one card left in the hands 90, and one point less for each further card', () => {
    expect(scoreGame(record({ cardsLeft: 1 }))).toBe(90);
    // Ken's examples: 3 cards left is 88, 10 cards left is 81.
    expect(scoreGame(record({ cardsLeft: 3 }))).toBe(88);
    expect(scoreGame(record({ cardsLeft: 10 }))).toBe(81);
  });

  it('charges 2 for every card left in the draw pile', () => {
    // Ken's example: two players with a hand of 7, 30 cards left. 14 are in the hands and 16 in the draw pile.
    expect(scoreGame(record({ cardsLeft: 30, drawLeft: 16 }))).toBe(45);
    expect(scoreGame(record({ cardsLeft: 1, drawLeft: 1 }))).toBe(89); // the one card left is in the draw pile
  });

  it('always scores fewer cards left higher, hand cards or draw pile cards', () => {
    const hands = [1, 2, 5, 20, 60].map((left) => scoreGame(record({ cardsLeft: left })));
    for (let i = 1; i < hands.length; i += 1) expect(hands[i]!).toBeLessThan(hands[i - 1]!);
    const draws = [0, 1, 5, 20, 60].map((d) => scoreGame(record({ cardsLeft: 7 + d, drawLeft: d })));
    for (let i = 1; i < draws.length; i += 1) expect(draws[i]!).toBeLessThan(draws[i - 1]!);
  });

  it('keeps every loss below a win by at least 10, and a draw pile card worse than a hand card', () => {
    expect(100 - scoreGame(record({ cardsLeft: 1 }))).toBe(10);
    expect(scoreGame(record({ cardsLeft: 8, drawLeft: 1 }))).toBeLessThan(scoreGame(record({ cardsLeft: 8, drawLeft: 0 })));
  });

  it('has no cliff: a draw pile with one card in it costs only 2 more than an empty one', () => {
    // the same 5 cards in the hands, plus one more in the draw pile
    expect(scoreGame(record({ cardsLeft: 5, drawLeft: 0 })) - scoreGame(record({ cardsLeft: 6, drawLeft: 1 }))).toBe(2);
  });
});
