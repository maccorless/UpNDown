import type { Card, GameState } from '@upndown/shared-types';

const hiddenCards = (count: number, tag: string): Card[] =>
  Array.from({ length: count }, (_unused, index) => ({ id: `hidden-${tag}-${index}`, value: 0 }));

// Other players' hands and the draw pile are replaced by same-length placeholders so clients keep the counts but not the cards.
export function toPlayerView(state: GameState, viewerId: string): GameState {
  return {
    ...state,
    drawPile: hiddenCards(state.drawPile.length, 'draw'),
    players: state.players.map((player) =>
      player.id === viewerId ? player : { ...player, hand: hiddenCards(player.hand.length, player.id) }
    )
  };
}
