import type {
  Card,
  CheatKind,
  FoundationPile,
  GameState,
  GameSettings,
  Player,
  PlayerColor,
  PlayerStatistics
} from '@upndown/shared-types';
import { cheatLimitOf, isNasName, PLAYER_COLORS } from '@upndown/shared-types';
import { createFoundationPiles } from './init.js';
import { EngineError } from './errors.js';
import { hasNormalPlay, isValidPlay, requiredCardsForTurn } from './rules.js';

interface EnginePlayerInput {
  id: string;
  name: string;
  color?: PlayerColor;
  robot?: boolean;
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

export function emptyPlayerStats(): PlayerStatistics {
  return {
    cardsPlayed: 0,
    totalMovement: 0,
    specialPlays: 0,
    nasCheatsUsed: 0,
    skipsUsed: 0,
    tradesUsed: 0,
    lookupsUsed: 0,
    nasChecksUsed: 0,
    montyUsed: 0,
    hintsUsed: 0,
    undosUsed: 0,
    marksPlaced: 0,
    lifelines: 0,
    markFollows: 0
  };
}

function ensureStatsForPlayers(state: GameState): GameState {
  const playersStats = { ...state.statistics.players };
  for (const player of state.players) {
    if (!playersStats[player.id]) {
      playersStats[player.id] = emptyPlayerStats();
    }
  }
  return {
    ...state,
    statistics: {
      ...state.statistics,
      players: playersStats
    },
    nasCheat: {
      ...state.nasCheat,
      usedThisTurnByPlayerId: { ...state.nasCheat.usedThisTurnByPlayerId }
    }
  };
}

function drawOne(drawPile: Card[]): Card | null {
  return drawPile.shift() ?? null;
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
    return {
      ...state,
      gamePhase: 'won',
      statistics: {
        ...state.statistics,
        endedAtMs: state.statistics.endedAtMs ?? Date.now()
      }
    };
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

    return canPlayAny ? state : {
      ...state,
      gamePhase: 'lost',
      statistics: {
        ...state.statistics,
        endedAtMs: state.statistics.endedAtMs ?? Date.now()
      }
    };
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
  return canEndTurn ? state : {
    ...state,
    gamePhase: 'lost',
    statistics: {
      ...state.statistics,
      endedAtMs: state.statistics.endedAtMs ?? Date.now()
    }
  };
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

  const initializedPlayers: Player[] = players.map((player, index) => ({
    id: player.id,
    name: player.name,
    hand: [],
    isHost: player.id === hostId,
    color: player.color ?? (PLAYER_COLORS[index % PLAYER_COLORS.length] as PlayerColor),
    ...(player.robot ? { robot: true } : {})
  }));

  if (initializedPlayers.length * settings.handSize > deck.length) {
    throw new EngineError('INSUFFICIENT_DECK_FOR_DEAL', 'The deck cannot deal every player a full hand');
  }

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
    statistics: {
      turns: 0,
      startedAtMs: Date.now(),
      endedAtMs: null,
      players: Object.fromEntries(initializedPlayers.map((player) => [player.id, emptyPlayerStats()]))
    },
    nasCheat: {
      enabledPlayerIds: initializedPlayers
        .filter((player) => player.name.trim().toLowerCase() === 'nas')
        .map((player) => player.id),
      usedThisTurnByPlayerId: Object.fromEntries(initializedPlayers.map((player) => [player.id, false]))
    },
    settings,
    isSolitaire
  };

  return ensureStatsForPlayers(evaluateLossForCurrentPlayer(evaluateWin(state)));
}

// `markedBy` are the seated people whose hand-placed mark was up on this pile when the card went down. The server knows the
// marks; the engine only counts them, and each one earns a follow. A player is never credited for their own play.
export function playCard(state: GameState, playerId: string, cardId: string, pileId: number, markedBy: readonly string[] = []): GameState {
  if (state.gamePhase !== 'playing') {
    throw new EngineError('GAME_NOT_PLAYING', 'Cannot play a card when game is not in playing phase');
  }

  const nextState: GameState = {
    ...state,
    players: state.players.map(clonePlayer),
    foundationPiles: state.foundationPiles.map((pile) => ({ ...pile })),
    drawPile: [...state.drawPile],
    statistics: {
      ...state.statistics,
      players: { ...state.statistics.players }
    },
    nasCheat: {
      ...state.nasCheat,
      usedThisTurnByPlayerId: { ...state.nasCheat.usedThisTurnByPlayerId }
    }
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

  // Checked before the pile moves. The card is out of the hand by now, so it is put back: a lifeline is a backward 10 where
  // no card the player had, this one included, had a normal play on either pile.
  const lifeline = !hasNormalPlay([...player.hand, card], nextState.foundationPiles);
  for (const markerId of new Set(markedBy)) {
    if (markerId === playerId) continue;
    const marker = { ...emptyPlayerStats(), ...nextState.statistics.players[markerId] };
    nextState.statistics.players[markerId] = { ...marker, markFollows: marker.markFollows + 1 };
  }

  const previousTopValue = pile.topCard.value;
  pile.topCard = card;
  nextState.cardsPlayedThisTurn += 1;
  nextState.consecutiveSkips = 0;

  // Merged with the defaults so a game saved before a counter existed reads it as zero, not as undefined.
  const activeStats = { ...emptyPlayerStats(), ...nextState.statistics.players[player.id] };
  const movementDelta = card.value - previousTopValue;
  // Net progress along the pile's direction: a backward 10 takes ten away, so the total matches where the piles ended.
  const movement = pile.type === 'ascending' ? movementDelta : -movementDelta;
  const isBackwardTen = (
    (pile.type === 'ascending' && movementDelta === -10)
    || (pile.type === 'descending' && movementDelta === 10)
  );
  nextState.statistics.players[player.id] = {
    ...activeStats,
    cardsPlayed: activeStats.cardsPlayed + 1,
    totalMovement: activeStats.totalMovement + movement,
    specialPlays: activeStats.specialPlays + (isBackwardTen ? 1 : 0),
    lifelines: activeStats.lifelines + (lifeline ? 1 : 0)
  };

  if (nextState.isSolitaire || nextState.settings.autoRefillHand) {
    drawToHand(player, nextState.drawPile, nextState.settings.handSize);
  }

  const result = ensureStatsForPlayers(evaluateLossForCurrentPlayer(evaluateWin(nextState)));
  // Only a card play can be the play that wins; the shared win check also runs from other moves, which stay unattributed.
  return result.gamePhase === 'won' ? { ...result, statistics: { ...result.statistics, finishedById: player.id } } : result;
}

// After an undo the play is taken back but nothing else is: a hint, a lookup or a mark placed since the snapshot stays counted
// for everyone, and the player who undid gets one more undo on their record.
export function carryAfterUndo(restored: GameState, current: GameState, undoingPlayerId: string): GameState {
  return {
    ...restored,
    // Switching auto-mark on or off is not a play, so the snapshot's setting must not win over the player's latest choice.
    players: restored.players.map((p) => {
      const on = current.players.find((c) => c.id === p.id)?.autoMark === true;
      return on ? { ...p, autoMark: true } : Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'autoMark')) as typeof p;
    }),
    statistics: {
      ...restored.statistics,
      players: Object.fromEntries(Object.entries(restored.statistics.players).map(([id, stats]) => {
        const now = current.statistics.players[id];
        const kept = now
          ? { ...stats, skipsUsed: now.skipsUsed, tradesUsed: now.tradesUsed, lookupsUsed: now.lookupsUsed, nasChecksUsed: now.nasChecksUsed, montyUsed: now.montyUsed, hintsUsed: now.hintsUsed, marksPlaced: now.marksPlaced, undosUsed: now.undosUsed }
          : stats;
        return [id, id === undoingPlayerId ? { ...kept, undosUsed: kept.undosUsed + 1 } : kept];
      }))
    }
  };
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
    cardsPlayedThisTurn: 0,
    statistics: {
      ...state.statistics,
      turns: state.statistics.turns + 1,
      players: { ...state.statistics.players }
    },
    nasCheat: {
      ...state.nasCheat,
      usedThisTurnByPlayerId: Object.fromEntries(state.players.map((player) => [player.id, false]))
    }
  };

  const activePlayer = nextState.players[nextState.currentPlayerIndex];
  if (!activePlayer) {
    throw new EngineError('NOT_PLAYER_TURN', 'Active player not found');
  }

  if (!nextState.settings.autoRefillHand) {
    drawToHand(activePlayer, nextState.drawPile, nextState.settings.handSize);
  }

  nextState.currentPlayerIndex = nextPlayerIndexWithCards(nextState.players, nextState.currentPlayerIndex);

  return ensureStatsForPlayers(evaluateLossForCurrentPlayer(evaluateWin(nextState)));
}

// After a seat is removed mid-game (a kick) its cards went back to the draw pile. When hands refill as cards are played,
// top them up and see whether the game is now won (only possible with the draw pile empty) or the active player is stuck.
// Without auto refill, hands fill at the end of a turn, so nothing here may judge them.
export function settleAfterRemoval(state: GameState): GameState {
  if (state.gamePhase !== 'playing' || state.isSolitaire || !state.settings.autoRefillHand) {
    return state;
  }
  const next: GameState = {
    ...state,
    players: state.players.map(clonePlayer),
    drawPile: [...state.drawPile]
  };
  for (const player of next.players) {
    drawToHand(player, next.drawPile, next.settings.handSize);
  }
  return ensureStatsForPlayers(evaluateLossForCurrentPlayer(evaluateWin(next)));
}

// A cheat is allowed when its setting is not off and, under "once", this player has not used it yet. Counts are the
// player's own, so a rejoin (which moves the seat's statistics) keeps them.
// The Nas check and the full Monty are lookups too, so each counts in lookupsUsed as well as its own counter. The card seeker's
// own count is the lookups that were neither, so each of the three cheats has its own "once".
type CheatCounter = 'skipsUsed' | 'tradesUsed' | 'lookupsUsed' | 'nasChecksUsed' | 'montyUsed' | 'hintsUsed';
const countersOf = (kind: CheatKind): CheatCounter[] =>
  kind === 'skip' ? ['skipsUsed'] : kind === 'trade' ? ['tradesUsed'] : kind === 'lookup' ? ['lookupsUsed']
    : kind === 'nas' ? ['lookupsUsed', 'nasChecksUsed'] : kind === 'monty' ? ['lookupsUsed', 'montyUsed'] : ['hintsUsed'];

const usedCount = (stats: PlayerStatistics, kind: CheatKind): number =>
  kind === 'nas' ? stats.nasChecksUsed
    : kind === 'monty' ? stats.montyUsed
    : kind === 'lookup' ? stats.lookupsUsed - stats.nasChecksUsed - stats.montyUsed
    : kind === 'skip' ? stats.skipsUsed
    : kind === 'trade' ? stats.tradesUsed
    : stats.hintsUsed;

export function assertCheatAvailable(state: GameState, playerId: string, kind: CheatKind): void {
  const limit = cheatLimitOf(state.settings, kind);
  if (limit === 'off') {
    throw new EngineError('INVALID_PLAY', 'This cheat is not enabled for this game');
  }
  if (kind === 'nas' && !isNasName(state.players.find((player) => player.id === playerId)?.name ?? '')) {
    throw new EngineError('INVALID_PLAY', 'Only a player named Nas can use the Nas check');
  }
  const stats = state.statistics.players[playerId] ?? emptyPlayerStats();
  if (limit === 'once' && usedCount(stats, kind) >= 1) {
    throw new EngineError('INVALID_PLAY', 'You have already used this cheat');
  }
}

function withCheatCounted(state: GameState, playerId: string, kind: CheatKind): GameState {
  const stats = state.statistics.players[playerId] ?? emptyPlayerStats();
  const next: PlayerStatistics = { ...stats };
  for (const counter of countersOf(kind)) next[counter] = stats[counter] + 1;
  return {
    ...state,
    statistics: {
      ...state.statistics,
      players: { ...state.statistics.players, [playerId]: next }
    }
  };
}

// Counts a use of a cheat that does not change the game (the card seeker, a hint) after checking it is allowed.
export function recordCheatUse(state: GameState, playerId: string, kind: CheatKind): GameState {
  if (state.gamePhase !== 'playing') {
    throw new EngineError('GAME_NOT_PLAYING', 'Cheats can only be used while a game is being played');
  }
  if (!state.players.some((player) => player.id === playerId)) {
    throw new EngineError('NOT_PLAYER_TURN', 'Player not found in game');
  }
  assertCheatAvailable(state, playerId, kind);
  return withCheatCounted(state, playerId, kind);
}

// Turns auto-mark on or off for one person at a table. It is a player setting, not a cheat: no limit, nothing counted.
// Solitaire has no one to react to the player, so it is refused there.
export function setAutoMark(state: GameState, playerId: string, enabled: boolean): GameState {
  if (state.isSolitaire) {
    throw new EngineError('INVALID_PLAY', 'Auto-mark is for tables with other players');
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new EngineError('NOT_PLAYER_TURN', 'Player not found in game');
  }
  if (!!player.autoMark === enabled) return state;
  return { ...state, players: state.players.map((p) => (p.id === playerId ? { ...p, autoMark: enabled } : p)) };
}

// Deals a new player into a game being played. They are given a hand from the BOTTOM of the draw pile: refills come off the
// top, so the cards the active player would draw next are not disturbed, and the pile is shuffled so nobody can tell. Every
// other hand and every foundation pile stays exactly as it was. The caller refuses an admission whose result is no longer
// being played, because an admission must never be what ends a game.
export function admitPlayer(state: GameState, input: { id: string; name: string; color?: PlayerColor }): GameState {
  if (state.gamePhase !== 'playing' || state.isSolitaire) {
    throw new EngineError('GAME_NOT_PLAYING', 'Players can only be dealt into a game being played');
  }
  if (state.drawPile.length === 0) {
    throw new EngineError('INSUFFICIENT_DECK_FOR_DEAL', 'There are no cards left to deal a new player');
  }
  const drawPile = [...state.drawPile];
  const count = Math.min(state.settings.handSize, drawPile.length);
  const hand = drawPile.splice(drawPile.length - count, count);
  const next: GameState = {
    ...state,
    players: [
      ...state.players.map(clonePlayer),
      { id: input.id, name: input.name, hand, isHost: false, color: input.color ?? (PLAYER_COLORS[state.players.length % PLAYER_COLORS.length] as PlayerColor) }
    ],
    foundationPiles: state.foundationPiles.map((pile) => ({ ...pile })),
    drawPile,
    statistics: { ...state.statistics, players: { ...state.statistics.players } },
    nasCheat: { ...state.nasCheat, usedThisTurnByPlayerId: { ...state.nasCheat.usedThisTurnByPlayerId, [input.id]: false } }
  };
  return ensureStatsForPlayers(evaluateLossForCurrentPlayer(evaluateWin(next)));
}

// Pass the turn without meeting the minimum, as a cheat. It is not a rescue: it is only possible while the game is still
// being played and before a card has been played this turn. A full round of skips with no card played by anyone ends the
// game as a loss, so an unlimited skip cannot stall a table for ever.
export function skipTurn(state: GameState, playerId: string): GameState {
  if (state.gamePhase !== 'playing') {
    throw new EngineError('GAME_NOT_PLAYING', 'Cannot skip when game is not in playing phase');
  }
  if (state.isSolitaire) {
    throw new EngineError('INVALID_PLAY', 'There is no turn to skip in solitaire');
  }
  const current = state.players[state.currentPlayerIndex];
  if (!current || current.id !== playerId) {
    throw new EngineError('NOT_PLAYER_TURN', 'Only active player can skip');
  }
  assertCheatAvailable(state, playerId, 'skip');
  if (state.cardsPlayedThisTurn > 0) {
    throw new EngineError('INVALID_PLAY', 'You can only skip before playing a card this turn');
  }

  const counted = withCheatCounted(state, playerId, 'skip');
  const streak = (state.consecutiveSkips ?? 0) + 1;
  const nextState: GameState = {
    ...counted,
    players: counted.players.map(clonePlayer),
    foundationPiles: counted.foundationPiles.map((pile) => ({ ...pile })),
    drawPile: [...counted.drawPile],
    cardsPlayedThisTurn: 0,
    consecutiveSkips: streak,
    statistics: { ...counted.statistics, turns: counted.statistics.turns + 1 },
    nasCheat: { ...counted.nasCheat, usedThisTurnByPlayerId: Object.fromEntries(counted.players.map((player) => [player.id, false])) }
  };

  if (streak >= nextState.players.length) {
    return ensureStatsForPlayers({
      ...nextState,
      gamePhase: 'lost',
      statistics: { ...nextState.statistics, endedAtMs: nextState.statistics.endedAtMs ?? Date.now() }
    });
  }

  nextState.currentPlayerIndex = nextPlayerIndexWithCards(nextState.players, nextState.currentPlayerIndex);
  return ensureStatsForPlayers(evaluateLossForCurrentPlayer(evaluateWin(nextState)));
}

// Trade a card from your hand for the next card of the draw pile; the card you hand over goes back into the pile at a
// random place. Only the active player may trade. `random` is injectable so a game can be reproduced.
export function tradeCard(state: GameState, playerId: string, cardId: string, random: () => number = Math.random): GameState {
  if (state.gamePhase !== 'playing') {
    throw new EngineError('GAME_NOT_PLAYING', 'Cannot trade when game is not in playing phase');
  }

  const playerIndex = state.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) {
    throw new EngineError('NOT_PLAYER_TURN', 'Player not found in game');
  }
  if (!state.isSolitaire && playerIndex !== state.currentPlayerIndex) {
    throw new EngineError('NOT_PLAYER_TURN', 'Only the active player may trade');
  }
  assertCheatAvailable(state, playerId, 'trade');
  if (state.drawPile.length === 0) {
    throw new EngineError('INVALID_PLAY', 'Trading requires at least one card in the draw pile');
  }

  const counted = withCheatCounted(state, playerId, 'trade');
  const nextState: GameState = {
    ...counted,
    players: counted.players.map(clonePlayer),
    foundationPiles: counted.foundationPiles.map((pile) => ({ ...pile })),
    drawPile: [...counted.drawPile]
  };

  const player = nextState.players[playerIndex];
  const cardIndex = player?.hand.findIndex((card) => card.id === cardId) ?? -1;
  if (!player || cardIndex < 0) {
    throw new EngineError('CARD_NOT_FOUND', 'Card does not exist in player hand');
  }
  const [tradedCard] = player.hand.splice(cardIndex, 1);
  const replacementCard = drawOne(nextState.drawPile);
  if (!tradedCard || !replacementCard) {
    throw new EngineError('CARD_NOT_FOUND', 'Card does not exist in player hand');
  }
  player.hand.push(replacementCard);
  nextState.drawPile.splice(Math.floor(random() * (nextState.drawPile.length + 1)), 0, tradedCard);

  return ensureStatsForPlayers(evaluateLossForCurrentPlayer(evaluateWin(nextState)));
}
