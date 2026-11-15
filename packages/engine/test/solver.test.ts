import { defaultSolitaireSettings, type GameSettings } from '@upndown/shared-types';
import { describe, expect, it } from 'vitest';
import { buildDeck } from '../src/init.js';
import { playGame, scoreGame, seededRandom, shuffleWith } from '../src/simulate.js';
import { solveSolitaire } from '../src/solver.js';
import { createStartedGameState, playCard } from '../src/transitions.js';
import { seedsFor } from '../src/evaluation.js';

const small = (top: number, hand: number): GameSettings => ({
  ...defaultSolitaireSettings, maxCardValue: top, handSize: hand, minCardsPerTurn: 1,
  cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off' }, allowCardLookup: false, allowUndo: false
});
const dealt = (settings: GameSettings, seed: number) => shuffleWith(buildDeck(settings), seededRandom(seed));

// Plays the solver's plays through the engine and returns what the game says the result is.
function replay(settings: GameSettings, deck: ReturnType<typeof dealt>, plays: Array<{ cardId: string; pileId: number }>) {
  let state = createStartedGameState({ gameId: 'REPLAY', hostId: 'p1', players: [{ id: 'p1', name: 'P1' }], settings, isSolitaire: true, deck });
  for (const p of plays) state = playCard(state, 'p1', p.cardId, p.pileId);
  const drawLeft = state.drawPile.length;
  return { phase: state.gamePhase, score: scoreGame({ outcome: state.gamePhase === 'won' ? 'won' : 'lost', cardsLeft: drawLeft + state.players[0]!.hand.length, drawLeft, cardsTotal: 0, turns: 0, steps: 0 }) };
}

describe('the exact solver', () => {
  const settings = small(59, 5);
  const seeds = seedsFor('train', 12);

  it('gives a play list that the engine confirms reaches exactly the score it claims', () => {
    for (const seed of seeds) {
      const deck = dealt(settings, seed);
      const s = solveSolitaire(settings, deck);
      const r = replay(settings, deck, s.plays);
      expect(r.score, `seed ${seed}`).toBe(s.score);
      expect(r.phase, `seed ${seed}`).toBe(s.outcome);
    }
  });

  it('is never worse than the strategy on the same deal, and is sometimes better (so it is not just echoing it)', () => {
    let better = 0;
    for (const seed of seeds) {
      const exact = solveSolitaire(settings, dealt(settings, seed)).score;
      const heuristic = scoreGame(playGame(settings, 1, seed));
      expect(exact, `seed ${seed}`).toBeGreaterThanOrEqual(heuristic);
      if (exact > heuristic) better += 1;
    }
    expect(better).toBeGreaterThan(0);
  });

  it('is never beaten by random play, which is the cheapest way to look for a play it missed', () => {
    for (const seed of seeds.slice(0, 10)) {
      const deck = dealt(settings, seed);
      const exact = solveSolitaire(settings, deck).score;
      const random = seededRandom(seed + 7);
      for (let attempt = 0; attempt < 200; attempt += 1) {
        let state = createStartedGameState({ gameId: 'RND', hostId: 'p1', players: [{ id: 'p1', name: 'P1' }], settings, isSolitaire: true, deck });
        while (state.gamePhase === 'playing') {
          const moves = state.players[0]!.hand.flatMap((c) => state.foundationPiles.filter((p) => (p.type === 'ascending' ? c.value > p.topCard.value || c.value === p.topCard.value - 10 : c.value < p.topCard.value || c.value === p.topCard.value + 10)).map((p) => ({ c, p })));
          if (moves.length === 0) break;
          const m = moves[Math.floor(random() * moves.length)]!;
          state = playCard(state, 'p1', m.c.id, m.p.id);
        }
        const left = state.drawPile.length;
        const score = scoreGame({ outcome: state.gamePhase === 'won' ? 'won' : 'lost', cardsLeft: left + state.players[0]!.hand.length, drawLeft: left, cardsTotal: 0, turns: 0, steps: 0 });
        expect(score, `seed ${seed}`).toBeLessThanOrEqual(exact);
      }
    }
  });

  it('wins a deck that is dealt in order, where one pile can take every card', () => {
    const deck = buildDeck(small(12, 4));
    const s = solveSolitaire(small(12, 4), deck);
    expect(s.score).toBe(100);
    expect(s.outcome).toBe('won');
  });

  it('refuses a deal that is too big rather than running for ever', () => {
    expect(() => solveSolitaire(small(99, 7), dealt(small(99, 7), 1), 50)).toThrow('too big');
  });
});
