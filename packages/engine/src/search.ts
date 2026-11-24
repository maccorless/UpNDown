import type { GameSettings, GameState } from '@upndown/shared-types';
import { sampleHidden } from './belief.js';
import { isValidPlay } from './rules.js';
import { mean, standardDeviation } from './stats.js';
import { scoreGame, type Policy } from './simulate.js';
import { chooseAction, DEFAULT_WEIGHTS, observe, type Action, type Observation, type StrategyWeights } from './strategy.js';
import { emptyPlayerStats, playCard } from './transitions.js';

// A search teacher for solitaire: for each legal play, deal the hidden cards at random several times, play on with the base
// strategy to the end of the game, and pick the play with the best average result. Every candidate sees the same dealt worlds,
// so a difference between candidates is the play and not the luck of the deal. With the played-card record (Tier B) the worlds are
// exactly the orderings the draw pile could have; without it (Tier A) the sampler guesses which cards were already played.
export interface SearchOptions {
  settings: GameSettings;
  worlds: number;
  weights?: StrategyWeights;
  // Judge each candidate by the base strategy's play (default), or with these weights for the rollouts only.
  rolloutWeights?: StrategyWeights;
  // Leave the base strategy's own play unless another candidate beats it, over the sampled worlds, by this many standard errors
  // of the paired difference. 0 takes the best average whatever the noise (which with few worlds chases luck).
  margin?: number;
}

function worldState(obs: Observation, settings: GameSettings, drawPile: ReturnType<typeof sampleHidden>['drawPile']): GameState {
  return {
    gameId: 'SEARCH', hostId: 'p1',
    players: [{ id: 'p1', name: 'P1', hand: obs.hand.map((c) => ({ ...c })), isHost: true }],
    foundationPiles: obs.piles.map((p) => ({ ...p, topCard: { ...p.topCard } })),
    drawPile, currentPlayerIndex: 0, gamePhase: 'playing', cardsPlayedThisTurn: 0,
    statistics: { turns: 0, startedAtMs: 0, endedAtMs: null, players: { p1: emptyPlayerStats() } },
    settings, isSolitaire: true
  };
}

function finish(state: GameState, weights: StrategyWeights): number {
  let s = state;
  for (let step = 0; step < 2000 && s.gamePhase === 'playing'; step += 1) {
    const action = chooseAction(observe(s, 'p1'), weights);
    if (action.type !== 'play') break;
    s = playCard(s, 'p1', action.cardId, action.pileId);
  }
  const drawLeft = s.drawPile.length;
  return scoreGame({ outcome: s.gamePhase === 'won' ? 'won' : 'lost', cardsLeft: drawLeft + s.players[0]!.hand.length, drawLeft, cardsTotal: 0, turns: 0, steps: 0 });
}

export function searchPolicy(options: SearchOptions): Policy {
  const base = options.weights ?? DEFAULT_WEIGHTS;
  const rollout = options.rolloutWeights ?? base;
  return (obs, random): Action => {
    if (!obs.isSolitaire) throw new Error('The search teacher is solitaire only: with other players the hidden cards are not uniform');
    // Two piles of one kind with the same top give the same result, so one of them is enough.
    const seen = new Set<string>();
    const candidates: Array<{ cardId: string; pileId: number }> = [];
    for (const card of obs.hand) for (const pile of obs.piles) {
      if (!isValidPlay(card, pile)) continue;
      const key = `${card.id}|${pile.type}|${pile.topCard.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ cardId: card.id, pileId: pile.id });
    }
    if (candidates.length === 0) return { type: 'none' };
    // The base strategy's own play goes first, so a tie between candidates keeps what the strategy would have done.
    const own = chooseAction(obs, base);
    if (own.type === 'play') candidates.sort((a, b) => Number(b.cardId === own.cardId && b.pileId === own.pileId) - Number(a.cardId === own.cardId && a.pileId === own.pileId));
    if (candidates.length === 1) return { type: 'play', ...candidates[0]! };
    // scores[i][w]: candidate i played out in world w. Candidate 0 is the base strategy's own play (see the sort above).
    const scores = candidates.map(() => [] as number[]);
    for (let w = 0; w < options.worlds; w += 1) {
      const world = sampleHidden({ settings: options.settings, hand: obs.hand, drawCount: obs.drawCount, otherHandSizes: [], played: obs.played }, random);
      candidates.forEach((c, i) => {
        scores[i]!.push(finish(playCard(worldState(obs, options.settings, [...world.drawPile]), 'p1', c.cardId, c.pileId), rollout));
      });
    }
    const margin = options.margin ?? 0;
    let best = 0;
    let bestMean = mean(scores[0]!);
    for (let i = 1; i < candidates.length; i += 1) {
      const m = mean(scores[i]!);
      if (m > bestMean) { best = i; bestMean = m; }
    }
    if (best !== 0 && margin > 0) {
      const diffs = scores[best]!.map((x, w) => x - scores[0]![w]!);
      const se = standardDeviation(diffs) / Math.sqrt(diffs.length);
      if (mean(diffs) <= margin * se) best = 0;
    }
    return { type: 'play', ...candidates[best]! };
  };
}
