import { buildDeck, createStartedGameState, endTurn, playCard, shuffle, useNasCheat } from '@upndown/engine';
import type {
  CreateGamePayload,
  GameState,
  GameSettings,
  JoinGamePayload,
  KickPlayerPayload,
  NasCheatPayload,
  PlayerStatistics,
  PlayCardPayload,
  Player,
  ReactionState,
  ReactionType,
  UpdateSettingsPayload
} from '@upndown/shared-types';
import { createFoundationPiles } from '@upndown/engine';

interface GameRoom {
  gameState: GameState;
  createdAtMs: number;
  updatedAtMs: number;
  turnUndoStack: GameState[];
}

export interface JoinableGameSummary {
  gameId: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  createdAtMs: number;
}

export interface JoinLookupSummary {
  gameId: string;
  playerCount: number;
  maxPlayers: number;
  privateGame: boolean;
}

function emptyPlayerStats(): PlayerStatistics {
  return {
    cardsPlayed: 0,
    totalMovement: 0,
    specialPlays: 0,
    nasCheatsUsed: 0
  };
}

function generateGameId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 6; i += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)] ?? 'A';
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

  rejoinPlayer(gameId: string, oldPlayerId: string, newPlayerId: string): GameState {
    const room = this.requireRoom(gameId);
    const { gameState } = room;
    const player = gameState.players.find((p) => p.id === oldPlayerId);
    if (!player) {
      throw new Error('Player not found in game');
    }

    // Swap player id
    player.id = newPlayerId;

    // Swap hostId if this player is host
    if (gameState.hostId === oldPlayerId) {
      gameState.hostId = newPlayerId;
    }

    // Swap in statistics.players
    if (gameState.statistics.players[oldPlayerId]) {
      gameState.statistics.players[newPlayerId] = gameState.statistics.players[oldPlayerId];
      delete gameState.statistics.players[oldPlayerId];
    }

    // Swap in nasCheat maps
    if (oldPlayerId in gameState.nasCheat.usedThisTurnByPlayerId) {
      gameState.nasCheat.usedThisTurnByPlayerId[newPlayerId] = gameState.nasCheat.usedThisTurnByPlayerId[oldPlayerId] ?? false;
      delete gameState.nasCheat.usedThisTurnByPlayerId[oldPlayerId];
    }
    const nasIdx = gameState.nasCheat.enabledPlayerIds.indexOf(oldPlayerId);
    if (nasIdx >= 0) {
      gameState.nasCheat.enabledPlayerIds[nasIdx] = newPlayerId;
    }

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
      isHost: true
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
    this.rooms.set(gameId, { gameState: state, createdAtMs: now, updatedAtMs: now, turnUndoStack: [] });
    return state;
  }

  listJoinableGames(activePlayerIds?: ReadonlySet<string>): JoinableGameSummary[] {
    if (activePlayerIds) {
      for (const [gameId, room] of this.rooms) {
        const connectedCount = room.gameState.players.filter((player) => activePlayerIds.has(player.id)).length;
        if (connectedCount === 0) {
          this.rooms.delete(gameId);
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
      throw new Error('Game not found');
    }

    const { gameState } = room;
    if (gameState.gamePhase !== 'lobby') {
      throw new Error('This game has already started.');
    }

    if (gameState.players.some((player) => player.id === playerId)) {
      return gameState;
    }

    if (gameState.players.length >= gameState.settings.maxPlayers) {
      throw new Error('This game just filled up. Please choose another game.');
    }

    const nextState: GameState = {
      ...gameState,
      players: [...gameState.players, { id: playerId, name: payload.playerName, hand: [], isHost: false }],
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
    room.updatedAtMs = Date.now();
    return nextState;
  }

  lookupJoinableGame(gameId: string): JoinLookupSummary {
    const room = this.requireRoom(gameId);
    const { gameState } = room;

    if (gameState.gamePhase !== 'lobby') {
      throw new Error('This game has already started.');
    }

    if (gameState.players.length >= gameState.settings.maxPlayers) {
      throw new Error('This game is full.');
    }

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
      players: gameState.players.map((p) => ({ id: p.id, name: p.name })),
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
    room.turnUndoStack.push(structuredClone(room.gameState));
    const nextState = playCard(room.gameState, playerId, payload.cardId, payload.pileId);
    room.gameState = nextState;
    room.updatedAtMs = Date.now();
    return nextState;
  }

  undoLastPlay(playerId: string, gameId: string): GameState {
    const room = this.requireRoom(gameId);
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

export const defaultMultiplayerSettings: GameSettings = {
  minCardValue: 2,
  maxCardValue: 99,
  handSize: 7,
  minPlayers: 2,
  maxPlayers: 6,
  minCardsPerTurn: 2,
  autoRefillHand: false,
  allowUndo: false,
  privateGame: false,
  allowCardLookup: false
};
