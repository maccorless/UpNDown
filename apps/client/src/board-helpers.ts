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
