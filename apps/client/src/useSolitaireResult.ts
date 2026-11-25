import { resultRowSchema, type GameState, type SolitaireResultPayload } from '@upndown/shared-types';
import { resultRowFromState } from '@upndown/profile';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalHistory } from './profile/local-history.js';
import { createOutbox, startOutboxDrain, type Drain } from './profile/outbox.js';
import { buildSolitairePayload, postSolitaireResult } from './solitaire-result.js';

// idle: nothing to say. local: kept on this device (a guest). saving, saved: a signed-in player's game and the server. queued: kept
// on this device until the connection is back. failed: refused for good, or nowhere to keep it.
export type ResultSaveStatus = 'idle' | 'saving' | 'saved' | 'queued' | 'local' | 'failed';

const SOLO_PLAYER_ID = 'solo-player';

interface Args {
  active: boolean;
  state: GameState;
  runId: string;
  signedIn: boolean;
  // A guest keeps the game on this device and sends nothing. Absent or false for everyone else, including a player whose
  // sign-in is not known yet (that one waits).
  guest?: boolean;
  userId?: string | null;
  history?: LocalHistory;
}

// Keeps a finished solitaire game: on this device for a guest, in the account's history for a signed-in player (with a
// retry kept on the device if the connection fails). Solitaire itself needs no connection.
export function useSolitaireResult({ active, state, runId, signedIn, guest = false, userId = null, history }: Args): { status: ResultSaveStatus; retry: () => void } {
  const [status, setStatus] = useState<ResultSaveStatus>('idle');
  const attemptedRun = useRef<string | null>(null);
  const pending = useRef<SolitaireResultPayload | null>(null);
  const currentRun = useRef(runId);
  currentRun.current = runId;
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const outbox = useMemo(() => (userId ? createOutbox(userId) : null), [userId]);
  const drain = useRef<Drain | null>(null);
  useEffect(() => {
    if (!outbox || !signedIn) return undefined;
    const d = startOutboxDrain(outbox, postSolitaireResult);
    drain.current = d;
    d.kick();
    return () => { d.stop(); drain.current = null; };
  }, [outbox, signedIn]);

  // A new game starts with a clean slate.
  useEffect(() => {
    setStatus('idle');
    pending.current = null;
  }, [runId]);

  const send = useCallback(async (payload: SolitaireResultPayload): Promise<void> => {
    setStatus('saving');
    const result = await postSolitaireResult(payload);
    if (result === 'ok' || result === 'permanent') outbox?.remove(payload.gameId);
    let next: ResultSaveStatus = 'saved';
    if (result === 'permanent') next = 'failed';
    else if (result === 'retry') {
      if (outbox) { outbox.enqueue(payload); drain.current?.kick(); next = 'queued'; } else next = 'failed';
    }
    // Ignore an answer for a game that is no longer the current one, or for a page that has gone.
    if (mounted.current && currentRun.current === payload.gameId) setStatus(next);
  }, [outbox]);

  useEffect(() => {
    if (!active || attemptedRun.current === runId) return;
    if (state.gamePhase !== 'won' && state.gamePhase !== 'lost') return;
    if (guest && history) {
      attemptedRun.current = runId;
      const row = resultRowFromState({ state, runId, outcome: state.gamePhase, playerId: SOLO_PLAYER_ID, nowMs: Date.now() });
      // Only a game the server would also accept is kept, so a later move to an account refuses nothing.
      if (row && resultRowSchema.safeParse(row).success) {
        history.add(row);
        setStatus('local');
      }
      return;
    }
    if (!signedIn) return;
    const payload = buildSolitairePayload(state, runId);
    // Null while the game is still being played. Ending it on purpose never gets here, because it never finishes.
    if (!payload) return;
    attemptedRun.current = runId;
    pending.current = payload;
    void send(payload);
  }, [active, signedIn, guest, history, state, runId, send]);

  const retry = useCallback((): void => {
    if (pending.current) void send(pending.current);
  }, [send]);

  return { status, retry };
}
