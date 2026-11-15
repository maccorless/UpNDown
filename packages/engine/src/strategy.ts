import { cheatLimitOf, type Card, type FoundationPile, type GameState } from '@upndown/shared-types';
import { isValidPlay, requiredCardsForTurn } from './rules.js';

// What a player can see, and nothing else: their own hand, the top of each pile, how many cards are in the draw pile and how
// big the other hands are. The strategy only ever reads this, so a hint on a client (which holds placeholder cards for the
// draw pile) and a robot on the server (which holds the real ones) reason from exactly the same facts, and neither can use a
// card the table cannot see.
export interface Observation {
  hand: Card[];
  piles: FoundationPile[];
  drawCount: number;
  otherHandSizes: number[];
  cardsPlayedThisTurn: number;
  // Cards still to play before the turn may end (multiplayer). In solitaire there are no turns: the player just plays.
  required: number;
  isSolitaire: boolean;
  myTurn: boolean;
  canSkip: boolean;
  canTrade: boolean;
}

export function observe(state: GameState, playerId: string): Observation {
  const me = state.players.find((player) => player.id === playerId);
  const stats = state.statistics.players[playerId];
  const myTurn = state.isSolitaire || state.players[state.currentPlayerIndex]?.id === playerId;
  const available = (limitKind: 'skip' | 'trade', used: number): boolean => {
    const limit = cheatLimitOf(state.settings, limitKind);
    return limit === 'unlimited' || (limit === 'once' && used < 1);
  };
  return {
    hand: (me?.hand ?? []).map((card) => ({ ...card })),
    piles: state.foundationPiles.map((pile) => ({ ...pile, topCard: { ...pile.topCard } })),
    drawCount: state.drawPile.length,
    otherHandSizes: state.players.filter((player) => player.id !== playerId).map((player) => player.hand.length),
    cardsPlayedThisTurn: state.cardsPlayedThisTurn,
    required: state.isSolitaire ? 1 : requiredCardsForTurn(state.settings.minCardsPerTurn, state.drawPile.length),
    isSolitaire: state.isSolitaire,
    myTurn,
    canSkip: myTurn && !state.isSolitaire && state.cardsPlayedThisTurn === 0 && available('skip', stats?.skipsUsed ?? 0),
    canTrade: myTurn && state.drawPile.length > 0 && available('trade', stats?.tradesUsed ?? 0)
  };
}

// The numbers the strategy weighs. One table, so a search can tune them (see tools/sim) without touching the logic.
export interface StrategyWeights {
  // Each step a card moves a pile along its direction costs this much: small moves keep the piles useful for everyone.
  gap: number;
  // A backward 10 sets a pile back by ten for free, which nothing else does.
  backwardTen: number;
  // Cost per other card in hand that this play would make unplayable on that pile.
  skipOver: number;
  // Cost per card left in hand with no legal pile at all after this play.
  strand: number;
  // Once the minimum is met, keep playing while the move is this small (or a backward 10).
  stopGap: number;
  // Looking ahead through the cards in hand (future draws are unknown): each further card that can still be played in a row
  // is worth this much, and each step of movement along the way costs planGap.
  planPlayed: number;
  planGap: number;
}

export const DEFAULT_WEIGHTS: StrategyWeights = { gap: 1, backwardTen: 14, skipOver: 4, strand: 8, stopGap: 3, planPlayed: 3, planGap: 0.3 };

export interface Suggestion {
  cardId: string;
  pileId: number;
  score: number;
  gap: number;
  backwardTen: boolean;
}

const isBackwardTen = (card: Card, pile: FoundationPile): boolean =>
  pile.type === 'ascending' ? card.value === pile.topCard.value - 10 : card.value === pile.topCard.value + 10;

const withPlayed = (piles: FoundationPile[], pileId: number, card: Card): FoundationPile[] =>
  piles.map((pile) => (pile.id === pileId ? { ...pile, topCard: card } : pile));

const playableSomewhere = (card: Card, piles: FoundationPile[]): boolean => piles.some((pile) => isValidPlay(card, pile));

// Can `needed` more cards be played from this hand alone? Future draws are unknown, so none are counted: this is a safe
// floor (draws can only help), and it never reads a card the player cannot see.
function canMeet(hand: Card[], piles: FoundationPile[], needed: number): boolean {
  if (needed <= 0) return true;
  for (let i = 0; i < hand.length; i += 1) {
    const card = hand[i]!;
    for (const pile of piles) {
      if (!isValidPlay(card, pile)) continue;
      const rest = hand.filter((_, index) => index !== i);
      if (canMeet(rest, withPlayed(piles, pile.id, card), needed - 1)) return true;
    }
  }
  return false;
}

// How far the cards in hand can be played in a row from these piles by always taking the smallest move, and what that costs
// in movement. A cheap look ahead: it reads only the hand and the pile tops.
function rollout(hand: Card[], piles: FoundationPile[]): { played: number; moved: number } {
  let cards = hand;
  let current = piles;
  let played = 0;
  let moved = 0;
  for (;;) {
    let best: { card: Card; pile: FoundationPile; gap: number } | null = null;
    for (const card of cards) {
      for (const pile of current) {
        if (!isValidPlay(card, pile)) continue;
        const gap = isBackwardTen(card, pile) ? 0 : Math.abs(card.value - pile.topCard.value);
        if (!best || gap < best.gap) best = { card, pile, gap };
      }
    }
    if (!best) return { played, moved };
    played += 1;
    moved += best.gap;
    cards = cards.filter((card) => card.id !== best!.card.id);
    current = withPlayed(current, best.pile.id, best.card);
  }
}

// Every legal play, best first.
export function rankPlays(obs: Observation, weights: StrategyWeights = DEFAULT_WEIGHTS): Suggestion[] {
  const needed = Math.max(0, obs.required - obs.cardsPlayedThisTurn);
  const out: Suggestion[] = [];
  for (const card of obs.hand) {
    for (const pile of obs.piles) {
      if (!isValidPlay(card, pile)) continue;
      const backward = isBackwardTen(card, pile);
      const top = pile.topCard.value;
      const gap = backward ? 0 : Math.abs(card.value - top);
      const others = obs.hand.filter((other) => other.id !== card.id);
      // A forward play skips over any card between the top and this one; those cards can no longer go on this pile
      // (unless they sit exactly ten back from it, which still works as a backward 10).
      const skipped = backward ? 0 : others.filter((other) => (
        pile.type === 'ascending'
          ? other.value > top && other.value < card.value && other.value !== card.value - 10
          : other.value < top && other.value > card.value && other.value !== card.value + 10
      )).length;
      const after = withPlayed(obs.piles, pile.id, card);
      const stranded = others.filter((other) => !playableSomewhere(other, after)).length;
      // A play that leaves the turn's minimum out of reach is the worst kind: it loses the game.
      const reachable = canMeet(others, after, needed - 1);
      const ahead = weights.planPlayed !== 0 || weights.planGap !== 0 ? rollout(others, after) : { played: 0, moved: 0 };
      const score = (backward ? weights.backwardTen : 0) - weights.gap * gap - weights.skipOver * skipped - weights.strand * stranded
        + weights.planPlayed * ahead.played - weights.planGap * ahead.moved - (reachable ? 0 : 1000);
      out.push({ cardId: card.id, pileId: pile.id, score, gap, backwardTen: backward });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.cardId.localeCompare(b.cardId) || a.pileId - b.pileId);
}

export type Action =
  | { type: 'play'; cardId: string; pileId: number }
  | { type: 'endTurn' }
  | { type: 'skip' }
  | { type: 'trade'; cardId: string }
  | { type: 'none' };

// What to do next: play, end the turn, or (only if the game allows it and it is clearly right) skip or trade.
// `none` means nothing can be done (it is not this player's turn, or the player is stuck).
export function chooseAction(obs: Observation, weights: StrategyWeights = DEFAULT_WEIGHTS): Action {
  if (!obs.myTurn) return { type: 'none' };
  const plays = rankPlays(obs, weights);
  const needed = Math.max(0, obs.required - obs.cardsPlayedThisTurn);
  const best = plays[0];

  // Before a card is played this turn: if the minimum cannot be met from this hand, skipping first (while the game is still
  // being played) is the one thing that saves the turn.
  if (!obs.isSolitaire && obs.canSkip && needed > 0 && (!best || best.score < -500)) return { type: 'skip' };
  // A card that no pile will take is dead weight: trade it for an unseen one when the game allows.
  if (obs.canTrade) {
    const dead = obs.hand.find((card) => !playableSomewhere(card, obs.piles));
    if (dead && (obs.isSolitaire || needed > 0 || !best)) return { type: 'trade', cardId: dead.id };
  }
  if (!best) return obs.isSolitaire || needed > 0 ? { type: 'none' } : { type: 'endTurn' };
  if (obs.isSolitaire || needed > 0) return { type: 'play', cardId: best.cardId, pileId: best.pileId };
  // The minimum is met. Keep going only while the move is cheap; otherwise end the turn and leave the piles as they are.
  return best.backwardTen || best.gap <= weights.stopGap ? { type: 'play', cardId: best.cardId, pileId: best.pileId } : { type: 'endTurn' };
}
