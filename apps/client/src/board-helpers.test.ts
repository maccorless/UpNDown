import type { GameState } from '@upndown/shared-types';
import { describe, expect, it } from 'vitest';
import { classifyPlay, deckProgress, isBackwardTen, turnProgress } from './board-helpers.js';

// Players learn the game's key trick from this cue, so it must fire only for the exact backward 10 and in the pile's own direction.
describe('isBackwardTen', () => {
  it('is true only for exactly 10 below an ascending pile top', () => {
    expect(isBackwardTen({ id: 'a', value: 33 }, 'ascending', 43)).toBe(true);
    expect(isBackwardTen({ id: 'a', value: 53 }, 'ascending', 43)).toBe(false); // a normal forward play
    expect(isBackwardTen({ id: 'a', value: 34 }, 'ascending', 43)).toBe(false); // illegal, not special
  });

  it('is true only for exactly 10 above a descending pile top', () => {
    expect(isBackwardTen({ id: 'a', value: 94 }, 'descending', 84)).toBe(true);
    expect(isBackwardTen({ id: 'a', value: 74 }, 'descending', 84)).toBe(false);
    expect(isBackwardTen({ id: 'a', value: 33 }, 'descending', 43)).toBe(false); // only the ascending trick direction
  });
});

describe('deckProgress', () => {
  const state = (hands: number[], draw: number): Pick<GameState, 'drawPile' | 'players' | 'settings'> => ({
    drawPile: Array.from({ length: draw }, (_, i) => ({ id: `d${i}`, value: i })),
    players: hands.map((n, i) => ({ id: `p${i}`, name: `P${i}`, isHost: i === 0, hand: Array.from({ length: n }, (_, j) => ({ id: `h${i}${j}`, value: j })) })),
    settings: { minCardValue: 2, maxCardValue: 99 } as GameState['settings']
  });

  it('counts the draw pile and every hand, including hidden ones, against the full deck', () => {
    expect(deckProgress(state([7, 7, 7], 77))).toEqual({ total: 98, left: 98 });
    expect(deckProgress(state([5, 6], 50))).toEqual({ total: 98, left: 61 });
  });

  it('never reports more cards left than the deck holds', () => {
    expect(deckProgress(state([7, 7], 200)).left).toBe(98);
  });
});

describe('turnProgress', () => {
  it('shows how many of the required plays are done and whether the minimum is met', () => {
    expect(turnProgress(1, 2)).toEqual({ text: '1 of 2 played', met: false });
    expect(turnProgress(2, 2)).toEqual({ text: '2 of 2 played', met: true });
  });

  it('keeps the count at the requirement when a player plays extra cards', () => {
    expect(turnProgress(4, 2)).toEqual({ text: '2 of 2 played', met: true });
  });
});

// Each reaction sound teaches the player how the play went, so the thresholds are the behaviour under test.
describe('classifyPlay', () => {
  const base = (tops: number[], played: number, special = 0): GameState => ({
    foundationPiles: tops.map((value, id) => ({ id, type: 'ascending', topCard: { id: `t${id}-${value}`, value } })),
    statistics: { players: { a: { cardsPlayed: played, totalMovement: 0, specialPlays: special, nasCheatsUsed: 0 } } }
  } as unknown as GameState);

  it('cheers for a backward ten, which the engine counts as a special play', () => {
    expect(classifyPlay(base([43], 5), base([33], 6, 1))).toBe('cheer');
  });

  it('claps for a move of exactly one and groans for a jump of more than twenty', () => {
    expect(classifyPlay(base([10], 5), base([11], 6))).toBe('clap');
    expect(classifyPlay(base([10], 5), base([31], 6))).toBe('groan');
    expect(classifyPlay(base([10], 5), base([30], 6))).toBe('card'); // exactly 20 is not a jump
  });

  it('stays silent for undo, turn changes and catch-up bursts so nothing cheers twice', () => {
    expect(classifyPlay(base([11], 6), base([10], 5))).toBeNull();
    expect(classifyPlay(base([10], 5), base([10], 5))).toBeNull();
    expect(classifyPlay(base([10], 5), base([40], 8))).toBeNull();
  });
});
