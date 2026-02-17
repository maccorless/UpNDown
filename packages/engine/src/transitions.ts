import type { Card, FoundationPile, GameState, GameSettings, Player } from '@upndown/shared-types';
import { createFoundationPiles } from './init.js';
import { EngineError } from './errors.js';
import { isValidPlay, requiredCardsForTurn } from './rules.js';

interface EnginePlayerInput {
  id: string;
  name: string;
}

interface CreateStartedGameParams {
  gameId: string;
  hostId: string;
  players: EnginePlayerInput[];
  settings: GameSettings;
  isSolitaire: boolean;
  deck: Card[];
}

function clonePlayer(player: Player): Player {
  return { ...player, hand: [...player.hand] };
}

function drawOne(drawPile: Card[]): Card | null {
  if (drawPile.length === 0) {
    return null;
  }

  const card = drawPile[0];
  if (!card) {
    return null;
  }
  const rest = drawPile.slice(1);
  drawPile.splice(0, drawPile.length, ...rest);
  return card;
}

function drawToHand(player: Player, drawPile: Card[], handSize: number): void {
  while (player.hand.length < handSize && drawPile.length > 0) {
    const next = drawOne(drawPile);
    if (!next) {
      return;
    }
    player.hand.push(next);
  }
}

function canPlayerSatisfyRequiredPlays(
  hand: Card[],
  pileTops: FoundationPile[],
  drawPile: Card[],
  required: number,
  autoRefillHand: boolean
): boolean {
  if (required <= 0) {
    return true;
  }

  const dfs = (localHand: Card[], localPiles: FoundationPile[], localDraw: Card[], depth: number): boolean => {
    if (depth >= required) {
      return true;
    }

    for (let cardIndex = 0; cardIndex < localHand.length; cardIndex += 1) {
      const card = localHand[cardIndex];
      if (!card) continue;

      for (let pileIndex = 0; pileIndex < localPiles.length; pileIndex += 1) {
        const pile = localPiles[pileIndex];
        if (!pile || !isValidPlay(card, pile)) {
          continue;
        }

        const nextHand = localHand.filter((_, i) => i !== cardIndex);
        const nextPiles = localPiles.map((p, i) => (i === pileIndex ? { ...p, topCard: card } : p));
        const nextDraw = [...localDraw];

        if (autoRefillHand && nextDraw.length > 0) {
          const refill = nextDraw.shift();
          if (refill) {
            nextHand.push(refill);
          }
        }

        if (dfs(nextHand, nextPiles, nextDraw, depth + 1)) {
          return true;
        }
      }
    }

    return false;
  };

  return dfs([...hand], pileTops.map((p) => ({ ...p })), [...drawPile], 0);
}

function evaluateWin(state: GameState): GameState {
  const allHandsEmpty = state.players.every((player) => player.hand.length === 0);
  if (allHandsEmpty) {
    return { ...state, gamePhase: 'won' };
  }

  return state;
}

function evaluateLossForCurrentPlayer(state: GameState): GameState {
  if (state.gamePhase !== 'playing') {
    return state;
  }

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer) {
    return state;
  }

  if (state.isSolitaire) {
    const canPlayAny = canPlayerSatisfyRequiredPlays(
      currentPlayer.hand,
      state.foundationPiles,
      state.drawPile,
      1,
      true
    );

    return canPlayAny ? state : { ...state, gamePhase: 'lost' };
  }

  // Multiplayer loss is only when there are zero legal moves and the active player
  // cannot legally end their turn yet. If they have already met the required plays,
  // they may pass the turn even with no immediate legal card plays.
  const canPlayAny = canPlayerSatisfyRequiredPlays(
    currentPlayer.hand,
    state.foundationPiles,
    state.drawPile,
    1,
    state.settings.autoRefillHand
  );

  if (canPlayAny) {
    return state;
  }

  const required = requiredCardsForTurn(state.settings.minCardsPerTurn, state.drawPile.length);
  const canEndTurn = state.cardsPlayedThisTurn >= required;
  return canEndTurn ? state : { ...state, gamePhase: 'lost' };
}

function nextPlayerIndexWithCards(players: Player[], fromIndex: number): number {
  if (players.every((player) => player.hand.length === 0)) {
    return fromIndex;
  }

  for (let offset = 1; offset <= players.length; offset += 1) {
    const idx = (fromIndex + offset) % players.length;
    const player = players[idx];
    if (player && player.hand.length > 0) {
      return idx;
    }
  }

  return fromIndex;
}

export function createStartedGameState(params: CreateStartedGameParams): GameState {
  const { gameId, hostId, settings, isSolitaire } = params;
  const players = params.players.map((player) => ({ ...player }));

  if (isSolitaire) {
    if (players.length !== 1) {
      throw new EngineError('SOLITAIRE_PLAYER_COUNT_INVALID', 'Solitaire requires exactly one player');
    }
    if (settings.minPlayers !== 1 || settings.maxPlayers !== 1) {
      throw new EngineError('SOLITAIRE_SETTINGS_INVALID', 'Solitaire requires minPlayers=1 and maxPlayers=1');
    }
    if (!settings.autoRefillHand) {
      throw new EngineError('SOLITAIRE_SETTINGS_INVALID', 'Solitaire requires autoRefillHand=true');
    }
  } else {
    if (players.length < settings.minPlayers || players.length > settings.maxPlayers) {
      throw new EngineError('INVALID_PLAYER_COUNT', 'Player count is outside configured game limits');
    }
  }

  const deck = [...params.deck];
  const hostMatchCount = players.filter((player) => player.id === hostId).length;
  if (hostMatchCount !== 1) {
    throw new EngineError('HOST_NOT_IN_PLAYERS', 'hostId must match exactly one player');
  }

  const initializedPlayers: Player[] = players.map((player) => ({
    id: player.id,
    name: player.name,
    hand: [],
    isHost: player.id === hostId
  }));

  for (let round = 0; round < settings.handSize; round += 1) {
    for (const player of initializedPlayers) {
      const next = drawOne(deck);
      if (!next) break;
      player.hand.push(next);
    }
  }

  const state: GameState = {
    gameId,
    hostId,
    players: initializedPlayers,
    foundationPiles: createFoundationPiles(settings),
    drawPile: deck,
    currentPlayerIndex: 0,
    gamePhase: 'playing',
    cardsPlayedThisTurn: 0,
    settings,
    isSolitaire
  };

  return evaluateLossForCurrentPlayer(evaluateWin(state));
}

export function playCard(state: GameState, playerId: string, cardId: string, pileId: number): GameState {
  if (state.gamePhase !== 'playing') {
    throw new EngineError('GAME_NOT_PLAYING', 'Cannot play a card when game is not in playing phase');
  }

  const nextState: GameState = {
    ...state,
    players: state.players.map(clonePlayer),
    foundationPiles: state.foundationPiles.map((pile) => ({ ...pile })),
    drawPile: [...state.drawPile]
  };

  const playerIndex = nextState.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) {
    throw new EngineError('NOT_PLAYER_TURN', 'Player not found in game');
  }

  if (!nextState.isSolitaire && playerIndex !== nextState.currentPlayerIndex) {
    throw new EngineError('NOT_PLAYER_TURN', 'Only the active player may play a card');
  }

  const player = nextState.players[playerIndex];
  if (!player) {
    throw new EngineError('NOT_PLAYER_TURN', 'Player not found in game');
  }

  const cardIndex = player.hand.findIndex((card) => card.id === cardId);
  if (cardIndex < 0) {
    throw new EngineError('CARD_NOT_FOUND', 'Card does not exist in player hand');
  }

  const pile = nextState.foundationPiles.find((target) => target.id === pileId);
  if (!pile) {
    throw new EngineError('PILE_NOT_FOUND', 'Foundation pile does not exist');
  }

  const [card] = player.hand.splice(cardIndex, 1);
  if (!card) {
    throw new EngineError('CARD_NOT_FOUND', 'Card does not exist in player hand');
  }

  if (!isValidPlay(card, pile)) {
    player.hand.splice(cardIndex, 0, card);
    throw new EngineError('INVALID_PLAY', 'Card cannot be played on selected foundation pile');
  }

  pile.topCard = card;
  nextState.cardsPlayedThisTurn += 1;

  if (nextState.isSolitaire || nextState.settings.autoRefillHand) {
    drawToHand(player, nextState.drawPile, nextState.settings.handSize);
  }

  return evaluateLossForCurrentPlayer(evaluateWin(nextState));
}

export function endTurn(state: GameState, playerId: string): GameState {
  if (state.gamePhase !== 'playing') {
    throw new EngineError('GAME_NOT_PLAYING', 'Cannot end turn when game is not in playing phase');
  }

  if (state.isSolitaire) {
    return state;
  }

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer || currentPlayer.id !== playerId) {
    throw new EngineError('NOT_PLAYER_TURN', 'Only active player can end turn');
  }

  const required = requiredCardsForTurn(state.settings.minCardsPerTurn, state.drawPile.length);
  if (state.cardsPlayedThisTurn < required) {
    throw new EngineError(
      'MIN_CARDS_NOT_MET',
      `You must play at least ${required} card(s) before ending your turn`
    );
  }

  const nextState: GameState = {
    ...state,
    players: state.players.map(clonePlayer),
    foundationPiles: state.foundationPiles.map((pile) => ({ ...pile })),
    drawPile: [...state.drawPile],
    cardsPlayedThisTurn: 0
  };

  const activePlayer = nextState.players[nextState.currentPlayerIndex];
  if (!activePlayer) {
    throw new EngineError('NOT_PLAYER_TURN', 'Active player not found');
  }

  if (!nextState.settings.autoRefillHand) {
    drawToHand(activePlayer, nextState.drawPile, nextState.settings.handSize);
  }

  nextState.currentPlayerIndex = nextPlayerIndexWithCards(nextState.players, nextState.currentPlayerIndex);

  return evaluateLossForCurrentPlayer(evaluateWin(nextState));
}
