import type { FoundationPile, GameState } from '@upndown/shared-types';
import { describe, expect, it } from 'vitest';
import { buildDeck } from '../src/init.js';
import { clearPlayerOn, DEFAULT_RECEIVER, DEFAULT_SENDER, honestBoard, receiverBias, REACTION_LEVEL, receiverPolicy, senderLevel, setReactionOn } from '../src/reactions.js';
import { playGameWith, seededRandom, shuffleWith, weightedPolicy } from '../src/simulate.js';
import { DEFAULT_WEIGHTS, observe, rankPlays } from '../src/strategy.js';
import { seedsFor, playSet, summarize } from '../src/evaluation.js';
import { tableById } from '../src/tables.js';
import { createStartedGameState } from '../src/transitions.js';

const table = tableById('s3-4p-99-h7');
const piles: FoundationPile[] = [
  { id: 0, type: 'ascending', topCard: { id: 'f-0', value: 30 } },
  { id: 1, type: 'ascending', topCard: { id: 'f-1', value: 1 } },
  { id: 2, type: 'descending', topCard: { id: 'f-2', value: 70 } },
  { id: 3, type: 'descending', topCard: { id: 'f-3', value: 100 } }
];
const card = (value: number) => ({ id: `c-${value}`, value });
const level = (values: number[], pileIndex = 0) => senderLevel(values.map(card), piles[pileIndex]!, table.settings);
const num = (l: ReturnType<typeof level>) => (l ? REACTION_LEVEL[l] : 0);

function game(seed = 1): GameState {
  return createStartedGameState({
    gameId: 'REACT1', hostId: 'p1', players: [1, 2, 3, 4].map((i) => ({ id: `p${i}`, name: `P${i}` })),
    settings: table.settings, isSolitaire: false, deck: shuffleWith(buildDeck(table.settings), seededRandom(seed))
  });
}

describe('the sender is truthful and monotone', () => {
  it('never falls as the single card for a pile gets closer, ascending (a backward 10 is the one jump up)', () => {
    let last = -1;
    for (let value = 99; value > 30; value -= 1) {
      expect(num(level([value])), `card ${value}`).toBeGreaterThanOrEqual(last);
      last = num(level([value]));
    }
  });

  it('is the same on a descending pile, mirrored', () => {
    let last = -1;
    for (let value = 2; value < 70; value += 1) {
      expect(num(level([value], 2)), `card ${value}`).toBeGreaterThanOrEqual(last);
      last = num(level([value], 2));
    }
  });

  it('reports the best card in the hand, not the worst, and nothing when no card fits', () => {
    expect(level([95, 32])).toBe('love');
    expect(level([95, 80])).toBeNull();
    expect(level([10, 15], 0)).toBeNull();
  });

  it('keeps really love for a backward 10 alone; a move of up to 2 is love and a move of 3 is like', () => {
    expect(level([20])).toBe('really_love');
    expect(level([32])).toBe('love');
    expect(level([33])).toBe('like');
  });

  it('steps down through love and like as the move grows, 98 cards being the deck', () => {
    expect(level([35])).toBe('like'); // move 5 is 5.1%
    expect(level([40])).toBe('like'); // move 10 is 10.2%, the last like
    expect(level([41])).toBeNull(); // move 11 is 11.2%
  });

  it('refuses thresholds that do not get smaller', () => {
    expect(() => senderLevel([card(31)], piles[0]!, table.settings, { like: 0.01, love: 0.05, reallyLove: 0.02 })).toThrow('get smaller');
  });
});

describe('the board rules match the server', () => {
  const state = game();
  it('lets a player off turn set and clear a reaction, and drops an empty player', () => {
    const set = setReactionOn({}, state, 'p2', 1, 'love');
    expect(set).toEqual({ p2: { 1: 'love' } });
    expect(setReactionOn(set, state, 'p2', 1, null)).toEqual({});
  });

  it('refuses the player on turn, a stranger, and a game that is not being played, with the server\'s words', () => {
    expect(() => setReactionOn({}, state, 'p1', 0, 'like')).toThrow('Cannot react during your own turn');
    expect(() => setReactionOn({}, state, 'zz', 0, 'like')).toThrow('Player not in game');
    expect(() => setReactionOn({}, { ...state, gamePhase: 'won' }, 'p2', 0, 'like')).toThrow('Reactions are only allowed during an active game');
  });

  it('clears one player and leaves the others alone', () => {
    expect(clearPlayerOn({ p2: { 0: 'like' }, p3: { 1: 'love' } }, 'p2')).toEqual({ p3: { 1: 'love' } });
  });

  it('never shows a reaction for the player on turn', () => {
    expect(honestBoard(state)['p1']).toBeUndefined();
  });
});

describe('the receiver', () => {
  const state = game(4);
  const obs = observe(state, 'p1', { p2: { 0: 'really_love' }, p3: { 0: 'like' } });

  it('sees the others\' reactions but not its own', () => {
    const own = observe(state, 'p1', { p1: { 0: 'love' }, p2: { 1: 'like' } });
    expect(Object.keys(own.reactions ?? {})).toEqual(['p2']);
  });

  it('takes the highest ask on a pile and counts zero where nobody asked', () => {
    const bias = receiverBias(obs);
    expect(bias(0, 10, false)).toBe(-DEFAULT_RECEIVER.avoid * 3);
    expect(bias(1, 10, false)).toBeCloseTo(0);
  });

  it('lets a tiny move and a backward 10 through even on a pile that is asked for', () => {
    const bias = receiverBias(obs);
    expect(bias(0, DEFAULT_RECEIVER.tinyGap, false)).toBe(0);
    expect(bias(0, 0, true)).toBe(0);
  });

  it('lowers plays on the asked-for pile and leaves the others', () => {
    const plain = rankPlays(obs, DEFAULT_WEIGHTS);
    const steered = rankPlays(obs, DEFAULT_WEIGHTS, receiverBias(obs));
    const find = (list: typeof plain, pile: number, cardId: string) => list.find((s) => s.pileId === pile && s.cardId === cardId)?.score;
    for (const s of plain) {
      const after = find(steered, s.pileId, s.cardId)!;
      if (s.pileId !== 0) expect(after).toBe(s.score);
      else expect(after).toBeLessThanOrEqual(s.score);
    }
  });

  it('is the plain strategy when there are no reactions', () => {
    const none = observe(state, 'p1');
    expect(receiverPolicy(DEFAULT_WEIGHTS)(none)).toEqual(weightedPolicy()(none, () => 0));
  });
});

describe('reactions in the simulator', () => {
  const seeds = seedsFor('validation', 40);

  it('are reproducible from one seed and never stall a game', () => {
    const run = () => playSet(table, receiverPolicy(DEFAULT_WEIGHTS), seeds, DEFAULT_SENDER);
    expect(run()).toEqual(run());
    expect(summarize(run()).stalled).toBe(0);
  });

  it('change nothing at all for a policy that ignores them, so the no-reaction numbers stay comparable', () => {
    expect(playSet(table, weightedPolicy(), seeds, DEFAULT_SENDER)).toEqual(playSet(table, weightedPolicy(), seeds));
  });

  it('change the play of a policy that reads them, on some deals', () => {
    expect(playSet(table, receiverPolicy(DEFAULT_WEIGHTS), seeds, DEFAULT_SENDER)).not.toEqual(playSet(table, weightedPolicy(), seeds));
  });

  it('do nothing in solitaire, where nobody else is there to ask', () => {
    const solo = tableById('s3-solo-99-h7');
    expect(playGameWith(solo.settings, 1, 3, receiverPolicy(DEFAULT_WEIGHTS), DEFAULT_SENDER)).toEqual(playGameWith(solo.settings, 1, 3, weightedPolicy()));
  });
});
