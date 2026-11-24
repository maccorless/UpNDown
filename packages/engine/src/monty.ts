import { inCardRange, MONTY_GRID_MAX, MONTY_GRID_MIN, type GameState, type MontyCell } from '@upndown/shared-types';

// Where each card from 1 to 100 is, as seen by `viewerId`, whose own hand is "mine". The draw pile and every hand are known to
// whoever runs this: the server for a table, the browser for solitaire. A card in the game's range that is in neither has been
// played to a foundation pile. Piles keep only their top card, so this is the only way to know the played ones, and a played
// card that is still a pile's top is marked "top". Cards outside the game's range are "out".
export function fullMontyCells(state: Pick<GameState, 'settings' | 'drawPile' | 'players' | 'foundationPiles'>, viewerId: string): MontyCell[] {
  const inDraw = new Set(state.drawPile.map((card) => card.value));
  const mine = new Set(state.players.filter((player) => player.id === viewerId).flatMap((player) => player.hand.map((card) => card.value)));
  const inOtherHands = new Set(state.players.filter((player) => player.id !== viewerId).flatMap((player) => player.hand.map((card) => card.value)));
  const tops = new Set(state.foundationPiles.map((pile) => pile.topCard.value));
  const cells: MontyCell[] = [];
  for (let value = MONTY_GRID_MIN; value <= MONTY_GRID_MAX; value += 1) {
    if (!inCardRange(state.settings, value)) cells.push('out');
    else if (inDraw.has(value)) cells.push('draw');
    else if (mine.has(value)) cells.push('mine');
    else if (inOtherHands.has(value)) cells.push('hand');
    else if (tops.has(value)) cells.push('top');
    else cells.push('played');
  }
  return cells;
}
