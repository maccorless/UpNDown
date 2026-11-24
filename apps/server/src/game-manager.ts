import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Action } from '@upndown/engine';
import { assertCheatAvailable, buildDeck, carryAfterUndo, createStartedGameState, emptyPlayerStats, endTurn, chooseAction, fullMontyCells, observe, admitPlayer, playCard, recordCheatUse, senderLevel, setAutoMark, settleAfterRemoval, shuffle, skipTurn, tradeCard } from '@upndown/engine';
import type { HintAdvisor, RobotBrain } from './robot-brain.js';
import { pickRobotName } from './robot-names.js';
import type {
  CreateGamePayload,
  GameState,
  JoinableGameSummary,
  JoinGamePayload,
  JoinLookupSummary,
  KickPlayerPayload,
  PlayCardPayload,
  PlayerStatistics,
  RemoveRobotPayload,
  Player,
  PlayerColor,
  ReactionState,
  ReconnectionView,
  SkipPayload,
  TradePayload,
  ReactionType,
  UpdateSettingsPayload
} from '@upndown/shared-types';
import { deckFitMessage, defaultMultiplayerSettings, inCardRange, maxPlayersFor, PLAYER_COLORS, withCheatLimits, type CardLookupStatus, type MontyCell } from '@upndown/shared-types';
import { createFoundationPiles } from '@upndown/engine';
import { uniqueInGameName } from './player-names.js';
import { buildResultRows } from './profile/result-rows.js';
import type { GameResultRow } from './profile/store.js';

interface GameRoom {
  gameState: GameState;
  createdAtMs: number;
  updatedAtMs: number;
  turnUndoStack: GameState[];
  // The token handed to a seat is kept as a hash. The plain text is only held in memory, long enough to give it to the client;
  // after a restart only the hash exists, and the client's saved token is checked against it.
  rejoinTokens: Map<string, { plain?: string; hash: string }>;
  // Seats the host removed. A rejoin on one of them is told it was a kick. In memory only: after a restart it reads as gone.
  kickedPlayerIds?: Set<string>;
  // Which signed-in account holds each seat, recorded when the player sits down. Guests have no entry.
  userIdByPlayerId: Map<string, string>;
  // A room code is not a game: a finished room goes back to the lobby and starts again under the same code. Each start
  // gets a fresh run id, and that is what a recorded result is keyed on.
  runId: string | null;
  // When each seat in a game being played lost its connection. A seat is connected when it has no entry.
  disconnectedAtMs: Map<string, number>;
  // Invitations to join a game in progress, by hash of the token, with when each expires. Single use. Not saved: after a
  // restart the host simply makes a new one.
  invites: Map<string, number>;
  // Requests waiting for the host's answer.
  pendingJoins: Map<string, PendingJoin>;
  // Cheats a signed-in account used before it was removed from the game, so being let back in does not refresh a "once".
  departedCheats: Map<string, Pick<PlayerStatistics, 'skipsUsed' | 'tradesUsed' | 'lookupsUsed' | 'nasChecksUsed' | 'montyUsed' | 'hintsUsed'>>;
}

export interface PendingJoin {
  requestId: string;
  socketId: string;
  playerName: string;
  userId?: string;
  inviteHash: string;
  createdAtMs: number;
}

const INVITE_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_JOINS = 5;
const MAX_INVITES = 10;

const isFinished = (state: GameState): boolean => state.gamePhase === 'won' || state.gamePhase === 'lost';

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

function newToken(): { plain: string; hash: string } {
  const plain = randomUUID();
  return { plain, hash: hashToken(plain) };
}

function tokensMatch(expectedHash: string, actualPlain: string): boolean {
  const a = Buffer.from(expectedHash);
  const b = Buffer.from(hashToken(actualPlain));
  return a.length === b.length && timingSafeEqual(a, b);
}

// A room as it is saved: everything needed to carry on after a restart, and nothing that is only about connections.
export interface StoredRoom {
  gameId: string;
  state: GameState;
  seatUsers: Record<string, string>;
  tokenHashes: Record<string, string>;
  runId: string | null;
  updatedAtMs: number;
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

  if (state.statistics.finishedById === oldPlayerId) {
    state.statistics.finishedById = newPlayerId;
  }

  if (state.statistics.players[oldPlayerId]) {
    state.statistics.players[newPlayerId] = state.statistics.players[oldPlayerId];
    delete state.statistics.players[oldPlayerId];
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

// What one play did that the table should see: a backward 10 flashes on its pile, and a lifeline says so. Null for any other play.
export function specialOf(before: GameState, after: GameState, playerId: string, pileId: number): { pileId: number; lifeline: boolean } | null {
  const was = before.statistics.players[playerId];
  const now = after.statistics.players[playerId];
  if ((now?.specialPlays ?? 0) <= (was?.specialPlays ?? 0)) return null;
  return { pileId, lifeline: (now?.lifelines ?? 0) > (was?.lifelines ?? 0) };
}

export interface GameManagerHooks {
  // Called with the rows to record, never awaited: a slow or failing database must not slow or break play.
  onResults?: (rows: GameResultRow[]) => void;
  // Most rooms alive at once. Rooms cost memory and nothing else limits how many a script can open.
  maxRooms?: number;
  // A player gone this long is shown to the others as reconnecting (default 10 s), and after kickMs may be kicked (90 s).
  noticeMs?: number;
  kickMs?: number;
  // How long a game that nobody is connected to is kept (default 30 minutes; much longer once games are saved).
  activeTtlMs?: number;
  // What robots decide with. Without one they use the written strategy.
  robotBrain?: RobotBrain | null;
  // What hints are worked out with, and explained by. Without one the written strategy gives the hint, without reasons.
  hintAdvisor?: HintAdvisor | null;
}

// The public lobby list shows the newest of these.
const LOBBY_LIST_LIMIT = 50;
const DEFAULT_MAX_ROOMS = 500;
const DEFAULT_NOTICE_MS = 10_000;
const DEFAULT_KICK_MS = 90_000;
// A game in progress that nobody has touched for this long is removed, unless every person at the table is signed in: such a
// game keeps for a week, so a group can play it over several days. Guests get the short time.
const GUEST_ACTIVE_TTL_MS = 30 * 60 * 1000;
export const SIGNED_IN_ACTIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Every person at the table has a signed-in account. Robots have no account and do not count, and a table with no person is not one.
export function everyPersonSignedIn(room: { gameState: GameState; userIdByPlayerId: ReadonlyMap<string, string> }): boolean {
  const people = room.gameState.players.filter((player) => !player.robot);
  return people.length > 0 && people.every((player) => room.userIdByPlayerId.has(player.id));
}

// Why a seat could not be taken back. "kicked": the host removed the seat. "gone": anything else (no game kept, a wrong token,
// the new seat taken), so the caller stops trying.
export type RejoinRefusal = 'gone' | 'kicked';

export class RejoinRefused extends Error {
  readonly reason: RejoinRefusal;
  constructor(reason: RejoinRefusal) {
    super('Unable to rejoin game');
    this.name = 'RejoinRefused';
    this.reason = reason;
  }
}

export class GameManager {
  constructor(private readonly hooks: GameManagerHooks = {}) {}

  // Set when games are being saved, so a game survives being left for a while (and a restart).
  private activeTtlMs: number | undefined;
  setActiveTtlMs(ms: number | undefined): void {
    this.activeTtlMs = ms;
  }

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

    if (reactionType !== null) {
      const stats = room.gameState.statistics.players[playerId] ?? emptyPlayerStats();
      room.gameState = {
        ...room.gameState,
        statistics: { ...room.gameState.statistics, players: { ...room.gameState.statistics.players, [playerId]: { ...stats, marksPlaced: stats.marksPlaced + 1 } } }
      };
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
    const token = this.requireRoom(gameId).rejoinTokens.get(playerId)?.plain;
    if (!token) {
      throw new Error('No rejoin token for player');
    }
    return token;
  }

  rejoinPlayer(gameId: string, oldPlayerId: string, newPlayerId: string, rejoinToken: string, userId?: string): GameState {
    const room = this.rooms.get(gameId);
    if (!room) throw new RejoinRefused('gone');
    const { gameState } = room;
    // A seat the host removed reads as a kick. A seat no longer in the game for any other reason (taken back by another device)
    // reads as gone, so nobody is told the host removed them when they were not.
    if (!gameState.players.some((p) => p.id === oldPlayerId)) {
      throw new RejoinRefused(room.kickedPlayerIds?.has(oldPlayerId) ? 'kicked' : 'gone');
    }
    const expectedToken = room.rejoinTokens.get(oldPlayerId);
    if (!expectedToken || !tokensMatch(expectedToken.hash, rejoinToken)) throw new RejoinRefused('gone');
    if (gameState.players.some((p) => p.id === newPlayerId)) throw new RejoinRefused('gone');

    return this.reseat(room, gameId, oldPlayerId, newPlayerId, userId);
  }

  // A signed-in player whose seat in a game being played is held (their browser closed, or this is another device) takes it
  // back by account: the session proves who they are, as the seat's rejoin token does for a guest.
  // The games being played in which this account holds a seat, so a player in several can choose which to go back to.
  heldGamesByAccount(userId: string): string[] {
    const games: string[] = [];
    for (const [gameId, room] of this.rooms) {
      if (room.gameState.gamePhase !== 'playing') continue;
      for (const [playerId, seatUser] of room.userIdByPlayerId) {
        if (seatUser === userId && room.gameState.players.some((p) => p.id === playerId)) { games.push(gameId); break; }
      }
    }
    return games;
  }

  rejoinByAccount(userId: string, newPlayerId: string, onlyGameId?: string): { gameId: string; previousPlayerId: string; state: GameState } {
    for (const [gameId, room] of this.rooms) {
      if (onlyGameId !== undefined && gameId !== onlyGameId) continue;
      if (room.gameState.gamePhase !== 'playing') continue;
      for (const [previousPlayerId, seatUser] of room.userIdByPlayerId) {
        if (seatUser !== userId || !room.gameState.players.some((p) => p.id === previousPlayerId)) continue;
        if (room.gameState.players.some((p) => p.id === newPlayerId)) break;
        return { gameId, previousPlayerId, state: this.reseat(room, gameId, previousPlayerId, newPlayerId, userId) };
      }
    }
    throw new Error('Unable to rejoin game');
  }

  // Whether a seat saved on a device can still be taken back: its game is kept, the seat is in it, and the token matches.
  // Read only, and a game that has ended is not live.
  seatIsLive(gameId: string, playerId: string, rejoinToken: string): boolean {
    const room = this.rooms.get(gameId);
    if (!room || room.gameState.gamePhase === 'won' || room.gameState.gamePhase === 'lost') return false;
    const expectedToken = room.rejoinTokens.get(playerId);
    return !!expectedToken && room.gameState.players.some((p) => p.id === playerId) && tokensMatch(expectedToken.hash, rejoinToken);
  }

  private reseat(room: GameRoom, gameId: string, oldPlayerId: string, newPlayerId: string, userId?: string): GameState {
    const { gameState } = room;
    swapPlayerId(gameState, oldPlayerId, newPlayerId);
    for (const snapshot of room.turnUndoStack) {
      swapPlayerId(snapshot, oldPlayerId, newPlayerId);
    }

    room.rejoinTokens.delete(oldPlayerId);
    room.rejoinTokens.set(newPlayerId, newToken());
    room.disconnectedAtMs.delete(oldPlayerId);

    // The seat keeps the account it was taken with. A rejoining socket with a different account, or none, is still seated
    // by its token but does not take the credit; a seat taken as a guest may adopt the account that comes back signed in.
    // A guest seat may adopt the account that comes back, unless that account already sits elsewhere in this game.
    const adopt = userId && !this.accountHoldsSeat(room, userId) ? userId : undefined;
    const seatUser = room.userIdByPlayerId.get(oldPlayerId) ?? adopt;
    room.userIdByPlayerId.delete(oldPlayerId);
    if (seatUser) room.userIdByPlayerId.set(newPlayerId, seatUser);

    // Swap reactions
    const gameReactions = this.reactions.get(gameId);
    if (gameReactions?.has(oldPlayerId)) {
      gameReactions.set(newPlayerId, gameReactions.get(oldPlayerId)!);
      gameReactions.delete(oldPlayerId);
    }

    room.updatedAtMs = Date.now();
    return gameState;
  }

  // The rooms worth saving: games being played. Lobbies and finished games are not kept across a restart.
  savableGameIds(): string[] {
    return [...this.rooms].filter(([, room]) => room.gameState.gamePhase === 'playing').map(([id]) => id);
  }

  exportRoom(gameId: string): StoredRoom | null {
    const room = this.rooms.get(gameId);
    if (!room || room.gameState.gamePhase !== 'playing') return null;
    return {
      gameId,
      state: structuredClone(room.gameState),
      seatUsers: Object.fromEntries(room.userIdByPlayerId),
      tokenHashes: Object.fromEntries([...room.rejoinTokens].map(([id, token]) => [id, token.hash])),
      runId: room.runId,
      updatedAtMs: room.updatedAtMs
    };
  }

  // Puts a saved game back. Every seat starts as disconnected: nobody is on a socket yet, so the dropped-connection rules
  // apply and each player takes their seat back with their token (or, signed in, by account).
  importRoom(stored: StoredRoom, nowMs: number = Date.now()): boolean {
    if (this.rooms.has(stored.gameId) || stored.state.gamePhase !== 'playing') return false;
    this.rooms.set(stored.gameId, {
      gameState: stored.state,
      createdAtMs: nowMs,
      updatedAtMs: stored.updatedAtMs,
      turnUndoStack: [],
      rejoinTokens: new Map(Object.entries(stored.tokenHashes).map(([id, hash]) => [id, { hash }])),
      userIdByPlayerId: new Map(Object.entries(stored.seatUsers)),
      runId: stored.runId,
      // Robots never disconnect; every person starts as away.
      disconnectedAtMs: new Map(stored.state.players.filter((player) => !player.robot).map((player) => [player.id, nowMs])),
      invites: new Map(),
      pendingJoins: new Map(),
      departedCheats: new Map()
    });
    return true;
  }

  // The stored state of a room, or undefined when it no longer exists.
  peekState(gameId: string): GameState | undefined {
    return this.rooms.get(gameId)?.gameState;
  }


  private accountHoldsSeat(room: GameRoom, userId: string): boolean {
    for (const [playerId, seatUser] of room.userIdByPlayerId) {
      if (seatUser === userId && room.gameState.players.some((p) => p.id === playerId)) return true;
    }
    return false;
  }

  // The room this connection is seated in, if any. A connection is in at most one game at a time.
  seatedGameOf(playerId: string): string | null {
    for (const [gameId, room] of this.rooms) {
      if (room.gameState.players.some((player) => player.id === playerId)) return gameId;
    }
    return null;
  }

  createGame(ownerPlayerId: string, payload: CreateGamePayload, userId?: string): GameState {
    if (payload.isSolitaire) {
      throw new Error('Solitaire is client-only in v1');
    }
    if (this.rooms.size >= (this.hooks.maxRooms ?? DEFAULT_MAX_ROOMS)) {
      throw new Error('The server is full right now. Please try again in a few minutes.');
    }
    if (this.seatedGameOf(ownerPlayerId)) {
      throw new Error('You are already in a game. Leave it before starting another.');
    }
    const unfit = deckFitMessage(payload.settings);
    if (unfit) {
      throw new Error(unfit);
    }
    const settings = withCheatLimits(payload.settings);

    const gameId = this.generateUniqueGameId();

    const host: Player = {
      id: ownerPlayerId,
      name: uniqueInGameName(payload.playerName, []),
      hand: [],
      isHost: true,
      color: PLAYER_COLORS[0] as PlayerColor
    };

    const state: GameState = {
      gameId,
      hostId: ownerPlayerId,
      players: [host],
      foundationPiles: createFoundationPiles(settings),
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
      settings,
      isSolitaire: false
    };

    const now = Date.now();
    this.rooms.set(gameId, {
      gameState: state,
      createdAtMs: now,
      updatedAtMs: now,
      turnUndoStack: [],
      rejoinTokens: new Map([[ownerPlayerId, newToken()]]),
      userIdByPlayerId: new Map(userId ? [[ownerPlayerId, userId]] : []),
      runId: null,
      disconnectedAtMs: new Map(),
      invites: new Map(),
      pendingJoins: new Map(),
      departedCheats: new Map()
    });
    return state;
  }

  // Only reads. Deleting a room is the reaper's job, on a timer, because a room with nobody connected right now is not
  // necessarily dead: a started game whose players all dropped at once can still be rejoined within its time limit.
  listJoinableGames(activePlayerIds?: ReadonlySet<string>): JoinableGameSummary[] {
    return [...this.rooms.values()]
      .filter((room) => {
        const state = room.gameState;
        // Nobody there to host it, so it is not worth advertising. The reaper removes it later.
        if (activePlayerIds && !state.players.some((player) => activePlayerIds.has(player.id))) return false;
        return state.gamePhase === 'lobby'
          && !state.settings.privateGame
          && state.players.length < maxPlayersFor(state.settings);
      })
      .map((room) => {
        const host = room.gameState.players.find((player) => player.id === room.gameState.hostId);
        return {
          gameId: room.gameState.gameId,
          hostName: host?.name ?? 'Host',
          playerCount: room.gameState.players.length,
          maxPlayers: maxPlayersFor(room.gameState.settings),
          createdAtMs: room.createdAtMs
        };
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, LOBBY_LIST_LIMIT);
  }

  joinGame(playerId: string, payload: JoinGamePayload, userId?: string): GameState {
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

    const elsewhere = this.seatedGameOf(playerId);
    if (elsewhere && elsewhere !== payload.gameId) {
      throw new Error('You are already in a game. Leave it before joining another.');
    }

    // One account, one seat per game. Two different accounts (say, in two tabs) are two players; guests are never matched.
    if (userId && this.accountHoldsSeat(room, userId)) {
      throw new Error('Your account is already in this game (perhaps in another tab).');
    }

    if (gameState.players.length >= maxPlayersFor(gameState.settings)) {
      throw new Error(GAME_UNAVAILABLE_MESSAGE);
    }

    const nextState: GameState = {
      ...gameState,
      players: [...gameState.players, { id: playerId, name: uniqueInGameName(payload.playerName, gameState.players.map((player) => player.name)), hand: [], isHost: false, color: PLAYER_COLORS[gameState.players.length % PLAYER_COLORS.length] as PlayerColor }],
      statistics: {
        ...gameState.statistics,
        players: {
          ...gameState.statistics.players,
          [playerId]: gameState.statistics.players[playerId] ?? emptyPlayerStats()
        }
      }
    };

    room.gameState = nextState;
    room.rejoinTokens.set(playerId, newToken());
    if (userId) room.userIdByPlayerId.set(playerId, userId);
    room.updatedAtMs = Date.now();
    return nextState;
  }

  lookupJoinableGame(gameId: string): JoinLookupSummary {
    const room = this.rooms.get(gameId);
    if (!room || room.gameState.gamePhase !== 'lobby' || room.gameState.players.length >= maxPlayersFor(room.gameState.settings)) {
      throw new Error(GAME_UNAVAILABLE_MESSAGE);
    }
    const { gameState } = room;

    return {
      gameId: gameState.gameId,
      playerCount: gameState.players.length,
      maxPlayers: maxPlayersFor(gameState.settings),
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
      players: gameState.players.map((p) => ({ id: p.id, name: p.name, ...(p.color ? { color: p.color } : {}), ...(p.robot ? { robot: true } : {}) })),
      settings: gameState.settings,
      isSolitaire: false,
      deck: shuffle(buildDeck(gameState.settings))
    });

    const before = room.gameState;
    room.gameState = started;
    room.runId = randomUUID();
    room.turnUndoStack = [];
    room.updatedAtMs = Date.now();
    // The engine checks for a win or loss as it deals, so a game can end the moment it starts.
    this.recordIfFinished(room, before, started);
    return started;
  }

  // The seated people whose own hand-placed mark is up on this pile. Auto-mark and robot marks are the server's doing, so
  // they earn no follow for anyone.
  private handMarkersOn(room: GameRoom, pileId: number): string[] {
    const board = this.reactions.get(room.gameState.gameId);
    if (!board) return [];
    return room.gameState.players.filter((p) => !p.robot && !p.autoMark && board.get(p.id)?.has(pileId)).map((p) => p.id);
  }

  playCard(playerId: string, payload: PlayCardPayload): GameState {
    const room = this.requireRoom(payload.gameId);
    const previous = room.gameState;
    const nextState = playCard(previous, playerId, payload.cardId, payload.pileId, this.handMarkersOn(room, payload.pileId));
    if (previous.settings.allowUndo) {
      room.turnUndoStack.push(structuredClone(previous));
      if (room.turnUndoStack.length > MAX_UNDO_SNAPSHOTS) {
        room.turnUndoStack.shift();
      }
    }
    room.gameState = nextState;
    room.updatedAtMs = Date.now();
    this.recordIfFinished(room, previous, nextState);
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
    // Cheats and marks counted since the snapshot are not undone with the play, and the undo itself is counted.
    const restored = carryAfterUndo(previous, room.gameState, playerId);
    room.gameState = restored;
    room.updatedAtMs = Date.now();
    return restored;
  }

  // A hint for the player asking, worked out from what that player can see (never the draw pile, other hands or the played-card record), and counted
  // as a use. Only on their own turn. Nothing about it changes the game or is shown to anyone else. With a network the hint comes with reasons.
  hintAdvice(playerId: string, payload: SkipPayload): { action: Action; headline?: string; reasons?: string[] } {
    const room = this.requireRoom(payload.gameId);
    const { gameState } = room;
    const current = gameState.players[gameState.currentPlayerIndex];
    if (gameState.gamePhase !== 'playing' || current?.id !== playerId) {
      throw new Error('Hints are only available on your own turn');
    }
    // Throws when hints are off for this game, or the single use is spent.
    room.gameState = recordCheatUse(gameState, playerId, 'hint');
    room.updatedAtMs = Date.now();
    const rule = chooseAction(observe(gameState, playerId));
    // Skip and trade are the written strategy's to suggest; the network was not trained on them.
    if (rule.type !== 'skip' && rule.type !== 'trade' && rule.type !== 'none') {
      try {
        const advice = this.hooks.hintAdvisor?.advise(gameState, playerId, this.getReactions(payload.gameId));
        if (advice) return advice;
      } catch { /* fall through to the written strategy */ }
    }
    return { action: rule };
  }

  hint(playerId: string, payload: SkipPayload): Action {
    return this.hintAdvice(playerId, payload).action;
  }

  // Skip and trade change the game for good: each clears the undo history, so undo can never take one back or refund it.
  skip(playerId: string, payload: SkipPayload): GameState {
    const room = this.requireRoom(payload.gameId);
    const previous = room.gameState;
    const nextState = skipTurn(previous, playerId);
    room.gameState = nextState;
    room.turnUndoStack = [];
    room.updatedAtMs = Date.now();
    this.recordIfFinished(room, previous, nextState);
    return nextState;
  }

  // Auto-mark (a player setting): the server marks the piles for this person, by the robots' rule, while they are off turn. Turning it off takes their marks down.
  setAutoMark(playerId: string, gameId: string, enabled: boolean): GameState {
    const room = this.requireRoom(gameId);
    if (room.gameState.gamePhase !== 'playing') throw new Error('Auto-mark can be changed while a game is being played');
    room.gameState = setAutoMark(room.gameState, playerId, enabled);
    if (!enabled) this.clearPlayerReactions(gameId, playerId);
    room.updatedAtMs = Date.now();
    return room.gameState;
  }

  trade(playerId: string, payload: TradePayload): GameState {
    const room = this.requireRoom(payload.gameId);
    const previous = room.gameState;
    const nextState = tradeCard(previous, playerId, payload.cardId);
    room.gameState = nextState;
    room.turnUndoStack = [];
    room.updatedAtMs = Date.now();
    this.recordIfFinished(room, previous, nextState);
    return nextState;
  }

  endTurn(playerId: string, gameId: string): GameState {
    const room = this.requireRoom(gameId);
    const previous = room.gameState;
    const nextState = endTurn(previous, playerId);
    room.gameState = nextState;
    room.turnUndoStack = [];
    room.updatedAtMs = Date.now();
    this.recordIfFinished(room, previous, nextState);
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

    // Ending a game that is still being played is the one way to quit a started game in v1, and only the host can do it.
    // A finished game was already recorded when it finished, so ending it again records nothing.
    if (gameState.gamePhase === 'playing' && room.runId) {
      this.emitResults(buildResultRows({
        state: gameState,
        runId: room.runId,
        outcome: 'abandoned',
        userIdByPlayerId: room.userIdByPlayerId,
        nowMs: Date.now(),
        onlyPlayerId: gameState.hostId
      }));
    }
    room.runId = null;

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
      }
    };

    room.gameState = nextState;
    room.updatedAtMs = Date.now();
    return nextState;
  }

  // Play Again after a game has ended: any player still at the table resets the table and deals the next round at once.
  playAgain(playerId: string, gameId: string): GameState {
    const room = this.requireRoom(gameId);
    const { gameState } = room;
    if (!gameState.players.some((p) => p.id === playerId)) {
      throw new Error('Only a player at this table can play again');
    }
    if (gameState.gamePhase !== 'won' && gameState.gamePhase !== 'lost') {
      throw new Error('Play Again is only after a game has ended');
    }
    this.endGame(gameState.hostId, gameId);
    return this.startGame(gameState.hostId, gameId);
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

    const unfit = deckFitMessage(payload.settings);
    if (unfit) {
      throw new Error(unfit);
    }

    if (gameState.players.length > maxPlayersFor(payload.settings)) {
      throw new Error('This deck cannot deal a full hand to that many players. Raise the top card or lower the hand size.');
    }

    const nextState: GameState = {
      ...gameState,
      settings: withCheatLimits(payload.settings)
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
    room.userIdByPlayerId.delete(playerId);
    room.disconnectedAtMs.delete(playerId);
    // A table of only robots has no one to host it or watch it.
    if (players.every((player) => player.robot)) {
      this.rooms.delete(gameId);
      this.reactions.delete(gameId);
      return null;
    }

    const nextHost = players.find((player) => player.id === gameState.hostId) ?? players.find((player) => !player.robot);
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
      }
    };

    room.gameState = nextState;
    room.updatedAtMs = Date.now();
    return nextState;
  }

  // The host may kick anyone, except a player who has dropped and has not yet been gone for the kick time (they may come
  // back). Anyone else may kick only the host, only once the host has been gone that long, and only if they are the next
  // available player; the kicker then becomes host. Kicking during a game counts as a quit for the kicked player.
  kickPlayer(requesterId: string, payload: KickPlayerPayload, nowMs: number = Date.now()): GameState {
    const room = this.requireRoom(payload.gameId);
    const { gameState } = room;
    const kickMs = this.hooks.kickMs ?? DEFAULT_KICK_MS;
    const goneFor = (id: string): number | null => {
      const since = room.disconnectedAtMs.get(id);
      return since === undefined ? null : nowMs - since;
    };

    if (gameState.gamePhase === 'won' || gameState.gamePhase === 'lost') {
      throw new Error('Cannot kick players after the game has ended');
    }

    const requesterIsHost = gameState.hostId === requesterId;
    if (!requesterIsHost && payload.targetPlayerId !== gameState.hostId) {
      throw new Error('Only host can kick players');
    }

    if (payload.targetPlayerId === requesterId) {
      throw new Error('Cannot kick yourself');
    }

    const targetGoneFor = goneFor(payload.targetPlayerId);
    if (targetGoneFor !== null && targetGoneFor < kickMs) {
      throw new Error('That player may still reconnect');
    }
    if (!requesterIsHost && (targetGoneFor === null || this.nextAvailablePlayerId(room) !== requesterId)) {
      throw new Error('Only host can kick players');
    }

    const kickedPlayerIndex = gameState.players.findIndex((p) => p.id === payload.targetPlayerId);
    if (kickedPlayerIndex === -1) {
      throw new Error('Player not found in game');
    }
    if (gameState.players[kickedPlayerIndex]!.robot) {
      throw new Error('Robots leave when the game ends; they cannot be kicked');
    }

    if (gameState.gamePhase === 'playing' && room.runId) {
      this.emitResults(buildResultRows({
        state: gameState,
        runId: room.runId,
        outcome: 'abandoned',
        userIdByPlayerId: room.userIdByPlayerId,
        nowMs,
        onlyPlayerId: payload.targetPlayerId
      }));
    }

    const kickedPlayer = gameState.players[kickedPlayerIndex]!;
    const players = gameState.players.filter((p) => p.id !== payload.targetPlayerId);
    const kickedUser = room.userIdByPlayerId.get(payload.targetPlayerId);
    const kickedStats = gameState.statistics.players[payload.targetPlayerId];
    if (kickedUser && kickedStats) {
      room.departedCheats.set(kickedUser, { skipsUsed: kickedStats.skipsUsed, tradesUsed: kickedStats.tradesUsed, lookupsUsed: kickedStats.lookupsUsed, nasChecksUsed: kickedStats.nasChecksUsed, montyUsed: kickedStats.montyUsed, hintsUsed: kickedStats.hintsUsed });
    }
    room.userIdByPlayerId.delete(payload.targetPlayerId);
    room.disconnectedAtMs.delete(payload.targetPlayerId);
    room.rejoinTokens.delete(payload.targetPlayerId);
    (room.kickedPlayerIds ??= new Set()).add(payload.targetPlayerId);

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

    const newHostId = requesterIsHost ? gameState.hostId : requesterId;
    const nextState: GameState = {
      ...gameState,
      hostId: newHostId,
      players: players.map((player) => ({ ...player, isHost: player.id === newHostId })),
      drawPile,
      currentPlayerIndex,
      cardsPlayedThisTurn,
      statistics: {
        ...gameState.statistics,
        players: Object.fromEntries(players.map((player) => [
          player.id,
          gameState.statistics.players[player.id] ?? emptyPlayerStats()
        ]))
      }
    };

    const settled = settleAfterRemoval(nextState);
    room.gameState = settled;
    room.turnUndoStack = [];
    room.updatedAtMs = Date.now();
    this.recordIfFinished(room, gameState, settled);
    return settled;
  }

  // The next player after the host, in seat order, who is connected: the one who may take over from a lost host.
  private nextAvailablePlayerId(room: GameRoom): string | null {
    const { players, hostId } = room.gameState;
    const hostIndex = players.findIndex((player) => player.id === hostId);
    for (let offset = 1; offset < players.length; offset += 1) {
      const candidate = players[(hostIndex + offset) % players.length]!;
      // A robot never disconnects but cannot take over as host: only a person can.
      if (!candidate.robot && !room.disconnectedAtMs.has(candidate.id)) return candidate.id;
    }
    return null;
  }

  // Joining a game already being played, by invitation. The host makes an invitation, a person asks to join with it, and the
  // host lets them in or not. The invitation is single use and expires; a request names no seat and takes nothing until the
  // host says yes, and the answer re-checks everything, since the game moved on while the host decided.
  createInvite(hostId: string, gameId: string, nowMs: number = Date.now()): { token: string; expiresAtMs: number } {
    const room = this.requireRoom(gameId);
    if (room.gameState.gamePhase !== 'playing') {
      throw new Error('Invitations are for a game that is being played');
    }
    if (room.gameState.hostId !== hostId) {
      throw new Error('Only host can invite players');
    }
    for (const [hash, expires] of room.invites) if (expires <= nowMs) room.invites.delete(hash);
    if (room.invites.size >= MAX_INVITES) {
      throw new Error('Too many invitations are waiting. Use or wait for one to expire.');
    }
    const token = randomBytes(24).toString('base64url');
    const expiresAtMs = nowMs + INVITE_TTL_MS;
    room.invites.set(hashToken(token), expiresAtMs);
    return { token, expiresAtMs };
  }

  // A person asks to join with an invitation. Everything wrong with it (no such game, a bad or used or expired invitation) is
  // answered the same way, so nobody can use this to find which games exist.
  requestJoin(socketId: string, payload: { gameId: string; inviteToken: string; playerName: string }, userId?: string, nowMs: number = Date.now()): PendingJoin {
    const room = this.rooms.get(payload.gameId);
    const inviteHash = hashToken(payload.inviteToken);
    const expires = room?.invites.get(inviteHash);
    if (!room || room.gameState.gamePhase !== 'playing' || expires === undefined || expires <= nowMs) {
      throw new Error(GAME_UNAVAILABLE_MESSAGE);
    }
    if (this.seatedGameOf(socketId)) {
      throw new Error('You are already in a game. Leave it before joining another.');
    }
    if (userId && this.accountHoldsSeat(room, userId)) {
      throw new Error('Your account is already in this game (perhaps in another tab).');
    }
    if (room.gameState.players.length >= maxPlayersFor(room.gameState.settings)) {
      throw new Error(GAME_UNAVAILABLE_MESSAGE);
    }
    if (room.pendingJoins.size >= MAX_PENDING_JOINS || [...room.pendingJoins.values()].some((p) => p.inviteHash === inviteHash)) {
      throw new Error('Someone else is already asking to join with that invitation.');
    }
    const request: PendingJoin = { requestId: randomUUID(), socketId, playerName: payload.playerName, inviteHash, createdAtMs: nowMs, ...(userId ? { userId } : {}) };
    room.pendingJoins.set(request.requestId, request);
    return request;
  }

  // Drops a request: the person gave up, left, or the host did not answer in time. Returns it if there was one.
  dropJoinRequest(gameId: string, requestId: string): PendingJoin | null {
    const room = this.rooms.get(gameId);
    const request = room?.pendingJoins.get(requestId);
    if (!room || !request) return null;
    room.pendingJoins.delete(requestId);
    return request;
  }

  // Requests a connection made that are still waiting, for when that connection goes away.
  dropJoinRequestsOf(socketId: string): Array<{ gameId: string; request: PendingJoin }> {
    const dropped: Array<{ gameId: string; request: PendingJoin }> = [];
    for (const [gameId, room] of this.rooms) {
      for (const [requestId, request] of room.pendingJoins) {
        if (request.socketId === socketId) {
          room.pendingJoins.delete(requestId);
          dropped.push({ gameId, request });
        }
      }
    }
    return dropped;
  }

  pendingJoinRequests(gameId: string): PendingJoin[] {
    return [...(this.rooms.get(gameId)?.pendingJoins.values() ?? [])];
  }

  // The host's answer. Declining leaves the game untouched. Letting in re-checks everything that may have changed while the
  // host decided (the game, who the host is, the table, the account, the invitation, the cards), deals the new player in from
  // the bottom of the draw pile, and refuses if that would end the game. A refusal leaves the game as it was and the
  // invitation still usable.
  resolveJoin(hostId: string, payload: { gameId: string; requestId: string; approve: boolean }, nowMs: number = Date.now()): { request: PendingJoin; state?: GameState; playerId?: string } {
    const room = this.requireRoom(payload.gameId);
    const request = room.pendingJoins.get(payload.requestId);
    if (!request) {
      throw new Error('That request is no longer waiting');
    }
    if (room.gameState.hostId !== hostId) {
      throw new Error('Only host can let players in');
    }
    if (!payload.approve) {
      room.pendingJoins.delete(payload.requestId);
      return { request };
    }
    const { gameState } = room;
    const expires = room.invites.get(request.inviteHash);
    if (gameState.gamePhase !== 'playing') {
      room.pendingJoins.delete(payload.requestId);
      throw new Error('The game is no longer being played');
    }
    if (expires === undefined || expires <= nowMs) {
      room.pendingJoins.delete(payload.requestId);
      throw new Error('That invitation has expired');
    }
    if (gameState.players.length >= maxPlayersFor(gameState.settings)) {
      throw new Error('The table is full');
    }
    if (request.userId && this.accountHoldsSeat(room, request.userId)) {
      room.pendingJoins.delete(payload.requestId);
      throw new Error('That account is already in this game');
    }
    if (this.seatedGameOf(request.socketId)) {
      room.pendingJoins.delete(payload.requestId);
      throw new Error('That person is already in a game');
    }
    const name = uniqueInGameName(request.playerName, gameState.players.map((player) => player.name));
    const admitted = admitPlayer(gameState, { id: request.socketId, name });
    if (admitted.gamePhase !== 'playing') {
      throw new Error('Dealing another player in would end this game, so it cannot be done now. Try again after the next play.');
    }
    // Inherit what this account already used, so being let back in does not refresh a single-use cheat.
    const earlier = request.userId ? room.departedCheats.get(request.userId) : undefined;
    const seated: GameState = earlier
      ? { ...admitted, statistics: { ...admitted.statistics, players: { ...admitted.statistics.players, [request.socketId]: { ...(admitted.statistics.players[request.socketId] ?? emptyPlayerStats()), ...earlier } } } }
      : admitted;
    room.gameState = seated;
    room.rejoinTokens.set(request.socketId, newToken());
    if (request.userId) room.userIdByPlayerId.set(request.socketId, request.userId);
    room.invites.delete(request.inviteHash);
    room.pendingJoins.delete(payload.requestId);
    // An admission is for good: undo must not be able to take the new player away again.
    room.turnUndoStack = [];
    room.updatedAtMs = nowMs;
    return { request, state: seated, playerId: request.socketId };
  }

  // Robots. The host fills seats with them in the lobby; they count toward the player limits like anyone, and at least one
  // person must stay. They play through the same methods as people, so every rule check is shared.
  addRobot(hostId: string, gameId: string): GameState {
    const room = this.requireRoom(gameId);
    const { gameState } = room;
    if (gameState.gamePhase !== 'lobby') {
      throw new Error('Robots can only be added in the lobby');
    }
    if (gameState.hostId !== hostId) {
      throw new Error('Only host can add robots');
    }
    if (gameState.players.length >= maxPlayersFor(gameState.settings)) {
      throw new Error('The table is full');
    }
    const id = `bot-${randomUUID().slice(0, 8)}`;
    const nextState: GameState = {
      ...gameState,
      players: [...gameState.players, {
        id,
        name: pickRobotName(gameState.players.map((player) => player.name)),
        hand: [],
        isHost: false,
        robot: true,
        color: PLAYER_COLORS[gameState.players.length % PLAYER_COLORS.length] as PlayerColor
      }],
      statistics: { ...gameState.statistics, players: { ...gameState.statistics.players, [id]: emptyPlayerStats() } }
    };
    room.gameState = nextState;
    room.updatedAtMs = Date.now();
    return nextState;
  }

  removeRobot(hostId: string, payload: RemoveRobotPayload): GameState {
    const room = this.requireRoom(payload.gameId);
    const { gameState } = room;
    if (gameState.gamePhase !== 'lobby') {
      throw new Error('Robots can only be removed in the lobby');
    }
    if (gameState.hostId !== hostId) {
      throw new Error('Only host can remove robots');
    }
    if (!gameState.players.some((player) => player.id === payload.playerId && player.robot)) {
      throw new Error('That seat is not a robot');
    }
    const players = gameState.players.filter((player) => player.id !== payload.playerId);
    const nextState: GameState = {
      ...gameState,
      players,
      statistics: { ...gameState.statistics, players: Object.fromEntries(players.map((player) => [player.id, gameState.statistics.players[player.id] ?? emptyPlayerStats()])) }
    };
    room.gameState = nextState;
    room.updatedAtMs = Date.now();
    return nextState;
  }

  // Robots show honest reactions, as a diligent player would: after every play, each robot not on turn marks every pile by how good its best card for
  // it is (the rule in How to Play), and a robot on turn shows none. A person with auto-mark on is marked the same way. Returns whether anything changed, so the caller can tell the table.
  syncRobotReactions(gameId: string): boolean {
    const room = this.rooms.get(gameId);
    if (!room || room.gameState.gamePhase !== 'playing' || room.gameState.isSolitaire) return false;
    const state = room.gameState;
    const onTurn = state.players[state.currentPlayerIndex]?.id;
    const board = this.reactions.get(gameId) ?? new Map<string, Map<number, ReactionType>>();
    let changed = false;
    for (const player of state.players) {
      if (!player.robot && !player.autoMark) continue;
      const want = new Map<number, ReactionType>();
      if (player.id !== onTurn) {
        for (const pile of state.foundationPiles) {
          const level = senderLevel(player.hand, pile, state.settings);
          if (level) want.set(pile.id, level);
        }
      }
      const have = board.get(player.id);
      const same = have ? have.size === want.size && [...want].every(([pile, level]) => have.get(pile) === level) : want.size === 0;
      if (same) continue;
      changed = true;
      if (want.size === 0) board.delete(player.id);
      else board.set(player.id, want);
    }
    if (board.size > 0) this.reactions.set(gameId, board);
    else this.reactions.delete(gameId);
    return changed;
  }

  // Whether any seat is a person (connected or not): a table of robots alone has nobody slow to wait for.
  hasHumanSeat(gameId: string): boolean {
    return this.rooms.get(gameId)?.gameState.players.some((player) => !player.robot) ?? false;
  }

  // Robots only act while a person is at the table: a connected one. With nobody there they wait.
  hasConnectedHuman(gameId: string): boolean {
    const room = this.rooms.get(gameId);
    if (!room) return false;
    return room.gameState.players.some((player) => !player.robot && !room.disconnectedAtMs.has(player.id));
  }

  // The robot whose turn it is, if the game is being played and a person is there to watch.
  robotToAct(gameId: string): { robotId: string; turnKey: string } | null {
    const room = this.rooms.get(gameId);
    if (!room || room.gameState.gamePhase !== 'playing') return null;
    const current = room.gameState.players[room.gameState.currentPlayerIndex];
    if (!current?.robot || !this.hasConnectedHuman(gameId)) return null;
    // Names this exact moment: the run, whose turn, how far into it. A step planned for a moment that has passed does nothing.
    return { robotId: current.id, turnKey: `${room.runId ?? ''}:${room.gameState.statistics.turns}:${room.gameState.cardsPlayedThisTurn}:${current.hand.length}` };
  }

  // One step for the robot whose turn it is. Returns what was done, or null when it was not (or is no longer) a robot's turn.
  robotStep(gameId: string, expectedTurnKey: string): { robotId: string; step: 'play' | 'endTurn' | 'skip' | 'trade'; special: { pileId: number; lifeline: boolean } | null } | null {
    const due = this.robotToAct(gameId);
    if (!due || due.turnKey !== expectedTurnKey) return null;
    const state = this.requireRoom(gameId).gameState;
    let special: { pileId: number; lifeline: boolean } | null = null;
    // The written strategy decides cheats (skip, trade), which the network was not trained on; otherwise the network decides when there is one.
    const rule = chooseAction(observe(state, due.robotId));
    let brainAction: Action | null = null;
    if (rule.type !== 'skip' && rule.type !== 'trade' && rule.type !== 'none') {
      try { brainAction = this.hooks.robotBrain?.choose(state, due.robotId, this.getReactions(gameId)) ?? null; } catch { brainAction = null; }
    }
    // A move the network picks that the rules refuse falls back to the written strategy's, so a robot never stalls.
    let action: Action = rule;
    for (const candidate of brainAction ? [brainAction, rule] : [rule]) {
      try {
        if (candidate.type === 'play') {
          const after = this.playCard(due.robotId, { gameId, cardId: candidate.cardId, pileId: candidate.pileId });
          special = specialOf(state, after, due.robotId, candidate.pileId);
        }
        else if (candidate.type === 'endTurn') this.endTurn(due.robotId, gameId);
        else if (candidate.type === 'skip') this.skip(due.robotId, { gameId });
        else if (candidate.type === 'trade') this.trade(due.robotId, { gameId, cardId: candidate.cardId });
        else return null;
        action = candidate;
        break;
      } catch {
        if (candidate === rule) return null;
      }
    }
    if (action.type === 'none') return null;
    return { robotId: due.robotId, step: action.type, special };
  }

  // A table that has robots and no person left: the robots stop, and after the kick time the game is over, recorded as
  // abandoned for each signed-in person who was in it. Returns true when it ended the game.
  abandonIfOnlyRobotsRemain(gameId: string, nowMs: number = Date.now()): boolean {
    const room = this.rooms.get(gameId);
    if (!room || room.gameState.gamePhase !== 'playing') return false;
    const { players } = room.gameState;
    if (!players.some((player) => player.robot)) return false;
    // A signed-in table is kept for a week while people are away, so robots alone do not end it.
    if (everyPersonSignedIn(room)) return false;
    const kickMs = this.hooks.kickMs ?? DEFAULT_KICK_MS;
    const humans = players.filter((player) => !player.robot);
    const allAway = humans.every((player) => {
      const since = room.disconnectedAtMs.get(player.id);
      return since !== undefined && nowMs - since >= kickMs;
    });
    if (!allAway) return false;
    if (room.runId) {
      for (const human of humans) {
        this.emitResults(buildResultRows({ state: room.gameState, runId: room.runId, outcome: 'abandoned', userIdByPlayerId: room.userIdByPlayerId, nowMs, onlyPlayerId: human.id }));
      }
    }
    this.rooms.delete(gameId);
    this.reactions.delete(gameId);
    return true;
  }

  // A connection dropped. In a lobby or a finished game the seat is simply given up (removeDisconnectedPlayer); in a game
  // being played the seat is held, and this notes when it was lost. Returns the games that now hold such a seat.
  markDisconnected(playerId: string, nowMs: number = Date.now()): string[] {
    const held: string[] = [];
    for (const [gameId, room] of this.rooms) {
      if (room.gameState.gamePhase === 'playing' && room.gameState.players.some((player) => player.id === playerId)) {
        room.disconnectedAtMs.set(playerId, nowMs);
        held.push(gameId);
      }
    }
    return held;
  }

  // What a viewer is told about players who dropped, or undefined when there is nothing to tell. Never part of the stored game.
  // The id of the game's current run, which the player view carries so a browser can name the game the way the server does.
  runIdOf(gameId: string): string | null {
    return this.rooms.get(gameId)?.runId ?? null;
  }

  reconnectionFor(gameId: string, viewerId: string, nowMs: number = Date.now()): ReconnectionView | undefined {
    const room = this.rooms.get(gameId);
    if (!room || room.gameState.gamePhase !== 'playing') return undefined;
    const noticeMs = this.hooks.noticeMs ?? DEFAULT_NOTICE_MS;
    const kickMs = this.hooks.kickMs ?? DEFAULT_KICK_MS;
    const { players, hostId } = room.gameState;

    const lost: ReconnectionView['lost'] = [];
    const canKick: string[] = [];
    for (const player of players) {
      const since = room.disconnectedAtMs.get(player.id);
      if (since === undefined || player.id === viewerId || nowMs - since < noticeMs) continue;
      const long = nowMs - since >= kickMs;
      lost.push({ playerId: player.id, name: player.name, status: long ? 'lost' : 'reconnecting' });
      if (long) canKick.push(player.id);
    }
    if (lost.length === 0) return undefined;

    const hostLong = lost.some((entry) => entry.playerId === hostId && entry.status === 'lost');
    return {
      lost,
      canKick: viewerId === hostId ? canKick : [],
      canTakeOver: hostLong && this.nextAvailablePlayerId(room) === viewerId ? hostId : null
    };
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

  // Every assignment of a new state that can finish a game goes through this. It fires only when a state that was not
  // finished becomes finished, so a rejoin or a kick that re-assigns an already finished state cannot record it again.
  private recordIfFinished(room: GameRoom, before: GameState, after: GameState): void {
    if (isFinished(before) || !isFinished(after) || !room.runId) return;
    this.emitResults(buildResultRows({
      state: after,
      runId: room.runId,
      outcome: after.gamePhase as 'won' | 'lost',
      userIdByPlayerId: room.userIdByPlayerId,
      nowMs: Date.now()
    }));
  }

  private emitResults(rows: GameResultRow[]): void {
    if (rows.length === 0) return;
    try {
      this.hooks.onResults?.(rows);
    } catch {
      // Recording is best effort. Nothing it does may break the game it is recording.
    }
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

  // Answers only the asker. Counts the use (and refuses it under "once" a second time); the others are told a lookup
  // happened, never what it found.
  lookupCardStatus(gameId: string, playerId: string, cardValue: number, kind: 'lookup' | 'nas' = 'lookup'): { status: CardLookupStatus; playerName: string; holderName?: string } {
    const room = this.requireRoom(gameId);
    const { gameState } = room;

    if (gameState.gamePhase !== 'playing') {
      throw new Error('Card lookup is only available during an active game');
    }
    const player = gameState.players.find((p) => p.id === playerId);
    if (!player) {
      throw new Error('You are not in this game');
    }
    // A card outside this game's range is not one anyone holds, so it is answered as such and is not counted as a use. The check
    // still refuses a cheat that is off or spent.
    if (!inCardRange(gameState.settings, cardValue)) {
      assertCheatAvailable(gameState, playerId, kind);
      return { status: 'out-of-range', playerName: player.name };
    }
    // Throws when the cheat is off for this game, its single use is spent, or (for the Nas check) the player is not named Nas.
    room.gameState = recordCheatUse(gameState, playerId, kind);
    room.updatedAtMs = Date.now();

    if (gameState.drawPile.some((c) => c.value === cardValue)) {
      return { status: 'in-draw', playerName: player.name };
    }

    const holder = gameState.players.find((p) => p.hand.some((c) => c.value === cardValue));
    if (holder) {
      return { status: 'in-hand', playerName: player.name, holderName: holder.name };
    }

    return { status: 'played', playerName: player.name };
  }

  // The full Monty: where every card from 1 to 100 is, for the one asking. Counted as a use, like the other checks. Nobody else
  // is told what it showed, though the others are told a cheat was used.
  fullMonty(gameId: string, playerId: string): MontyCell[] {
    const room = this.requireRoom(gameId);
    room.gameState = recordCheatUse(room.gameState, playerId, 'monty');
    room.updatedAtMs = Date.now();
    return fullMontyCells(room.gameState, playerId);
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
    // A lobby nobody has touched for this long goes even with someone connected, so a forgotten open tab cannot hold a room.
    const idleLobbyMs = 60 * 60 * 1000;
    const overrideTtlMs = this.activeTtlMs ?? this.hooks.activeTtlMs;

    for (const [gameId, room] of this.rooms) {
      const connectedCount = room.gameState.players.filter((player) => activePlayerIds.has(player.id)).length;
      const ageMs = nowMs - room.updatedAtMs;
      if (connectedCount > 0 && !(room.gameState.gamePhase === 'lobby' && ageMs >= idleLobbyMs)) {
        continue;
      }

      const activeTtlMs = overrideTtlMs ?? (everyPersonSignedIn(room) ? SIGNED_IN_ACTIVE_TTL_MS : GUEST_ACTIVE_TTL_MS);
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
