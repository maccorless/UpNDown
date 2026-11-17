import type { FoundationPile, GameState } from '@upndown/shared-types';
import { playedValues } from './belief.js';
import { isValidPlay, requiredCardsForTurn } from './rules.js';

// What the trained network is shown for the player on turn: only what that player can see (plus, for the "Tier B" network, the public list of cards
// played so far). One function builds it for training and for the live game, so the two cannot drift apart. The layout is the one in tools/actor.ts
// and tools/training/protocol.py.
export const NET_HAND = 11, NET_OTHERS = 5, NET_DECK = 100, NET_ACTIONS = NET_HAND * 4 + 1, NET_END = NET_HAND * 4;

export interface NetInputOptions {
  // Tier B: also show the list of cards already played.
  tierB: boolean;
  // The network was trained with reactions switched on (flag 11 of the globals); the reactions themselves come from reactionsOf.
  reactionsOn: boolean;
  // The reaction level (0 none, 1 like, 2 love, 3 really love) another seat has on each real pile id, as it should be shown to the player, or null to show none.
  reactionsOf?: ((seatIndex: number) => number[] | null) | undefined;
  // 0 for a seat whose reactions are exact and instant (a robot), 1 for one that may be late or silent (a person).
  seatKindOf?: ((seatIndex: number) => 0 | 1) | undefined;
}

export interface NetInput {
  hand: number[];      // card values, 0 for an empty slot, NET_HAND long
  tops: number[];      // pile tops in canonical order: the two ascending piles (lowest top first), then the two descending (highest top first)
  canon: number[];     // the real pile id of each canonical position
  globals: number[];   // players, handSize, lo, hi, perTurn, refill, drawCount, playedThisTurn, required, solitaire, tierB, reactionsOn
  others: number[];    // the other seats' hand sizes, from the player's left, padded to NET_OTHERS
  react: number[];     // NET_OTHERS x 4, those seats' levels on the canonical piles
  seatKind: number[];  // NET_OTHERS
  played: number[];    // NET_DECK, 1 at each card value already played (Tier B), else zeros
  mask: number[];      // NET_ACTIONS: card slot * 4 + canonical pile, then 'end turn'
}

export function canonicalPiles(piles: readonly FoundationPile[]): number[] {
  const asc = piles.filter((p) => p.type === 'ascending').sort((a, b) => a.topCard.value - b.topCard.value || a.id - b.id).map((p) => p.id);
  const desc = piles.filter((p) => p.type === 'descending').sort((a, b) => b.topCard.value - a.topCard.value || a.id - b.id).map((p) => p.id);
  return [...asc, ...desc];
}

export function buildNetInput(state: GameState, opts: NetInputOptions): NetInput {
  const players = state.players.length;
  const cur = state.currentPlayerIndex;
  const me = state.players[cur]!;
  const settings = state.settings;
  const canon = canonicalPiles(state.foundationPiles);
  const pileOf = (id: number): FoundationPile => state.foundationPiles.find((p) => p.id === id)!;
  const hand = new Array<number>(NET_HAND).fill(0);
  me.hand.slice(0, NET_HAND).forEach((c, i) => { hand[i] = c.value; });
  const tops = canon.map((id) => pileOf(id).topCard.value);
  const draw = state.drawPile.length;
  const required = requiredCardsForTurn(settings.minCardsPerTurn, draw);
  const globals = [players, settings.handSize, settings.minCardValue, settings.maxCardValue, settings.minCardsPerTurn, settings.autoRefillHand ? 1 : 0,
    draw, state.cardsPlayedThisTurn, required, state.isSolitaire ? 1 : 0, opts.tierB ? 1 : 0, opts.reactionsOn ? 1 : 0];
  const others = new Array<number>(NET_OTHERS).fill(0);
  const react = new Array<number>(NET_OTHERS * 4).fill(0);
  const seatKind = new Array<number>(NET_OTHERS).fill(0);
  for (let k = 1; k < players && k <= NET_OTHERS; k += 1) {
    const idx = (cur + k) % players;
    others[k - 1] = state.players[idx]!.hand.length;
    if (opts.seatKindOf) seatKind[k - 1] = opts.seatKindOf(idx);
    const shown = opts.reactionsOn && players > 1 ? opts.reactionsOf?.(idx) ?? null : null;
    if (shown) canon.forEach((pileId, c) => { react[(k - 1) * 4 + c] = shown[pileId] ?? 0; });
  }
  const played = new Array<number>(NET_DECK).fill(0);
  if (opts.tierB) for (const v of playedValues(state)) played[v] = 1;
  const mask = new Array<number>(NET_ACTIONS).fill(0);
  me.hand.slice(0, NET_HAND).forEach((c, i) => canon.forEach((pileId, p) => { if (isValidPlay(c, pileOf(pileId))) mask[i * 4 + p] = 1; }));
  if (players > 1 && state.cardsPlayedThisTurn >= required) mask[NET_END] = 1;
  return { hand, tops, canon, globals, others, react, seatKind, played, mask };
}
