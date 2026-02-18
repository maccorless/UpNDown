import type { Card, FoundationPile, GameSettings } from '@upndown/shared-types';

export function buildDeck(settings: GameSettings): Card[] {
  const deck: Card[] = [];
  for (let value = settings.minCardValue; value <= settings.maxCardValue; value += 1) {
    deck.push({ id: `c-${value}`, value });
  }
  return deck;
}

export function shuffle<T>(input: T[]): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j] as T;
    out[j] = tmp as T;
  }
  return out;
}

export function createFoundationPiles(settings: GameSettings): FoundationPile[] {
  const ascendingBase = settings.minCardValue - 1;
  const descendingBase = settings.maxCardValue + 1;

  return [
    { id: 0, type: 'ascending', topCard: { id: 'f-0', value: ascendingBase } },
    { id: 1, type: 'ascending', topCard: { id: 'f-1', value: ascendingBase } },
    { id: 2, type: 'descending', topCard: { id: 'f-2', value: descendingBase } },
    { id: 3, type: 'descending', topCard: { id: 'f-3', value: descendingBase } }
  ];
}
