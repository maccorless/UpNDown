import type { Card, FoundationPile, GameSettings, GameState, ReactionState, ReactionType } from '@upndown/shared-types';
import { isValidPlay } from './rules.js';
import { chooseAction, isBackwardTen, type Action, type Observation, type PlayBias, type StrategyWeights } from './strategy.js';

// Reactions (none, like, love, really love): one small pure module for the rules of the board, the sender and the receiver.
// The messages match the server's, which will move onto this module when robots use reactions at live tables.

export const REACTION_LEVEL: Record<ReactionType, number> = { like: 1, love: 2, really_love: 3 };

// ---- The board: who may set a reaction, and when it clears ----

export function setReactionOn(board: ReactionState, state: GameState, playerId: string, pileId: number, type: ReactionType | null): ReactionState {
  if (!state.players.some((p) => p.id === playerId)) throw new Error('Player not in game');
  if (state.gamePhase !== 'playing') throw new Error('Reactions are only allowed during an active game');
  if (state.players[state.currentPlayerIndex]?.id === playerId) throw new Error('Cannot react during your own turn');
  const mine = { ...(board[playerId] ?? {}) };
  if (type === null) delete mine[pileId];
  else mine[pileId] = type;
  const next = { ...board };
  if (Object.keys(mine).length === 0) delete next[playerId];
  else next[playerId] = mine;
  return next;
}

// A player's reactions clear when their turn starts.
export function clearPlayerOn(board: ReactionState, playerId: string): ReactionState {
  return Object.fromEntries(Object.entries(board).filter(([id]) => id !== playerId));
}

// ---- The sender: the level reports how good my best card for the pile is ----

// A level is a step on the move (as a fraction of the deck): at most `like`, `love`, `reallyLove`, which must get smaller.
// A backward 10 is always really love, and with reallyLove 0 it is the only thing that is. These are the only numbers the sender has, so a person can compute the same signal.
export interface SenderThresholds { like: number; love: number; reallyLove: number }
export const DEFAULT_SENDER: SenderThresholds = { like: 0.105, love: 0.03, reallyLove: 0 };

export function senderLevel(hand: readonly Card[], pile: FoundationPile, settings: GameSettings, t: SenderThresholds = DEFAULT_SENDER): ReactionType | null {
  if (!(t.like >= t.love && t.love >= t.reallyLove && t.reallyLove >= 0)) throw new Error('Sender thresholds must get smaller: like, love, really love');
  const span = settings.maxCardValue - settings.minCardValue + 1;
  let best = Infinity;
  for (const card of hand) {
    if (!isValidPlay(card, pile)) continue;
    best = Math.min(best, isBackwardTen(card, pile) ? 0 : Math.abs(card.value - pile.topCard.value));
  }
  if (best === Infinity) return null;
  const fraction = best / span;
  if (best === 0 || fraction <= t.reallyLove) return 'really_love';
  if (fraction <= t.love) return 'love';
  if (fraction <= t.like) return 'like';
  return null;
}

// Every player not on turn sets their honest level on every pile; the player on turn holds none.
export function honestBoard(state: GameState, t: SenderThresholds = DEFAULT_SENDER): ReactionState {
  const board: ReactionState = {};
  if (state.gamePhase !== 'playing') return board;
  const onTurn = state.players[state.currentPlayerIndex]?.id;
  for (const player of state.players) {
    if (player.id === onTurn) continue;
    const mine: Record<number, ReactionType> = {};
    for (const pile of state.foundationPiles) {
      const level = senderLevel(player.hand, pile, state.settings, t);
      if (level) mine[pile.id] = level;
    }
    if (Object.keys(mine).length > 0) board[player.id] = mine;
  }
  return board;
}

// ---- The receiver: do not take a pile a teammate has asked for, unless the move is tiny or a backward 10 ----

export interface ReceiverParams { avoid: number; tinyGap: number }
export const DEFAULT_RECEIVER: ReceiverParams = { avoid: 3, tinyGap: 2 };

export function highestAsk(obs: Observation, pileId: number): number {
  let top = 0;
  for (const piles of Object.values(obs.reactions ?? {})) {
    const level = piles[pileId];
    if (level) top = Math.max(top, REACTION_LEVEL[level]);
  }
  return top;
}

export const receiverBias = (obs: Observation, r: ReceiverParams = DEFAULT_RECEIVER): PlayBias =>
  (pileId, gap, backwardTen) => (backwardTen || gap <= r.tinyGap ? 0 : -r.avoid * highestAsk(obs, pileId));

export const receiverPolicy = (weights: StrategyWeights, r: ReceiverParams = DEFAULT_RECEIVER) =>
  (obs: Observation): Action => chooseAction(obs, weights, obs.reactions ? receiverBias(obs, r) : undefined);
