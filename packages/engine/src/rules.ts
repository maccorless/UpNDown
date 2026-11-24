import type { Card, FoundationPile } from '@upndown/shared-types';

export function isValidPlay(card: Card, pile: FoundationPile): boolean {
  const topValue = pile.topCard.value;

  if (pile.type === 'ascending') {
    return card.value > topValue || card.value === topValue - 10;
  }

  return card.value < topValue || card.value === topValue + 10;
}

// A normal play goes the way the pile's direction says, from its top: higher on an ascending pile, lower on a descending one.
// Any other valid play is a backward 10.
export function isNormalPlay(card: Card, pile: FoundationPile): boolean {
  return pile.type === 'ascending' ? card.value > pile.topCard.value : card.value < pile.topCard.value;
}

export function hasNormalPlay(hand: readonly Card[], piles: readonly FoundationPile[]): boolean {
  return hand.some((card) => piles.some((pile) => isNormalPlay(card, pile)));
}

export function requiredCardsForTurn(minCardsPerTurn: number, drawPileCount: number): number {
  return drawPileCount === 0 ? 1 : minCardsPerTurn;
}
