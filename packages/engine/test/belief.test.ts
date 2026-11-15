import { describe, expect, it } from 'vitest';
import { observe } from '../src/strategy.js';
import { playedValues, sampleHidden } from '../src/belief.js';
import { buildDeck } from '../src/init.js';
import { seededRandom, shuffleWith } from '../src/simulate.js';
import { createStartedGameState, playCard } from '../src/transitions.js';
import { tableById } from '../src/tables.js';

function started(id: string, seed: number) {
  const t = tableById(id);
  const state = createStartedGameState({
    gameId: 'BELIEF', hostId: 'p1', players: Array.from({ length: t.players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })),
    settings: t.settings, isSolitaire: t.players === 1, deck: shuffleWith(buildDeck(t.settings), seededRandom(seed))
  });
  return { t, state };
}

describe('the played-card record', () => {
  it('is empty at the start and grows by exactly the cards played', () => {
    const { state } = started('s2-solo-79-h7', 1);
    expect(playedValues(state)).toEqual([]);
    const card = state.players[0]!.hand.find((c) => state.foundationPiles.some((p) => (p.type === 'ascending' ? c.value > p.topCard.value : c.value < p.topCard.value)))!;
    const pile = state.foundationPiles.find((p) => (p.type === 'ascending' ? card.value > p.topCard.value : card.value < p.topCard.value))!;
    const after = playCard(state, 'p1', card.id, pile.id);
    expect(playedValues(after)).toEqual([card.value]);
  });
});

describe('the hidden-card sampler', () => {
  it('with the record, always deals exactly the cards that are hidden, so in solitaire it only reorders the draw pile', () => {
    const { t, state } = started('s2-solo-79-h7', 2);
    const obs = observe(state, 'p1');
    const truth = state.drawPile.map((c) => c.value).sort((a, b) => a - b);
    for (let i = 0; i < 20; i += 1) {
      const deal = sampleHidden({ settings: t.settings, hand: obs.hand, drawCount: obs.drawCount, otherHandSizes: obs.otherHandSizes, played: playedValues(state) }, seededRandom(i + 1));
      expect(deal.drawPile.map((c) => c.value).sort((a, b) => a - b)).toEqual(truth);
      expect(deal.otherHands).toEqual([]);
    }
  });

  it('never hands out a card from my hand or the record, and never the same card twice, with several players', () => {
    const { t, state } = started('s2-4p-79-h7', 3);
    const obs = observe(state, 'p1');
    const deal = sampleHidden({ settings: t.settings, hand: obs.hand, drawCount: obs.drawCount, otherHandSizes: obs.otherHandSizes, played: playedValues(state) }, seededRandom(9));
    const all = [...deal.drawPile, ...deal.otherHands.flat()].map((c) => c.value);
    expect(new Set(all).size).toBe(all.length);
    expect(all.some((v) => obs.hand.some((c) => c.value === v))).toBe(false);
    expect(deal.otherHands.map((h) => h.length)).toEqual(obs.otherHandSizes);
    expect(deal.drawPile).toHaveLength(obs.drawCount);
  });

  it('without the record, can place a card that was already played (what Tier A cannot know), but the counts still match', () => {
    const { t, state } = started('s2-solo-79-h7', 4);
    const card = state.players[0]!.hand.find((c) => c.value > state.foundationPiles[0]!.topCard.value)!;
    const after = playCard(state, 'p1', card.id, 0);
    const obs = observe(after, 'p1');
    let sawPlayed = false;
    for (let i = 0; i < 200; i += 1) {
      const deal = sampleHidden({ settings: t.settings, hand: obs.hand, drawCount: obs.drawCount, otherHandSizes: [] }, seededRandom(i + 1));
      expect(deal.drawPile).toHaveLength(obs.drawCount);
      if (deal.drawPile.some((c) => c.value === card.value)) sawPlayed = true;
    }
    expect(sawPlayed).toBe(true);
  });

  it('is the same every time for one seed, and refuses an impossible situation', () => {
    const { t, state } = started('s2-solo-79-h7', 5);
    const obs = observe(state, 'p1');
    const input = { settings: t.settings, hand: obs.hand, drawCount: obs.drawCount, otherHandSizes: [] as number[], played: [] as number[] };
    expect(sampleHidden(input, seededRandom(7))).toEqual(sampleHidden(input, seededRandom(7)));
    expect(() => sampleHidden({ ...input, drawCount: 999 }, seededRandom(1))).toThrow('could be hidden');
  });
});
