import type { Card, FoundationPile } from '@upndown/shared-types';

export function isValidPlay(card: Card, pile: FoundationPile): boolean {
  const topValue = pile.topCard.value;

  if (pile.type === 'ascending') {
    return card.value > topValue || card.value === topValue - 10;
  }

  return card.value < topValue || card.value === topValue + 10;
}

export function requiredCardsForTurn(minCardsPerTurn: number, drawPileCount: number): number {
  return drawPileCount === 0 ? 1 : minCardsPerTurn;
}
