import type { Card, GameSettings, GameState } from '@upndown/shared-types';
import { buildDeck } from './init.js';
import { shuffleWith } from './simulate.js';

// What a player can know about the cards they cannot see (the draw pile and other players' hands).
//   Tier A: the hand, the pile tops and the counts, which is what the screen shows.
//   Tier B: Tier A plus the public record of which cards have been played (a list the game could show, but does not today).
// Every card is unique, so "played" is a set of values.

// The Tier B record: every card that has left the deck for a pile, from the full state. Sorted, so equal records compare equal.
export function playedValues(state: GameState): number[] {
  const held = new Set<number>();
  for (const player of state.players) for (const card of player.hand) held.add(card.value);
  for (const card of state.drawPile) held.add(card.value);
  return buildDeck(state.settings).map((c) => c.value).filter((v) => !held.has(v));
}

export interface BeliefInput {
  settings: GameSettings;
  hand: readonly Card[];
  drawCount: number;
  otherHandSizes: readonly number[];
  // Present for Tier B, absent for Tier A.
  played?: readonly number[] | undefined;
}

export interface HiddenDeal { drawPile: Card[]; otherHands: Card[][] }

// One possible arrangement of the hidden cards, drawn at random.
// Tier B: the hidden cards are exactly the deck minus my hand minus the record, so this is a uniform draw over what can be true
// (exact for solitaire, where nobody else holds cards; for several players it ignores what other players' choices reveal).
// Tier A: the played cards are unknown, so any cards outside my hand could be hidden; I take a uniform draw of the right number.
export function sampleHidden(input: BeliefInput, random: () => number): HiddenDeal {
  const mine = new Set(input.hand.map((c) => c.value));
  const played = new Set(input.played ?? []);
  const candidates = buildDeck(input.settings).filter((c) => !mine.has(c.value) && !played.has(c.value));
  const need = input.drawCount + input.otherHandSizes.reduce((n, s) => n + s, 0);
  if (candidates.length < need) throw new Error(`Only ${candidates.length} cards could be hidden but ${need} are`);
  const hidden = shuffleWith(candidates, random).slice(0, need);
  let at = 0;
  const otherHands = input.otherHandSizes.map((size) => { const h = hidden.slice(at, at + size); at += size; return h; });
  return { drawPile: hidden.slice(at), otherHands };
}
