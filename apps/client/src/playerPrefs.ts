import { useEffect, useRef, useState } from 'react';
import type { GameState } from '@upndown/shared-types';

// Settings that belong to one person, not to the game: remembered on this device and applied at once. (Sound effects is the third;
// it predates this file and lives in App.)
const ARROWS_KEY = 'upndown.arrows.v1';
const AUTO_MARK_KEY = 'upndown.autoMark.v1';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === 'true';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try { window.localStorage.setItem(key, String(value)); } catch { /* storage may be blocked; the setting then lasts for this visit */ }
}

export function usePlayerPrefs(): { showArrows: boolean; autoMark: boolean; changeShowArrows: (value: boolean) => void; changeAutoMark: (value: boolean) => void } {
  const [showArrows, setShowArrows] = useState(() => readFlag(ARROWS_KEY, true));
  const [autoMark, setAutoMark] = useState(() => readFlag(AUTO_MARK_KEY, false));
  return {
    showArrows,
    autoMark,
    changeShowArrows: (value) => { setShowArrows(value); writeFlag(ARROWS_KEY, value); },
    changeAutoMark: (value) => { setAutoMark(value); writeFlag(AUTO_MARK_KEY, value); }
  };
}

interface AutoMarkSyncArgs {
  autoMark: boolean;
  state: GameState | null;
  playerId: string | null;
  connected: boolean;
  // Tells the server; resolves true when it accepted.
  send: (gameId: string, enabled: boolean) => Promise<boolean>;
}

// The server marks the piles, so it has to be told what this person wants. Whenever a game is being played at a table and the
// seat disagrees with the preference (the person flipped it, or sat down with it already on), say so once. A failed send is
// tried again the next time the game moves.
export function useAutoMarkSync({ autoMark, state, playerId, connected, send }: AutoMarkSyncArgs): void {
  const sent = useRef('');
  const sendRef = useRef(send);
  sendRef.current = send;
  const gameId = state?.gameId;
  const playing = state?.gamePhase === 'playing' && !state.isSolitaire;
  const seat = state?.players.find((p) => p.id === playerId);
  const seatOn = seat ? seat.autoMark === true : null;
  // Each update of the game is a reason to look again, so a send that failed is retried.
  const moveCount = state?.statistics.turns;
  useEffect(() => {
    if (!gameId || !playing || !connected || seatOn === null || seatOn === autoMark) return;
    const key = `${gameId}:${playerId}:${autoMark}:${moveCount}`;
    if (sent.current === key) return;
    sent.current = key;
    void sendRef.current(gameId, autoMark);
  }, [gameId, playing, connected, seatOn, autoMark, playerId, moveCount]);
}
