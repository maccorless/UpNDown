// The seats a player holds in multiplayer games being played, kept in this browser so that closing a tab by accident
// (or a crash) does not lose the game. Each seat has its own entry, so tabs playing different games never overwrite one
// another. The token is the seat's rejoin credential: it is only used to take back that one seat, and it dies with the game.
// Nothing here is sent anywhere except in the rejoin request itself.
const PREFIX = 'upndown.seat.';
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// The server drops a game nobody is connected to after 30 minutes (a week when everyone at the table is signed in), so a record
// older than these cannot be good. A guest's seat lives only in this browser; a signed-in seat is also held by the account.
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const SIGNED_IN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const SAVED_SEAT_PREFIX = PREFIX;

export interface SavedSeat {
  // Names the seat in this browser for as long as the game lasts (the player id changes at every reconnect).
  seatKey: string;
  gameId: string;
  playerId: string;
  rejoinToken: string;
  savedAtMs: number;
  // Whether the player was signed in when the seat was saved, which sets how long the record is kept.
  signedIn: boolean;
}

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;

function parse(seatKey: string, raw: string, nowMs: number): SavedSeat | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { gameId, playerId, rejoinToken, savedAtMs, signedIn } = parsed as Record<string, unknown>;
    if (!text(gameId) || !text(playerId) || !text(rejoinToken) || typeof savedAtMs !== 'number') return null;
    const kept = signedIn === true;
    if (nowMs - savedAtMs > (kept ? SIGNED_IN_MAX_AGE_MS : MAX_AGE_MS) || savedAtMs > nowMs + 60_000) return null;
    return { seatKey, gameId, playerId, rejoinToken, savedAtMs, signedIn: kept };
  } catch {
    return null;
  }
}

export function readSavedSeat(seatKey: string, nowMs: number = Date.now()): SavedSeat | null {
  if (!KEY_PATTERN.test(seatKey)) return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + seatKey);
    if (!raw) return null;
    const seat = parse(seatKey, raw, nowMs);
    if (!seat) clearSavedSeat(seatKey);
    return seat;
  } catch {
    return null;
  }
}

// Every seat saved on this device that can still be good, newest first. Damaged and stale entries are removed on the way.
export function listSavedSeats(nowMs: number = Date.now()): SavedSeat[] {
  const seats: SavedSeat[] = [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key.slice(PREFIX.length));
    }
    for (const key of keys) {
      const seat = readSavedSeat(key, nowMs);
      if (seat) seats.push(seat);
    }
  } catch {
    return [];
  }
  return seats.sort((a, b) => b.savedAtMs - a.savedAtMs);
}

export function writeSavedSeat(seat: Omit<SavedSeat, 'savedAtMs' | 'signedIn'> & { signedIn?: boolean }, nowMs: number = Date.now()): void {
  try {
    const { seatKey, gameId, playerId, rejoinToken } = seat;
    window.localStorage.setItem(PREFIX + seatKey, JSON.stringify({ gameId, playerId, rejoinToken, savedAtMs: nowMs, signedIn: seat.signedIn === true }));
  } catch {
    // Private mode or full storage: the game works, it just cannot be picked up after a closed tab.
  }
}

export function clearSavedSeat(seatKey: string): void {
  try {
    window.localStorage.removeItem(PREFIX + seatKey);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
