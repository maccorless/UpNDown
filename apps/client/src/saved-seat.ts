// The seat a player holds in a multiplayer game being played, kept in this browser so that closing the tab by accident
// (or a crash) does not lose the game. The token is the seat's rejoin credential: it is only ever used to take back
// that one seat, and it dies with the game. Nothing here is sent anywhere except in the rejoin request itself.
const KEY = 'upndown.seat';
// The server drops a game nobody is connected to after 30 minutes; a record older than this cannot be good.
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface SavedSeat {
  gameId: string;
  playerId: string;
  rejoinToken: string;
  savedAtMs: number;
}

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;

export function readSavedSeat(nowMs: number = Date.now()): SavedSeat | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { gameId, playerId, rejoinToken, savedAtMs } = parsed as Record<string, unknown>;
    if (!text(gameId) || !text(playerId) || !text(rejoinToken) || typeof savedAtMs !== 'number') return null;
    if (nowMs - savedAtMs > MAX_AGE_MS || savedAtMs > nowMs + 60_000) return null;
    return { gameId, playerId, rejoinToken, savedAtMs };
  } catch {
    return null;
  }
}

export function writeSavedSeat(seat: Omit<SavedSeat, 'savedAtMs'>, nowMs: number = Date.now()): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...seat, savedAtMs: nowMs }));
  } catch {
    // Private mode or full storage: the game works, it just cannot be picked up after a closed tab.
  }
}

export function clearSavedSeat(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
