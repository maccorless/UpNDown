import type { GameState, SolitaireResultPayload } from '@upndown/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildSolitairePayload, postSolitaireResult } from './solitaire-result.js';

export type ResultSaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

interface Args {
  active: boolean;
  state: GameState;
  runId: string;
  signedIn: boolean;
}

// Saves a finished solitaire game's result to a signed-in player's history. Guests, and a player whose sign-in is not
// known, make no request at all: solitaire is playable with no connection, and this is the only thing it ever sends.
export function useSolitaireResult({ active, state, runId, signedIn }: Args): { status: ResultSaveStatus; retry: () => void } {
  const [status, setStatus] = useState<ResultSaveStatus>('idle');
  const attemptedRun = useRef<string | null>(null);
  const pending = useRef<SolitaireResultPayload | null>(null);
  const currentRun = useRef(runId);
  currentRun.current = runId;
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // A new game starts with a clean slate.
  useEffect(() => {
    setStatus('idle');
    pending.current = null;
  }, [runId]);

  const send = useCallback(async (payload: SolitaireResultPayload): Promise<void> => {
    setStatus('saving');
    const ok = await postSolitaireResult(payload);
    // Ignore an answer for a game that is no longer the current one, or for a page that has gone.
    if (mounted.current && currentRun.current === payload.gameId) setStatus(ok ? 'saved' : 'failed');
  }, []);

  useEffect(() => {
    if (!active || !signedIn || attemptedRun.current === runId) return;
    const payload = buildSolitairePayload(state, runId);
    // Null while the game is still being played. Ending it on purpose never gets here, because it never finishes.
    if (!payload) return;
    attemptedRun.current = runId;
    pending.current = payload;
    void send(payload);
  }, [active, signedIn, state, runId, send]);

  const retry = useCallback((): void => {
    if (pending.current) void send(pending.current);
  }, [send]);

  return { status, retry };
}
