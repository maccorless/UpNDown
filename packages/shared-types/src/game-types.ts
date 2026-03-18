export type GamePhase = 'lobby' | 'playing' | 'won' | 'lost';
export type PileType = 'ascending' | 'descending';
export type PlayerColor = 'red' | 'orange' | 'green' | 'cyan' | 'purple' | 'pink';

export const PLAYER_COLORS: PlayerColor[] = ['red', 'orange', 'green', 'cyan', 'purple', 'pink'];

export interface Card {
  id: string;
  value: number;
}

export interface FoundationPile {
  id: number;
  type: PileType;
  topCard: Card;
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  isHost: boolean;
  color?: PlayerColor;
}

export interface GameSettings {
  minCardValue: number;
  maxCardValue: number;
  handSize: number;
  minPlayers: number;
  maxPlayers: number;
  minCardsPerTurn: number;
  autoRefillHand: boolean;
  allowUndo: boolean;
  privateGame: boolean;
  allowCardLookup: boolean;
}

export interface PlayerStatistics {
  cardsPlayed: number;
  totalMovement: number;
  specialPlays: number;
  nasCheatsUsed: number;
}

export interface GameStatistics {
  turns: number;
  startedAtMs: number | null;
  endedAtMs: number | null;
  players: Record<string, PlayerStatistics>;
}

export interface NasCheatState {
  enabledPlayerIds: string[];
  usedThisTurnByPlayerId: Record<string, boolean>;
}

export interface GameState {
  gameId: string;
  hostId: string;
  players: Player[];
  foundationPiles: FoundationPile[];
  drawPile: Card[];
  currentPlayerIndex: number;
  gamePhase: GamePhase;
  cardsPlayedThisTurn: number;
  statistics: GameStatistics;
  nasCheat: NasCheatState;
  settings: GameSettings;
  isSolitaire: boolean;
}

export type ReactionType = 'like' | 'love' | 'really_love';

export type PileReactions = Partial<Record<number, ReactionType>>;
export type ReactionState = Record<string, PileReactions>;

export interface SetReactionPayload {
  gameId: string;
  pileId: number;
  reactionType: ReactionType | null;
}

export interface CreateGamePayload {
  playerName: string;
  settings: GameSettings;
  isSolitaire: boolean;
}

export interface JoinGamePayload {
  gameId: string;
  playerName: string;
}

export interface PlayCardPayload {
  gameId: string;
  cardId: string;
  pileId: number;
}

export interface NasCheatPayload {
  gameId: string;
  cardId: string;
}

export interface UpdateSettingsPayload {
  gameId: string;
  settings: GameSettings;
}

export interface KickPlayerPayload {
  gameId: string;
  targetPlayerId: string;
}

export type CardLookupStatus = 'in-draw' | 'in-hand' | 'played';

export interface CardLookupPayload {
  gameId: string;
  cardValue: number;
}

export interface CardLookupResult {
  cardValue: number;
  status: CardLookupStatus;
  playerName: string;
  holderName?: string;
}

// ---------------------------------------------------------------------------
// Shared API / DTO types (used by both client and server)
// ---------------------------------------------------------------------------

/** Summary of a publicly joinable game returned by game:listJoinable. */
export interface JoinableGameSummary {
  gameId: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  createdAtMs: number;
}

/** Minimal info returned by game:lookup before a player commits to joining. */
export interface JoinLookupSummary {
  gameId: string;
  playerCount: number;
  maxPlayers: number;
  privateGame: boolean;
}

// ---------------------------------------------------------------------------
// Canonical default settings (single source of truth for both apps)
// ---------------------------------------------------------------------------

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

export const defaultSolitaireSettings: GameSettings = {
  minCardValue: 2,
  maxCardValue: 99,
  handSize: 7,
  minPlayers: 1,
  maxPlayers: 1,
  minCardsPerTurn: 2,
  autoRefillHand: true,
  allowUndo: false,
  privateGame: false,
  allowCardLookup: false
};
