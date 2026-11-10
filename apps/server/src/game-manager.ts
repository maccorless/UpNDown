import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { buildDeck, createStartedGameState, emptyPlayerStats, endTurn, playCard, shuffle, useNasCheat } from '@upndown/engine';
import type {
  CreateGamePayload,
  GameState,
  JoinableGameSummary,
  JoinGamePayload,
  JoinLookupSummary,
  KickPlayerPayload,
  NasCheatPayload,
  PlayCardPayload,
  Player,
  PlayerColor,
  ReactionState,
  ReactionType,
  UpdateSettingsPayload
} from '@upndown/shared-types';
import { defaultMultiplayerSettings, PLAYER_COLORS } from '@upndown/shared-types';
import { createFoundationPiles } from '@upndown/engine';

interface GameRoom {
  gameState: GameState;
  createdAtMs: number;
  updatedAtMs: number;
  turnUndoStack: GameState[];
  rejoinTokens: Map<string, string>;
}

function tokensMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

function swapPlayerId(state: GameState, oldPlayerId: string, newPlayerId: string): void {
  const player = state.players.find((p) => p.id === oldPlayerId);
  if (!player) {
    return;
  }
  player.id = newPlayerId;

  if (state.hostId === oldPlayerId) {
    state.hostId = newPlayerId;
  }

  if (state.statistics.players[oldPlayerId]) {
    state.statistics.players[newPlayerId] = state.statistics.players[oldPlayerId];
    delete state.statistics.players[oldPlayerId];
  }

  if (oldPlayerId in state.nasCheat.usedThisTurnByPlayerId) {
    state.nasCheat.usedThisTurnByPlayerId[newPlayerId] = state.nasCheat.usedThisTurnByPlayerId[oldPlayerId] ?? false;
    delete state.nasCheat.usedThisTurnByPlayerId[oldPlayerId];
  }
  const nasIdx = state.nasCheat.enabledPlayerIds.indexOf(oldPlayerId);
  if (nasIdx >= 0) {
    state.nasCheat.enabledPlayerIds[nasIdx] = newPlayerId;
  }
}

const MAX_UNDO_SNAPSHOTS = 100;

// One message for missing, started and full games so a guesser cannot tell which ids exist.
const GAME_UNAVAILABLE_MESSAGE = 'This game is not available. Check the game ID; it may be full or already started.';

function generateGameId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 6; i += 1) {
    id += alphabet[randomInt(alphabet.length)] ?? 'A';
  }
  return id;
}

export class GameManager {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly reactions = new Map<string, Map<string, Map<number, ReactionType>>>();

  getReactions(gameId: string): ReactionState {
    const gameReactions = this.reactions.get(gameId);
    if (!gameReactions) return {};
    const result: ReactionState = {};
    for (const [playerId, pileMap] of gameReactions) {
      result[playerId] = {};
      for (const [pileId, reaction] of pileMap) {
        result[playerId][pileId] = reaction;
      }
    }
    return result;
  }

  setReaction(gameId: string, playerId: string, pileId: number, reactionType: ReactionType | null): void {
    const room = this.requireRoom(gameId);
    if (!room.gameState.players.some((p) => p.id === playerId)) {
      throw new Error('Player not in game');
    }
    if (room.gameState.gamePhase !== 'playing') {
      throw new Error('Reactions are only allowed during an active game');
    }
    const currentPlayer = room.gameState.players[room.gameState.currentPlayerIndex];
    if (currentPlayer?.id === playerId) {
      throw new Error('Cannot react during your own turn');
    }

    if (!this.reactions.has(gameId)) {
      this.reactions.set(gameId, new Map());
    }
    const gameReactions = this.reactions.get(gameId)!;

    if (reactionType === null) {
      const playerPiles = gameReactions.get(playerId);
      if (playerPiles) {
        playerPiles.delete(pileId);
        if (playerPiles.size === 0) gameReactions.delete(playerId);
      }
    } else {
      if (!gameReactions.has(playerId)) gameReactions.set(playerId, new Map());
      gameReactions.get(playerId)!.set(pileId, reactionType);
    }
  }

  clearPlayerReactions(gameId: string, playerId: string): void {
    this.reactions.get(gameId)?.delete(playerId);
  }

  clearAllReactions(gameId: string): void {
    this.reactions.delete(gameId);
  }

  getRejoinToken(gameId: string, playerId: string): string {
    const token = this.requireRoom(gameId).rejoinTokens.get(playerId);
    if (!token) {
      throw new Error('No rejoin token for player');
    }
    return token;
  }

  rejoinPlayer(gameId: string, oldPlayerId: string, newPlayerId: string, rejoinToken: string): GameState {
    const room = this.requireRoom(gameId);
    const { gameState } = room;
    const expectedToken = room.rejoinTokens.get(oldPlayerId);
    const seatExists = gameState.players.some((p) => p.id === oldPlayerId);
    // Same message for a missing seat and a wrong token so callers cannot probe which seats exist.
    if (!seatExists || !expectedToken || !tokensMatch(expectedToken, rejoinToken)) {
      throw new Error('Unable to rejoin game');
    }
    if (gameState.players.some((p) => p.id === newPlayerId)) {
      throw new Error('Unable to rejoin game');
    }

    swapPlayerId(gameState, oldPlayerId, newPlayerId);
    for (const snapshot of room.turnUndoStack) {
      swapPlayerId(snapshot, oldPlayerId, newPlayerId);
    }

    room.rejoinTokens.delete(oldPlayerId);
    room.rejoinTokens.set(newPlayerId, randomUUID());

    // Swap reactions
    const gameReactions = this.reactions.get(gameId);
    if (gameReactions?.has(oldPlayerId)) {
      gameReactions.set(newPlayerId, gameReactions.get(oldPlayerId)!);
      gameReactions.delete(oldPlayerId);
    }

    room.updatedAtMs = Date.now();
    return gameState;
  }

  getSpecialPlays(gameId: string, playerId: string): number {
    const room = this.rooms.get(gameId);
    if (!room) return 0;
    return room.gameState.statistics.players[playerId]?.specialPlays ?? 0;
  }

  createGame(ownerPlayerId: string, payload: CreateGamePayload): GameState {
    if (payload.isSolitaire) {
      throw new Error('Solitaire is client-only in v1');
    }

    const gameId = this.generateUniqueGameId();

    const host: Player = {
      id: ownerPlayerId,
      name: payload.playerName,
      hand: [],
      isHost: true,
      color: PLAYER_COLORS[0] as PlayerColor
    };

    const state: GameState = {
      gameId,
      hostId: ownerPlayerId,
      players: [host],
      foundationPiles: createFoundationPiles(payload.settings),
      drawPile: [],
      currentPlayerIndex: 0,
      gamePhase: 'lobby',
      cardsPlayedThisTurn: 0,
      statistics: {
        turns: 0,
        startedAtMs: null,
        endedAtMs: null,
        players: {
          [ownerPlayerId]: emptyPlayerStats()
        }
      },
      nasCheat: {
        enabledPlayerIds: [],
        usedThisTurnByPlayerId: {
          [ownerPlayerId]: false
        }
      },
      settings: payload.settings,
      isSolitaire: false
    };

    const now = Date.now();
    this.rooms.set(gameId, {
      gameState: state,
      createdAtMs: now,
      updatedAtMs: now,
      turnUndoStack: [],
      rejoinTokens: new Map([[ownerPlayerId, randomUUID()]])
    });
    return state;
  }

  listJoinableGames(activePlayerIds?: ReadonlySet<string>): JoinableGameSummary[] {
    if (activePlayerIds) {
      for (const [gameId, room] of this.rooms) {
        const connectedCount = room.gameState.players.filter((player) => activePlayerIds.has(player.id)).length;
        if (connectedCount === 0) {
          this.rooms.delete(gameId);
          this.reactions.delete(gameId);
        }
      }
    }

    return [...this.rooms.values()]
      .filter((room) => {
        const state = room.gameState;
        return state.gamePhase === 'lobby'
          && !state.settings.privateGame
          && state.players.length < state.settings.maxPlayers;
      })
      .map((room) => {
        const host = room.gameState.players.find((player) => player.id === room.gameState.hostId);
        return {
          gameId: room.gameState.gameId,
          hostName: host?.name ?? 'Host',
          playerCount: room.gameState.players.length,
          maxPlayers: room.gameState.settings.maxPlayers,
          createdAtMs: room.createdAtMs
        };
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }

  joinGame(playerId: string, payload: JoinGamePayload): GameState {
    const room = this.rooms.get(payload.gameId);
    if (!room) {
      throw new Error(GAME_UNAVAILABLE_MESSAGE);
    }

    const { gameState } = room;
    if (gameState.gamePhase !== 'lobby') {
      throw new Error(GAME_UNAVAILABLE_MESSAGE);
    }

    if (gameState.players.some((player) => player.id === playerId)) {
      return gameState;
    }

    if (gameState.players.length >= gameState.settings.maxPlayers) {
      throw new Error(GAME_UNAVAILABLE_MESSAGE);
    }

    const nextState: GameState = {
      ...gameState,
      players: [...gameState.players, { id: playerId, name: payload.playerName, hand: [], isHost: false, color: PLAYER_COLORS[gameState.players.length % PLAYER_COLORS.length] as PlayerColor }],
      statistics: {
        ...gameState.statistics,
        players: {
          ...gameState.statistics.players,
          [playerId]: gameState.statistics.players[playerId] ?? emptyPlayerStats()
        }
      },
      nasCheat: {
        ...gameState.nasCheat,
        usedThisTurnByPlayerId: {
          ...gameState.nasCheat.usedThisTurnByPlayerId,
          [playerId]: false
        }
      }
    };

    room.gameState = nextState;
    room.rejoinTokens.set(playerId, randomUUID());
    room.updatedAtMs = Date.now();
    return nextState;
  }

  lookupJoinableGame(gameId: string): JoinLookupSummary {
    const room = this.rooms.get(gameId);
    if (!room || room.gameState.gamePhase !== 'lobby' || room.gameState.players.length >= room.gameState.settings.maxPlayers) {
      throw new Error(GAME_UNAVAILABLE_MESSAGE);
    }
    const { gameState } = room;

    return {
      gameId: gameState.gameId,
      playerCount: gameState.players.length,
      maxPlayers: gameState.settings.maxPlayers,
      privateGame: gameState.settings.privateGame
    };
  }

  startGame(playerId: string, gameId: string): GameState {
    const room = this.requireRoom(gameId);
    const { gameState } = room;

    if (gameState.gamePhase !== 'lobby') {
      throw new Error('Game already started');
    }

    if (gameState.hostId !== playerId) {
      throw new Error('Only host can start game');
    }

    if (gameState.players.length < gameState.settings.minPlayers) {
      throw new Error(`Need at least ${gameState.settings.minPlayers} players to start`);
    }

    const started = createStartedGameState({
      gameId,
      hostId: gameState.hostId,
      players: gameState.players.map((p) => ({ id: p.id, name: p.name, ...(p.color ? { color: p.color } : {}) })),
      settings: gameState.settings,
      isSolitaire: false,
      deck: shuffle(buildDeck(gameState.settings))
    });

    room.gameState = started;
    room.turnUndoStack = [];
    room.updatedAtMs = Date.now();
    return started;
  }

  playCard(playerId: string, payload: PlayCardPayload): GameState {
    const room = this.requireRoom(payload.gameId);
    const previous = room.gameState;
    const nextState = playCard(previous, playerId, payload.cardId, payload.pileId);
    if (previous.settings.allowUndo) {
      room.turnUndoStack.push(structuredClone(previous));
      if (room.turnUndoStack.length > MAX_UNDO_SNAPSHOTS) {
        room.turnUndoStack.shift();
      }
    }
    room.gameState = nextState;
    room.updatedAtMs = Date.now();
    return nextState;
  }

  undoLastPlay(playerId: string, gameId: string): GameState {
    const room = this.requireRoom(gameId);
    if (!room.gameState.settings.allowUndo) {
      throw new Error('Undo is not enabled for this game');
    }
    if (room.gameState.gamePhase !== 'playing') {
      throw new Error('Cannot undo outside of active game');
    }
    const currentPlayer = room.gameState.players[room.gameState.currentPlayerIndex];
    if (currentPlayer?.id !== playerId) {
      throw new Error('Can only undo during your own turn');
    }
    if (room.turnUndoStack.length === 0) {
      throw new Error('Nothing to undo');
    }
    const previous = room.turnUndoStack.pop()!;
    room.gameState = previous;
    room.updatedAtMs = Date.now();
    return previous;
  }

  nasCheat(playerId: string, payload: NasCheatPayload): GameState {
    const room = this.requireRoom(payload.gameId);
    const nextState = useNasCheat(room.gameState, playerId, payload.cardId);
    room.gameState = nextState;
    room.updatedAtMs = Date.now();
    return nextState;
  }

  endTurn(playerId: string, gameId: string): GameState {
    const room = this.requireRoom(gameId);
    const nextState = endTurn(room.gameState, playerId);
    room.gameState = nextState;
    room.turnUndoStack = [];
    room.updatedAtMs = Date.now();
    return nextState;
  }

  endGame(playerId: string, gameId: string): GameState {
    const room = this.requireRoom(gameId);
    const { gameState } = room;

    if (gameState.hostId !== playerId) {
      throw new Error('Only host can end game');
    }

    if (gameState.gamePhase === 'lobby') {
      throw new Error('Game is already in lobby');
    }

    const nextState: GameState = {
      ...gameState,
      players: gameState.players.map((player) => ({ ...player, hand: [] })),
      foundationPiles: createFoundationPiles(gameState.settings),
      drawPile: [],
      currentPlayerIndex: 0,
      cardsPlayedThisTurn: 0,
      gamePhase: 'lobby',
      statistics: {
        turns: 0,
        startedAtMs: null,
        endedAtMs: null,
        players: Object.fromEntries(gameState.players.map((player) => [player.id, emptyPlayerStats()]))
      },
      nasCheat: {
        enabledPlayerIds: [],
        usedThisTurnByPlayerId: Object.fromEntries(gameState.players.map((player) => [player.id, false]))
      }
    };

    room.gameState = nextState;
    room.updatedAtMs = Date.now();
    return nextState;
  }

  updateSettings(playerId: string, payload: UpdateSettingsPayload): GameState {
    const room = this.requireRoom(payload.gameId);
    const { gameState } = room;

    if (gameState.gamePhase !== 'lobby') {
      throw new Error('Settings can only be changed in lobby');
    }

    if (gameState.hostId !== playerId) {
      throw new Error('Only host can change settings');
    }

    if (payload.settings.minPlayers < 2 || payload.settings.maxPlayers < 2) {
      throw new Error('Multiplayer requires at least 2 players');
    }

    if (gameState.players.length > payload.settings.maxPlayers) {
      throw new Error('Current player count exceeds new max players');
    }

    if (gameState.players.length < payload.settings.minPlayers) {
      throw new Error('Current player count is below new min players');
    }

    const nextState: GameState = {
      ...gameState,
      settings: payload.settings
    };

    room.gameState = nextState;
    room.updatedAtMs = Date.now();
    return nextState;
  }

  leaveGame(playerId: string, gameId: string): GameState | null {
    const room = this.requireRoom(gameId);
    const { gameState } = room;

    if (gameState.gamePhase === 'playing') {
      throw new Error('Leaving during active game is not supported in v1');
    }

    const players = gameState.players.filter((player) => player.id !== playerId);
    if (players.length === 0) {
      this.rooms.delete(gameId);
      return null;
    }

    const nextHost = players.find((player) => player.id === gameState.hostId) ?? players[0];
    const nextState: GameState = {
      ...gameState,
      hostId: nextHost?.id ?? gameState.hostId,
      players: players.map((player) => ({
        ...player,
        isHost: player.id === (nextHost?.id ?? gameState.hostId)
      })),
      statistics: {
        ...gameState.statistics,
        players: Object.fromEntries(players.map((player) => [
          player.id,
          gameState.statistics.players[player.id] ?? emptyPlayerStats()
        ]))
      },
      nasCheat: {
        ...gameState.nasCheat,
        enabledPlayerIds: gameState.nasCheat.enabledPlayerIds.filter((id) => players.some((player) => player.id === id)),
        usedThisTurnByPlayerId: Object.fromEntries(players.map((player) => [
          player.id,
          gameState.nasCheat.usedThisTurnByPlayerId[player.id] ?? false
        ]))
      }
    };

    room.gameState = nextState;
    room.updatedAtMs = Date.now();
    return nextState;
  }

  kickPlayer(hostPlayerId: string, payload: KickPlayerPayload): GameState {
    const room = this.requireRoom(payload.gameId);
    const { gameState } = room;

    if (gameState.gamePhase === 'won' || gameState.gamePhase === 'lost') {
      throw new Error('Cannot kick players after the game has ended');
    }

    if (gameState.hostId !== hostPlayerId) {
      throw new Error('Only host can kick players');
    }

    if (payload.targetPlayerId === hostPlayerId) {
      throw new Error('Cannot kick yourself');
    }

    const kickedPlayerIndex = gameState.players.findIndex((p) => p.id === payload.targetPlayerId);
    if (kickedPlayerIndex === -1) {
      throw new Error('Player not found in game');
    }

    const kickedPlayer = gameState.players[kickedPlayerIndex]!;
    const players = gameState.players.filter((p) => p.id !== payload.targetPlayerId);

    // Return kicked player's cards to draw pile in random order
    let drawPile = [...gameState.drawPile];
    if (kickedPlayer.hand.length > 0) {
      const returnedCards = [...kickedPlayer.hand];
      drawPile = [...drawPile, ...returnedCards];
      drawPile = shuffle(drawPile);
    }

    // Fix currentPlayerIndex if we're in an active game
    let currentPlayerIndex = gameState.currentPlayerIndex;
    if (gameState.gamePhase === 'playing') {
      if (kickedPlayerIndex < currentPlayerIndex) {
        // Kicked player was before current — shift index back
        currentPlayerIndex -= 1;
      } else if (kickedPlayerIndex === currentPlayerIndex) {
        // Kicked player was the active player — keep same index but wrap if needed
        if (currentPlayerIndex >= players.length) {
          currentPlayerIndex = 0;
        }
      }
      // If kicked player was after current, no adjustment needed
    }

    // Reset cardsPlayedThisTurn if the kicked player was the active player
    const cardsPlayedThisTurn = kickedPlayerIndex === gameState.currentPlayerIndex
      ? 0
      : gameState.cardsPlayedThisTurn;

    const nextState: GameState = {
      ...gameState,
      players,
      drawPile,
      currentPlayerIndex,
      cardsPlayedThisTurn,
      statistics: {
        ...gameState.statistics,
        players: Object.fromEntries(players.map((player) => [
          player.id,
          gameState.statistics.players[player.id] ?? emptyPlayerStats()
        ]))
      },
      nasCheat: {
        ...gameState.nasCheat,
        enabledPlayerIds: gameState.nasCheat.enabledPlayerIds.filter((id) => id !== payload.targetPlayerId),
        usedThisTurnByPlayerId: Object.fromEntries(players.map((player) => [
          player.id,
          gameState.nasCheat.usedThisTurnByPlayerId[player.id] ?? false
        ]))
      }
    };

    room.gameState = nextState;
    room.turnUndoStack = [];
    room.updatedAtMs = Date.now();
    return nextState;
  }

  removeDisconnectedPlayer(playerId: string): Array<{ gameId: string; gameState: GameState | null }> {
    const updates: Array<{ gameId: string; gameState: GameState | null }> = [];

    for (const [gameId, room] of this.rooms) {
      if (!room.gameState.players.some((player) => player.id === playerId)) {
        continue;
      }

      if (room.gameState.gamePhase === 'playing') {
        continue;
      }

      const next = this.leaveGame(playerId, gameId);
      updates.push({ gameId, gameState: next });
    }

    return updates;
  }

  private generateUniqueGameId(): string {
    for (let i = 0; i < 20; i += 1) {
      const candidate = generateGameId();
      if (!this.rooms.has(candidate)) {
        return candidate;
      }
    }
    throw new Error('Unable to generate unique game id');
  }

  lookupCardStatus(gameId: string, playerId: string, cardValue: number): { status: 'in-draw' | 'in-hand' | 'played'; playerName: string; holderName?: string } {
    const room = this.requireRoom(gameId);
    const { gameState } = room;

    if (gameState.gamePhase !== 'playing') {
      throw new Error('Card lookup is only available during an active game');
    }
    if (!gameState.settings.allowCardLookup) {
      throw new Error('Card lookup cheat is not enabled for this game');
    }
    const player = gameState.players.find((p) => p.id === playerId);
    if (!player) {
      throw new Error('You are not in this game');
    }

    if (gameState.drawPile.some((c) => c.value === cardValue)) {
      return { status: 'in-draw', playerName: player.name };
    }

    const holder = gameState.players.find((p) => p.hand.some((c) => c.value === cardValue));
    if (holder) {
      return { status: 'in-hand', playerName: player.name, holderName: holder.name };
    }

    return { status: 'played', playerName: player.name };
  }

  private requireRoom(gameId: string): GameRoom {
    const room = this.rooms.get(gameId);
    if (!room) {
      throw new Error('Game not found');
    }
    return room;
  }

  reapOrphanedRooms(activePlayerIds: ReadonlySet<string>, nowMs = Date.now()): string[] {
    const deleted: string[] = [];
    const lobbyTtlMs = 5 * 60 * 1000;
    const activeTtlMs = 30 * 60 * 1000;

    for (const [gameId, room] of this.rooms) {
      const connectedCount = room.gameState.players.filter((player) => activePlayerIds.has(player.id)).length;
      if (connectedCount > 0) {
        continue;
      }

      const ageMs = nowMs - room.updatedAtMs;
      const ttlMs = room.gameState.gamePhase === 'lobby' ? lobbyTtlMs : activeTtlMs;
      if (ageMs >= ttlMs) {
        this.rooms.delete(gameId);
        this.reactions.delete(gameId);
        deleted.push(gameId);
      }
    }

    return deleted;
  }
}

// defaultMultiplayerSettings is exported from @upndown/shared-types.
export { defaultMultiplayerSettings };
