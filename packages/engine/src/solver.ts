import type { Card, GameSettings, GameState } from '@upndown/shared-types';
import { isValidPlay } from './rules.js';
import { scoreGame } from './simulate.js';
import { createStartedGameState, playCard } from './transitions.js';

// The exact best result for a solitaire deal whose draw order is known (a perfect-information oracle). It is only for small decks:
// the search tries every legal play and remembers the states it has seen. Its answer is the ceiling any strategy that cannot
// see the draw pile is measured against. It uses the engine's own transitions, so it plays by exactly the game's rules.
export interface Solution {
  score: number;
  outcome: 'won' | 'lost';
  plays: Array<{ cardId: string; pileId: number }>;
  nodes: number;
}

const finalScore = (state: GameState): number => {
  const drawLeft = state.drawPile.length;
  const outcome = state.gamePhase === 'won' ? 'won' : 'lost';
  return scoreGame({ outcome, cardsLeft: drawLeft + state.players[0]!.hand.length, drawLeft, cardsTotal: 0, turns: 0, steps: 0 });
};

// The state is decided by the pile tops, the hand and how much of the draw pile is left (the order of the draw pile is fixed). The two
// ascending piles are interchangeable, and so are the two descending ones, so their tops are sorted before looking a state up.
const keyOf = (state: GameState): string => {
  const asc = state.foundationPiles.filter((p) => p.type === 'ascending').map((p) => p.topCard.value).sort((a, b) => a - b);
  const desc = state.foundationPiles.filter((p) => p.type === 'descending').map((p) => p.topCard.value).sort((a, b) => a - b);
  const hand = state.players[0]!.hand.map((c) => c.value).sort((a, b) => a - b);
  return `${asc}|${desc}|${hand}|${state.drawPile.length}`;
};

export function solveSolitaire(settings: GameSettings, deck: Card[], nodeLimit = 5_000_000): Solution {
  const start = createStartedGameState({ gameId: 'SOLVER', hostId: 'p1', players: [{ id: 'p1', name: 'P1' }], settings, isSolitaire: true, deck });
  const best = new Map<string, { score: number; plays: Solution['plays'] }>();
  let nodes = 0;

  const search = (state: GameState): { score: number; plays: Solution['plays'] } => {
    if (state.gamePhase !== 'playing') return { score: finalScore(state), plays: [] };
    const key = keyOf(state);
    const seen = best.get(key);
    if (seen) return seen;
    nodes += 1;
    if (nodes > nodeLimit) throw new Error(`The deal is too big to solve exactly (more than ${nodeLimit} states)`);
    let top: { score: number; plays: Solution['plays'] } = { score: -Infinity, plays: [] };
    // Equal cards cannot occur and equal piles give the same state, so trying one pile of each kind with a given top is enough.
    const tried = new Set<string>();
    for (const card of state.players[0]!.hand) {
      for (const pile of state.foundationPiles) {
        if (!isValidPlay(card, pile)) continue;
        const move = `${card.id}|${pile.type}|${pile.topCard.value}`;
        if (tried.has(move)) continue;
        tried.add(move);
        const next = search(playCard(state, 'p1', card.id, pile.id));
        if (next.score > top.score) top = { score: next.score, plays: [{ cardId: card.id, pileId: pile.id }, ...next.plays] };
        if (top.score === 100) break;
      }
      if (top.score === 100) break;
    }
    best.set(key, top);
    return top;
  };

  const result = search(start);
  return { ...result, outcome: result.score === 100 ? 'won' : 'lost', nodes };
}
