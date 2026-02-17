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
  settings: GameSettings;
  isSolitaire: boolean;
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

export interface UpdateSettingsPayload {
  gameId: string;
  settings: GameSettings;
}
