import { inCardRange, MONTY_GRID_MAX, MONTY_GRID_MIN, type GameState, type MontyCell } from '@upndown/shared-types';

// Where each card from 1 to 100 is. The draw pile and every hand are known to whoever runs this: the server for a table, the
// browser for solitaire. A card in the game's range that is in neither has been played to a foundation pile. Piles keep only
// their top card, so this is the only way to know the played ones. Cards outside the game's range are "out".
export function fullMontyCells(state: Pick<GameState, 'settings' | 'drawPile' | 'players'>): MontyCell[] {
  const inDraw = new Set(state.drawPile.map((card) => card.value));
  const inHand = new Set(state.players.flatMap((player) => player.hand.map((card) => card.value)));
  const cells: MontyCell[] = [];
  for (let value = MONTY_GRID_MIN; value <= MONTY_GRID_MAX; value += 1) {
    if (!inCardRange(state.settings, value)) cells.push('out');
    else if (inDraw.has(value)) cells.push('draw');
    else if (inHand.has(value)) cells.push('hand');
    else cells.push('played');
  }
  return cells;
}
