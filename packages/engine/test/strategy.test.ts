import { defaultMultiplayerSettings, defaultSolitaireSettings, type Card, type FoundationPile, type GameSettings, type GameState } from '@upndown/shared-types';
import { describe, expect, it } from 'vitest';
import { buildDeck } from '../src/init.js';
import { isValidPlay } from '../src/rules.js';
import { playGame, playMany, seededRandom, shuffleWith } from '../src/simulate.js';
import { chooseAction, DEFAULT_WEIGHTS, observe, rankPlays, type Observation } from '../src/strategy.js';
import { createStartedGameState } from '../src/transitions.js';

const card = (value: number): Card => ({ id: `c-${value}`, value });
const piles = (asc1 = 1, asc2 = 1, desc1 = 100, desc2 = 100): FoundationPile[] => [
  { id: 0, type: 'ascending', topCard: card(asc1) },
  { id: 1, type: 'ascending', topCard: card(asc2) },
  { id: 2, type: 'descending', topCard: card(desc1) },
  { id: 3, type: 'descending', topCard: card(desc2) }
];
const obs = (hand: number[], pileTops: FoundationPile[] = piles(), over: Partial<Observation> = {}): Observation => ({
  hand: hand.map(card), piles: pileTops, drawCount: 40, otherHandSizes: [7], cardsPlayedThisTurn: 0, required: 2,
  isSolitaire: false, myTurn: true, canSkip: false, canTrade: false, ...over
});

describe('which play is best', () => {
  it('prefers the smallest move, since small moves keep the piles useful', () => {
    const top = rankPlays(obs([5, 40], piles(1, 1, 100, 100)))[0]!;
    expect(top.cardId).toBe('c-5');
    expect(top.gap).toBe(4);
  });

  it('takes a backward 10 when there is one, however large the other moves would be', () => {
    const [best] = rankPlays(obs([47, 70], piles(57, 90, 100, 100)));
    expect(best).toMatchObject({ cardId: 'c-47', pileId: 0, backwardTen: true });
  });

  it('puts a card on the pile where it moves the least', () => {
    const [best] = rankPlays(obs([60], piles(30, 55, 100, 100)));
    expect(best).toMatchObject({ pileId: 1, gap: 5 });
  });

  it('does not play over a card it would strand when another play is as cheap', () => {
    // 20 would jump over 12 on the only pile that can take both; playing 12 first keeps 20 playable.
    const [best] = rankPlays(obs([12, 20], piles(10, 99, 100, 100)));
    expect(best.cardId).toBe('c-12');
  });

  it('never suggests a play the rules refuse', () => {
    const random = seededRandom(7);
    for (let i = 0; i < 300; i += 1) {
      const hand = Array.from({ length: 7 }, () => 2 + Math.floor(random() * 98));
      const tops = piles(1 + Math.floor(random() * 90), 1 + Math.floor(random() * 90), 10 + Math.floor(random() * 90), 10 + Math.floor(random() * 90));
      for (const suggestion of rankPlays(obs([...new Set(hand)], tops))) {
        const pile = tops.find((p) => p.id === suggestion.pileId)!;
        expect(isValidPlay(card(Number(suggestion.cardId.slice(2))), pile)).toBe(true);
      }
    }
  });
});

describe('what to do next', () => {
  it('plays until the minimum is met, then stops unless the next move is cheap', () => {
    expect(chooseAction(obs([5, 60], piles(), { cardsPlayedThisTurn: 0 }))).toMatchObject({ type: 'play', cardId: 'c-5' });
    expect(chooseAction(obs([60], piles(), { cardsPlayedThisTurn: 2 }))).toEqual({ type: 'endTurn' });
    expect(chooseAction(obs([3], piles(), { cardsPlayedThisTurn: 2 }))).toMatchObject({ type: 'play', cardId: 'c-3' });
  });

  it('does nothing when it is not its turn', () => {
    expect(chooseAction(obs([5], piles(), { myTurn: false }))).toEqual({ type: 'none' });
  });

  it('always plays in solitaire, where there is no turn to end', () => {
    expect(chooseAction(obs([80], piles(), { isSolitaire: true, required: 1 }))).toMatchObject({ type: 'play' });
  });

  it('skips before a turn it cannot finish, but only when skipping is allowed', () => {
    // Two cards are needed but only one can be played: the second would be impossible.
    const stuck = obs([50], piles(60, 60, 20, 20), { required: 2, canSkip: true });
    expect(chooseAction(stuck)).toEqual({ type: 'skip' });
    expect(chooseAction({ ...stuck, canSkip: false })).toMatchObject({ type: 'play' });
  });

  it('trades a card no pile will take, only when trading is allowed', () => {
    const dead = obs([70, 15], piles(80, 80, 20, 20), { canTrade: true, required: 1 });
    // 70 is below both ascending tops and above both descending tops: nowhere to go (but 70 = 80 - 10 is a backward 10).
    expect(chooseAction({ ...dead, hand: [card(75), card(15)], piles: piles(80, 80, 20, 20) })).toMatchObject({ type: 'trade', cardId: 'c-75' });
    expect(chooseAction({ ...dead, hand: [card(75), card(15)], piles: piles(80, 80, 20, 20), canTrade: false }).type).not.toBe('trade');
  });
});

// The strategy must reason from what a player can see. A hint on a client holds placeholders for the draw pile; a robot on
// the server holds the real cards. They must still agree, and neither may use a card the table cannot see.
describe('only what a player can see', () => {
  const game = (seed: number): GameState => createStartedGameState({
    gameId: 'ABC123', hostId: 'p1', players: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }],
    settings: { ...defaultMultiplayerSettings, autoRefillHand: true }, isSolitaire: false,
    deck: shuffleWith(buildDeck(defaultMultiplayerSettings), seededRandom(seed))
  });
  const hidden = (state: GameState): GameState => ({
    ...state,
    drawPile: state.drawPile.map((c, i) => ({ id: `hidden-${i}`, value: 0 })),
    players: state.players.map((p, i) => (i === 0 ? p : { ...p, hand: p.hand.map((c, k) => ({ id: `h-${i}-${k}`, value: 0 })) }))
  });

  it('gives the same advice from the real game and from the version with every hidden card blanked', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const real = game(seed);
      expect(chooseAction(observe(hidden(real), 'p1'))).toEqual(chooseAction(observe(real, 'p1')));
      expect(rankPlays(observe(hidden(real), 'p1'))).toEqual(rankPlays(observe(real, 'p1')));
    }
  });

  it('gives the same advice when only the draw pile differs', () => {
    const a = game(3);
    const b: GameState = { ...a, drawPile: [...a.drawPile].reverse() };
    expect(chooseAction(observe(a, 'p1'))).toEqual(chooseAction(observe(b, 'p1')));
  });

  it('shows nothing but the hand, the pile tops, the draw count and the other hands\' sizes', () => {
    const o = observe(game(5), 'p1');
    expect(Object.keys(o).sort()).toEqual(['canSkip', 'canTrade', 'cardsPlayedThisTurn', 'drawCount', 'hand', 'isSolitaire', 'myTurn', 'otherHandSizes', 'piles', 'required']);
    expect(o.otherHandSizes).toEqual([7, 7]);
  });
});

// "Intelligent" is measured, not assumed. These floors catch the strategy getting worse; the numbers are well under what it
// reaches now so noise cannot fail them.
describe('how well it plays', () => {
  const easy: GameSettings = { ...defaultSolitaireSettings, maxCardValue: 59, handSize: 8, minCardsPerTurn: 1 };
  const table: GameSettings = { ...defaultMultiplayerSettings, minCardsPerTurn: 2, autoRefillHand: false, handSize: 7 };

  it('almost always wins an easy solitaire game', () => {
    expect(playMany(easy, 1, 120).winRate).toBeGreaterThan(0.9);
  });

  it('wins a good share of games at a four-player table, and leaves few cards when it loses', () => {
    const summary = playMany(table, 4, 150);
    expect(summary.winRate).toBeGreaterThan(0.08);
    expect(summary.averageCardsLeft).toBeLessThan(8);
    expect(summary.stalled).toBe(0);
  });

  it('beats playing at random by a wide margin', () => {
    const random = seededRandom(99);
    let randomWins = 0;
    const games = 80;
    for (let i = 0; i < games; i += 1) {
      // A table of random legal players: same rules, no strategy.
      randomWins += playRandomGame(table, 4, 500 + i, random) ? 1 : 0;
    }
    expect(playMany(table, 4, games, DEFAULT_WEIGHTS, 500).winRate).toBeGreaterThan(randomWins / games + 0.05);
  });

  it('plays the same game twice from the same seed', () => {
    expect(playGame(table, 3, 42)).toEqual(playGame(table, 3, 42));
  });
});

// A baseline: legal plays chosen at random, ending the turn as soon as the minimum is met.
function playRandomGame(settings: GameSettings, players: number, seed: number, random: () => number): boolean {
  const rng = seededRandom(seed);
  let state = createStartedGameState({
    gameId: 'RANDOM', hostId: 'p1', players: Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })),
    settings, isSolitaire: false, deck: shuffleWith(buildDeck(settings), rng)
  });
  return randomPlay(state, random);
}

function randomPlay(start: GameState, random: () => number): boolean {
  let state = start;
  for (let step = 0; step < 4000 && state.gamePhase === 'playing'; step += 1) {
    const id = state.players[state.currentPlayerIndex]!.id;
    const o = observe(state, id);
    const legal = o.hand.flatMap((c) => o.piles.filter((p) => isValidPlay(c, p)).map((p) => ({ c, p })));
    const needed = Math.max(0, o.required - o.cardsPlayedThisTurn);
    if (needed === 0 || legal.length === 0) { state = endTurnSafe(state, id); continue; }
    const pick = legal[Math.floor(random() * legal.length)]!;
    state = playSafe(state, id, pick.c.id, pick.p.id);
  }
  return state.gamePhase === 'won';
}

import { endTurn, playCard } from '../src/transitions.js';
const endTurnSafe = (state: GameState, id: string): GameState => { try { return endTurn(state, id); } catch { return { ...state, gamePhase: 'lost' }; } };
const playSafe = (state: GameState, id: string, cardId: string, pileId: number): GameState => { try { return playCard(state, id, cardId, pileId); } catch { return { ...state, gamePhase: 'lost' }; } };
