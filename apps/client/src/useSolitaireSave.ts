import type { GameState } from '@upndown/shared-types';
import { useCallback, useEffect, useState } from 'react';
import {
  SOLITAIRE_SAVE_KEY, clearSolitaireSave, readSolitaireSave, resumeClock, summarizeSave, writeSolitaireSave,
  type SaveSummary, type SavedSolitaire
} from './solitaire-save.js';

const cardsPlayedIn = (state: GameState): number => Object.values(state.statistics.players).reduce((sum, p) => sum + p.cardsPlayed, 0);

interface Args {
  active: boolean;
  state: GameState;
  undoStack: GameState[];
  runId: string;
}

// Keeps the solitaire save point current while a game is being played, and forgets it when the game is over.
export function useSolitaireSave({ active, state, undoStack, runId }: Args): {
  summary: SaveSummary | null;
  load: () => SavedSolitaire | null;
  discard: () => void;
} {
  const [summary, setSummary] = useState<SaveSummary | null>(() => summarizeSave(readSolitaireSave()));

  useEffect(() => {
    // Not while inactive: a page load starts inactive, and that must not wipe the game being resumed.
    if (!active) return;
    if (state.gamePhase === 'playing') {
      // This is also what discards the old save when a new game starts: the new game has no plays yet.
      // A game nobody has played a card in is not worth keeping: you would only be asked to discard it to get a fresh
      // deal. Undoing back to the start also counts, or the save would hold a position the player has taken back.
      if (cardsPlayedIn(state) > 0) {
        writeSolitaireSave(state, undoStack, Date.now(), runId);
      } else {
        clearSolitaireSave();
        setSummary(null);
      }
    } else if (state.gamePhase === 'won' || state.gamePhase === 'lost') {
      clearSolitaireSave();
      setSummary(null);
    }
  }, [active, state, undoStack, runId]);

  // Another tab started, finished or discarded a game.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === SOLITAIRE_SAVE_KEY || event.key === null) setSummary(summarizeSave(readSolitaireSave()));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const load = useCallback((): SavedSolitaire | null => {
    const save = readSolitaireSave();
    return save ? resumeClock(save) : null;
  }, []);

  const discard = useCallback((): void => {
    clearSolitaireSave();
    setSummary(null);
  }, []);

  return { summary, load, discard };
}
