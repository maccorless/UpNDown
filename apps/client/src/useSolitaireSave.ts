import type { GameState } from '@upndown/shared-types';
import { useCallback, useEffect } from 'react';
import { holdClaim, isClaimed, useUnclaimed } from './claims.js';
import {
  SOLITAIRE_SAVE_PREFIX, clearSolitaireSave, listSolitaireSaves, readSolitaireSave, resumeClock, summarizeSave, writeSolitaireSave,
  type SaveSummary, type SavedSolitaire
} from './solitaire-save.js';

const cardsPlayedIn = (state: GameState): number => Object.values(state.statistics.players).reduce((sum, p) => sum + p.cardsPlayed, 0);

const summaries = (): SaveSummary[] => listSolitaireSaves().map((save) => summarizeSave(save)).filter((s): s is SaveSummary => s !== null);

interface Args {
  active: boolean;
  state: GameState;
  undoStack: GameState[];
  runId: string;
}

// Keeps this tab's solitaire game saved while it is played, forgets it when it is over, and lists the other games saved on
// this device that no other tab has open (any number may be started, each with its own save).
export function useSolitaireSave({ active, state, undoStack, runId }: Args): {
  saves: SaveSummary[];
  load: (runId: string) => Promise<SavedSolitaire | null>;
  discard: (runId?: string) => void;
} {
  const [saves, refresh] = useUnclaimed(summaries, 'solitaire:', SOLITAIRE_SAVE_PREFIX, !active, active ? runId : undefined);

  // While a game is open in this tab no other tab is offered it.
  useEffect(() => (active ? holdClaim(`solitaire:${runId}`) : undefined), [active, runId]);

  useEffect(() => {
    // Not while inactive: a page load starts inactive, and that must not wipe a game waiting to be resumed.
    if (!active) return;
    if (state.gamePhase === 'playing') {
      // A game nobody has played a card in is not worth keeping: you would only be asked about it later.
      // Undoing back to the start also counts, or the save would hold a position the player has taken back.
      if (cardsPlayedIn(state) > 0) writeSolitaireSave(state, undoStack, Date.now(), runId);
      else clearSolitaireSave(runId);
    } else if (state.gamePhase === 'won' || state.gamePhase === 'lost') {
      clearSolitaireSave(runId);
    }
  }, [active, state, undoStack, runId]);

  // Refuses a game another tab opened since this list was drawn, so two tabs never play one game.
  const load = useCallback(async (id: string): Promise<SavedSolitaire | null> => {
    if (await isClaimed(`solitaire:${id}`)) {
      refresh();
      return null;
    }
    const save = readSolitaireSave(id);
    return save ? resumeClock(save) : null;
  }, [refresh]);

  const discard = useCallback((id: string = runId): void => {
    clearSolitaireSave(id);
    refresh();
  }, [runId, refresh]);

  return { saves, load, discard };
}
