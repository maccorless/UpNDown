import { resultRowFromState } from '@upndown/profile';
import { resultRowSchema, type GameState } from '@upndown/shared-types';
import { useCallback, useEffect, useRef } from 'react';
import type { LocalHistory } from './local-history.js';

interface Args {
  state: GameState | null;
  playerId: string | null;
  // A guest's multiplayer games are kept on the device. A signed-in player's are written by the server.
  guest: boolean;
  history: LocalHistory;
}

function keep(history: LocalHistory, state: GameState, playerId: string, outcome: 'won' | 'lost' | 'abandoned'): void {
  // The server's view names the run. Without it the game cannot be given the id the server would give it, so it is not kept.
  if (!state.runId || state.isSolitaire) return;
  const row = resultRowFromState({ state, runId: state.runId, outcome, playerId, nowMs: Date.now() });
  if (row && resultRowSchema.safeParse(row).success) history.add(row);
}

// Keeps a guest's finished multiplayer game on the device, once. A game that is already finished when its first view arrives
// (the player was offline when it ended and has just come back) is kept the same way.
export function useGuestMultiplayerRecord({ state, playerId, guest, history }: Args): { recordAbandoned: (before: GameState | null) => void } {
  const kept = useRef(new Set<string>());

  useEffect(() => {
    if (!guest || !state || !playerId || !state.runId) return;
    if (state.gamePhase !== 'won' && state.gamePhase !== 'lost') return;
    if (!state.players.some((p) => p.id === playerId) || kept.current.has(state.runId)) return;
    kept.current.add(state.runId);
    keep(history, state, playerId, state.gamePhase);
  }, [guest, state, playerId, history]);

  // The host ended a game in progress. `before` is the game as it stood when they asked, since ending it resets the room. Call this
  // only after the server has said yes.
  const recordAbandoned = useCallback((before: GameState | null): void => {
    if (!guest || !before || !playerId || before.gamePhase !== 'playing' || !before.runId || kept.current.has(before.runId)) return;
    kept.current.add(before.runId);
    keep(history, before, playerId, 'abandoned');
  }, [guest, playerId, history]);

  return { recordAbandoned };
}
