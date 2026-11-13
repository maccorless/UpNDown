import type { Card, GameState } from '@upndown/shared-types';

// The special "backward 10" play: exactly 10 against the pile's direction. Any other legal play moves with it.
export function isBackwardTen(card: Card, pileType: 'ascending' | 'descending', topValue: number): boolean {
  return pileType === 'ascending' ? card.value === topValue - 10 : card.value === topValue + 10;
}

// Cards still to play = draw pile + every hand. Other players' hands are hidden but their length is sent.
export function deckProgress(state: Pick<GameState, 'drawPile' | 'players' | 'settings'>): { total: number; left: number } {
  const total = state.settings.maxCardValue - state.settings.minCardValue + 1;
  const inHands = state.players.reduce((sum, player) => sum + player.hand.length, 0);
  return { total, left: Math.min(total, state.drawPile.length + inHands) };
}

export function turnProgress(played: number, required: number): { text: string; met: boolean } {
  const met = played >= required;
  return { text: `${Math.min(played, required)} of ${required} played`, met };
}

export type PlayKind = 'card' | 'clap' | 'groan' | 'cheer';

const sumStat = (state: Pick<GameState, 'statistics'>, key: 'cardsPlayed' | 'specialPlays'): number =>
  Object.values(state.statistics.players).reduce((sum, stats) => sum + stats[key], 0);

// Names the sound for the single play between two states, so every client reacts the same way to anyone's play.
// Returns null when no play happened (turn change, undo, join) or several happened at once (reconnect catch-up).
export function classifyPlay(prev: GameState, next: GameState): PlayKind | null {
  if (sumStat(next, 'cardsPlayed') - sumStat(prev, 'cardsPlayed') !== 1) return null;
  if (sumStat(next, 'specialPlays') > sumStat(prev, 'specialPlays')) return 'cheer';
  const moved = next.foundationPiles.find((pile, i) => pile.topCard.id !== prev.foundationPiles[i]?.topCard.id);
  const before = moved && prev.foundationPiles.find((pile) => pile.id === moved.id);
  if (!moved || !before) return 'card';
  const distance = Math.abs(moved.topCard.value - before.topCard.value);
  if (distance === 1) return 'clap';
  return distance > 20 ? 'groan' : 'card';
}
