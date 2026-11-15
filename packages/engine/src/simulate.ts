import type { Card, GameSettings, GameState } from '@upndown/shared-types';
import { buildDeck } from './init.js';
import { chooseAction, DEFAULT_WEIGHTS, observe, type StrategyWeights } from './strategy.js';
import { createStartedGameState, endTurn, playCard, skipTurn, tradeCard } from './transitions.js';

// A small seeded random source, so a game can be played again exactly from its seed.
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWith(deck: Card[], random: () => number): Card[] {
  const out = [...deck];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface GameRecord {
  outcome: 'won' | 'lost' | 'stalled';
  cardsLeft: number;
  // Cards still in the draw pile at the end (part of cardsLeft). A game that ends with the draw pile not emptied scores less.
  drawLeft: number;
  cardsTotal: number;
  turns: number;
  steps: number;
}

// Plays a whole game with the strategy in every seat, entirely in process: no sockets, no clock, no pacing. Solitaire when
// `players` is 1. `random` drives the shuffle and trades, so the same seed gives the same game.
export function playGame(settings: GameSettings, players: number, seed: number, weights: StrategyWeights = DEFAULT_WEIGHTS): GameRecord {
  const random = seededRandom(seed);
  const solitaire = players === 1;
  let state: GameState = createStartedGameState({
    gameId: 'SIMULA',
    hostId: 'p1',
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })),
    settings,
    isSolitaire: solitaire,
    deck: shuffleWith(buildDeck(settings), random)
  });
  let steps = 0;
  const limit = 5000;
  while (state.gamePhase === 'playing' && steps < limit) {
    steps += 1;
    const id = state.players[state.currentPlayerIndex]!.id;
    const action = chooseAction(observe(state, id), weights);
    try {
      if (action.type === 'play') state = playCard(state, id, action.cardId, action.pileId);
      else if (action.type === 'endTurn') state = endTurn(state, id);
      else if (action.type === 'skip') state = skipTurn(state, id);
      else if (action.type === 'trade') state = tradeCard(state, id, action.cardId, random);
      else return { outcome: 'stalled', cardsLeft: cardsLeft(state), drawLeft: state.drawPile.length, cardsTotal: cardsTotal(settings), turns: state.statistics.turns, steps };
    } catch {
      return { outcome: 'stalled', cardsLeft: cardsLeft(state), drawLeft: state.drawPile.length, cardsTotal: cardsTotal(settings), turns: state.statistics.turns, steps };
    }
  }
  const outcome = state.gamePhase === 'won' ? 'won' : state.gamePhase === 'lost' ? 'lost' : 'stalled';
  return { outcome, cardsLeft: cardsLeft(state), drawLeft: state.drawPile.length, cardsTotal: cardsTotal(settings), turns: state.statistics.turns, steps };
}

const cardsLeft = (state: GameState): number => state.drawPile.length + state.players.reduce((sum, player) => sum + player.hand.length, 0);
const cardsTotal = (settings: GameSettings): number => settings.maxCardValue - settings.minCardValue + 1;

// What a game is worth (decided by Ken, 15-Nov-2026). A win is 100. A loss starts at 90 for one card left in the hands, and
// each further card in the hands costs 1; every card still in the draw pile costs 2, so running out of moves early costs
// more than getting through the deck and stalling at the end. So a loss scores 91 - hand cards - 2 x draw pile cards:
// 3 cards left in the hands is 88, 10 is 81, and 14 in the hands with 16 in the draw pile is 45.
export function scoreGame(record: GameRecord): number {
  if (record.outcome === 'won') return 100;
  const inHands = record.cardsLeft - record.drawLeft;
  return 91 - inHands - 2 * record.drawLeft;
}

export interface Summary {
  games: number;
  winRate: number;
  averageCardsLeft: number;
  stalled: number;
}

export function playMany(settings: GameSettings, players: number, games: number, weights: StrategyWeights = DEFAULT_WEIGHTS, firstSeed = 1): Summary {
  let won = 0;
  let left = 0;
  let stalled = 0;
  for (let i = 0; i < games; i += 1) {
    const record = playGame(settings, players, firstSeed + i, weights);
    if (record.outcome === 'won') won += 1;
    if (record.outcome === 'stalled') stalled += 1;
    left += record.cardsLeft;
  }
  return { games, winRate: won / games, averageCardsLeft: left / games, stalled };
}
