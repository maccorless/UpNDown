import { cheatStatuses, describeHint, keepCheatCounts, moveKey, soloHint, useCheatHotkeys, type HintView } from './cheats.js';
import { CheatsPanel } from './CheatsPanel.js';
import { InviteModal, JoinRequestModal } from './LateJoin.js';
import { SeatChoice } from './SeatChoice.js';
import { StorageNotice } from './StorageNotice.js';
import { isClaimed } from './claims.js';
import { readSavedSeat } from './saved-seat.js';
import { useSavedSeat } from './useSavedSeat.js';
import type { Action } from '@upndown/engine';
import { assertCheatAvailable, buildDeck, createStartedGameState, fullMontyCells, playCard as playCardEngine, recordCheatUse, shuffle, tradeCard as tradeCardEngine } from '@upndown/engine';
import { playCardSound, playCheerSound, playGolfClapSound, playGroanSound, playLoseSound, playTurnStartSound, playWinSound } from './sounds.js';
import { classifyPlay } from './board-helpers.js';
import { EndGameStatisticsModal } from './EndGame.js';
import { SettingsDialog } from './SettingsDialog.js';
import { useAutoMarkSync, usePlayerPrefs } from './playerPrefs.js';
import { defaultMultiplayerSettings, defaultSolitaireSettings, inCardRange, randomPresidentName, type CardLookupResult, type GameSettings, type MontyCell, type GameState, type JoinableGameSummary, type JoinLookupSummary, type ReactionState, type ReactionType } from '@upndown/shared-types';
import { useEffect, useRef, useState } from 'react';
import { GameBoard } from './GameBoard.js';
import { useGameSocket } from './useGameSocket.js';
import { BackToLobbyModal, CardLookupModal, EndGameConfirmModal, HostEndedModal, KickedModal } from './GameModals.js';
import { FullMontyModal } from './FullMonty.js';
import { JoinPanel, WaitingRoom } from './MultiplayerLobby.js';
import { useJoinablePoller, usePageVisible, useViewportHeight } from './app-hooks.js';
import { buildInviteLink, normalizeGameId, readGameIdFromLocation, readInviteFromLocation, syncGameIdInUrl } from './game-url.js';
import { readPersistedPlayerName, readPersistedSettings, SETTINGS_STORAGE_KEY, validateCreateSettings, writePersistedPlayerName, writePersistedSettings } from './settings-storage.js';
import { io, type Socket } from 'socket.io-client';
import { ProfileMenu } from './auth/ProfileMenu.js';
import { Landing } from './Landing.js';
import { SolitaireSetup } from './SolitaireSetup.js';
import { NamePrompt } from './auth/NamePrompt.js';
import { useAccountSync } from './auth/useAccountSync.js';
import { readNameConfirmed, writeNameConfirmed } from './player-name-confirmed.js';
import { newRunId } from './solitaire-result.js';
import { useSolitaireResult } from './useSolitaireResult.js';
import { useLocalHistory } from './profile/useLocalHistory.js';
import { useGuestMultiplayerRecord } from './profile/useGuestMultiplayerRecord.js';
import { ProfileLayer } from './profile/ProfileLayer.js';
import { BadgeToasts } from './profile/BadgeToasts.js';
import { useBadgeToasts } from './profile/useBadgeToasts.js';
import { useSeenBadges } from './profile/useSeenBadges.js';
import { useProfileSource } from './profile/useProfile.js';
import { MoveHistoryDialog } from './profile/MoveHistoryDialog.js';
import { useSolitaireSave } from './useSolitaireSave.js';
import { useAuth } from './auth/useAuth.js';
import './App.css';

const SOLO_PLAYER_ID = 'solo-player';

type Mode = 'solitaire' | 'multiplayer';
type ConnectionState = 'disconnected' | 'connecting' | 'connected';
type PendingAction = 'create' | 'join' | 'lookup' | 'start' | 'play' | 'cheat' | 'robot' | 'endturn' | 'endgame' | 'leave' | 'updatesettings' | 'undo' | null;

type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

// JoinableGameSummary, JoinLookupSummary, defaultMultiplayerSettings, and
// defaultSolitaireSettings are imported from @upndown/shared-types above.
const solitaireSettings = defaultSolitaireSettings;
const multiplayerSettings = defaultMultiplayerSettings;

const SOUNDS_STORAGE_KEY = 'upndown.sounds.v1';

function readSoundsEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(SOUNDS_STORAGE_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}
const ACK_TIMEOUT_MS = import.meta.env.MODE === 'test' ? 80 : 5000;
const ACK_TIMEOUT_ERROR = 'Request timed out. Please check your connection and try again.';
const SOCKET_DISCONNECTED_ERROR = 'Not connected to server. Please wait for reconnect and retry.';
const SOCKET_REQUEST_ERROR = 'Unable to reach server. Please retry.';
function newSolitaireGame(settings: GameSettings): GameState {
  const deck = shuffle(buildDeck(settings));
  return createStartedGameState({
    gameId: 'SOLITAIRE',
    hostId: SOLO_PLAYER_ID,
    players: [{ id: SOLO_PLAYER_ID, name: 'You', color: 'cyan' as const }],
    settings,
    isSolitaire: true,
    deck
  });
}

export function App(): JSX.Element {
  const persisted = readPersistedSettings();
  const [mode, setMode] = useState<Mode | null>(null);
  const auth = useAuth();
  const [firstVisit] = useState(() => readPersistedSettings() === null);
  const [editingName, setEditingName] = useState(false);
  const [solitaireConfig, setSolitaireConfig] = useState<GameSettings>(() => persisted?.solitaire ?? solitaireSettings);
  const [solitaireActive, setSolitaireActive] = useState(false);

  const [solitaireState, setSolitaireState] = useState<GameState>(() => newSolitaireGame(solitaireSettings));
  const [solitaireSelectedCardId, setSolitaireSelectedCardId] = useState<string | null>(null);
  const [solitaireSpecialPlayPileId, setSolitaireSpecialPlayPileId] = useState<number | null>(null);
  const [solitaireSpecialPlayLifeline, setSolitaireSpecialPlayLifeline] = useState(false);
  const solitaireSpecialPlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [solitaireUndoStack, setSolitaireUndoStack] = useState<GameState[]>([]);
  const [solitaireRunId, setSolitaireRunId] = useState(newRunId);
  const solitaireSave = useSolitaireSave({ active: solitaireActive, state: solitaireState, undoStack: solitaireUndoStack, runId: solitaireRunId });
  // Solitaire needs no server. Only a signed-in player's finished game is sent, to be saved to their history.
  const localHistory = useLocalHistory();
  const [profileOpen, setProfileOpen] = useState(false);
  const seenBadges = useSeenBadges(auth, localHistory);
  const profileSource = useProfileSource(auth, localHistory);
  const solitaireResult = useSolitaireResult({ active: solitaireActive, state: solitaireState, runId: solitaireRunId, signedIn: auth.status === 'signedIn', guest: auth.status === 'guest' || auth.status === 'disabled', userId: auth.userId, history: localHistory });

  const [multiplayerState, setMultiplayerState] = useState<GameState | null>(null);
  const [multiplayerSelectedCardId, setMultiplayerSelectedCardId] = useState<string | null>(null);
  const [gameReactions, setGameReactions] = useState<ReactionState>({});
  const [specialPlayPileId, setSpecialPlayPileId] = useState<number | null>(null);
  const [specialPlayLifeline, setSpecialPlayLifeline] = useState(false);
  const specialPlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [multiplayerCreateSettings, setMultiplayerCreateSettings] = useState<GameSettings>(() => persisted?.multiplayer ?? multiplayerSettings);
  const [settingsDraft, setSettingsDraft] = useState<GameSettings>(() => persisted?.multiplayer ?? multiplayerSettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // A refused save is told inside the dialog; the page banner sits behind it.
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  const [dismissedStatsModalKey, setDismissedStatsModalKey] = useState<string | null>(null);
  // false: closed. 'panel': the cheats panel. 'skip': the panel, straight to the skip confirmation (the Ctrl/Cmd-S key).
  const [cheatsOpen, setCheatsOpen] = useState<false | 'panel' | 'skip'>(false);
  const [cheatNotice, setCheatNotice] = useState<string | null>(null);
  // The current hint: lights up a card and a pile and says it in words. Gone as soon as the game moves on.
  const [hint, setHint] = useState<HintView | null>(null);
  const cheatNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hostEndedModalGameId, setHostEndedModalGameId] = useState<string | null>(null);
  const [kickedFromGameId, setKickedFromGameId] = useState<string | null>(null);
  const [kickedWhileAway, setKickedWhileAway] = useState(false);
  const [playerName, setPlayerName] = useState(() => readPersistedPlayerName() || randomPresidentName());
  const nameConfirmedRef = useRef(readNameConfirmed(readPersistedPlayerName()));
  const [joinGameId, setJoinGameId] = useState('');
  const [showJoinById, setShowJoinById] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [joinLookup, setJoinLookup] = useState<JoinLookupSummary | null>(null);
  const [multiplayerFlow, setMultiplayerFlow] = useState<'choose' | 'join'>('choose');
  const [joinableGames, setJoinableGames] = useState<JoinableGameSummary[]>([]);
  const [loadingJoinableGames, setLoadingJoinableGames] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const guestRecord = useGuestMultiplayerRecord({ state: multiplayerState, playerId, guest: auth.status === 'guest' || auth.status === 'disabled', history: localHistory });
  const mpFinished = mode === 'multiplayer' && (multiplayerState?.gamePhase === 'won' || multiplayerState?.gamePhase === 'lost') && !!multiplayerState.runId;
  const finishedKey = mode === 'solitaire' && ['saved', 'local', 'queued'].includes(solitaireResult.status) ? `solo:${solitaireRunId}` : mpFinished ? `mp:${multiplayerState?.runId}` : null;
  const badgeToasts = useBadgeToasts({ source: profileSource, finishedKey, delayMs: auth.status === 'signedIn' && mpFinished ? 1500 : 0, seen: seenBadges.seen, markSeen: seenBadges.markSeen, nudge: auth.status === 'guest', history: localHistory });
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [pendingLobbyState, setPendingLobbyState] = useState<GameState | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [enableSounds, setEnableSounds] = useState(() => readSoundsEnabled());
  const enableSoundsRef = useRef(enableSounds);
  enableSoundsRef.current = enableSounds;
  const changeSounds = (val: boolean): void => {
    setEnableSounds(val);
    try { window.localStorage.setItem(SOUNDS_STORAGE_KEY, String(val)); } catch { /* ignore */ }
  };
  useAccountSync(auth, { playerName, setPlayerName, solitaire: solitaireConfig, setSolitaire: setSolitaireConfig, multiplayer: multiplayerCreateSettings, setMultiplayer: setMultiplayerCreateSettings, enableSounds, setEnableSounds: changeSounds, seenBadges: seenBadges.seen });
  const [cardLookupOpen, setCardLookupOpen] = useState(false);
  const [cardLookupValue, setCardLookupValue] = useState('');
  // Which cheat the open check is made under: the card seeker, or the Nas check.
  const [cardLookupKind, setCardLookupKind] = useState<'lookup' | 'nas'>('lookup');
  // The full Monty's grid while it is open: one cell per card from 1 to 100, or null when it is shut.
  const [montyCells, setMontyCells] = useState<MontyCell[] | null>(null);
  const [cardLookupToast, setCardLookupToast] = useState<CardLookupResult | null>(null);
  const cardLookupToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const socketRef = useRef<Socket | null>(null);
  // Kept in sync every render so event handlers can read current playerId without stale closures
  const playerIdRef = useRef<string | null>(null);
  playerIdRef.current = playerId;
  const pendingDeepLinkGameIdRef = useRef<string | null>(readGameIdFromLocation());
  // An invitation to a game already being played: asking to join with it needs the host to say yes.
  const inviteTokenRef = useRef<string | null>(readInviteFromLocation());
  const [joinWaiting, setJoinWaiting] = useState(false);
  const [joinRequests, setJoinRequests] = useState<Array<{ requestId: string; playerName: string }>>([]);
  const [lateInvite, setLateInvite] = useState<{ link: string; expiresAtMs: number } | null>(null);
  const pendingAutoJoinGameIdRef = useRef<string | null>(pendingDeepLinkGameIdRef.current);
  // Touching the name hands control to the player: no auto-join while they type (the first letter would otherwise join as "S").
  const confirmName = (): void => { nameConfirmedRef.current = true; writeNameConfirmed(); pendingAutoJoinGameIdRef.current = null; };
  const previousMultiplayerSnapshotRef = useRef<{ gameId: string; phase: GameState['gamePhase'] } | null>(null);
  const suppressHostEndedNoticeRef = useRef(false);
  const joinablePollFailuresRef = useRef(0);
  const activeGameIdRef = useRef<string | null>(null);
  const previousPlayerIdRef = useRef<string | null>(null);
  const rejoinTokenRef = useRef<string | null>(null);

  // Production builds talk to whichever host served them, so one image works in every environment.
  const socketUrl = import.meta.env.VITE_SOCKET_URL
    || (import.meta.env.PROD ? window.location.origin : 'http://localhost:3001');

  const getSocket = (): Socket => {
    if (!socketRef.current) {
      socketRef.current = io(socketUrl, {
        autoConnect: false,
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500
      });
    }
    return socketRef.current;
  };

  useEffect(() => {
    const deepLinkedGameId = pendingDeepLinkGameIdRef.current;
    if (!deepLinkedGameId) {
      return;
    }

    setMode('multiplayer');
    setMultiplayerFlow('join');
    setShowJoinById(true);
    setJoinGameId(deepLinkedGameId);
    setJoinLookup(null);
    setError(null);
    pendingDeepLinkGameIdRef.current = null;
  }, []);

  useEffect(() => {
    if (mode === null) {
      return;
    }

    const joinFlowGameId = mode === 'multiplayer' && showJoinById
      ? normalizeGameId(joinGameId)
      : null;
    const lobbyGameId = mode === 'multiplayer' && multiplayerState?.gamePhase === 'lobby'
      ? multiplayerState.gameId
      : null;
    syncGameIdInUrl(lobbyGameId ?? joinFlowGameId);
  }, [mode, showJoinById, joinGameId, multiplayerState]);

  useEffect(() => {
    setInviteCopied(false);
  }, [multiplayerState?.gameId]);

  useEffect(() => {
    if (mode !== 'multiplayer' || !multiplayerState || !playerId) {
      previousMultiplayerSnapshotRef.current = null;
      return;
    }

    const previous = previousMultiplayerSnapshotRef.current;
    const transitionedToLobby = previous
      && previous.gameId === multiplayerState.gameId
      && previous.phase === 'playing'
      && multiplayerState.gamePhase === 'lobby';
    const amSeated = multiplayerState.players.some((player) => player.id === playerId);
    if (transitionedToLobby && amSeated && !suppressHostEndedNoticeRef.current) {
      setHostEndedModalGameId(multiplayerState.gameId);
    }

    previousMultiplayerSnapshotRef.current = {
      gameId: multiplayerState.gameId,
      phase: multiplayerState.gamePhase
    };
  }, [mode, multiplayerState, playerId]);

  useEffect(() => {
    if (mode !== 'multiplayer' || multiplayerState || connectionState !== 'connected') {
      return;
    }

    const deepLinkGameId = pendingAutoJoinGameIdRef.current;
    if (!deepLinkGameId) {
      return;
    }
    if (normalizeGameId(joinGameId) !== deepLinkGameId) {
      return;
    }
    // A generated name the player never chose waits on the join screen instead.
    if (!playerName.trim() || !nameConfirmedRef.current) {
      return;
    }

    pendingAutoJoinGameIdRef.current = null;
    void handleJoinGame(deepLinkGameId);
  }, [mode, multiplayerState, connectionState, joinGameId, playerName]);

  // A game being played survives a closed tab: the seat is kept in this browser, and the landing offers to take it back.
  const savedSeat = useSavedSeat(multiplayerState, playerId, rejoinTokenRef, mode === null, auth.status === 'signedIn');
  const forgetSeatRef = useRef(savedSeat.forget);
  forgetSeatRef.current = savedSeat.forget;
  const adoptSeat = (data: { gameState: GameState; playerId: string; rejoinToken: string }): void => {
    setMultiplayerState(data.gameState);
    setPlayerId(data.playerId);
    previousPlayerIdRef.current = data.playerId;
    rejoinTokenRef.current = data.rejoinToken;
    activeGameIdRef.current = data.gameState.gameId;
  };
  // Takes back a seat held by this account in a game being played (no token: the sign-in is the proof).
  const rejoinMine = (gameId: string): void => {
    getSocket().emit('game:rejoinMine', { gameId }, (response: { ok: boolean; data?: { gameState: GameState; playerId: string; rejoinToken: string } }) => {
      if (response?.ok && response.data) adoptSeat(response.data);
    });
  };
  const [seatChoices, setSeatChoices] = useState<string[]>([]);
  const handleRejoinSavedSeat = async (seatKey: string): Promise<void> => {
    const seat = readSavedSeat(seatKey);
    // Another tab may have opened this seat since the list was drawn.
    if (!seat || await isClaimed(`seat:${seatKey}`)) { savedSeat.refreshOffers(); return; }
    activeGameIdRef.current = seat.gameId;
    previousPlayerIdRef.current = seat.playerId;
    rejoinTokenRef.current = seat.rejoinToken;
    savedSeat.adopt(seatKey);
    setMode('multiplayer');
    setMultiplayerFlow('choose');
    setShowJoinById(false);
    setError(null);
    // The seat is taken back when a connection opens. The Multiplayer screen has one open already, so it is reopened.
    const socket = getSocket();
    if (socket.connected) { socket.disconnect(); socket.connect(); }
  };

  useGameSocket({
    mode, getSocket, setConnectionState, previousPlayerIdRef, activeGameIdRef, rejoinTokenRef, playerIdRef, adoptSeat,
    resetToLanding: () => resetToLanding(), setKickedWhileAway, setKickedFromGameId, setError, rejoinMine, setSeatChoices,
    setPlayerId, setPendingLobbyState, setMultiplayerState, setGameReactions, setSpecialPlayPileId, setSpecialPlayLifeline, specialPlayTimerRef,
    forgetSeatRef, setMultiplayerSelectedCardId, setCheatNotice, cheatNoticeTimerRef, setJoinRequests, setJoinWaiting,
    inviteTokenRef
  });


  useEffect(() => {
    if (mode === 'solitaire') {
      setSettingsDraft(solitaireConfig);
      return;
    }

    if (multiplayerState) {
      setSettingsDraft(multiplayerState.settings);
      return;
    }
    setSettingsDraft(multiplayerCreateSettings);
  }, [mode, multiplayerState, multiplayerCreateSettings, solitaireConfig]);

  useEffect(() => {
    writePersistedSettings({
      solitaire: solitaireConfig,
      multiplayer: multiplayerCreateSettings
    });
  }, [solitaireConfig, multiplayerCreateSettings]);

  useEffect(() => {
    writePersistedPlayerName(playerName);
  }, [playerName]);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== SETTINGS_STORAGE_KEY) {
        return;
      }

      const updated = readPersistedSettings();
      if (!updated) {
        return;
      }

      setSolitaireConfig(updated.solitaire);
      setMultiplayerCreateSettings(updated.multiplayer);
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useViewportHeight();
  const isPageVisible = usePageVisible();

  useEffect(() => {
    setJoinLookup(null);
  }, [joinGameId]);

  // Sound: win / lose
  const prevPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    const phase = (mode === 'multiplayer' ? multiplayerState?.gamePhase : solitaireActive ? solitaireState.gamePhase : null) ?? null;
    if (enableSoundsRef.current && prevPhaseRef.current !== phase) {
      if (phase === 'won') playWinSound();
      else if (phase === 'lost') playLoseSound();
    }
    prevPhaseRef.current = phase;
  }, [mode, multiplayerState?.gamePhase, solitaireState.gamePhase, solitaireActive]);

  // Tab title: a hidden tab shows when it is your turn
  const isMyTurnNow = mode === 'multiplayer'
    && multiplayerState?.gamePhase === 'playing'
    && multiplayerState.players[multiplayerState.currentPlayerIndex]?.id === playerId;
  useEffect(() => {
    document.title = isMyTurnNow ? '(Your turn) UpNDown' : 'UpNDown';
    return () => { document.title = 'UpNDown'; };
  }, [isMyTurnNow]);

  // Sound: your turn starts (multiplayer only)
  const prevCurrentPlayerRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== 'multiplayer' || !multiplayerState || !playerId) return;
    const currentId = multiplayerState.players[multiplayerState.currentPlayerIndex]?.id ?? null;
    if (enableSoundsRef.current && currentId === playerId && currentId !== prevCurrentPlayerRef.current && multiplayerState.gamePhase === 'playing') {
      playTurnStartSound();
      if ('vibrate' in navigator) navigator.vibrate(150);
    }
    prevCurrentPlayerRef.current = currentId;
  }, [mode, multiplayerState, playerId]);

  // Sound: every play, by anyone, picked from how far it moved the pile
  const prevPlayStateRef = useRef<GameState | null>(null);
  useEffect(() => {
    const state = mode === 'multiplayer' ? multiplayerState : mode === 'solitaire' ? solitaireState : null;
    const prev = prevPlayStateRef.current;
    prevPlayStateRef.current = state;
    if (!enableSoundsRef.current || !prev || !state || prev.gameId !== state.gameId) return;
    const kind = classifyPlay(prev, state);
    if (kind === 'cheer') playCheerSound();
    else if (kind === 'clap') playGolfClapSound();
    else if (kind === 'groan') playGroanSound();
    else if (kind === 'card') playCardSound();
  }, [mode, multiplayerState, solitaireState]);

  const requestSocketAck = <T,>(event: string, payload: unknown): Promise<Ack<T>> => {
    const socket = getSocket();
    if (!socket.connected) {
      return Promise.resolve({ ok: false, error: SOCKET_DISCONNECTED_ERROR });
    }

    return new Promise((resolve) => {
      let settled = false;
      let timer = 0;

      const finish = (ack: Ack<T>): void => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        resolve(ack);
      };

      timer = window.setTimeout(() => {
        finish({ ok: false, error: ACK_TIMEOUT_ERROR });
      }, ACK_TIMEOUT_MS);

      try {
        socket.emit(event, payload, (ack: Ack<T>) => finish(ack));
      } catch {
        finish({ ok: false, error: SOCKET_REQUEST_ERROR });
      }
    });
  };

  const emitWithAck = async <T,>(
    event: string,
    payload: unknown,
    action: Exclude<PendingAction, null>
  ): Promise<Ack<T>> => {
    setPendingAction(action);
    try {
      return await requestSocketAck<T>(event, payload);
    } finally {
      setPendingAction(null);
    }
  };

  // This person's own settings (arrows, auto-mark), and telling the server what they chose for auto-mark.
  const prefs = usePlayerPrefs();
  useAutoMarkSync({
    autoMark: prefs.autoMark,
    state: multiplayerState,
    playerId,
    connected: connectionState === 'connected',
    send: async (gameId, enabled) => {
      const ack = await requestSocketAck<{ gameState: GameState }>('game:setAutoMark', { gameId, enabled });
      if (ack.ok) setMultiplayerState(ack.data.gameState);
      return ack.ok;
    }
  });

  const refreshJoinableGames = async (options?: { background?: boolean }): Promise<boolean> => {
    if (mode !== 'multiplayer' || multiplayerState) {
      return false;
    }

    const background = options?.background ?? false;
    if (!background) {
      setLoadingJoinableGames(true);
    }
    try {
      const ack = await requestSocketAck<{ games: JoinableGameSummary[] }>('game:listJoinable', {});
      if (!ack.ok) {
        joinablePollFailuresRef.current += 1;
        setError(ack.error);
        return false;
      }
      setJoinableGames(ack.data.games);
      joinablePollFailuresRef.current = 0;
      setError(null);
      return true;
    } finally {
      if (!background) {
        setLoadingJoinableGames(false);
      }
    }
  };

  useJoinablePoller(
    mode === 'multiplayer' && !multiplayerState && connectionState === 'connected' && multiplayerFlow === 'join' && isPageVisible,
    refreshJoinableGames,
    joinablePollFailuresRef
  );

  const handleRetryConnection = (): void => {
    const socket = getSocket();
    if (!socket.connected) {
      setConnectionState('connecting');
      socket.connect();
    }
  };

  const beginSolitaire = (state: GameState, undo: GameState[], runId: string): void => {
    setSolitaireActive(true);
    setSolitaireRunId(runId);
    setSolitaireState(state);
    setDismissedStatsModalKey(null);
    setSolitaireSelectedCardId(null);
    setSolitaireUndoStack(undo);
    setError(null);
  };

  const handleSolitaireNewGame = (): void => beginSolitaire(newSolitaireGame(solitaireConfig), [], newRunId());

  // Picks up a game saved on this device (and not open in another tab). The clock stopped while it was away.
  const handleSolitaireResume = async (runId: string): Promise<void> => {
    const saved = await solitaireSave.load(runId);
    if (!saved) return;
    setMode('solitaire');
    beginSolitaire(saved.state, saved.undo, saved.runId ?? newRunId());
    setMultiplayerFlow('choose');
    setShowJoinById(false);
  };

  const handleSolitaireEndGame = (): void => {
    solitaireSave.discard();
    setSolitaireActive(false);
    setSolitaireSelectedCardId(null);
    setSolitaireUndoStack([]);
    setError(null);
  };

  const handleSolitairePlayCard = (pileId: number): void => {
    if (!solitaireSelectedCardId) return;

    try {
      const oldSpecialPlays = solitaireState.statistics.players[SOLO_PLAYER_ID]?.specialPlays ?? 0;
      const oldLifelines = solitaireState.statistics.players[SOLO_PLAYER_ID]?.lifelines ?? 0;
      const next = playCardEngine(solitaireState, SOLO_PLAYER_ID, solitaireSelectedCardId, pileId);
      const newSpecialPlays = next.statistics.players[SOLO_PLAYER_ID]?.specialPlays ?? 0;
      const newLifelines = next.statistics.players[SOLO_PLAYER_ID]?.lifelines ?? 0;

      setSolitaireUndoStack((stack) => [...stack, solitaireState]);
      setSolitaireState(next);
      setSolitaireSelectedCardId(null);
      setError(null);

      if (newSpecialPlays > oldSpecialPlays) {
        setSolitaireSpecialPlayPileId(pileId);
        setSolitaireSpecialPlayLifeline(newLifelines > oldLifelines);
        if (solitaireSpecialPlayTimerRef.current) clearTimeout(solitaireSpecialPlayTimerRef.current);
        solitaireSpecialPlayTimerRef.current = setTimeout(() => setSolitaireSpecialPlayPileId(null), 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to play card.');
    }
  };

  const handleSolitaireUndo = (): void => {
    setSolitaireUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1]!;
      // Cheats counted since the snapshot (a card lookup, a hint) are not undone with the move.
      setSolitaireState((current) => keepCheatCounts(prev, current, SOLO_PLAYER_ID));
      setSolitaireSelectedCardId(null);
      setError(null);
      return stack.slice(0, -1);
    });
  };

  const handleCreateGame = async (): Promise<void> => {
    const trimmedName = playerName.trim();
    confirmName();
    if (!trimmedName) {
      setError('Player name is required');
      return;
    }

    const settingsError = validateCreateSettings(multiplayerCreateSettings);
    if (settingsError) {
      setError(settingsError);
      return;
    }

    setError(null);
    const ack = await emitWithAck<{ gameState: GameState; playerId: string; rejoinToken: string }>(
      'game:create',
      {
        playerName: trimmedName,
        settings: multiplayerCreateSettings,
        isSolitaire: false
      },
      'create'
    );

    if (!ack.ok) {
      setError(ack.error);
      return;
    }

    setPlayerId(ack.data.playerId);
    previousPlayerIdRef.current = ack.data.playerId;
    rejoinTokenRef.current = ack.data.rejoinToken;
    activeGameIdRef.current = ack.data.gameState.gameId;
    setMultiplayerState(ack.data.gameState);
    setMultiplayerSelectedCardId(null);
    setInviteCopied(false);
  };

  const handleJoinGame = async (forcedGameId?: string): Promise<void> => {
    const trimmedName = playerName.trim();
    confirmName();
    const gameId = (forcedGameId ?? joinGameId).trim().toUpperCase();

    if (!trimmedName) {
      setError('Player name is required');
      return;
    }

    if (gameId.length !== 6) {
      setError('Game ID must be 6 characters');
      return;
    }

    setError(null);
    if (inviteTokenRef.current) {
      // A game already being played: ask to join with the invitation, then wait for the host's answer.
      const asked = await emitWithAck<{ requestId: string }>('game:requestJoin', { gameId, inviteToken: inviteTokenRef.current, playerName: trimmedName }, 'join');
      if (!asked.ok) {
        setError(asked.error);
        return;
      }
      setJoinWaiting(true);
      return;
    }
    const ack = await emitWithAck<{ gameState: GameState; playerId: string; rejoinToken: string }>(
      'game:join',
      { gameId, playerName: trimmedName },
      'join'
    );

    if (!ack.ok) {
      setError(ack.error);
      return;
    }

    setJoinGameId(gameId);
    setPlayerId(ack.data.playerId);
    previousPlayerIdRef.current = ack.data.playerId;
    rejoinTokenRef.current = ack.data.rejoinToken;
    activeGameIdRef.current = ack.data.gameState.gameId;
    setMultiplayerState(ack.data.gameState);
    setMultiplayerSelectedCardId(null);
    setShowJoinById(false);
    setJoinLookup(null);
    setInviteCopied(false);
  };

  const handleLookupGame = async (): Promise<void> => {
    const gameId = joinGameId.trim().toUpperCase();
    if (gameId.length !== 6) {
      setError('Game ID must be 6 characters');
      return;
    }

    setError(null);
    const ack = await emitWithAck<{ game: JoinLookupSummary }>(
      'game:lookup',
      { gameId },
      'lookup'
    );

    if (!ack.ok) {
      setJoinLookup(null);
      setError(ack.error);
      return;
    }

    setJoinLookup(ack.data.game);
  };

  const handleStartGame = async (): Promise<void> => {
    if (!multiplayerState) return;

    const ack = await emitWithAck<{ gameState: GameState }>(
      'game:start',
      { gameId: multiplayerState.gameId },
      'start'
    );

    if (!ack.ok) {
      setError(ack.error);
      return;
    }

    setError(null);
    setMultiplayerState(ack.data.gameState);
    setMultiplayerSelectedCardId(null);
  };

  const handleMultiplayerPlayCard = async (pileId: number): Promise<void> => {
    if (!multiplayerState || !multiplayerSelectedCardId) {
      return;
    }

    const ack = await emitWithAck<{ gameState: GameState }>(
      'game:playCard',
      {
        gameId: multiplayerState.gameId,
        cardId: multiplayerSelectedCardId,
        pileId
      },
      'play'
    );

    if (!ack.ok) {
      setError(ack.error);
      return;
    }

    setError(null);
    setMultiplayerSelectedCardId(null);
    setMultiplayerState(ack.data.gameState);
  };

  // Cheats. In multiplayer the server decides; in solitaire the whole game is local, so the engine is used directly.
  const openCheck = (kind: 'lookup' | 'nas'): void => {
    setCardLookupValue('');
    setCardLookupKind(kind);
    setCardLookupOpen(true);
  };
  const openLookup = (): void => openCheck('lookup');
  const openNasCheck = (): void => openCheck('nas');

  // The full Monty. Solitaire is local, so the grid is worked out here. At a table the server answers only the one asking, and
  // the others are told a cheat was used, as for the card seeker.
  const handleCheatMonty = async (): Promise<void> => {
    if (mode === 'solitaire') {
      try {
        const counted = recordCheatUse(solitaireState, SOLO_PLAYER_ID, 'monty');
        setSolitaireState(counted);
        setMontyCells(fullMontyCells(counted));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to use the full Monty');
      }
      return;
    }
    if (!multiplayerState) return;
    const ack = await emitWithAck<{ cells: MontyCell[] }>('game:fullMonty', { gameId: multiplayerState.gameId }, 'cheat');
    if (!ack.ok) {
      setError(ack.error);
      return;
    }
    setError(null);
    setMontyCells(ack.data.cells);
  };

  // Robots: the host fills seats in the lobby. They count toward the player limits like anyone.
  const handleAddRobot = async (): Promise<void> => {
    if (!multiplayerState) return;
    const ack = await emitWithAck<{ gameState: GameState }>('game:addRobot', { gameId: multiplayerState.gameId }, 'robot');
    if (!ack.ok) {
      setError(ack.error);
      return;
    }
    setError(null);
    setMultiplayerState(ack.data.gameState);
  };

  const handleRemoveRobot = async (robotId: string): Promise<void> => {
    if (!multiplayerState) return;
    const ack = await emitWithAck<{ gameState: GameState }>('game:removeRobot', { gameId: multiplayerState.gameId, playerId: robotId }, 'robot');
    if (!ack.ok) {
      setError(ack.error);
      return;
    }
    setError(null);
    setMultiplayerState(ack.data.gameState);
  };

  // The host's side of joining a game in progress: make an invitation, and answer the requests that come in.
  const handleCreateInvite = async (): Promise<void> => {
    if (!multiplayerState) return;
    const ack = await emitWithAck<{ token: string; expiresAtMs: number }>('game:createInvite', { gameId: multiplayerState.gameId }, 'cheat');
    if (!ack.ok) {
      setError(ack.error);
      return;
    }
    setError(null);
    setLateInvite({ link: buildInviteLink(multiplayerState.gameId, ack.data.token), expiresAtMs: ack.data.expiresAtMs });
  };

  const handleAnswerJoin = async (approve: boolean): Promise<void> => {
    const request = joinRequests[0];
    if (!request || !multiplayerState) return;
    const ack = await emitWithAck<{ gameState: GameState }>('game:resolveJoin', { gameId: multiplayerState.gameId, requestId: request.requestId, approve }, 'cheat');
    setJoinRequests((all) => all.filter((r) => r.requestId !== request.requestId));
    if (!ack.ok) {
      setError(ack.error);
      return;
    }
    setError(null);
    setMultiplayerState(ack.data.gameState);
  };

  const handleCheatHint = async (): Promise<void> => {
    if (mode === 'solitaire') {
      try {
        const counted = recordCheatUse(solitaireState, SOLO_PLAYER_ID, 'hint');
        setSolitaireState(counted);
        setHint(await soloHint(solitaireState, SOLO_PLAYER_ID));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to give a hint');
      }
      return;
    }
    if (!multiplayerState) return;
    // The server works the hint out from what this player can see and counts the use; nothing goes to the other players.
    const ack = await emitWithAck<{ action: Action; reasons?: string[] }>('game:hint', { gameId: multiplayerState.gameId }, 'cheat');
    if (!ack.ok) {
      setError(ack.error);
      return;
    }
    setError(null);
    setHint(describeHint(ack.data.action, multiplayerState, playerId, ack.data.reasons));
  };

  const handleCheatSkip = async (): Promise<void> => {
    if (!multiplayerState) return;
    const ack = await emitWithAck<{ gameState: GameState }>('game:skip', { gameId: multiplayerState.gameId }, 'cheat');
    if (!ack.ok) {
      setError(ack.error);
      return;
    }
    setError(null);
    setMultiplayerSelectedCardId(null);
    setMultiplayerState(ack.data.gameState);
  };

  const handleCheatTrade = async (): Promise<void> => {
    if (mode === 'solitaire') {
      if (!solitaireSelectedCardId) return;
      try {
        // A trade is for good: undo cannot take it back, so the undo history starts again.
        setSolitaireState(tradeCardEngine(solitaireState, SOLO_PLAYER_ID, solitaireSelectedCardId));
        setSolitaireUndoStack([]);
        setSolitaireSelectedCardId(null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to trade');
      }
      return;
    }
    if (!multiplayerState || !multiplayerSelectedCardId) return;
    const ack = await emitWithAck<{ gameState: GameState }>('game:trade', { gameId: multiplayerState.gameId, cardId: multiplayerSelectedCardId }, 'cheat');
    if (!ack.ok) {
      setError(ack.error);
      return;
    }
    setError(null);
    setMultiplayerSelectedCardId(null);
    setMultiplayerState(ack.data.gameState);
  };

  const handleMultiplayerEndTurn = async (): Promise<void> => {
    if (!multiplayerState) return;

    const ack = await emitWithAck<{ gameState: GameState }>(
      'game:endTurn',
      { gameId: multiplayerState.gameId },
      'endturn'
    );

    if (!ack.ok) {
      setError(ack.error);
      return;
    }

    setError(null);
    setMultiplayerSelectedCardId(null);
    setMultiplayerState(ack.data.gameState);
  };

  const handleMultiplayerUndo = async (): Promise<void> => {
    if (!multiplayerState) return;

    const ack = await emitWithAck<{ gameState: GameState }>(
      'game:undoPlay',
      { gameId: multiplayerState.gameId },
      'undo'
    );

    if (!ack.ok) {
      setError(ack.error);
      return;
    }

    setError(null);
    setMultiplayerSelectedCardId(null);
    setMultiplayerState(ack.data.gameState);
  };

  const handleKickPlayer = async (targetPlayerId: string): Promise<void> => {
    if (!multiplayerState) return;

    const ack = await emitWithAck<{ gameState: GameState }>(
      'game:kickPlayer',
      { gameId: multiplayerState.gameId, targetPlayerId },
      'leave'
    );

    if (!ack.ok) {
      setError(ack.error);
      return;
    }

    setError(null);
    setMultiplayerState(ack.data.gameState);
  };

  const handleCardLookupSubmit = (): void => {
    const cardValue = parseInt(cardLookupValue, 10);
    if (isNaN(cardValue)) return;
    setCardLookupOpen(false);
    setCardLookupValue('');

    const activeState = mode === 'multiplayer' ? multiplayerState : (mode === 'solitaire' ? solitaireState : null);
    if (!activeState || activeState.gamePhase !== 'playing') return;

    const showToast = (result: CardLookupResult): void => {
      if (cardLookupToastTimerRef.current) clearTimeout(cardLookupToastTimerRef.current);
      setCardLookupToast(result);
      cardLookupToastTimerRef.current = setTimeout(() => setCardLookupToast(null), 3500);
    };

    // Solitaire: the full state is local, so look up here (and count the use, which the cheat limit may refuse).
    if (mode === 'solitaire') {
      try {
        // A card outside this game's range is answered as such and is not counted as a use. A cheat that is off is still refused.
        if (!inCardRange(activeState.settings, cardValue)) {
          assertCheatAvailable(activeState, SOLO_PLAYER_ID, cardLookupKind);
          showToast({ cardValue, status: 'out-of-range', playerName: '' });
          return;
        }
        setSolitaireState(recordCheatUse(solitaireState, SOLO_PLAYER_ID, cardLookupKind));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to use the card seeker');
        return;
      }
      let status: CardLookupResult['status'];
      let holderName: string | undefined;
      if (activeState.drawPile.some((c) => c.value === cardValue)) {
        status = 'in-draw';
      } else {
        const holder = activeState.players.find((p) => p.hand.some((c) => c.value === cardValue));
        if (holder) {
          status = 'in-hand';
          holderName = holder.name;
        } else {
          status = 'played';
        }
      }
      showToast({ cardValue, status, playerName: '', ...(holderName ? { holderName } : {}) });
      return;
    }

    // Multiplayer: the server holds the hidden cards and answers only this player; the others are told a lookup happened.
    void requestSocketAck<{ result: CardLookupResult }>('game:cardLookup', { gameId: activeState.gameId, cardValue, kind: cardLookupKind })
      .then((ack) => {
        if (ack.ok) showToast(ack.data.result);
        else setError(ack.error);
      });
  };

  const sendSetReaction = (pileId: number, reactionType: ReactionType | null): void => {
    const socket = getSocket();
    if (!socket.connected || !multiplayerState) return;
    socket.emit('game:setReaction', { gameId: multiplayerState.gameId, pileId, reactionType });
  };

  const [showEndGameConfirm, setShowEndGameConfirm] = useState(false);

  const executeEndGame = async (): Promise<void> => {
    if (!multiplayerState) return;
    setShowEndGameConfirm(false);
    // Ending the game resets the room, so the game as it stands is kept to record from if the server agrees.
    const before = multiplayerState;

    const ack = await emitWithAck<{ gameState: GameState }>(
      'game:endGame',
      { gameId: multiplayerState.gameId },
      'endgame'
    );

    if (!ack.ok) {
      setError(ack.error);
      return;
    }
    guestRecord.recordAbandoned(before);

    setError(null);
    setMultiplayerSelectedCardId(null);
    setMultiplayerState(ack.data.gameState);
  };

  const handleMultiplayerEndGame = async (): Promise<void> => {
    if (!multiplayerState) return;

    if (multiplayerState.gamePhase === 'playing') {
      setShowEndGameConfirm(true);
      return;
    }

    await executeEndGame();
  };

  const handleMultiplayerPlayAgain = async (): Promise<void> => {
    if (!multiplayerState || multiplayerState.hostId !== playerId) {
      return;
    }

    suppressHostEndedNoticeRef.current = true;
    try {
      const resetAck = await emitWithAck<{ gameState: GameState }>(
        'game:endGame',
        { gameId: multiplayerState.gameId },
        'endgame'
      );

      if (!resetAck.ok) {
        setError(resetAck.error);
        return;
      }

      const startAck = await emitWithAck<{ gameState: GameState }>(
        'game:start',
        { gameId: multiplayerState.gameId },
        'start'
      );

      if (!startAck.ok) {
        setError(startAck.error);
        setMultiplayerState(resetAck.data.gameState);
        return;
      }

      setError(null);
      setDismissedStatsModalKey(null);
      setMultiplayerSelectedCardId(null);
      setMultiplayerState(startAck.data.gameState);
    } finally {
      suppressHostEndedNoticeRef.current = false;
    }
  };

  const handleLeaveMultiplayer = async (): Promise<void> => {
    if (!multiplayerState) {
      return;
    }

    const ack = await emitWithAck<{ gameState: GameState | null }>(
      'game:leave',
      { gameId: multiplayerState.gameId },
      'leave'
    );

    if (!ack.ok) {
      setError(ack.error);
      return;
    }

    setMultiplayerState(null);
    setPendingLobbyState(null);
    setMultiplayerSelectedCardId(null);
    setJoinGameId('');
    setInviteCopied(false);
    setHostEndedModalGameId(null);
    setError(null);
  };

  const resetToLanding = (): void => {
    forgetSeatRef.current();
    setMode(null);
    setMultiplayerState(null);
    setPendingLobbyState(null);
    setMultiplayerSelectedCardId(null);
    activeGameIdRef.current = null;
    previousPlayerIdRef.current = null;
    rejoinTokenRef.current = null;
    setMultiplayerFlow('choose');
    setShowJoinById(false);
    setJoinLookup(null);
    setJoinGameId('');
    setInviteCopied(false);
    setHostEndedModalGameId(null);
    setKickedFromGameId(null);
    setError(null);
  };

  const handleAcknowledgeHostEnded = async (): Promise<void> => {
    const activeGameId = multiplayerState?.gameId ?? hostEndedModalGameId;
    if (activeGameId && connectionState === 'connected') {
      await emitWithAck<{ gameState: GameState | null }>(
        'game:leave',
        { gameId: activeGameId },
        'leave'
      );
    }
    resetToLanding();
  };

  const handleCopyInviteLink = async (): Promise<void> => {
    if (!multiplayerState) {
      return;
    }

    const inviteLink = buildInviteLink(multiplayerState.gameId);
    if (!navigator.clipboard?.writeText) {
      setInviteCopied(false);
      setError('Clipboard unavailable. Copy the invite URL manually.');
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteCopied(true);
      setError(null);
    } catch {
      setInviteCopied(false);
      setError('Could not copy invite link. Copy the invite URL manually.');
    }
  };

  const handleOpenSettings = (): void => {
    if (mode === 'solitaire') {
      setSettingsDraft(solitaireConfig);
    } else if (mode === null) {
      setSettingsDraft(multiplayerCreateSettings);
    } else {
      setSettingsDraft(multiplayerState ? multiplayerState.settings : multiplayerCreateSettings);
    }
    setSettingsSaveError(null);
    setIsSettingsOpen(true);
  };

  const handleSaveSettings = async (): Promise<void> => {
    const normalizedSettings = mode === 'solitaire'
      ? {
        ...settingsDraft,
        minPlayers: 1,
        maxPlayers: 1,
        minCardsPerTurn: 2,
        autoRefillHand: true,
        allowUndo: false,
        privateGame: false
      }
      : settingsDraft;

    const settingsError = validateCreateSettings(normalizedSettings);
    if (settingsError) {
      setError(settingsError);
      return;
    }

    if (mode === 'solitaire') {
      setSolitaireConfig(normalizedSettings);
      setSolitaireState(newSolitaireGame(normalizedSettings));
      setSolitaireSelectedCardId(null);
      setIsSettingsOpen(false);
      setError(null);
      return;
    }

    if (!multiplayerState) {
      setMultiplayerCreateSettings(normalizedSettings);
      setIsSettingsOpen(false);
      setError(null);
      return;
    }

    const isHost = multiplayerState.hostId === playerId;
    if (!isHost) {
      setSettingsSaveError('Only host can change settings');
      return;
    }

    const ack = await emitWithAck<{ gameState: GameState }>(
      'game:updateSettings',
      { gameId: multiplayerState.gameId, settings: normalizedSettings },
      'updatesettings'
    );

    if (!ack.ok) {
      setSettingsSaveError(ack.error);
      return;
    }

    setMultiplayerState(ack.data.gameState);
    setSettingsSaveError(null);
    setIsSettingsOpen(false);
    setError(null);
  };

  const multiplayerInteractionDisabled = pendingAction !== null || connectionState !== 'connected';
  const multiplayerGameActive = !!multiplayerState && multiplayerState.gamePhase !== 'lobby';
  const isHost = !!multiplayerState && multiplayerState.hostId === playerId;
  const cheatState = mode === 'multiplayer' ? multiplayerState : (mode === 'solitaire' && solitaireActive ? solitaireState : null);
  const cheatSelectedCardId = mode === 'multiplayer' ? multiplayerSelectedCardId : solitaireSelectedCardId;
  const cheatPlayerId = mode === 'multiplayer' ? playerId : SOLO_PLAYER_ID;
  const cheatStatusList = cheatState && cheatState.gamePhase === 'playing' ? cheatStatuses(cheatState, cheatPlayerId, cheatSelectedCardId) : [];
  // The hint goes when the game moves on: any change to either game, or leaving it.
  const hintBoardKey = moveKey(mode === 'multiplayer' ? multiplayerState : (mode === 'solitaire' ? solitaireState : null), mode === 'multiplayer' ? playerId : SOLO_PLAYER_ID);
  useEffect(() => { setHint(null); }, [hintBoardKey]);
  const cheatCan = (kind: 'lookup' | 'nas' | 'hint' | 'skip' | 'trade'): boolean => cheatStatusList.some((status) => status.kind === kind && status.available);
  useCheatHotkeys({
    active: cheatStatusList.length > 0,
    ...(cheatCan('lookup') ? { onLookup: openLookup } : {}),
    ...(cheatCan('nas') ? { onNas: openNasCheck } : {}),
    ...(cheatCan('skip') ? { onSkip: () => setCheatsOpen('skip') } : {}),
    // Trade needs a selected card; without one the panel opens and says so.
    ...(cheatStatusList.some((status) => status.kind === 'trade') ? { onTrade: () => { if (cheatCan('trade')) void handleCheatTrade(); else setCheatsOpen('panel'); } } : {})
  });
  const settingsLockedByActiveGame = (mode === 'solitaire' && solitaireActive) || (mode === 'multiplayer' && multiplayerGameActive);
  const canChangeMode = (mode === 'solitaire' && !solitaireActive) || (mode === 'multiplayer' && !multiplayerState);
  const createSettingsError = validateCreateSettings(multiplayerCreateSettings);
  const settingsDraftError = validateCreateSettings(mode === 'solitaire'
    ? {
      ...settingsDraft,
      minPlayers: 1,
      maxPlayers: 1,
      minCardsPerTurn: 2,
      autoRefillHand: true,
      allowUndo: false,
      privateGame: false
    }
    : settingsDraft);
  const hostCanEditLiveSettings = !!multiplayerState && multiplayerState.hostId === playerId && multiplayerState.gamePhase === 'lobby';
  const settingsEditable = !settingsLockedByActiveGame && (
    mode !== 'multiplayer' || (!multiplayerState || hostCanEditLiveSettings)
  );
  const isBoardMode = (mode === 'solitaire' && solitaireActive) || (mode === 'multiplayer' && multiplayerGameActive);
  const isHostInLobby = !!multiplayerState && multiplayerState.gamePhase === 'lobby' && multiplayerState.hostId === playerId;
  const amInMultiplayerGame = !!multiplayerState && !!playerId && multiplayerState.players.some((player) => player.id === playerId);

  const showSupportBar = mode === null
    || (mode === 'solitaire' && (!solitaireActive || solitaireState.gamePhase === 'won' || solitaireState.gamePhase === 'lost'))
    || (mode === 'multiplayer' && !!multiplayerState && (multiplayerState.gamePhase === 'won' || multiplayerState.gamePhase === 'lost' || multiplayerState.gamePhase === 'lobby'));

  const multiplayerEnded = mode === 'multiplayer'
    && !!multiplayerState
    && (multiplayerState.gamePhase === 'won' || multiplayerState.gamePhase === 'lost');
  const solitaireEnded = mode === 'solitaire'
    && solitaireActive
    && (solitaireState.gamePhase === 'won' || solitaireState.gamePhase === 'lost');
  const activeStatsModalKey = multiplayerEnded && multiplayerState
    ? `multiplayer:${multiplayerState.gameId}:${multiplayerState.gamePhase}`
    : solitaireEnded
      ? `solitaire:${solitaireState.gameId}:${solitaireState.gamePhase}`
      : null;
  const activeStatsSummary = multiplayerEnded
    ? multiplayerState?.statistics ?? null
    : solitaireEnded
      ? solitaireState.statistics
      : null;
  const activeStatsState = multiplayerEnded && multiplayerState ? multiplayerState : solitaireEnded ? solitaireState : null;
  const statsModalOpen = !!activeStatsModalKey
    && !!activeStatsSummary
    && !!activeStatsState
    && dismissedStatsModalKey !== activeStatsModalKey;

  useEffect(() => {
    if (!activeStatsModalKey) {
      setDismissedStatsModalKey(null);
    }
  }, [activeStatsModalKey]);

  return (
    <main className={`app ${isBoardMode ? 'board-mode' : ''} ${showSupportBar ? 'support-mode' : ''} ${mode === null ? 'landing-mode' : ''}`}>
      <section className="app-header">
        <h1 onDoubleClick={() => { if (cheatStatusList.length > 0) setCheatsOpen('panel'); }}><span className="word-up">Up</span>N<span className="word-down">Down</span></h1>
        <div className="header-actions">
          <ProfileMenu auth={auth} currentName={playerName} locked={mode === 'solitaire' || multiplayerState !== null} onOpenProfile={() => setProfileOpen(true)} movedNote={localHistory.movedAtMs() !== null} />
          {mode === null ? (
            <a
              className="secondary link-button"
              href="/how-to-play.html"
              target="_blank"
              rel="noreferrer"
              data-testid="how-to-play-link"
            >
              How to Play
            </a>
          ) : null}
          {(solitaireEnded || multiplayerEnded) && !statsModalOpen ? (
            <button type="button" className="secondary" onClick={() => setDismissedStatsModalKey(null)} data-testid="show-results">
              Results
            </button>
          ) : null}
          {mode === 'solitaire' && solitaireActive && !solitaireEnded ? (
            <button
              type="button"
              className="danger"
              onClick={handleSolitaireEndGame}
              data-testid="end-game-top"
            >
              End Game
            </button>
          ) : null}
          {mode === 'multiplayer' && multiplayerGameActive && !multiplayerEnded ? (
            <button
              type="button"
              className="danger"
              onClick={() => { void handleMultiplayerEndGame(); }}
              disabled={multiplayerInteractionDisabled || !isHost}
              data-testid="end-game-top"
              title={!isHost ? 'Only the game host can end the game' : undefined}
            >
              End Game
            </button>
          ) : null}
          {mode ? (
            canChangeMode ? (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  resetToLanding();
                }}
              >
                {mode === 'solitaire' ? 'Change to Multiplayer' : 'Change to Solitaire'}
              </button>
            ) : null
          ) : null}
          {mode ? (
            <>
              <button
                type="button"
                className={settingsEditable ? 'secondary' : 'secondary settings-frozen'}
                onClick={handleOpenSettings}
                disabled={mode === 'multiplayer' && connectionState === 'connecting'}
                data-testid="open-settings"
                aria-describedby={settingsEditable ? undefined : 'settings-frozen-hint'}
              >
                Settings
              </button>
              {settingsEditable ? null : <span id="settings-frozen-hint" className="sr-only">Settings are view only right now</span>}
            </>
          ) : null}
        </div>
        <StorageNotice storage={auth.storage} />
      </section>

      <NamePrompt
        auth={auth}
        suppress={mode === 'solitaire' || multiplayerState !== null}
        editing={editingName}
        onClose={() => setEditingName(false)}
        onConfirmed={(name) => { setPlayerName(name); confirmName(); }}
      />

      <p className="sr-only" role="status" aria-live="polite">
        {pendingAction ? `Action in progress: ${pendingAction}` : 'Ready'}
      </p>

      {mode === null ? (
        <Landing
          auth={auth}
          firstVisit={firstVisit}
          onSolitaire={() => {
            setMode('solitaire');
            setMultiplayerFlow('choose');
            setShowJoinById(false);
            setError(null);
          }}
          solitaireSaves={solitaireSave.saves}
          rejoinSeats={savedSeat.offers}
          onRejoin={(seatKey) => { void handleRejoinSavedSeat(seatKey); }}
          onResumeSolitaire={(runId) => { void handleSolitaireResume(runId); }}
          onDiscardSolitaire={(runId) => solitaireSave.discard(runId)}
          onMultiplayer={() => {
            setMode('multiplayer');
            setMultiplayerFlow('choose');
            setShowJoinById(false);
            setError(null);
          }}
        />
      ) : null}

      {mode === 'multiplayer' && connectionState !== 'connected' ? (
        <section className="panel connection-banner" aria-live="polite">
          <strong>{connectionState === 'connecting' ? 'Connecting to server...' : 'Disconnected from server.'}</strong>
          <button
            type="button"
            className="secondary"
            onClick={handleRetryConnection}
            disabled={connectionState === 'connecting'}
          >
            Retry Connection
          </button>
        </section>
      ) : null}

      {showSupportBar ? (
        <section className="landing-support-bar" aria-label="support">
          <div className="landing-support-inner">
            <p>If you like the game, buy me a cup of coffee.</p>
            <a href="https://www.buymeacoffee.com/goldenchimp" target="_blank" rel="noreferrer">
              <img
                src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
                alt="Buy Me A Coffee"
                className="coffee-button-image"
              />
            </a>
          </div>
        </section>
      ) : null}

      {mode === 'solitaire' ? (
        solitaireActive ? (
        <GameBoard
          mode="solitaire"
          showArrows={prefs.showArrows}
          gameState={solitaireState}
          selectedCardId={solitaireSelectedCardId}
          setSelectedCardId={setSolitaireSelectedCardId}
          onPlayPile={handleSolitairePlayCard}
          specialPlayPileId={solitaireSpecialPlayPileId}
          specialPlayLifeline={solitaireSpecialPlayLifeline}
          onUndo={solitaireUndoStack.length > 0 ? handleSolitaireUndo : undefined}
          canUndo={solitaireUndoStack.length > 0}
          {...(cheatStatusList.length > 0 ? { onOpenCheats: () => setCheatsOpen('panel') } : {})}
          hintCardId={hint?.cardId}
          hintPileId={hint?.pileId}
        />
        ) : (
          <SolitaireSetup settings={solitaireConfig} onStart={handleSolitaireNewGame} onChangeSettings={handleOpenSettings} />
        )
      ) : mode === 'multiplayer' ? (
        <>
          {!multiplayerState ? (
            <JoinPanel
              rejoinSeats={savedSeat.offers}
              onRejoin={(seatKey) => { void handleRejoinSavedSeat(seatKey); }}
              playerName={playerName}
              setPlayerName={setPlayerName}
              confirmName={confirmName}
              multiplayerInteractionDisabled={multiplayerInteractionDisabled}
              multiplayerFlow={multiplayerFlow}
              setMultiplayerFlow={setMultiplayerFlow}
              pendingAction={pendingAction}
              createSettingsError={createSettingsError}
              handleCreateGame={handleCreateGame}
              setShowJoinById={setShowJoinById}
              setJoinLookup={setJoinLookup}
              setError={setError}
              refreshJoinableGames={refreshJoinableGames}
              loadingJoinableGames={loadingJoinableGames}
              joinableGames={joinableGames}
              handleJoinGame={handleJoinGame}
              showJoinById={showJoinById}
              joinGameId={joinGameId}
              setJoinGameId={setJoinGameId}
              handleLookupGame={handleLookupGame}
              joinLookup={joinLookup}
            />
          ) : multiplayerState.gamePhase === 'lobby' ? (
            <WaitingRoom
              multiplayerState={multiplayerState}
              playerId={playerId}
              isHostInLobby={isHostInLobby}
              multiplayerInteractionDisabled={multiplayerInteractionDisabled}
              pendingAction={pendingAction}
              inviteCopied={inviteCopied}
              handleCopyInviteLink={handleCopyInviteLink}
              handleRemoveRobot={handleRemoveRobot}
              handleKickPlayer={handleKickPlayer}
              handleStartGame={handleStartGame}
              handleAddRobot={handleAddRobot}
              handleLeaveMultiplayer={handleLeaveMultiplayer}
            />
          ) : (
            amInMultiplayerGame ? (
              <GameBoard
                mode="multiplayer"
                showArrows={prefs.showArrows}
                gameState={multiplayerState}
                selectedCardId={multiplayerSelectedCardId}
                setSelectedCardId={setMultiplayerSelectedCardId}
                onPlayPile={(pileId) => {
                  void handleMultiplayerPlayCard(pileId);
                }}
                onEndTurn={() => {
                  void handleMultiplayerEndTurn();
                }}
                playerId={playerId}
                interactionDisabled={multiplayerInteractionDisabled}
                onSetReaction={sendSetReaction}
                gameReactions={gameReactions}
                specialPlayPileId={specialPlayPileId}
                specialPlayLifeline={specialPlayLifeline}
                onUndo={multiplayerState?.cardsPlayedThisTurn && multiplayerState.cardsPlayedThisTurn > 0
                  ? () => { void handleMultiplayerUndo(); }
                  : undefined}
                canUndo={(multiplayerState?.cardsPlayedThisTurn ?? 0) > 0}
                onKickPlayer={isHost ? (targetId: string) => { void handleKickPlayer(targetId); } : undefined}
                onTakeOverHost={(hostId: string) => { void handleKickPlayer(hostId); }}
                isHost={!!isHost}
                {...(cheatStatusList.length > 0 ? { onOpenCheats: () => setCheatsOpen('panel') } : {})}
                {...(isHost && multiplayerState?.gamePhase === 'playing' ? { onInvite: () => { void handleCreateInvite(); } } : {})}
                hintCardId={hint?.cardId}
                hintPileId={hint?.pileId}
              />
            ) : (
              <section className="panel lobby" aria-label="seat lost">
                <h2>Session No Longer Attached</h2>
                <p>Your current connection is not mapped to a player seat in this game.</p>
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setMultiplayerState(null);
                      setPendingLobbyState(null);
                      setMultiplayerSelectedCardId(null);
                      setJoinGameId('');
                    }}
                  >
                    Return to Lobby
                  </button>
                </div>
              </section>
            )
          )}
        </>
      ) : null}

      {error ? (
        <div className="error" role="alert" aria-live="assertive" data-testid="error-banner">
          {error}
        </div>
      ) : null}

      {mode === 'multiplayer' ? (
        <div
          className={`socket-indicator ${connectionState}`}
          role="img"
          aria-label={`Connection ${connectionState}`}
          title={`Server connection: ${connectionState}`}
        />
      ) : null}

      <ProfileLayer auth={auth} history={localHistory} open={profileOpen} seen={seenBadges.seen} markSeen={seenBadges.markSeen} onClose={() => setProfileOpen(false)} onChangeName={mode === 'solitaire' || multiplayerState !== null ? undefined : () => setEditingName(true)} />
      <BadgeToasts toasts={badgeToasts.toasts} onDismiss={badgeToasts.dismiss} />
      <MoveHistoryDialog auth={auth} history={localHistory} source={profileSource} markSeen={seenBadges.markSeen} />

      {(mode || isSettingsOpen) ? (
        <SettingsDialog
          mode={mode ?? 'multiplayer'}
          open={isSettingsOpen}
          settings={settingsDraft}
          editable={settingsEditable}
          validationError={settingsDraftError}
          saveError={settingsSaveError}
          onClose={() => { setSettingsSaveError(null); setIsSettingsOpen(false); }}
          onSave={() => { void handleSaveSettings(); }}
          onChange={(next) => { setSettingsSaveError(null); setSettingsDraft(next); }}
          enableSounds={enableSounds}
          onToggleSounds={changeSounds}
          showArrows={prefs.showArrows}
          onToggleArrows={prefs.changeShowArrows}
          autoMark={prefs.autoMark}
          onToggleAutoMark={prefs.changeAutoMark}
        />
      ) : null}

      {showEndGameConfirm ? (
        <EndGameConfirmModal pending={pendingAction === 'endgame'} onConfirm={() => { void executeEndGame(); }} onCancel={() => setShowEndGameConfirm(false)} />
      ) : null}

      {hostEndedModalGameId ? (
        <HostEndedModal gameId={hostEndedModalGameId} pending={pendingAction === 'leave'} onAcknowledge={() => { void handleAcknowledgeHostEnded(); }} />
      ) : null}

      {pendingLobbyState ? (
        <BackToLobbyModal pending={pendingAction === 'leave'} onBack={() => { setMultiplayerState(pendingLobbyState); setPendingLobbyState(null); setMultiplayerSelectedCardId(null); }} onLeave={() => { setPendingLobbyState(null); void handleLeaveMultiplayer(); }} />
      ) : null}

      {montyCells ? <FullMontyModal cells={montyCells} onClose={() => setMontyCells(null)} /> : null}
      {cardLookupOpen ? (
        <CardLookupModal value={cardLookupValue} onChange={setCardLookupValue} onSubmit={handleCardLookupSubmit} onClose={() => setCardLookupOpen(false)} />
      ) : null}

      {joinWaiting ? <p className="join-waiting" aria-live="polite" data-testid="join-waiting">Asking the host to let you in. This page will open the game when they say yes.</p> : null}

      {joinRequests[0] && multiplayerState && multiplayerState.hostId === playerId ? (
        <JoinRequestModal playerName={joinRequests[0].playerName} busy={pendingAction !== null} onAnswer={(approve) => { void handleAnswerJoin(approve); }} />
      ) : null}

      {lateInvite ? <InviteModal link={lateInvite.link} expiresAtMs={lateInvite.expiresAtMs} onClose={() => setLateInvite(null)} /> : null}

      {seatChoices.length > 1 ? (
        <SeatChoice
          gameIds={seatChoices}
          onClose={() => setSeatChoices([])}
          onChoose={(gameId) => { setSeatChoices([]); rejoinMine(gameId); }}
        />
      ) : null}

      {cheatsOpen ? (
        <CheatsPanel
          statuses={cheatStatusList}
          startWithSkipConfirm={cheatsOpen === 'skip'}
          busy={pendingAction !== null}
          onClose={() => setCheatsOpen(false)}
          onLookup={openLookup}
          onNas={openNasCheck}
          onMonty={() => { void handleCheatMonty(); }}
          onHint={() => { void handleCheatHint(); }}
          onSkip={() => { void handleCheatSkip(); }}
          onTrade={() => { void handleCheatTrade(); }}
        />
      ) : null}

      {/* Always present, so a screen reader announces a notice when its text appears. Plain div: the end-to-end specs select role=status strictly. */}
      <div className="cheat-notice" aria-live="polite">{cheatNotice}</div>
      <div className="hint-banner" aria-live="polite" data-testid="hint-banner">{hint?.text ?? ''}</div>

      {cardLookupToast ? (
        <div className="card-lookup-toast" role="status" aria-live="polite">
          {cardLookupToast.playerName ? `${cardLookupToast.playerName} checked — ` : ''}
          <strong>{cardLookupToast.cardValue}</strong>:{' '}
          {cardLookupToast.status === 'in-draw' && '📦 In Draw Pile'}
          {cardLookupToast.status === 'in-hand' && `🤚 In Hand (${cardLookupToast.holderName ?? '?'})`}
          {cardLookupToast.status === 'played' && '✓ Played'}
          {cardLookupToast.status === 'out-of-range' && `Not one of this game's cards (${(mode === 'multiplayer' ? multiplayerState?.settings : solitaireState.settings)?.minCardValue ?? '?'} to ${(mode === 'multiplayer' ? multiplayerState?.settings : solitaireState.settings)?.maxCardValue ?? '?'})`}
        </div>
      ) : null}

      {kickedFromGameId ? (
        <KickedModal gameId={kickedFromGameId} whileAway={kickedWhileAway} onBackHome={() => { setKickedFromGameId(null); setKickedWhileAway(false); resetToLanding(); }} />
      ) : null}

      {statsModalOpen && activeStatsSummary && activeStatsState ? (
        <EndGameStatisticsModal
          mode={mode ?? 'multiplayer'}
          gameState={activeStatsState}
          statistics={activeStatsSummary}
          isHost={!!isHost}
          onClose={() => setDismissedStatsModalKey(activeStatsModalKey)}
          saveStatus={mode === 'solitaire' ? solitaireResult.status : 'idle'}
          onRetrySave={solitaireResult.retry}
          {...(mode === 'solitaire' ? { onChangeSettings: () => { handleSolitaireEndGame(); handleOpenSettings(); } } : {})}
          onPlayAgain={() => {
            if (mode === 'solitaire') {
              handleSolitaireNewGame();
              return;
            }
            if (mode === 'multiplayer') {
              void handleMultiplayerPlayAgain();
            }
          }}
          onBackToLobby={() => {
            if (mode === 'solitaire') {
              handleSolitaireEndGame();
              setMode(null);
              return;
            }
            if (mode === 'multiplayer') {
              void handleMultiplayerEndGame();
            }
          }}
        />
      ) : null}
    </main>
  );
}
