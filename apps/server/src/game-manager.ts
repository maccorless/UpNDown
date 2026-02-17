import { buildDeck, createStartedGameState, endTurn, playCard } from '@upndown/engine';
import type {
  CreateGamePayload,
  GameState,
  GameSettings,
  JoinGamePayload,
  PlayCardPayload,
  Player,
  UpdateSettingsPayload
} from '@upndown/shared-types';
import { createFoundationPiles } from '@upndown/engine';

interface GameRoom {
  gameState: GameState;
  createdAtMs: number;
  updatedAtMs: number;
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
      settings: payload.settings,
      isSolitaire: false
    };

    const now = Date.now();
    this.rooms.set(gameId, { gameState: state, createdAtMs: now, updatedAtMs: now });
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
      players: [...gameState.players, { id: playerId, name: payload.playerName, hand: [], isHost: false }]
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
    room.updatedAtMs = Date.now();
    return started;
  }

  playCard(playerId: string, payload: PlayCardPayload): GameState {
    const room = this.requireRoom(payload.gameId);
    const nextState = playCard(room.gameState, playerId, payload.cardId, payload.pileId);
    room.gameState = nextState;
    room.updatedAtMs = Date.now();
    return nextState;
  }

  endTurn(playerId: string, gameId: string): GameState {
    const room = this.requireRoom(gameId);
    const nextState = endTurn(room.gameState, playerId);
    room.gameState = nextState;
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
      gamePhase: 'lobby'
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
      }))
    };

    room.gameState = nextState;
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
  privateGame: false
};
