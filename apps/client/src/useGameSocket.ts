import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { CheatUsedEvent, GameState, JoinResolvedEvent, ReactionState } from '@upndown/shared-types';
import { cheatNoticeText } from './cheats.js';
import { INVITE_QUERY_PARAM } from './game-url.js';

type SeatData = { gameState: GameState; playerId: string; rejoinToken: string };
type Set<T> = Dispatch<SetStateAction<T>>;
type Timer = MutableRefObject<ReturnType<typeof setTimeout> | null>;

export interface GameSocketOptions {
  mode: 'solitaire' | 'multiplayer' | null;
  getSocket: () => Socket;
  setConnectionState: Set<'disconnected' | 'connecting' | 'connected'>;
  previousPlayerIdRef: MutableRefObject<string | null>;
  activeGameIdRef: MutableRefObject<string | null>;
  rejoinTokenRef: MutableRefObject<string | null>;
  playerIdRef: MutableRefObject<string | null>;
  adoptSeat: (data: SeatData) => void;
  resetToLanding: () => void;
  setKickedWhileAway: Set<boolean>;
  setKickedFromGameId: Set<string | null>;
  setError: Set<string | null>;
  rejoinMine: (gameId: string) => void;
  setSeatChoices: Set<string[]>;
  setPlayerId: Set<string | null>;
  setPendingLobbyState: Set<GameState | null>;
  setMultiplayerState: Set<GameState | null>;
  setGameReactions: Set<ReactionState>;
  setSpecialPlayPileId: Set<number | null>;
  setSpecialPlayLifeline: Set<boolean>;
  specialPlayTimerRef: Timer;
  forgetSeatRef: MutableRefObject<() => void>;
  setMultiplayerSelectedCardId: Set<string | null>;
  setCheatNotice: Set<string | null>;
  cheatNoticeTimerRef: Timer;
  setJoinRequests: Set<Array<{ requestId: string; playerName: string }>>;
  setJoinWaiting: Set<boolean>;
  inviteTokenRef: MutableRefObject<string | null>;
}

// Connects while the player is in multiplayer: follows the server's updates, takes a seat back after a dropped connection,
// and disconnects (clearing what the table showed) when the player leaves multiplayer. It runs once per change of `mode`.
export function useGameSocket(options: GameSocketOptions): void {
  const { mode } = options;
  useEffect(() => {
    const { getSocket, setConnectionState, previousPlayerIdRef, activeGameIdRef, rejoinTokenRef, playerIdRef, adoptSeat, resetToLanding, setKickedWhileAway, setKickedFromGameId, setError, rejoinMine, setSeatChoices, setPlayerId, setPendingLobbyState, setMultiplayerState, setGameReactions, setSpecialPlayPileId, setSpecialPlayLifeline, specialPlayTimerRef, forgetSeatRef, setMultiplayerSelectedCardId, setCheatNotice, cheatNoticeTimerRef, setJoinRequests, setJoinWaiting, inviteTokenRef } = options;
    if (mode !== 'multiplayer') {
      return;
    }

    const socket = getSocket();
    setConnectionState('connecting');

    const onConnect = (): void => {
      setConnectionState('connected');
      const newId = socket.id ?? null;
      const oldId = previousPlayerIdRef.current;
      const gameId = activeGameIdRef.current;

      type RejoinAck = { ok: boolean; data?: { gameState: GameState; playerId: string; rejoinToken: string }; gone?: boolean };
      const rejoinToken = rejoinTokenRef.current;
      if (gameId && oldId && newId && rejoinToken && oldId !== newId) {
        // We had a seat and our socket ID changed (a dropped connection, or a page opened again): take the seat back.
        socket.emit('game:rejoin', { gameId, previousPlayerId: oldId, rejoinToken }, (response: RejoinAck) => {
          if (response?.ok && response.data) adoptSeat(response.data);
          else if (response?.gone) { resetToLanding(); setKickedWhileAway(true); setKickedFromGameId(gameId); } // seat gone: no stale board
          else setError('Could not rejoin your game yet. Reload the page to try again.');
        });
      } else if (!gameId && newId) {
        // No seat in memory. A signed-in player may still hold seats in games being played (another device, cleared storage, a
        // server restart); a guest holds none and is told so with nothing shown. One game goes straight back; several ask.
        socket.emit('game:mySeats', {}, (seats: { ok: boolean; data?: { gameIds: string[] } }) => {
          const gameIds = seats?.ok ? seats.data?.gameIds ?? [] : [];
          if (gameIds.length === 1) rejoinMine(gameIds[0]!);
          else if (gameIds.length > 1) setSeatChoices(gameIds);
        });
      }

      setPlayerId(newId);
      previousPlayerIdRef.current = newId;
    };

    const onDisconnect = (): void => {
      setConnectionState('disconnected');
    };

    const onConnectError = (): void => {
      setConnectionState('disconnected');
    };

    const onUpdated = (state: GameState): void => {
      // If a new game starts while a pending lobby transition is held, clear it
      if (state.gamePhase !== 'lobby') {
        setPendingLobbyState(null);
      }
      setMultiplayerState((prev) => {
        // Non-host players should not be auto-navigated to lobby when the host
        // ends the session after a natural game end (won/lost). Hold the state
        // and let them choose to join or leave.
        if (
          prev &&
          (prev.gamePhase === 'won' || prev.gamePhase === 'lost') &&
          state.gamePhase === 'lobby' &&
          state.hostId !== playerIdRef.current
        ) {
          setPendingLobbyState(state);
          return prev;
        }
        return state;
      });
    };

    const onReactionsUpdated = (reactions: ReactionState): void => {
      setGameReactions(reactions);
    };

    const onSpecialPlay = (data: { pileId: number; lifeline?: boolean }): void => {
      setSpecialPlayPileId(data.pileId);
      setSpecialPlayLifeline(data.lifeline === true);
      if (specialPlayTimerRef.current) clearTimeout(specialPlayTimerRef.current);
      specialPlayTimerRef.current = setTimeout(() => setSpecialPlayPileId(null), 1500);
    };

    const onKicked = (data: { gameId: string }): void => {
      forgetSeatRef.current();
      setKickedFromGameId(data.gameId);
      setMultiplayerState(null);
      setPendingLobbyState(null);
      setMultiplayerSelectedCardId(null);
      activeGameIdRef.current = null;
    };

    const onCheatUsed = (event: CheatUsedEvent): void => {
      if (cheatNoticeTimerRef.current) clearTimeout(cheatNoticeTimerRef.current);
      setCheatNotice(cheatNoticeText(event));
      cheatNoticeTimerRef.current = setTimeout(() => setCheatNotice(null), 3500);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('game:updated', onUpdated);
    socket.on('game:reactionsUpdated', onReactionsUpdated);
    socket.on('game:specialPlay', onSpecialPlay);
    socket.on('game:kicked', onKicked);
    socket.on('game:cheatUsed', onCheatUsed);
    const onJoinRequest = (event: { requestId: string; playerName: string }): void => setJoinRequests((all) => (all.some((r) => r.requestId === event.requestId) ? all : [...all, event]));
    const onJoinRequestCancelled = (event: { requestId: string }): void => setJoinRequests((all) => all.filter((r) => r.requestId !== event.requestId));
    const onJoinResolved = (event: JoinResolvedEvent): void => {
      setJoinWaiting(false);
      if (!event.approved) {
        setError(event.reason);
        return;
      }
      // Let in. The invitation is used up, so it comes out of the address.
      inviteTokenRef.current = null;
      const url = new URL(window.location.href);
      url.searchParams.delete(INVITE_QUERY_PARAM);
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      adoptSeat({ gameState: event.gameState, playerId: event.playerId, rejoinToken: event.rejoinToken });
    };
    socket.on('game:joinRequest', onJoinRequest);
    socket.on('game:joinRequestCancelled', onJoinRequestCancelled);
    socket.on('game:joinResolved', onJoinResolved);

    if (!socket.connected) {
      socket.connect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('game:updated', onUpdated);
      socket.off('game:reactionsUpdated', onReactionsUpdated);
      socket.off('game:specialPlay', onSpecialPlay);
      socket.off('game:kicked', onKicked);
      socket.off('game:cheatUsed', onCheatUsed);
      socket.off('game:joinRequest', onJoinRequest);
      socket.off('game:joinRequestCancelled', onJoinRequestCancelled);
      socket.off('game:joinResolved', onJoinResolved);
      socket.disconnect();
      setConnectionState('disconnected');
      setGameReactions({});
      setSpecialPlayPileId(null);
      setSpecialPlayLifeline(false);
    };
  }, [mode]);
}
