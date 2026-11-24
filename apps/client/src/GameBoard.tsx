import { isValidPlay, requiredCardsForTurn } from '@upndown/engine';
import type { Card, GameState, ReactionState, ReactionType } from '@upndown/shared-types';
import { deckProgress, isBackwardTen, PLAYER_COLOR_HEX, specialFlashLabel, turnProgress } from './board-helpers.js';
import { Modal } from './Modal.js';
import { useEffect, useState } from 'react';
import { ConnectionNotices, hasConnectionNotices } from './ConnectionNotices.js';
import { EndGameSplash } from './EndGame.js';
import { buildInviteLink } from './game-url.js';

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
  mode: 'solitaire' | 'multiplayer';
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
  // The viewer's own setting (arrows beside each pile card).
  showArrows: boolean;
  playerId?: string | null;
  interactionDisabled?: boolean;
  onSetReaction?: (pileId: number, reactionType: ReactionType | null) => void;
  gameReactions?: ReactionState;
  specialPlayPileId?: number | null | undefined;
  // The flash says Lifeline instead of the usual 10 when the play was the only way forward.
  specialPlayLifeline?: boolean | undefined;
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
    showArrows,
    playerId,
    interactionDisabled,
    onSetReaction,
    gameReactions = {},
    specialPlayPileId: specialPlayPileIdProp = null,
    specialPlayLifeline = false,
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
            const specialLabel = specialFlashLabel(pile.type, specialPlayLifeline);
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

      <section className={`panel hand-panel${mode === 'multiplayer' && gameState.gamePhase === 'playing' && isMyTurn ? ' my-turn' : ''}`} aria-label="your hand">
        {mode === 'multiplayer' && gameState.gamePhase === 'playing' && isMyTurn ? (
          // keyed by the turn count so the entrance plays again each time the turn comes back to this player
          <div key={gameState.statistics.turns} className="your-turn-banner" aria-live="polite" data-testid="your-turn-banner">
            Your turn: play at least {requiredPlaysThisTurn} {requiredPlaysThisTurn === 1 ? 'card' : 'cards'}
          </div>
        ) : null}
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
        <div className={`cards-fan ${isCompactHand ? 'compact' : ''}`} style={{ '--hand-n': Math.max(1, sortedHand.length), '--hand-gaps': Math.max(1, sortedHand.length - 1) } as React.CSSProperties}>
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
