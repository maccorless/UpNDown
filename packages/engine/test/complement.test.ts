import { describe, expect, it } from 'vitest';
import type { Card, FoundationPile } from '@upndown/shared-types';
import { chooseAction, deferComplement, DEFAULT_WEIGHTS, observe, createStartedGameState, buildDeck, seededRandom, shuffleWith } from '../src/index.js';
import { defaultSolitaireSettings } from '@upndown/shared-types';

const card = (value: number): Card => ({ id: `c-${value}`, value });
const up = (id: number, top: number): FoundationPile => ({ id, type: 'ascending', topCard: card(top) });
const down = (id: number, top: number): FoundationPile => ({ id, type: 'descending', topCard: card(top) });

describe('the pair rule: the second card of a ten-apart pair waits for its partner', () => {
  const hand = [3, 4, 5, 6, 8, 13, 15, 17, 18].map(card);
  const piles = [up(0, 1), up(1, 1), down(2, 20), down(3, 20)];

  // Playing the 3 the ordinary way throws away the free reset that 13 then 3 gives: the pile would end on 13 instead of 3 for the same cards.
  it('sends the 3 back to the climb (4 is the smallest step) when the 13 is still in the hand', () => {
    const redirect = deferComplement(hand, piles, { cardId: 'c-3', pileId: 0 });
    expect(redirect).toMatchObject({ cardId: 'c-4', pileId: 0 });
    expect(redirect!.reason).toContain('3 and 13');
  });

  it('lets the 3 go once the 13 is down, as a backward 10', () => {
    const after = [up(0, 13), up(1, 1), down(2, 20), down(3, 20)];
    expect(deferComplement([3, 4].map(card), after, { cardId: 'c-3', pileId: 0 })).toBeNull();
  });

  it('lets the 3 go the ordinary way when there is no partner in the hand (nothing is guessed about the draw pile)', () => {
    expect(deferComplement([3, 4, 5].map(card), piles, { cardId: 'c-3', pileId: 0 })).toBeNull();
  });

  it('does not touch the partner or the cards in between', () => {
    const own = [3, 4, 6, 7, 13].map(card);
    for (const value of [4, 6, 7, 13]) expect(deferComplement(own, piles, { cardId: `c-${value}`, pileId: 0 })).toBeNull();
  });

  it('is the mirror on a down pile: the higher card waits for the lower one', () => {
    const h = [48, 38, 45].map(card);
    expect(deferComplement(h, [down(0, 50), up(1, 1)], { cardId: 'c-48', pileId: 0 })).toMatchObject({ cardId: 'c-45', pileId: 0 });
    expect(deferComplement(h, [down(0, 50), up(1, 1)], { cardId: 'c-38', pileId: 0 })).toBeNull();
  });

  it('is what the written strategy now does with the hand from the screen', () => {
    const settings = { ...defaultSolitaireSettings, minCardValue: 2, maxCardValue: 19, handSize: 9 };
    const state = structuredClone(createStartedGameState({ gameId: 'PAIR', hostId: 'p1', players: [{ id: 'p1', name: 'P1' }], settings, isSolitaire: true, deck: shuffleWith(buildDeck(settings), seededRandom(1)) }));
    state.players[0]!.hand = hand;
    const obs = observe(state, 'p1');
    const picked = (w = DEFAULT_WEIGHTS) => { const a = chooseAction(obs, w); return a.type === 'play' ? a.cardId : a.type; };
    expect(picked()).not.toBe('c-3');
    expect(picked({ ...DEFAULT_WEIGHTS, deferComplement: false })).toBeDefined();
  });
});
