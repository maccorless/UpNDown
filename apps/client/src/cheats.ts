import { buildNetInput, carryAfterUndo, chooseAction, explainMove, loadNetwork, NET_END, networkLogits, observe, type Action, type Network, type NetworkWeights } from '@upndown/engine';
import { cheatLimitOf, type CheatKind, type CheatUsedEvent, type GameState, type PlayerStatistics } from '@upndown/shared-types';
import { useEffect } from 'react';

export const CHEAT_TITLES: Record<CheatKind, string> = {
  lookup: 'Card seeker',
  skip: 'Skip turn',
  trade: 'Trade a card',
  hint: 'Hint'
};

export interface CheatStatus {
  kind: CheatKind;
  // What the game allows: once is one use per player, unlimited has no limit.
  limit: 'once' | 'unlimited';
  used: number;
  available: boolean;
  // Why a cheat cannot be used right now (never set when it can).
  reason?: string;
}

const usedOf = (state: GameState, playerId: string | null, kind: CheatKind): number => {
  const stats = playerId ? state.statistics.players[playerId] : undefined;
  if (!stats) return 0;
  return kind === 'skip' ? stats.skipsUsed : kind === 'trade' ? stats.tradesUsed : kind === 'lookup' ? stats.lookupsUsed : stats.hintsUsed;
};

// The cheats this game offers this player, and whether each can be used this moment. Cheats the game has turned off are not
// listed at all. Skip needs a table (there is no turn to skip alone).
export function cheatStatuses(state: GameState, playerId: string | null, selectedCardId: string | null): CheatStatus[] {
  const mine = !!playerId && state.players[state.currentPlayerIndex]?.id === playerId;
  const playing = state.gamePhase === 'playing';
  const out: CheatStatus[] = [];
  for (const kind of ['lookup', 'hint', 'skip', 'trade'] as const) {
    const limit = cheatLimitOf(state.settings, kind);
    if (limit === 'off' || (kind === 'skip' && state.isSolitaire)) continue;
    const used = usedOf(state, playerId, kind);
    let reason: string | undefined;
    if (!playing) reason = 'The game is not being played';
    else if (limit === 'once' && used >= 1) reason = 'Already used';
    else if ((kind === 'skip' || kind === 'hint') && !mine) reason = 'Only on your turn';
    else if (kind === 'skip' && state.cardsPlayedThisTurn > 0) reason = 'Only before you play a card this turn';
    else if (kind === 'trade' && !state.isSolitaire && !mine) reason = 'Only on your turn';
    else if (kind === 'trade' && state.drawPile.length === 0) reason = 'The draw pile is empty';
    else if (kind === 'trade' && !selectedCardId) reason = 'Select a card in your hand first';
    out.push({ kind, limit, used, available: !reason, ...(reason ? { reason } : {}) });
  }
  return out;
}

export function cheatNoticeText(event: Pick<CheatUsedEvent, 'playerName' | 'kind'>): string {
  const who = event.playerName || 'A player';
  if (event.kind === 'skip') return `${who} skipped a turn`;
  if (event.kind === 'trade') return `${who} traded a card`;
  if (event.kind === 'lookup') return `${who} used the card seeker`;
  return `${who} used a hint`;
}

interface HotkeyArgs {
  active: boolean;
  onLookup?: () => void;
  onSkip?: () => void;
  onTrade?: () => void;
}

const typingIn = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

// Accelerators only: the panel is the dependable way in (and the only one on a phone). A key is taken from the browser only
// when it does something here, so printing and saving still work whenever the cheat is not available.
// Card seeker: Ctrl/Cmd-P. Skip: Ctrl/Cmd-S. Trade: Ctrl/Cmd-Shift-X. Ctrl/Cmd-T opens a browser tab and cannot be used.
export function useCheatHotkeys({ active, onLookup, onSkip, onTrade }: HotkeyArgs): void {
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || typingIn(e.target)) return;
      const run = (action: (() => void) | undefined): void => {
        if (!action) return;
        e.preventDefault();
        action();
      };
      if (!e.shiftKey && e.code === 'KeyP') run(onLookup);
      else if (!e.shiftKey && e.code === 'KeyS') run(onSkip);
      else if (e.shiftKey && e.code === 'KeyX') run(onTrade);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, onLookup, onSkip, onTrade]);
}

// After an undo, cheats and marks counted since the snapshot stay counted, and the undo itself is counted. The rule is the
// engine's, shared with the server.
export const keepCheatCounts = (restored: GameState, current: GameState, undoingPlayerId: string): GameState => carryAfterUndo(restored, current, undoingPlayerId);

// Every cheat a player used, counted. The old card-swap count is the same thing as trades and is not added twice.
export const cheatCount = (stats: PlayerStatistics): number => stats.skipsUsed + stats.tradesUsed + stats.lookupsUsed + stats.hintsUsed;

// "2 skips, 1 trade" for the end screen, or a dash when the player used none.
export function describeCheats(stats: PlayerStatistics): string {
  const parts: string[] = [];
  const add = (count: number, one: string, many: string): void => { if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`); };
  add(stats.skipsUsed, 'skip', 'skips');
  add(stats.tradesUsed, 'trade', 'trades');
  add(stats.lookupsUsed, 'card lookup', 'card lookups');
  add(stats.hintsUsed, 'hint', 'hints');
  return parts.length > 0 ? parts.join(', ') : 'None';
}

export interface HintView {
  cardId?: string;
  pileId?: number;
  text: string;
}

// A hint in words, and which card and pile to light up. `action` comes from the strategy (engine) or, in multiplayer, from
// the server, which worked it out from the same facts a player can see.
export function describeHint(action: Action, state: GameState, playerId: string | null, reasons?: readonly string[]): HintView {
  const view = hintWithoutReasons(action, state, playerId);
  return reasons && reasons.length > 0 ? { ...view, text: `${view.text} Why: ${reasons.join(' ')}` } : view;
}

function hintWithoutReasons(action: Action, state: GameState, playerId: string | null): HintView {
  const me = state.players.find((player) => player.id === playerId);
  if (action.type === 'play') {
    const card = me?.hand.find((c) => c.id === action.cardId);
    const pile = state.foundationPiles.find((p) => p.id === action.pileId);
    if (card && pile) {
      return { cardId: card.id, pileId: pile.id, text: `Hint: play ${card.value} on the ${pile.type === 'ascending' ? 'up' : 'down'} pile showing ${pile.topCard.value}.` };
    }
  }
  if (action.type === 'trade') {
    const card = me?.hand.find((c) => c.id === action.cardId);
    if (card) return { cardId: card.id, text: `Hint: trade the ${card.value}, nothing will take it.` };
  }
  if (action.type === 'endTurn') return { text: 'Hint: you have played enough. End your turn.' };
  if (action.type === 'skip') return { text: 'Hint: you cannot make the minimum this turn. Skip it, before you are stuck.' };
  return { text: 'Hint: no play is possible.' };
}

// Solitaire is played in the browser, so its hint is worked out here, with the screen-only network when its file can be fetched (about 2 MB, once, the
// first time a hint is asked for) and the written strategy otherwise (offline, or any failure). The network sees only what the player sees, and gives reasons.
let soloNetwork: Promise<Network | null> | null = null;
function loadSoloNetwork(): Promise<Network | null> {
  soloNetwork ??= fetch('/models/hint.json')
    .then((r) => (r.ok ? (r.json() as Promise<NetworkWeights>) : null))
    .then((w) => (w ? loadNetwork(w) : null))
    .catch(() => null)
    .then((net) => { if (!net) soloNetwork = null; return net; });
  return soloNetwork;
}

export async function soloHint(state: GameState, playerId: string): Promise<HintView> {
  const rule = chooseAction(observe(state, playerId));
  if (rule.type === 'play') {
    try {
      const net = await loadSoloNetwork();
      if (net && !net.tierB) {
        const input = buildNetInput(state, { tierB: false, reactionsOn: net.reactions });
        const logits = networkLogits(net, input);
        let best = -1;
        for (let a = 0; a < input.mask.length; a += 1) if (input.mask[a] === 1 && a !== NET_END && (best < 0 || logits[a]! > logits[best]!)) best = a;
        const me = state.players.find((p) => p.id === playerId);
        const card = me?.hand[Math.floor(best / 4)];
        const pileId = input.canon[best % 4];
        if (best >= 0 && card && pileId !== undefined) {
          return describeHint({ type: 'play', cardId: card.id, pileId }, state, playerId, explainMove(input, best, logits).reasons);
        }
      }
    } catch { /* fall back to the written strategy */ }
  }
  return describeHint(rule, state, playerId);
}

// Changes whenever the game moves on (a card played, a turn passed, the hand changed), and not when only a count changes, so
// a hint stays up while it is being read and goes when it is no longer true.
export function moveKey(state: GameState | null, playerId: string | null): string {
  if (!state) return '';
  const hand = state.players.find((player) => player.id === playerId)?.hand.map((card) => card.id).join(',') ?? '';
  return [state.gameId, state.gamePhase, state.currentPlayerIndex, state.cardsPlayedThisTurn, state.statistics.turns, state.foundationPiles.map((pile) => pile.topCard.id).join(','), hand].join('|');
}
