import { gameStateSchema, type GameState } from '@upndown/shared-types';

// A solitaire game saved on this device so it can be picked up later. It lives in this browser's local storage only:
// nothing here is ever sent to the server, and it does not follow an account to another device.
const SAVE_KEY = 'upndown.solitaire.save.v1';
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
// Undo snapshots are whole game states, so the history that is kept is bounded.
export const MAX_SAVED_UNDO = 30;

export interface SavedSolitaire {
  state: GameState;
  undo: GameState[];
  savedAtMs: number;
  // Identifies the game, so its result can be sent more than once without being counted twice. Saves from before
  // the id existed have none; the game that resumes from one gets a new id.
  runId?: string;
}

export interface SaveSummary {
  cardsLeft: number;
  savedAtMs: number;
}

const cardsLeftOf = (state: GameState): number => state.drawPile.length + state.players.reduce((sum, p) => sum + p.hand.length, 0);

// Shape is checked by the schema. This checks it is a game that can be resumed: a live, one-player solitaire game
// whose cards are real, in range and not repeated.
function resumable(state: GameState): boolean {
  if (!state.isSolitaire || state.gamePhase !== 'playing' || state.players.length !== 1 || state.foundationPiles.length !== 4) return false;
  const { minCardValue, maxCardValue } = state.settings;
  const ids = new Set<string>();
  for (const card of [...state.drawPile, ...state.players.flatMap((p) => p.hand)]) {
    if (card.value < minCardValue || card.value > maxCardValue || ids.has(card.id)) return false;
    ids.add(card.id);
  }
  return true;
}

export function readSolitaireSave(): SavedSolitaire | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const { v, savedAtMs, state, undo, runId } = parsed as Record<string, unknown>;
      const live = gameStateSchema.safeParse(state);
      const history = Array.isArray(undo) && undo.length <= MAX_SAVED_UNDO ? undo.map((entry) => gameStateSchema.safeParse(entry)) : null;
      if (v === 1 && typeof savedAtMs === 'number' && live.success && history?.every((entry) => entry.success)) {
        const liveState = live.data as GameState;
        const undoStates = history.map((entry) => (entry.success ? entry.data : null)) as GameState[];
        if (resumable(liveState) && undoStates.every(resumable)) {
          const id = typeof runId === 'string' && RUN_ID.test(runId) ? runId : undefined;
          return { state: liveState, undo: undoStates, savedAtMs, ...(id ? { runId: id } : {}) };
        }
      }
    }
  } catch {
    // fall through: unreadable
  }
  // Damaged, or from a game this build cannot resume. Left in place it would be re-checked on every visit.
  clearSolitaireSave();
  return null;
}

export function writeSolitaireSave(state: GameState, undo: GameState[], nowMs: number = Date.now(), runId?: string): void {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, savedAtMs: nowMs, state, undo: undo.slice(-MAX_SAVED_UNDO), ...(runId ? { runId } : {}) }));
  } catch {
    // Storage can be full or unavailable (private mode). The game goes on; it just cannot be resumed later.
  }
}

export function clearSolitaireSave(): void {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // nothing to clear if storage is unavailable
  }
}

export function summarizeSave(save: SavedSolitaire | null): SaveSummary | null {
  return save ? { cardsLeft: cardsLeftOf(save.state), savedAtMs: save.savedAtMs } : null;
}

// The clock stops while the game is away: the time spent away is not time spent playing, so the start moves forward by it.
export function resumeClock(save: SavedSolitaire, nowMs: number = Date.now()): SavedSolitaire {
  const away = Math.max(0, nowMs - save.savedAtMs);
  const shift = (state: GameState): GameState => (state.statistics.startedAtMs === null
    ? state
    : { ...state, statistics: { ...state.statistics, startedAtMs: state.statistics.startedAtMs + away } });
  return { state: shift(save.state), undo: save.undo.map(shift), savedAtMs: nowMs, ...(save.runId ? { runId: save.runId } : {}) };
}

export function describeAge(savedAtMs: number, nowMs: number = Date.now()): string {
  const minutes = Math.floor(Math.max(0, nowMs - savedAtMs) / 60_000);
  if (minutes < 1) return 'just now';
  const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (minutes < 60) return plural(minutes, 'minute');
  if (minutes < 60 * 24) return plural(Math.floor(minutes / 60), 'hour');
  return plural(Math.floor(minutes / (60 * 24)), 'day');
}

export const SOLITAIRE_SAVE_KEY = SAVE_KEY;
