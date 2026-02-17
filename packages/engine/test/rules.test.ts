import { describe, expect, it } from 'vitest';
import { isValidPlay, requiredCardsForTurn } from '../src/rules.js';

describe('isValidPlay', () => {
  it('validates ascending normal and backward-10 moves', () => {
    const pile = { id: 0, type: 'ascending' as const, topCard: { id: 'x', value: 67 } };

    expect(isValidPlay({ id: 'a', value: 68 }, pile)).toBe(true);
    expect(isValidPlay({ id: 'b', value: 57 }, pile)).toBe(true);
    expect(isValidPlay({ id: 'c', value: 66 }, pile)).toBe(false);
  });

  it('validates descending normal and backward-10 moves', () => {
    const pile = { id: 2, type: 'descending' as const, topCard: { id: 'x', value: 34 } };

    expect(isValidPlay({ id: 'a', value: 33 }, pile)).toBe(true);
    expect(isValidPlay({ id: 'b', value: 44 }, pile)).toBe(true);
    expect(isValidPlay({ id: 'c', value: 35 }, pile)).toBe(false);
  });
});

describe('requiredCardsForTurn', () => {
  it('uses configured minimum when draw pile has cards', () => {
    expect(requiredCardsForTurn(3, 5)).toBe(3);
  });

  it('forces minimum to 1 when draw pile is empty', () => {
    expect(requiredCardsForTurn(3, 0)).toBe(1);
  });
});
