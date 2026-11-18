import type { Card, FoundationPile } from '@upndown/shared-types';
import { isValidPlay } from './rules.js';

// The pair rule. When one hand holds two cards exactly ten apart and both can go on a pile the ordinary way, the card that is played second is
// played as a backward 10, which sets the pile back by ten for free. On an up pile that is the lower card (3 and 13: climb to 13, then play the 3 on it);
// on a down pile it is the higher one. Playing that second card the ordinary way first throws the reset away, so it waits: the cards between go first, then
// the partner, then the second card. This is a rule about the player's own hand, not a guess about the draw pile.
const hasValue = (hand: readonly Card[], value: number): boolean => hand.some((card) => card.value === value);

// The partner that makes `card` the second card of a pair on this pile, if the card would be played the ordinary way.
function partnerOf(card: Card, pile: FoundationPile, hand: readonly Card[]): number | null {
  const top = pile.topCard.value;
  if (pile.type === 'ascending') return card.value > top && hasValue(hand, card.value + 10) ? card.value + 10 : null;
  return card.value < top && hasValue(hand, card.value - 10) ? card.value - 10 : null;
}

export interface Redirect { cardId: string; pileId: number; reason: string }

// If the chosen play puts down the second card of a pair the ordinary way while its partner is still in the hand, the play to make instead (the next
// card of the climb on that pile, smallest step first); otherwise null and the chosen play stands.
export function deferComplement(hand: readonly Card[], piles: readonly FoundationPile[], play: { cardId: string; pileId: number }): Redirect | null {
  const card = hand.find((c) => c.id === play.cardId);
  const pile = piles.find((p) => p.id === play.pileId);
  if (!card || !pile) return null;
  const partner = partnerOf(card, pile, hand);
  if (partner === null) return null;
  const next = hand
    .filter((c) => isValidPlay(c, pile) && c.id !== card.id && partnerOf(c, pile, hand) === null
      && (pile.type === 'ascending' ? c.value > pile.topCard.value : c.value < pile.topCard.value))
    .sort((a, b) => Math.abs(a.value - pile.topCard.value) - Math.abs(b.value - pile.topCard.value))[0];
  if (!next) return null;
  const word = pile.type === 'ascending' ? 'up' : 'down';
  const reason = `Your ${card.value} and ${partner} are ten apart. Play the cards up to ${partner} on this ${word} pile first, then the ${card.value} on it as a backward 10, which sets the pile back.`;
  return { cardId: next.id, pileId: pile.id, reason };
}
