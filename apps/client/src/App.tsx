import { buildDeck, createStartedGameState, isValidPlay, playCard as playCardEngine, requiredCardsForTurn } from '@upndown/engine';
import { gameSettingsSchema, type Card, type GameSettings, type GameState } from '@upndown/shared-types';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import './App.css';

const SOLO_PLAYER_ID = 'solo-player';

type Mode = 'solitaire' | 'multiplayer';
type ConnectionState = 'disconnected' | 'connecting' | 'connected';
type PendingAction = 'create' | 'join' | 'lookup' | 'start' | 'play' | 'endturn' | 'endgame' | 'leave' | 'updatesettings' | null;

type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

interface JoinableGameSummary {
  gameId: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  createdAtMs: number;
}

interface JoinLookupSummary {
  gameId: string;
  playerCount: number;
  maxPlayers: number;
  privateGame: boolean;
}

const solitaireSettings: GameSettings = {
  minCardValue: 2,
  maxCardValue: 99,
  handSize: 7,
  minPlayers: 1,
  maxPlayers: 1,
  minCardsPerTurn: 2,
  autoRefillHand: true,
  allowUndo: false,
  privateGame: false
};

const multiplayerSettings: GameSettings = {
  minCardValue: 2,
  maxCardValue: 99,
  handSize: 7,
  minPlayers: 2,
  maxPlayers: 6,
  minCardsPerTurn: 2,
  autoRefillHand: false,
  allowUndo: false,
  privateGame: false
};

const SETTINGS_STORAGE_KEY = 'upndown.settings.v1';

interface PersistedSettings {
  solitaire: GameSettings;
  multiplayer: GameSettings;
}

function normalizeSolitaireSettings(settings: GameSettings): GameSettings {
  return {
    ...settings,
    minPlayers: 1,
    maxPlayers: 1,
    minCardsPerTurn: 2,
    autoRefillHand: true,
    allowUndo: false,
    privateGame: false
  };
}

function normalizeMultiplayerSettings(settings: GameSettings): GameSettings {
  return {
    ...settings,
    minPlayers: Math.max(2, settings.minPlayers),
    maxPlayers: Math.max(2, settings.maxPlayers)
  };
}

function readPersistedSettings(): PersistedSettings | null {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    const solitaireResult = gameSettingsSchema.safeParse(parsed.solitaire);
    const multiplayerResult = gameSettingsSchema.safeParse(parsed.multiplayer);
    if (!solitaireResult.success || !multiplayerResult.success) {
      return null;
    }

    return {
      solitaire: normalizeSolitaireSettings(solitaireResult.data),
      multiplayer: normalizeMultiplayerSettings(multiplayerResult.data)
    };
  } catch {
    return null;
  }
}

function writePersistedSettings(settings: PersistedSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage write failures (private mode/quota/etc).
  }
}

function shuffle<T>(input: T[]): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j] as T;
    out[j] = tmp as T;
  }
  return out;
}

function newSolitaireGame(settings: GameSettings): GameState {
  const deck = shuffle(buildDeck(settings));
  return createStartedGameState({
    gameId: 'SOLITAIRE',
    hostId: SOLO_PLAYER_ID,
    players: [{ id: SOLO_PLAYER_ID, name: 'You' }],
    settings,
    isSolitaire: true,
    deck
  });
}

function sortByValue(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => a.value - b.value);
}

function phaseLabel(phase: GameState['gamePhase']): string {
  if (phase === 'won') return 'Won';
  if (phase === 'lost') return 'Lost';
  if (phase === 'playing') return 'Playing';
  return 'Lobby';
}

function canPlayOnPile(selectedCard: Card | null, pileTop: Card, pileType: 'ascending' | 'descending'): boolean {
  if (!selectedCard) {
    return false;
  }
  return isValidPlay(selectedCard, {
    id: -1,
    type: pileType,
    topCard: pileTop
  });
}

interface GameBoardProps {
  mode: Mode;
  gameState: GameState;
  selectedCardId: string | null;
  setSelectedCardId: (cardId: string | null) => void;
  onPlayPile: (pileId: number) => void;
  onEndTurn?: () => void;
  playerId?: string | null;
  interactionDisabled?: boolean;
  newCardIds?: string[];
}

export function GameBoard(props: GameBoardProps): JSX.Element {
  const {
    mode,
    gameState,
    selectedCardId,
    setSelectedCardId,
    onPlayPile,
    onEndTurn,
    playerId,
    interactionDisabled,
    newCardIds = []
  } = props;

  const me = mode === 'solitaire'
    ? gameState.players[0]
    : gameState.players.find((player) => player.id === playerId);

  if (!me) {
    return <section className="panel">Waiting for player state...</section>;
  }

  const sortedHand = sortByValue(me.hand);
  const selectedCard = sortedHand.find((card) => card.id === selectedCardId) ?? null;
  const isCompactHand = sortedHand.length >= 8;
  const activePlayer = gameState.players[gameState.currentPlayerIndex];
  const isMyTurn = mode === 'solitaire' ? true : activePlayer?.id === playerId;
  const inputsDisabled = !!interactionDisabled || (mode === 'multiplayer' && !isMyTurn) || gameState.gamePhase !== 'playing';
  const requiredPlaysThisTurn = requiredCardsForTurn(gameState.settings.minCardsPerTurn, gameState.drawPile.length);
  const canEndTurn = mode === 'multiplayer'
    && gameState.gamePhase === 'playing'
    && isMyTurn
    && gameState.cardsPlayedThisTurn >= requiredPlaysThisTurn;
  const [dismissedPhaseSplash, setDismissedPhaseSplash] = useState(false);

  useEffect(() => {
    if (gameState.gamePhase === 'playing' || gameState.gamePhase === 'lobby') {
      setDismissedPhaseSplash(false);
      return;
    }

    setDismissedPhaseSplash(false);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setDismissedPhaseSplash(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gameState.gamePhase]);

  return (
    <div className={`gameboard ${mode === 'multiplayer' ? 'gameboard-multi' : 'gameboard-solo'}`}>
      {(gameState.gamePhase === 'won' || gameState.gamePhase === 'lost') && !dismissedPhaseSplash ? (
        <section className={`phase-splash ${gameState.gamePhase}`} data-testid="phase-splash" aria-live="assertive">
          <div className="phase-splash-label">{gameState.gamePhase === 'won' ? 'Victory' : 'Defeat'}</div>
          <div className="phase-splash-title">{gameState.gamePhase === 'won' ? 'Game Won' : 'Game Lost'}</div>
          <div className="phase-splash-subtitle">
            {gameState.gamePhase === 'won' ? 'All cards cleared.' : 'No legal moves remain.'}
          </div>
        </section>
      ) : null}

      <section className="panel foundation-panel" aria-label="foundation piles">
        <div className="foundation-header">
          <h2>Foundation Piles</h2>
          <div className="pill mini">Draw: {gameState.drawPile.length}</div>
        </div>
        <div className="pile-grid">
          {gameState.foundationPiles.map((pile) => {
            const highlighted = canPlayOnPile(selectedCard, pile.topCard, pile.type);
            return (
              <button
                key={pile.id}
                type="button"
                className={`pile ${pile.type === 'ascending' ? 'asc' : 'desc'} ${highlighted ? 'highlight' : ''}`}
                onClick={() => onPlayPile(pile.id)}
                data-testid={`pile-${pile.id}`}
                disabled={inputsDisabled}
                aria-label={`Foundation ${pile.type} with top card ${pile.topCard.value}`}
              >
                <span className="pile-tag">{pile.type === 'ascending' ? 'Ascending' : 'Descending'}</span>
                <span className="top-card" data-testid={`pile-top-${pile.id}`}>{pile.topCard.value}</span>
                <span className="pile-hint">
                  {pile.type === 'ascending'
                    ? `>${pile.topCard.value} or ${pile.topCard.value - 10}`
                    : `<${pile.topCard.value} or ${pile.topCard.value + 10}`}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {mode === 'multiplayer' ? (
        <section className="panel players-panel" aria-label="players list">
          <h2>Players</h2>
          <div className="players-list">
            {gameState.players.map((player, index) => (
              <div
                key={player.id}
                className={`player-line ${index === gameState.currentPlayerIndex ? 'active' : ''}`}
                aria-current={index === gameState.currentPlayerIndex ? 'true' : undefined}
              >
                <span>{index + 1}. {player.name}{player.id === playerId ? ' (You)' : ''}{player.isHost ? ' [Host]' : ''}</span>
                <span>{player.hand.length} cards</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel hand-panel" aria-label="your hand">
        <div className="hand-header">
          <h2>Your Hand</h2>
          <div className="button-row">
            {onEndTurn ? (
              <button
                type="button"
                className="primary"
                onClick={onEndTurn}
                disabled={inputsDisabled || !canEndTurn}
                data-testid="end-turn"
              >
                End Turn
              </button>
            ) : null}
          </div>
        </div>
        {gameState.gamePhase !== 'playing' ? (
          <div className={`phase-banner ${gameState.gamePhase}`} data-testid="phase-banner">
            {gameState.gamePhase === 'won' ? 'Game Won' : gameState.gamePhase === 'lost' ? 'Game Lost' : phaseLabel(gameState.gamePhase)}
          </div>
        ) : null}

        <div className={`cards-fan ${isCompactHand ? 'compact' : ''}`}>
          {sortedHand.map((card) => (
            <button
              key={card.id}
              type="button"
              className={`card ${selectedCardId === card.id ? 'selected' : ''} ${newCardIds.includes(card.id) ? 'new-dealt' : ''}`}
              onClick={() => {
                if (inputsDisabled) return;
                setSelectedCardId(card.id);
              }}
              data-testid={`hand-card-${card.id}`}
              aria-label={`Card ${card.value}`}
              disabled={inputsDisabled}
            >
              {card.value}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function validateCreateSettings(settings: GameSettings): string | null {
  if (settings.maxPlayers < settings.minPlayers) {
    return 'Max players must be greater than or equal to min players';
  }
  const deckSize = settings.maxCardValue - settings.minCardValue + 1;
  if (deckSize < 18) {
    return 'Deck must contain at least 18 cards';
  }
  return null;
}

const settingsHelp: Record<'minCardValue' | 'maxCardValue' | 'handSize' | 'minCardsPerTurn' | 'minPlayers' | 'maxPlayers' | 'autoRefillHand' | 'privateGame', string> = {
  minCardValue: 'Minimum card value included in the deck. Increasing this reduces deck size, which generally makes the game easier.',
  maxCardValue: 'Maximum card value included in the deck. Increasing this increases deck size, which generally makes the game harder.',
  handSize: 'How many cards each player holds. Increasing hand size generally makes the game easier.',
  minCardsPerTurn: 'Minimum cards required per turn (except draw pile empty forces 1). Increasing this generally makes the game harder.',
  minPlayers: 'Minimum players required to start. Increasing this typically makes coordination harder.',
  maxPlayers: 'Maximum players allowed to join. Increasing this can make the game harder due to coordination.',
  autoRefillHand: 'When ON, cards are drawn immediately after each play. This generally makes the game easier.',
  privateGame: 'Private games do not appear in the public join list. You must share the game ID directly.'
};

interface SettingsDialogProps {
  mode: Mode;
  open: boolean;
  settings: GameSettings;
  editable: boolean;
  validationError: string | null;
  onClose: () => void;
  onSave?: () => void;
  onChange: (settings: GameSettings) => void;
}

function SettingsDialog({
  mode,
  open,
  settings,
  editable,
  validationError,
  onClose,
  onSave,
  onChange
}: SettingsDialogProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  const isSolitaire = mode === 'solitaire';
  const fieldEditable = (applicableInSolitaire: boolean): boolean => {
    if (!editable) return false;
    if (isSolitaire && !applicableInSolitaire) return false;
    return true;
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="panel settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="game settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>Game Settings</h2>
          <div className="pill">{editable ? 'Edit Mode (Host)' : 'View Only'}</div>
        </div>
        <div className="settings-grid">
          <label htmlFor="settings-min-card" className={!fieldEditable(true) ? 'field-disabled' : ''}>
            Min Card Value
            <span className="info-dot" title={settingsHelp.minCardValue} aria-label={settingsHelp.minCardValue}>i</span>
            <input
              id="settings-min-card"
              type="number"
              min={2}
              max={99}
              value={settings.minCardValue}
              onChange={(e) => {
                const value = clampInt(e.target.value, 2, 99, settings.minCardValue);
                onChange({ ...settings, minCardValue: value });
              }}
              disabled={!fieldEditable(true)}
            />
          </label>
          <label htmlFor="settings-max-card" className={!fieldEditable(true) ? 'field-disabled' : ''}>
            Max Card Value
            <span className="info-dot" title={settingsHelp.maxCardValue} aria-label={settingsHelp.maxCardValue}>i</span>
            <input
              id="settings-max-card"
              type="number"
              min={2}
              max={99}
              value={settings.maxCardValue}
              onChange={(e) => {
                const value = clampInt(e.target.value, 2, 99, settings.maxCardValue);
                onChange({ ...settings, maxCardValue: value });
              }}
              disabled={!fieldEditable(true)}
            />
          </label>
          <label htmlFor="settings-hand-size" className={!fieldEditable(true) ? 'field-disabled' : ''}>
            Hand Size
            <span className="info-dot" title={settingsHelp.handSize} aria-label={settingsHelp.handSize}>i</span>
            <input
              id="settings-hand-size"
              type="number"
              min={5}
              max={9}
              value={settings.handSize}
              onChange={(e) => {
                const value = clampInt(e.target.value, 5, 9, settings.handSize);
                onChange({ ...settings, handSize: value });
              }}
              disabled={!fieldEditable(true)}
            />
          </label>
          <label htmlFor="settings-min-cards-turn" className={!fieldEditable(false) ? 'field-disabled' : ''}>
            Min Cards Per Turn
            <span
              className="info-dot"
              title={`${settingsHelp.minCardsPerTurn}${isSolitaire ? ' Not applicable in Solitaire.' : ''}`}
              aria-label={`${settingsHelp.minCardsPerTurn}${isSolitaire ? ' Not applicable in Solitaire.' : ''}`}
            >i</span>
            <input
              id="settings-min-cards-turn"
              type="number"
              min={1}
              max={3}
              value={settings.minCardsPerTurn}
              onChange={(e) => {
                const value = clampInt(e.target.value, 1, 3, settings.minCardsPerTurn);
                onChange({ ...settings, minCardsPerTurn: value });
              }}
              disabled={!fieldEditable(false)}
            />
          </label>
          <label htmlFor="settings-min-players" className={!fieldEditable(false) ? 'field-disabled' : ''}>
            Min Players
            <span
              className="info-dot"
              title={`${settingsHelp.minPlayers}${isSolitaire ? ' Not applicable in Solitaire.' : ''}`}
              aria-label={`${settingsHelp.minPlayers}${isSolitaire ? ' Not applicable in Solitaire.' : ''}`}
            >i</span>
            <input
              id="settings-min-players"
              type="number"
              min={2}
              max={6}
              value={settings.minPlayers}
              onChange={(e) => {
                const value = clampInt(e.target.value, 2, 6, settings.minPlayers);
                onChange({ ...settings, minPlayers: value });
              }}
              disabled={!fieldEditable(false)}
            />
          </label>
          <label htmlFor="settings-max-players" className={!fieldEditable(false) ? 'field-disabled' : ''}>
            Max Players
            <span
              className="info-dot"
              title={`${settingsHelp.maxPlayers}${isSolitaire ? ' Not applicable in Solitaire.' : ''}`}
              aria-label={`${settingsHelp.maxPlayers}${isSolitaire ? ' Not applicable in Solitaire.' : ''}`}
            >i</span>
            <input
              id="settings-max-players"
              type="number"
              min={2}
              max={6}
              value={settings.maxPlayers}
              onChange={(e) => {
                const value = clampInt(e.target.value, 2, 6, settings.maxPlayers);
                onChange({ ...settings, maxPlayers: value });
              }}
              disabled={!fieldEditable(false)}
            />
          </label>
          <label htmlFor="settings-auto-refill" className={`checkbox-label ${!fieldEditable(false) ? 'field-disabled' : ''}`}>
            <input
              id="settings-auto-refill"
              type="checkbox"
              checked={settings.autoRefillHand}
              onChange={(e) => onChange({ ...settings, autoRefillHand: e.target.checked })}
              disabled={!fieldEditable(false)}
            />
            Auto refill hand
            <span
              className="info-dot"
              title={`${settingsHelp.autoRefillHand}${isSolitaire ? ' Not applicable in Solitaire (always on).' : ''}`}
              aria-label={`${settingsHelp.autoRefillHand}${isSolitaire ? ' Not applicable in Solitaire (always on).' : ''}`}
            >i</span>
          </label>
          <label htmlFor="settings-private-game" className={`checkbox-label ${!fieldEditable(false) ? 'field-disabled' : ''}`}>
            <input
              id="settings-private-game"
              type="checkbox"
              checked={settings.privateGame}
              onChange={(e) => onChange({ ...settings, privateGame: e.target.checked })}
              disabled={!fieldEditable(false)}
            />
            Private game
            <span
              className="info-dot"
              title={`${settingsHelp.privateGame}${isSolitaire ? ' Not applicable in Solitaire.' : ''}`}
              aria-label={`${settingsHelp.privateGame}${isSolitaire ? ' Not applicable in Solitaire.' : ''}`}
            >i</span>
          </label>
        </div>
        {validationError ? <div className="error">{validationError}</div> : null}
        {!editable ? <div className="pill">Only the game master can edit settings.</div> : null}
        {isSolitaire ? <div className="pill">In Solitaire, players and turn-min fields are informational only.</div> : null}
        <div className="button-row">
          <button type="button" className="secondary" onClick={onClose}>Close</button>
          {editable ? (
            <button type="button" className="primary" onClick={onSave} disabled={!!validationError}>
              Save Settings
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function App(): JSX.Element {
  const persisted = readPersistedSettings();
  const [mode, setMode] = useState<Mode | null>(null);
  const [solitaireConfig, setSolitaireConfig] = useState<GameSettings>(() => persisted?.solitaire ?? solitaireSettings);
  const [solitaireActive, setSolitaireActive] = useState(false);

  const [solitaireState, setSolitaireState] = useState<GameState>(() => newSolitaireGame(solitaireSettings));
  const [solitaireSelectedCardId, setSolitaireSelectedCardId] = useState<string | null>(null);

  const [multiplayerState, setMultiplayerState] = useState<GameState | null>(null);
  const [multiplayerSelectedCardId, setMultiplayerSelectedCardId] = useState<string | null>(null);
  const [multiplayerCreateSettings, setMultiplayerCreateSettings] = useState<GameSettings>(() => persisted?.multiplayer ?? multiplayerSettings);
  const [settingsDraft, setSettingsDraft] = useState<GameSettings>(() => persisted?.multiplayer ?? multiplayerSettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [solitaireNewCardIds, setSolitaireNewCardIds] = useState<string[]>([]);
  const [multiplayerNewCardIds, setMultiplayerNewCardIds] = useState<string[]>([]);
  const [playerName, setPlayerName] = useState('Player');
  const [joinGameId, setJoinGameId] = useState('');
  const [showJoinById, setShowJoinById] = useState(false);
  const [joinLookup, setJoinLookup] = useState<JoinLookupSummary | null>(null);
  const [multiplayerFlow, setMultiplayerFlow] = useState<'choose' | 'host' | 'join'>('choose');
  const [joinableGames, setJoinableGames] = useState<JoinableGameSummary[]>([]);
  const [loadingJoinableGames, setLoadingJoinableGames] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const lastSolitaireHandIdsRef = useRef<string[]>([]);
  const lastMultiplayerHandIdsRef = useRef<string[]>([]);

  const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

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
    if (mode !== 'multiplayer') {
      return;
    }

    const socket = getSocket();
    setConnectionState('connecting');

    const onConnect = (): void => {
      setConnectionState('connected');
      setPlayerId(socket.id ?? null);
    };

    const onDisconnect = (): void => {
      setConnectionState('disconnected');
    };

    const onConnectError = (): void => {
      setConnectionState('disconnected');
    };

    const onUpdated = (state: GameState): void => {
      setMultiplayerState(state);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('game:updated', onUpdated);

    if (!socket.connected) {
      socket.connect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('game:updated', onUpdated);
      socket.disconnect();
      setConnectionState('disconnected');
    };
  }, [mode]);

  useEffect(() => {
    const handIds = (solitaireState.players[0]?.hand ?? []).map((card) => card.id);
    const drawnIds = handIds.filter((id) => !lastSolitaireHandIdsRef.current.includes(id));
    setSolitaireNewCardIds((current) => (
      drawnIds.length > 0 ? drawnIds : current.filter((id) => handIds.includes(id))
    ));
    lastSolitaireHandIdsRef.current = handIds;
  }, [solitaireState]);

  useEffect(() => {
    if (!multiplayerState || !playerId) {
      lastMultiplayerHandIdsRef.current = [];
      setMultiplayerNewCardIds([]);
      return;
    }

    const me = multiplayerState.players.find((player) => player.id === playerId);
    if (!me) {
      lastMultiplayerHandIdsRef.current = [];
      setMultiplayerNewCardIds([]);
      return;
    }

    const handIds = me.hand.map((card) => card.id);
    const drawnIds = handIds.filter((id) => !lastMultiplayerHandIdsRef.current.includes(id));
    setMultiplayerNewCardIds((current) => (
      drawnIds.length > 0 ? drawnIds : current.filter((id) => handIds.includes(id))
    ));
    lastMultiplayerHandIdsRef.current = handIds;
  }, [multiplayerState, playerId]);

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

  useEffect(() => {
    if (mode !== 'multiplayer' || multiplayerState || connectionState !== 'connected' || multiplayerFlow !== 'join') {
      return;
    }

    void refreshJoinableGames();
    const timer = setInterval(() => {
      void refreshJoinableGames();
    }, 5000);

    return () => clearInterval(timer);
  }, [mode, multiplayerState, connectionState, multiplayerFlow]);

  useEffect(() => {
    setJoinLookup(null);
  }, [joinGameId]);

  const emitWithAck = async <T,>(
    event: string,
    payload: unknown,
    action: Exclude<PendingAction, null>
  ): Promise<Ack<T>> => {
    const socket = getSocket();
    setPendingAction(action);
    try {
      return await new Promise((resolve) => {
        socket.emit(event, payload, (ack: Ack<T>) => resolve(ack));
      });
    } finally {
      setPendingAction(null);
    }
  };

  const refreshJoinableGames = async (): Promise<void> => {
    if (mode !== 'multiplayer' || multiplayerState) {
      return;
    }

    setLoadingJoinableGames(true);
    try {
      const socket = getSocket();
      const ack = await new Promise<Ack<{ games: JoinableGameSummary[] }>>((resolve) => {
        socket.emit('game:listJoinable', {}, (response: Ack<{ games: JoinableGameSummary[] }>) => resolve(response));
      });
      if (!ack.ok) {
        setError(ack.error);
        return;
      }
      setJoinableGames(ack.data.games);
    } finally {
      setLoadingJoinableGames(false);
    }
  };

  const handleRetryConnection = (): void => {
    const socket = getSocket();
    if (!socket.connected) {
      setConnectionState('connecting');
      socket.connect();
    }
  };

  const handleSolitaireNewGame = (): void => {
    setSolitaireActive(true);
    setSolitaireState(newSolitaireGame(solitaireConfig));
    setSolitaireSelectedCardId(null);
    setSolitaireNewCardIds([]);
    setError(null);
  };

  const handleSolitaireEndGame = (): void => {
    setSolitaireActive(false);
    setSolitaireSelectedCardId(null);
    setSolitaireNewCardIds([]);
    setError(null);
  };

  const handleSolitairePlayCard = (pileId: number): void => {
    if (!solitaireSelectedCardId) return;

    try {
      const next = playCardEngine(solitaireState, SOLO_PLAYER_ID, solitaireSelectedCardId, pileId);
      setSolitaireState(next);
      setSolitaireSelectedCardId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to play card.');
    }
  };

  const handleCreateGame = async (): Promise<void> => {
    const trimmedName = playerName.trim();
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
    const ack = await emitWithAck<{ gameState: GameState; playerId: string }>(
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
    setMultiplayerState(ack.data.gameState);
    setMultiplayerSelectedCardId(null);
    setMultiplayerNewCardIds([]);
    lastMultiplayerHandIdsRef.current = [];
  };

  const handleJoinGame = async (forcedGameId?: string): Promise<void> => {
    const trimmedName = playerName.trim();
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
    const ack = await emitWithAck<{ gameState: GameState; playerId: string }>(
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
    setMultiplayerState(ack.data.gameState);
    setMultiplayerSelectedCardId(null);
    setMultiplayerNewCardIds([]);
    setShowJoinById(false);
    setJoinLookup(null);
    lastMultiplayerHandIdsRef.current = [];
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

  const handleMultiplayerEndGame = async (): Promise<void> => {
    if (!multiplayerState) {
      return;
    }

    const ack = await emitWithAck<{ gameState: GameState }>(
      'game:endGame',
      { gameId: multiplayerState.gameId },
      'endgame'
    );

    if (!ack.ok) {
      setError(ack.error);
      return;
    }

    setError(null);
    setMultiplayerSelectedCardId(null);
    setMultiplayerState(ack.data.gameState);
  };

  const handleLeaveMultiplayer = async (): Promise<void> => {
    if (!multiplayerState) {
      return;
    }

    await emitWithAck<{ gameState: GameState | null }>(
      'game:leave',
      { gameId: multiplayerState.gameId },
      'leave'
    );

    setMultiplayerState(null);
    setMultiplayerSelectedCardId(null);
    setMultiplayerNewCardIds([]);
    lastMultiplayerHandIdsRef.current = [];
    setJoinGameId('');
    setError(null);
  };

  const handleOpenSettings = (): void => {
    if (!mode) {
      return;
    }
    if (mode === 'solitaire') {
      setSettingsDraft(solitaireConfig);
    } else {
      setSettingsDraft(multiplayerState ? multiplayerState.settings : multiplayerCreateSettings);
    }
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
      setError('Only host can change settings');
      return;
    }

    const ack = await emitWithAck<{ gameState: GameState }>(
      'game:updateSettings',
      { gameId: multiplayerState.gameId, settings: normalizedSettings },
      'updatesettings'
    );

    if (!ack.ok) {
      setError(ack.error);
      return;
    }

    setMultiplayerState(ack.data.gameState);
    setIsSettingsOpen(false);
    setError(null);
  };

  const multiplayerInteractionDisabled = pendingAction !== null || connectionState !== 'connected';
  const multiplayerGameActive = !!multiplayerState && multiplayerState.gamePhase !== 'lobby';
  const isHost = !!multiplayerState && multiplayerState.hostId === playerId;
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
  const settingsEditable = !!mode && !settingsLockedByActiveGame && (
    mode === 'solitaire' || (mode === 'multiplayer' && (!multiplayerState || hostCanEditLiveSettings))
  );
  const isBoardMode = (mode === 'solitaire' && solitaireActive) || (mode === 'multiplayer' && multiplayerGameActive);
  const isHostInLobby = !!multiplayerState && multiplayerState.gamePhase === 'lobby' && multiplayerState.hostId === playerId;
  const amInMultiplayerGame = !!multiplayerState && !!playerId && multiplayerState.players.some((player) => player.id === playerId);
  const modeLocked = (mode === 'solitaire' && solitaireActive) || (mode === 'multiplayer' && !!multiplayerState);

  return (
    <main className={`app ${isBoardMode ? 'board-mode' : ''}`}>
      <section className="app-header">
        <h1>UpNDown</h1>
        <div className="header-actions">
          {mode === 'solitaire' && solitaireActive ? (
            <button
              type="button"
              className="danger"
              onClick={handleSolitaireEndGame}
              data-testid="end-game-top"
            >
              End Game
            </button>
          ) : null}
          {mode === 'multiplayer' && multiplayerGameActive ? (
            <button
              type="button"
              className={isHost ? 'danger' : 'secondary'}
              onClick={() => { void handleMultiplayerEndGame(); }}
              disabled={multiplayerInteractionDisabled || !isHost}
              data-testid="end-game-top"
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
                  setMode(null);
                  setMultiplayerFlow('choose');
                  setShowJoinById(false);
                  setJoinLookup(null);
                  setError(null);
                }}
              >
                Change Mode
              </button>
            ) : null
          ) : null}
          {mode ? (
            <button
              type="button"
              className="secondary"
              onClick={handleOpenSettings}
              disabled={(mode === 'multiplayer' && connectionState === 'connecting') || settingsLockedByActiveGame}
              data-testid="open-settings"
            >
              Settings
            </button>
          ) : null}
        </div>
      </section>

      <p className="sr-only" role="status" aria-live="polite">
        {pendingAction ? `Action in progress: ${pendingAction}` : 'Ready'}
      </p>

      {(mode === null || modeLocked) ? (
        <section className="panel mode-switch compact" aria-label="mode switch">
          {mode === null ? (
          <>
            <div className="pill">Choose Mode</div>
            <button
              type="button"
              className="primary mode-current"
              onClick={() => {
                setMode('solitaire');
                setMultiplayerFlow('choose');
                setShowJoinById(false);
                setError(null);
              }}
              data-testid="mode-solitaire"
            >
              Solitaire
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setMode('multiplayer');
                setMultiplayerFlow('choose');
                setShowJoinById(false);
                setError(null);
              }}
              data-testid="mode-multiplayer"
            >
              Multiplayer
            </button>
          </>
          ) : (
            <button type="button" className="primary mode-current" disabled>
              {mode === 'solitaire' ? 'Solitaire' : 'Multiplayer'}
            </button>
          )}
        </section>
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

      {mode === null ? (
        <section className="panel lobby" aria-label="welcome">
          <h2>Choose a mode to begin.</h2>
          <p>New to UpNDown? Read the quick rules first.</p>
          <div className="button-row">
            <a
              className="secondary link-button"
              href="/how-to-play.html"
              target="_blank"
              rel="noreferrer"
              data-testid="how-to-play-link"
            >
              How to Play
            </a>
          </div>
        </section>
      ) : mode === 'solitaire' ? (
        solitaireActive ? (
        <GameBoard
          mode="solitaire"
          gameState={solitaireState}
          selectedCardId={solitaireSelectedCardId}
          setSelectedCardId={setSolitaireSelectedCardId}
          onPlayPile={handleSolitairePlayCard}
          newCardIds={solitaireNewCardIds}
        />
        ) : (
          <section className="panel lobby" aria-label="solitaire ended">
            <h2>Solitaire</h2>
            <p>Start a solitaire run when you are ready.</p>
            <div className="button-row">
              <button type="button" className="primary" onClick={handleSolitaireNewGame} data-testid="start-solitaire">
                Start Solitaire
              </button>
            </div>
          </section>
        )
      ) : (
        <>
          {!multiplayerState ? (
            <section className="panel lobby" aria-label="multiplayer lobby">
              <h2>Multiplayer</h2>
              <div className="lobby-grid">
                <label htmlFor="player-name-input">
                  Player Name
                  <input
                    id="player-name-input"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    maxLength={32}
                    disabled={multiplayerInteractionDisabled}
                  />
                </label>
              </div>
              {multiplayerFlow === 'choose' ? (
                <div className="flow-choice" data-testid="flow-choice">
                  <button
                    type="button"
                    className="choice-card primary"
                    onClick={() => {
                      setMultiplayerFlow('host');
                      setShowJoinById(false);
                      setJoinLookup(null);
                      setError(null);
                    }}
                    disabled={multiplayerInteractionDisabled}
                    data-testid="flow-host"
                  >
                    Host Game
                  </button>
                  <button
                    type="button"
                    className="choice-card secondary"
                    onClick={() => {
                      setMultiplayerFlow('join');
                      setShowJoinById(false);
                      setJoinLookup(null);
                      setError(null);
                    }}
                    disabled={multiplayerInteractionDisabled}
                    data-testid="flow-join"
                  >
                    Join Game
                  </button>
                </div>
              ) : null}

              {multiplayerFlow === 'host' ? (
                <>
                  <div className="button-row">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => { void handleCreateGame(); }}
                      disabled={multiplayerInteractionDisabled || !playerName.trim() || !!createSettingsError}
                      data-testid="create-game"
                    >
                      {pendingAction === 'create' ? 'Creating...' : 'Create Game'}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setMultiplayerFlow('choose')}
                      disabled={multiplayerInteractionDisabled}
                    >
                      Back
                    </button>
                  </div>
                </>
              ) : null}

              {multiplayerFlow === 'join' ? (
                <>
                  <div className="button-row">
                    <button type="button" className="secondary" onClick={() => { void refreshJoinableGames(); }} disabled={multiplayerInteractionDisabled || loadingJoinableGames}>
                      {loadingJoinableGames ? 'Refreshing...' : 'Refresh Games'}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setMultiplayerFlow('choose')}
                      disabled={multiplayerInteractionDisabled}
                    >
                      Back
                    </button>
                  </div>

                  <div className="joinable-list" aria-label="joinable games">
                    <h3>Public Games</h3>
                    {joinableGames.length === 0 ? (
                      <div className="pill">No public lobby games right now.</div>
                    ) : (
                      joinableGames.map((game) => (
                        <div key={game.gameId} className="joinable-item">
                          <span>{game.hostName} • {game.playerCount}/{game.maxPlayers}</span>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => { void handleJoinGame(game.gameId); }}
                            disabled={multiplayerInteractionDisabled || !playerName.trim()}
                            data-testid={`join-list-${game.gameId}`}
                          >
                            Join
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="button-row">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setShowJoinById((value) => {
                          const next = !value;
                          if (!next) {
                            setJoinLookup(null);
                          }
                          return next;
                        });
                      }}
                      disabled={multiplayerInteractionDisabled}
                      data-testid="show-join-by-id"
                    >
                      {showJoinById ? 'Hide Join by ID' : 'Join by ID'}
                    </button>
                  </div>

                  {showJoinById ? (
                    <div className="private-join">
                      <label htmlFor="game-id-input">
                        Private Game ID
                        <input
                          id="game-id-input"
                          value={joinGameId}
                          onChange={(e) => setJoinGameId(e.target.value.toUpperCase())}
                          maxLength={6}
                          disabled={multiplayerInteractionDisabled}
                        />
                      </label>
                      <div className="button-row">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => { void handleLookupGame(); }}
                          disabled={multiplayerInteractionDisabled || joinGameId.trim().length !== 6}
                          data-testid="lookup-game"
                        >
                          {pendingAction === 'lookup' ? 'Checking...' : 'Check'}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => { void handleJoinGame(); }}
                          disabled={multiplayerInteractionDisabled || !playerName.trim() || joinGameId.trim().length !== 6}
                          data-testid="join-game"
                        >
                          {pendingAction === 'join' ? 'Joining...' : 'Join Private'}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {showJoinById && joinLookup ? (
                    <div className="pill" data-testid="private-lookup-result">
                      {joinLookup.privateGame ? 'Private' : 'Public'} game • {joinLookup.playerCount}/{joinLookup.maxPlayers} joined
                    </div>
                  ) : null}
                </>
              ) : null}

              <div className="pill">Socket: {connectionState}</div>
              {createSettingsError ? <div className="error">{createSettingsError}</div> : null}
            </section>
          ) : multiplayerState.gamePhase === 'lobby' ? (
            <section className="panel lobby" aria-label="waiting room">
              <h2>Game {multiplayerState.gameId}</h2>
              <div className="players-list">
                {multiplayerState.players.map((player, index) => (
                  <div className="player-line" key={player.id}>
                    <span>{index + 1}. {player.name}{player.id === playerId ? ' (You)' : ''}{player.isHost ? ' [Host]' : ''}</span>
                  </div>
                ))}
              </div>
              <div className="button-row">
                {isHostInLobby ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => { void handleStartGame(); }}
                    disabled={multiplayerInteractionDisabled}
                    data-testid="start-game"
                  >
                    {pendingAction === 'start' ? 'Starting...' : 'Start Game'}
                  </button>
                ) : (
                  <div className="pill">Only host can start the game.</div>
                )}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => { void handleLeaveMultiplayer(); }}
                  disabled={multiplayerInteractionDisabled}
                  data-testid="leave-game"
                >
                  {pendingAction === 'leave' ? 'Leaving...' : 'Leave'}
                </button>
              </div>
            </section>
          ) : (
            amInMultiplayerGame ? (
              <GameBoard
                mode="multiplayer"
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
                newCardIds={multiplayerNewCardIds}
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
      )}

      {error ? (
        <div className="error" role="alert" aria-live="assertive" data-testid="error-banner">
          {error}
        </div>
      ) : null}

      {mode ? (
        <SettingsDialog
          mode={mode}
          open={isSettingsOpen}
          settings={settingsDraft}
          editable={settingsEditable}
          validationError={settingsDraftError}
          onClose={() => setIsSettingsOpen(false)}
          onSave={() => { void handleSaveSettings(); }}
          onChange={setSettingsDraft}
        />
      ) : null}
    </main>
  );
}
