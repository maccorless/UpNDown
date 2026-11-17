import { cheatNoticeText, cheatStatuses, describeHint, keepCheatCounts, moveKey, soloHint, useCheatHotkeys, type HintView } from './cheats.js';
import { CheatsPanel } from './CheatsPanel.js';
import { InviteModal, JoinRequestModal } from './LateJoin.js';
import { SeatChoice } from './SeatChoice.js';
import { StorageNotice } from './StorageNotice.js';
import { isClaimed } from './claims.js';
import { readSavedSeat } from './saved-seat.js';
import { useSavedSeat } from './useSavedSeat.js';
import type { Action } from '@upndown/engine';
import { buildDeck, createStartedGameState, isValidPlay, playCard as playCardEngine, recordCheatUse, requiredCardsForTurn, shuffle, tradeCard as tradeCardEngine } from '@upndown/engine';
import { playCardSound, playCheerSound, playGolfClapSound, playGroanSound, playLoseSound, playTurnStartSound, playWinSound } from './sounds.js';
import { classifyPlay, deckProgress, isBackwardTen, PLAYER_COLOR_HEX, turnProgress } from './board-helpers.js';
import { EndGameSplash, EndGameStatisticsModal } from './EndGame.js';
import { Modal } from './Modal.js';
import { SettingsDialog } from './SettingsDialog.js';
import { deckFitMessage, defaultMultiplayerSettings, defaultSolitaireSettings, gameSettingsSchema, maxPlayersFor, randomPresidentName, type Card, type CardLookupResult, type CheatUsedEvent, type JoinResolvedEvent, type GameSettings, type GameState, type JoinableGameSummary, type JoinLookupSummary, type ReactionState, type ReactionType } from '@upndown/shared-types';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ProfileMenu } from './auth/ProfileMenu.js';
import { ConnectionNotices, hasConnectionNotices } from './ConnectionNotices.js';
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

const SETTINGS_STORAGE_KEY = 'upndown.settings.v1';
const PLAYER_NAME_STORAGE_KEY = 'upndown.multiplayer.playerName.v1';
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
const JOINABLE_POLL_BASE_MS = import.meta.env.MODE === 'test' ? 120 : 5000;
const JOINABLE_POLL_MAX_MS = import.meta.env.MODE === 'test' ? 600 : 30000;
const GAME_QUERY_PARAM = 'game';
const INVITE_QUERY_PARAM = 'invite';

interface PersistedSettings {
  solitaire: GameSettings;
  multiplayer: GameSettings;
}

function normalizeGameId(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(normalized) ? normalized : null;
}

function readGameIdFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search);
  return normalizeGameId(params.get(GAME_QUERY_PARAM));
}

function buildInviteLink(gameId: string, inviteToken?: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set(GAME_QUERY_PARAM, gameId);
  if (inviteToken) url.searchParams.set(INVITE_QUERY_PARAM, inviteToken);
  return url.toString();
}

// The single-use invitation in the address, if there is one and it looks like one.
function readInviteFromLocation(): string | null {
  const value = new URLSearchParams(window.location.search).get(INVITE_QUERY_PARAM);
  return value && /^[A-Za-z0-9_-]{16,100}$/.test(value) ? value : null;
}

function syncGameIdInUrl(gameId: string | null): void {
  const url = new URL(window.location.href);
  if (gameId) {
    url.searchParams.set(GAME_QUERY_PARAM, gameId);
  } else {
    url.searchParams.delete(GAME_QUERY_PARAM);
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
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

function readPersistedPlayerName(): string {
  try {
    const raw = window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    if (!raw) {
      return '';
    }
    return raw.slice(0, 32);
  } catch {
    return '';
  }
}

function writePersistedPlayerName(playerName: string): void {
  try {
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, playerName);
  } catch {
    // Ignore storage write failures (private mode/quota/etc).
  }
}

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

function sortByValue(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => a.value - b.value);
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
  // Opens the cheats panel. Present only when the game has a cheat turned on, so the panel is reachable from the keyboard.
  onOpenCheats?: () => void;
  // Host only: make a single-use invitation for someone to join the game being played.
  onInvite?: () => void;
  // A card and a pile to light up for a hint.
  hintCardId?: string | undefined;
  hintPileId?: number | undefined;
  playerId?: string | null;
  interactionDisabled?: boolean;
  onSetReaction?: (pileId: number, reactionType: ReactionType | null) => void;
  gameReactions?: ReactionState;
  specialPlayPileId?: number | null | undefined;
  onUndo?: (() => void) | undefined;
  canUndo?: boolean | undefined;
  onKickPlayer?: ((targetPlayerId: string) => void) | undefined;
  onTakeOverHost?: ((hostId: string) => void) | undefined;
  isHost?: boolean | undefined;
}

const REACTION_EMOJI: Record<ReactionType, string> = {
  like: '👍',
  love: '❤️',
  really_love: '🔥'
};

function nextReaction(current: ReactionType | null): ReactionType | null {
  if (current === null) return 'like';
  if (current === 'like') return 'love';
  if (current === 'love') return 'really_love';
  return null;
}

export function GameBoard(props: GameBoardProps): JSX.Element {
  const {
    mode,
    gameState,
    selectedCardId,
    setSelectedCardId,
    onPlayPile,
    onEndTurn,
    onOpenCheats,
    onInvite,
    hintCardId,
    hintPileId,
    playerId,
    interactionDisabled,
    onSetReaction,
    gameReactions = {},
    specialPlayPileId: specialPlayPileIdProp = null,
    onUndo,
    canUndo,
    onKickPlayer,
    onTakeOverHost,
    isHost: isHostProp
  } = props;

  const me = mode === 'solitaire'
    ? gameState.players[0]
    : gameState.players.find((player) => player.id === playerId);

  if (!me) {
    return <section className="panel">Waiting for player state...</section>;
  }

  const sortedHand = sortByValue(me.hand);
  const progress = deckProgress(gameState);
  const selectedCard = sortedHand.find((card) => card.id === selectedCardId) ?? null;
  const isCompactHand = sortedHand.length >= 8;

  const unplayableIds = gameState.gamePhase === 'playing'
    ? new Set(
        sortedHand
          .filter((card) =>
            card.id !== selectedCardId &&
            gameState.foundationPiles.every((pile) => !isValidPlay(card, pile))
          )
          .map((card) => card.id)
      )
    : new Set<string>();
  const activePlayer = gameState.players[gameState.currentPlayerIndex];
  const isMyTurn = mode === 'solitaire' ? true : activePlayer?.id === playerId;
  const inputsDisabled = !!interactionDisabled || (mode === 'multiplayer' && !isMyTurn) || gameState.gamePhase !== 'playing';
  const requiredPlaysThisTurn = requiredCardsForTurn(gameState.settings.minCardsPerTurn, gameState.drawPile.length);
  const canEndTurn = mode === 'multiplayer'
    && gameState.gamePhase === 'playing'
    && isMyTurn
    && gameState.cardsPlayedThisTurn >= requiredPlaysThisTurn;
  const [dismissedPhaseSplash, setDismissedPhaseSplash] = useState(false);
  const [gameIdCopied, setGameIdCopied] = useState(false);
  const [kickConfirmPlayerId, setKickConfirmPlayerId] = useState<string | null>(null);
  const kickConfirmPlayer = kickConfirmPlayerId ? gameState.players.find((p) => p.id === kickConfirmPlayerId) : null;

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
    <div className={`gameboard ${mode === 'multiplayer' ? 'gameboard-multi' : 'gameboard-solo'}${mode === 'multiplayer' && hasConnectionNotices(gameState.reconnection, playerId ?? '') ? ' has-notices' : ''}`}>
      {(gameState.gamePhase === 'won' || gameState.gamePhase === 'lost') && !dismissedPhaseSplash ? (
        <EndGameSplash phase={gameState.gamePhase} state={gameState} />
      ) : null}

      {mode === 'multiplayer' ? <ConnectionNotices reconnection={gameState.reconnection} viewerId={playerId ?? ''} players={gameState.players} onKick={(id) => onKickPlayer?.(id)} onTakeOver={(id) => onTakeOverHost?.(id)} /> : null}

      <section className="panel foundation-panel" aria-label="foundation piles">
        <div className="foundation-header">
          <h2>Foundation Piles</h2>
          <div
            className="pill mini progress-pill"
            style={{ '--progress': `${Math.round(((progress.total - progress.left) / progress.total) * 100)}%` } as React.CSSProperties}
            aria-label={`${progress.left} cards left to play, ${gameState.drawPile.length} in the draw pile`}
          >
            {progress.left} left · draw pile {gameState.drawPile.length}
          </div>
        </div>
        <div className="pile-grid">
          {gameState.foundationPiles.map((pile) => {
            const highlighted = canPlayOnPile(selectedCard, pile.topCard, pile.type);
            const backwardTen = !!selectedCard && highlighted && isBackwardTen(selectedCard, pile.type, pile.topCard.value);

            const leftPlayers = mode === 'multiplayer' ? gameState.players.slice(0, 3) : [];
            const rightPlayers = mode === 'multiplayer' ? gameState.players.slice(3, 6) : [];
            const isMyTurn = gameState.players[gameState.currentPlayerIndex]?.id === playerId;
            const canReact = mode === 'multiplayer'
              && gameState.gamePhase === 'playing'
              && !isMyTurn
              && !!onSetReaction;

            const renderSlot = (player: typeof gameState.players[0], playerNum: number): JSX.Element => {
              const reaction = gameReactions[player.id]?.[pile.id] ?? null;
              const isMine = player.id === playerId;
              const slotCanClick = isMine && canReact;
              return (
                <div
                  key={player.id}
                  role="button"
                  tabIndex={slotCanClick ? 0 : -1}
                  className={`reaction-slot${reaction ? ' active' : ''}${isMine ? ' mine' : ''}${slotCanClick ? ' clickable' : ''}`}
                  style={player.color ? { '--player-color': PLAYER_COLOR_HEX[player.color] } as React.CSSProperties : undefined}
                  onClick={slotCanClick ? (e) => { e.stopPropagation(); onSetReaction(pile.id, nextReaction(reaction)); } : undefined}
                  onKeyDown={slotCanClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onSetReaction(pile.id, nextReaction(reaction)); } } : undefined}
                  aria-label={reaction
                    ? `Player ${playerNum} reacted ${reaction.replace('_', ' ')} to this pile`
                    : `Player ${playerNum}`}
                  title={isMine && !isMyTurn && gameState.gamePhase === 'playing'
                    ? 'Click to react'
                    : reaction
                      ? `${player.name} reacted ${reaction.replace('_', ' ')}`
                      : undefined}
                >
                  {reaction ? REACTION_EMOJI[reaction] : playerNum}
                </div>
              );
            };

            const pileTypeClass = pile.type === 'ascending' ? 'asc' : 'desc';
            const hasReactionRows = leftPlayers.length > 0 || rightPlayers.length > 0;
            const isSpecialFlash = specialPlayPileIdProp === pile.id;
            const specialLabel = pile.type === 'ascending' ? '🔥 -10! 🔥' : '🔥 +10! 🔥';
            const showArrows = gameState.settings.showArrows;
            const pileArrow = (
              <svg className={`pile-arrow ${pile.type === 'ascending' ? 'up' : 'down'}`} viewBox="0 0 14 22" aria-hidden="true" focusable="false">
                <path d="M7 0 L14 9 L9.5 9 L9.5 22 L4.5 22 L4.5 9 L0 9 Z" />
              </svg>
            );

            return (
              <div
                key={pile.id}
                className={`pile-unit ${pileTypeClass} ${highlighted ? 'highlight' : ''}${backwardTen ? ' highlight-special' : ''}${isSpecialFlash ? ' backward-ten-flash' : ''}${hintPileId === pile.id ? ' hinted' : ''}`}
              >
                {isSpecialFlash && (
                  <span className="backward-ten-label">{specialLabel}</span>
                )}
                {hasReactionRows && (
                  <div className="reaction-row top">
                    {leftPlayers.map((player, i) => renderSlot(player, i + 1))}
                  </div>
                )}
                <button
                  type="button"
                  className="pile"
                  onClick={() => onPlayPile(pile.id)}
                  data-testid={`pile-${pile.id}`}
                  disabled={inputsDisabled}
                  aria-label={`Foundation ${pile.type} with top card ${pile.topCard.value}${backwardTen ? ', a backward ten play' : ''}`}
                >
                  {backwardTen ? <span className="special-badge" aria-hidden="true">{pile.type === 'ascending' ? '\u221210' : '+10'}</span> : null}
                  {showArrows ? pileArrow : null}
                  <span className="top-card" data-testid={`pile-top-${pile.id}`}>{pile.topCard.value}</span>
                  {showArrows ? pileArrow : null}
                </button>
                {hasReactionRows && (
                  <div className="reaction-row bottom">
                    {rightPlayers.map((player, i) => renderSlot(player, i + 4))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {mode === 'multiplayer' ? (() => {
        const myIndex = gameState.players.findIndex((p) => p.id === playerId);
        const currentIdx = gameState.currentPlayerIndex;
        const count = gameState.players.length;
        const turnsUntilMine = myIndex >= 0
          ? (myIndex - currentIdx + count) % count
          : -1;
        const turnLabel = gameState.gamePhase === 'playing'
          ? turnsUntilMine === 0
            ? 'Your turn'
            : turnsUntilMine === 1
              ? 'You\'re next'
              : `Your turn in ${turnsUntilMine}`
          : null;

        return (
          <section className="panel players-panel" aria-label="players list">
            <div className="players-panel-header">
              <h2>Players</h2>
              <div className="pill mini">{gameState.players.length}</div>
              <button
                type="button"
                className="pill mini game-id-pill"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(buildInviteLink(gameState.gameId));
                    setGameIdCopied(true);
                    setTimeout(() => setGameIdCopied(false), 1500);
                  } catch { /* clipboard unavailable */ }
                }}
                title="Click to copy invite link"
              >
                {gameIdCopied ? 'Copied!' : `Game: ${gameState.gameId}`}
              </button>
            </div>
            {gameState.gamePhase === 'playing' && (
              <div className="turn-sequence" aria-label="turn order">
                <div className="turn-dots">
                  {gameState.players.map((player, index) => {
                    const isCurrent = index === currentIdx;
                    const isMe = player.id === playerId;
                    return (
                      <span key={player.id} className="turn-step">
                        {index > 0 && <span className="turn-connector" />}
                        <span
                          className={`turn-dot${isCurrent ? ' current' : ''}${isMe ? ' me' : ''}`}
                          style={player.color ? { '--player-color': PLAYER_COLOR_HEX[player.color] } as React.CSSProperties : undefined}
                          title={`${player.name}${isCurrent ? ' (playing)' : ''}`}
                        >
                          {index + 1}
                        </span>
                      </span>
                    );
                  })}
                </div>
                {turnLabel && <span className="turn-label">{turnLabel}</span>}
              </div>
            )}
            <div className="players-list" role="region" aria-label="Players" tabIndex={0}>
              {gameState.players.map((player, index) => (
                <div
                  key={player.id}
                  className={`player-line ${index === gameState.currentPlayerIndex ? 'active' : ''}`}
                  aria-current={index === gameState.currentPlayerIndex ? 'true' : undefined}
                >
                  <span>
                    {player.color && <span className="player-color-pip" style={{ background: PLAYER_COLOR_HEX[player.color] }} aria-hidden="true" />}
                    {index + 1}. {player.name}{player.id === playerId ? ' (You)' : ''}{player.isHost ? ' [Host]' : ''}{player.robot ? ' [Robot]' : ''}
                  </span>
                  <span className="player-line-right">
                    <span>{player.hand.length} cards</span>
                    {isHostProp && onKickPlayer && player.id !== playerId && !player.isHost && !player.robot ? (
                      <button
                        type="button"
                        className="kick-btn"
                        onClick={() => setKickConfirmPlayerId(player.id)}
                        title={`Remove ${player.name}`}
                        data-testid={`kick-ingame-${player.id}`}
                      >
                        ✕
                      </button>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>

            {kickConfirmPlayer && onKickPlayer ? (
              <Modal className="panel end-game-confirm-modal" dismiss="any" label="confirm kick player" onClose={() => setKickConfirmPlayerId(null)}>
                <h2>Kick Player?</h2>
                <p>Remove <strong>{kickConfirmPlayer.name}</strong> from the game? Their {kickConfirmPlayer.hand.length} cards will be returned to the draw pile.</p>
                <div className="button-row">
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      onKickPlayer(kickConfirmPlayer.id);
                      setKickConfirmPlayerId(null);
                    }}
                  >
                    Kick Player
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    data-autofocus
                    onClick={() => setKickConfirmPlayerId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </Modal>
            ) : null}
          </section>
        );
      })() : null}

      <section className="panel hand-panel" aria-label="your hand">
        <div className="hand-header">
          <div className="hand-title">
            <h2>Your Hand</h2>
            {mode === 'multiplayer' && gameState.gamePhase === 'playing' && isMyTurn ? (() => {
              const played = turnProgress(gameState.cardsPlayedThisTurn, requiredPlaysThisTurn);
              return (
                <span className={`turn-progress${played.met ? ' met' : ''}`} aria-live="polite" data-testid="turn-progress">
                  {played.text}{played.met ? ' \u2713' : ''}
                </span>
              );
            })() : null}
          </div>
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
            {onUndo ? (
              <button
                type="button"
                className="secondary"
                onClick={onUndo}
                disabled={inputsDisabled || !canUndo}
                data-testid="undo"
              >
                Undo
              </button>
            ) : null}
            {onInvite ? (
              <button type="button" className="secondary" onClick={onInvite} disabled={inputsDisabled} data-testid="invite-late">
                Invite
              </button>
            ) : null}
            {onOpenCheats ? (
              <button type="button" className="secondary" onClick={onOpenCheats} disabled={inputsDisabled} data-testid="open-cheats">
                Cheats
              </button>
            ) : null}
          </div>
        </div>
        <div className={`cards-fan ${isCompactHand ? 'compact' : ''}`} style={{ '--hand-n': Math.max(1, sortedHand.length) } as React.CSSProperties}>
          {sortedHand.map((card) => (
            <button
              key={card.id}
              type="button"
              className={`card ${selectedCardId === card.id ? 'selected' : ''} ${unplayableIds.has(card.id) ? 'card-unplayable' : ''}${hintCardId === card.id ? ' hinted' : ''}`}
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

function validateCreateSettings(settings: GameSettings): string | null {
  if (settings.maxPlayers < settings.minPlayers) {
    return 'Max players must be greater than or equal to min players';
  }
  const deckSize = settings.maxCardValue - settings.minCardValue + 1;
  if (deckSize < 18) {
    return 'Deck must contain at least 18 cards';
  }
  return deckFitMessage(settings);
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
  const solitaireSpecialPlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [solitaireUndoStack, setSolitaireUndoStack] = useState<GameState[]>([]);
  const [solitaireRunId, setSolitaireRunId] = useState(newRunId);
  const solitaireSave = useSolitaireSave({ active: solitaireActive, state: solitaireState, undoStack: solitaireUndoStack, runId: solitaireRunId });
  // Solitaire needs no server. Only a signed-in player's finished game is sent, to be saved to their history.
  const localHistory = useLocalHistory();
  const [profileOpen, setProfileOpen] = useState(false);
  const solitaireResult = useSolitaireResult({ active: solitaireActive, state: solitaireState, runId: solitaireRunId, signedIn: auth.status === 'signedIn', guest: auth.status === 'guest' || auth.status === 'disabled', userId: auth.userId, history: localHistory });

  const [multiplayerState, setMultiplayerState] = useState<GameState | null>(null);
  const [multiplayerSelectedCardId, setMultiplayerSelectedCardId] = useState<string | null>(null);
  const [gameReactions, setGameReactions] = useState<ReactionState>({});
  const [specialPlayPileId, setSpecialPlayPileId] = useState<number | null>(null);
  const specialPlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [multiplayerCreateSettings, setMultiplayerCreateSettings] = useState<GameSettings>(() => persisted?.multiplayer ?? multiplayerSettings);
  const [settingsDraft, setSettingsDraft] = useState<GameSettings>(() => persisted?.multiplayer ?? multiplayerSettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
  const [isPageVisible, setIsPageVisible] = useState(() => document.visibilityState === 'visible');
  const [playerId, setPlayerId] = useState<string | null>(null);
  const guestRecord = useGuestMultiplayerRecord({ state: multiplayerState, playerId, guest: auth.status === 'guest' || auth.status === 'disabled', history: localHistory });
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
  useAccountSync(auth, { playerName, setPlayerName, solitaire: solitaireConfig, setSolitaire: setSolitaireConfig, multiplayer: multiplayerCreateSettings, setMultiplayer: setMultiplayerCreateSettings, enableSounds, setEnableSounds: changeSounds });
  const [cardLookupOpen, setCardLookupOpen] = useState(false);
  const [cardLookupValue, setCardLookupValue] = useState('');
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
  const savedSeat = useSavedSeat(multiplayerState, playerId, rejoinTokenRef, mode === null);
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
  };

  useEffect(() => {
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

    const onSpecialPlay = (data: { pileId: number }): void => {
      setSpecialPlayPileId(data.pileId);
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
    };
  }, [mode]);


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

  useEffect(() => {
    const applyViewportHeight = (): void => {
      document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    };

    const onResize = (): void => {
      applyViewportHeight();
      window.setTimeout(applyViewportHeight, 80);
    };

    applyViewportHeight();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  useEffect(() => {
    const onVisibilityChange = (): void => {
      setIsPageVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    if (
      mode !== 'multiplayer'
      || multiplayerState
      || connectionState !== 'connected'
      || multiplayerFlow !== 'join'
      || !isPageVisible
    ) {
      return;
    }

    joinablePollFailuresRef.current = 0;
    let timer = 0;
    let cancelled = false;

    const schedule = (delayMs: number): void => {
      timer = window.setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async (): Promise<void> => {
      if (cancelled) {
        return;
      }

      const ok = await refreshJoinableGames({ background: true });
      if (cancelled) {
        return;
      }

      const failureCount = ok ? 0 : joinablePollFailuresRef.current;
      const nextDelay = ok
        ? JOINABLE_POLL_BASE_MS
        : Math.min(JOINABLE_POLL_MAX_MS, JOINABLE_POLL_BASE_MS * (2 ** Math.min(3, failureCount - 1)));
      schedule(nextDelay);
    };

    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, multiplayerState, connectionState, multiplayerFlow, isPageVisible]);

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
      const next = playCardEngine(solitaireState, SOLO_PLAYER_ID, solitaireSelectedCardId, pileId);
      const newSpecialPlays = next.statistics.players[SOLO_PLAYER_ID]?.specialPlays ?? 0;

      setSolitaireUndoStack((stack) => [...stack, solitaireState]);
      setSolitaireState(next);
      setSolitaireSelectedCardId(null);
      setError(null);

      if (newSpecialPlays > oldSpecialPlays) {
        setSolitaireSpecialPlayPileId(pileId);
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
  const openLookup = (): void => {
    setCardLookupValue('');
    setCardLookupOpen(true);
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
        setSolitaireState(recordCheatUse(solitaireState, SOLO_PLAYER_ID, 'lookup'));
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
    void requestSocketAck<{ result: CardLookupResult }>('game:cardLookup', { gameId: activeState.gameId, cardValue })
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
  const cheatState = mode === 'multiplayer' ? multiplayerState : (mode === 'solitaire' && solitaireActive ? solitaireState : null);
  const cheatSelectedCardId = mode === 'multiplayer' ? multiplayerSelectedCardId : solitaireSelectedCardId;
  const cheatPlayerId = mode === 'multiplayer' ? playerId : SOLO_PLAYER_ID;
  const cheatStatusList = cheatState && cheatState.gamePhase === 'playing' ? cheatStatuses(cheatState, cheatPlayerId, cheatSelectedCardId) : [];
  // The hint goes when the game moves on: any change to either game, or leaving it.
  const hintBoardKey = moveKey(mode === 'multiplayer' ? multiplayerState : (mode === 'solitaire' ? solitaireState : null), mode === 'multiplayer' ? playerId : SOLO_PLAYER_ID);
  useEffect(() => { setHint(null); }, [hintBoardKey]);
  const cheatCan = (kind: 'lookup' | 'hint' | 'skip' | 'trade'): boolean => cheatStatusList.some((status) => status.kind === kind && status.available);
  useCheatHotkeys({
    active: cheatStatusList.length > 0,
    ...(cheatCan('lookup') ? { onLookup: openLookup } : {}),
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
          <ProfileMenu auth={auth} currentName={playerName} locked={mode === 'solitaire' || multiplayerState !== null} onOpenProfile={() => setProfileOpen(true)} />
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
          onChangeName={() => setEditingName(true)}
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
          gameState={solitaireState}
          selectedCardId={solitaireSelectedCardId}
          setSelectedCardId={setSolitaireSelectedCardId}
          onPlayPile={handleSolitairePlayCard}
          specialPlayPileId={solitaireSpecialPlayPileId}
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
            <section className="panel lobby" aria-label="multiplayer lobby">
              <h2>Multiplayer</h2>
              <div className="lobby-grid">
                <label htmlFor="player-name-input">
                  Player Name
                  <input
                    id="player-name-input"
                    value={playerName}
                    onChange={(e) => { setPlayerName(e.target.value); confirmName(); }}
                    name="playerName"
                    autoComplete="nickname"
                    autoCapitalize="words"
                    spellCheck={false}
                    maxLength={32}
                    placeholder="Your Name"
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
                      void handleCreateGame();
                      setShowJoinById(false);
                      setJoinLookup(null);
                      setError(null);
                    }}
                    disabled={multiplayerInteractionDisabled || !playerName.trim() || !!createSettingsError}
                    data-testid="flow-host"
                  >
                    {pendingAction === 'create' ? 'Hosting...' : 'Host Game'}
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

                  <section className="joinable-list" aria-labelledby="joinable-games-title">
                    <h3 id="joinable-games-title">Public Games</h3>
                    {joinableGames.length === 0 ? (
                      <div className="info-message">No public lobby games right now.</div>
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
                  </section>

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
                          className="primary"
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
                    <div className="info-message" data-testid="private-lookup-result">
                      {joinLookup.privateGame ? 'Private' : 'Public'} game • {joinLookup.playerCount}/{joinLookup.maxPlayers} joined
                    </div>
                  ) : null}
                </>
              ) : null}

              {createSettingsError ? <div className="error">{createSettingsError}</div> : null}
            </section>
          ) : multiplayerState.gamePhase === 'lobby' ? (
            <section className="panel lobby" aria-label="waiting room">
              <h2>Game {multiplayerState.gameId}</h2>
              <div className="invite-share">
                <label htmlFor="invite-link-input">
                  Invite Link
                  <input id="invite-link-input" value={buildInviteLink(multiplayerState.gameId)} readOnly data-testid="invite-link-input" />
                </label>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => { void handleCopyInviteLink(); }}
                  disabled={multiplayerInteractionDisabled}
                  data-testid="copy-invite-link"
                >
                  {inviteCopied ? 'Copied' : 'Copy Link'}
                </button>
              </div>
              {inviteCopied ? <div className="info-message">Invite link copied.</div> : null}
              <div className="pill">
                Players in Lobby: {multiplayerState.players.length}/{maxPlayersFor(multiplayerState.settings)}
              </div>
              <div className="players-list">
                {multiplayerState.players.map((player, index) => (
                  <div className="player-line" key={player.id}>
                    <span>
                      {player.color && <span className="player-color-pip" style={{ background: PLAYER_COLOR_HEX[player.color] }} aria-hidden="true" />}
                      {index + 1}. {player.name}{player.id === playerId ? ' (You)' : ''}{player.isHost ? ' [Host]' : ''}{player.robot ? ' [Robot]' : ''}
                    </span>
                    {isHostInLobby && player.id !== playerId && !player.isHost ? (
                      <button
                        type="button"
                        className="kick-btn"
                        onClick={() => { void (player.robot ? handleRemoveRobot(player.id) : handleKickPlayer(player.id)); }}
                        disabled={!!pendingAction}
                        title={`Remove ${player.name}`}
                        data-testid={`kick-${player.id}`}
                      >
                        ✕
                      </button>
                    ) : null}
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
                  <div className="info-message">Only host can start the game.</div>
                )}
                {isHostInLobby ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => { void handleAddRobot(); }}
                    disabled={multiplayerInteractionDisabled || multiplayerState.players.length >= maxPlayersFor(multiplayerState.settings)}
                    data-testid="add-robot"
                  >
                    Add Robot
                  </button>
                ) : null}
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
                onSetReaction={sendSetReaction}
                gameReactions={gameReactions}
                specialPlayPileId={specialPlayPileId}
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

      <ProfileLayer auth={auth} history={localHistory} open={profileOpen} seen={{}} onClose={() => setProfileOpen(false)} />

      {(mode || isSettingsOpen) ? (
        <SettingsDialog
          mode={mode ?? 'multiplayer'}
          open={isSettingsOpen}
          settings={settingsDraft}
          editable={settingsEditable}
          validationError={settingsDraftError}
          onClose={() => setIsSettingsOpen(false)}
          onSave={() => { void handleSaveSettings(); }}
          onChange={setSettingsDraft}
          enableSounds={enableSounds}
          onToggleSounds={changeSounds}
        />
      ) : null}

      {showEndGameConfirm ? (
        <Modal className="panel end-game-confirm-modal" dismiss="esc" label="confirm end game" onClose={() => setShowEndGameConfirm(false)}>
          <h2>End Game?</h2>
          <p>This will end the active game for all players and return everyone to the lobby.</p>
          <div className="button-row">
            <button
              type="button"
              className="danger"
              onClick={() => { void executeEndGame(); }}
              disabled={pendingAction === 'endgame'}
            >
              {pendingAction === 'endgame' ? 'Ending...' : 'End Game'}
            </button>
            <button
              type="button"
              className="secondary"
              data-autofocus
              onClick={() => setShowEndGameConfirm(false)}
            >
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}

      {hostEndedModalGameId ? (
        <Modal className="panel host-ended-modal" dismiss="none" label="host ended the game" onClose={() => undefined}>
          <h2>Host Ended The Game</h2>
          <p>The host ended game {hostEndedModalGameId}. Return to home to join or host another game.</p>
          <div className="button-row">
            <button
              type="button"
              className="primary"
              onClick={() => { void handleAcknowledgeHostEnded(); }}
              disabled={pendingAction === 'leave'}
            >
              {pendingAction === 'leave' ? 'Returning...' : 'Back To Home'}
            </button>
          </div>
        </Modal>
      ) : null}

      {pendingLobbyState ? (
        <Modal className="panel host-ended-modal" dismiss="none" label="host returned to lobby" onClose={() => undefined}>
          <h2>Back to Lobby?</h2>
          <p>The host has returned to the lobby. Join them for another round, or leave.</p>
          <div className="button-row">
            <button
              type="button"
              className="primary"
              onClick={() => {
                setMultiplayerState(pendingLobbyState);
                setPendingLobbyState(null);
                setMultiplayerSelectedCardId(null);
              }}
            >
              Back to Lobby
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setPendingLobbyState(null);
                void handleLeaveMultiplayer();
              }}
              disabled={pendingAction === 'leave'}
            >
              {pendingAction === 'leave' ? 'Leaving...' : 'Leave'}
            </button>
          </div>
        </Modal>
      ) : null}

      {cardLookupOpen ? (
        <Modal className="panel card-lookup-modal" dismiss="any" label="card lookup" onClose={() => setCardLookupOpen(false)}>
          <h2>Card Lookup</h2>
          <p>Enter a card number to see where it is.</p>
          <input
            className="card-lookup-input"
            type="number"
            min={1}
            max={999}
            value={cardLookupValue}
            autoFocus
            onChange={(e) => setCardLookupValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleCardLookupSubmit();
              } else if (e.key === 'Escape') {
                setCardLookupOpen(false);
              }
            }}
            placeholder="e.g. 34"
          />
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => setCardLookupOpen(false)}>Cancel</button>
            <button
              type="button"
              className="primary"
              disabled={!cardLookupValue}
              onClick={() => handleCardLookupSubmit()}
            >
              Look Up
            </button>
          </div>
        </Modal>
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
        </div>
      ) : null}

      {kickedFromGameId ? (
        <Modal className="panel host-ended-modal" dismiss="none" label="kicked from game" onClose={() => undefined}>
          <h2>Kicked From Game</h2>
          <p>{kickedWhileAway ? `You were removed from game ${kickedFromGameId} while you were disconnected.` : `The host removed you from game ${kickedFromGameId}.`}</p>
          <div className="button-row">
            <button
              type="button"
              className="primary"
              onClick={() => {
                setKickedFromGameId(null);
                setKickedWhileAway(false);
                resetToLanding();
              }}
            >
              Back To Home
            </button>
          </div>
        </Modal>
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
