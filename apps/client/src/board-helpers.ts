import type { Card, GameState, PlayerColor } from '@upndown/shared-types';

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

export interface StatsHighlights {
  totalCardsPlayed: number;
  totalSpecialPlays: number;
  totalMovement: number;
  averageMovement: number;
  topBackwardTen: { names: string[]; count: number } | null;
}

// Everything the end-of-game screen shows beyond raw per-player rows. Ties name every tied player rather than picking one.
export function statsHighlights(state: Pick<GameState, 'players' | 'statistics'>): StatsHighlights {
  const rows = state.players.map((player) => ({
    name: player.name,
    stats: state.statistics.players[player.id] ?? { cardsPlayed: 0, totalMovement: 0, specialPlays: 0, nasCheatsUsed: 0 }
  }));
  const sum = (key: 'cardsPlayed' | 'totalMovement' | 'specialPlays'): number => rows.reduce((total, row) => total + row.stats[key], 0);
  const totalCardsPlayed = sum('cardsPlayed');
  const totalMovement = sum('totalMovement');
  const most = Math.max(0, ...rows.map((row) => row.stats.specialPlays));
  return {
    totalCardsPlayed,
    totalSpecialPlays: sum('specialPlays'),
    totalMovement,
    averageMovement: totalCardsPlayed > 0 ? totalMovement / totalCardsPlayed : 0,
    topBackwardTen: most > 0 ? { names: rows.filter((row) => row.stats.specialPlays === most).map((row) => row.name), count: most } : null
  };
}

export const PLAYER_COLOR_HEX: Record<PlayerColor, string> = {
  red:    '#e05555',
  orange: '#e08c30',
  green:  '#4db86a',
  cyan:   '#30b8d8',
  purple: '#8855cc',
  pink:   '#d855aa'
};

// "So close" only when it was: a loss with most of the deck left is not close, and saying so reads as mocking.
export function lossLine(left: number, total: number): string {
  return left <= Math.ceil(total * 0.1)
    ? `So close: only ${left} of ${total} cards were left to play.`
    : `${left} of ${total} cards were still to play.`;
}
