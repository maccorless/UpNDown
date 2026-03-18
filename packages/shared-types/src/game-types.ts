export type GamePhase = 'lobby' | 'playing' | 'won' | 'lost';
export type PileType = 'ascending' | 'descending';

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
