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
  // A seat played by the server, not by a person: no connection, no account, no result recorded.
  robot?: boolean | undefined;
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
  showArrows: boolean;
  // Per-game limit on each cheat. Absent means off, except that a saved game or setting from before this existed keeps
  // meaning what allowCardLookup said for the card seeker. Use cheatLimitOf to read it.
  cheatLimits?: CheatLimits | undefined;
}

export type CheatKind = 'lookup' | 'skip' | 'trade' | 'hint';
// off: not available. once: one use per player per game. unlimited: no limit.
export type CheatLimit = 'off' | 'once' | 'unlimited';
export type CheatLimits = Record<CheatKind, CheatLimit>;
export const CHEAT_KINDS: readonly CheatKind[] = ['lookup', 'skip', 'trade', 'hint'];

export interface PlayerStatistics {
  cardsPlayed: number;
  totalMovement: number;
  specialPlays: number;
  // The old card swap, kept readable for saved games and stored results. New games count swaps as tradesUsed.
  nasCheatsUsed: number;
  skipsUsed: number;
  tradesUsed: number;
  lookupsUsed: number;
  hintsUsed: number;
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

// What a player is told about connections that have dropped during a game. Only the server fills this in, per viewer, in
// the view it sends; it is never part of the stored game. Times are the server's: a blip shorter than the notice time is
// not reported at all.
export interface ReconnectionView {
  // Everyone sees these: players gone for at least the notice time (10 s). `lost` means gone for the kick time (90 s) too.
  lost: Array<{ playerId: string; name: string; status: 'reconnecting' | 'lost' }>;
  // For the host only: players gone for at least the kick time, whom they may now kick (or keep waiting for).
  canKick: string[];
  // For the next available player only, when the host has been gone for the kick time: the host's id. They may take over.
  canTakeOver: string | null;
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
  // Skips in a row with no card played in between; a full round of them ends the game as a loss.
  consecutiveSkips?: number | undefined;
  reconnection?: ReconnectionView;
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

export interface RemoveRobotPayload {
  gameId: string;
  playerId: string;
}

export interface SkipPayload {
  gameId: string;
}

// The cheat that tells the others a player used a cheat. Never says which card or what the answer was.
export interface CheatUsedEvent {
  playerId: string;
  playerName: string;
  kind: CheatKind;
}

export interface TradePayload {
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
  allowCardLookup: false,
  showArrows: true
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
  allowCardLookup: false,
  showArrows: true
};

// Cards in the deck for these settings (every value from the lowest to the highest). The four foundation piles are
// created separately and do not come out of it.
export function deckSizeOf(settings: Pick<GameSettings, 'minCardValue' | 'maxCardValue'>): number {
  return settings.maxCardValue - settings.minCardValue + 1;
}

// How many players can be dealt a full hand from this deck. A table never holds more than this, whatever maxPlayers says,
// so a deal can never leave a player short.
export function maxPlayersFor(settings: Pick<GameSettings, 'minCardValue' | 'maxCardValue' | 'handSize' | 'maxPlayers'>): number {
  return Math.max(0, Math.min(settings.maxPlayers, Math.floor(deckSizeOf(settings) / settings.handSize)));
}

// Null when a table of at least minPlayers can be dealt, otherwise a message for the person choosing the settings.
export function deckFitMessage(settings: Pick<GameSettings, 'minCardValue' | 'maxCardValue' | 'handSize' | 'maxPlayers' | 'minPlayers'>): string | null {
  const fit = Math.floor(deckSizeOf(settings) / settings.handSize);
  if (fit < settings.minPlayers) {
    return `This deck has ${deckSizeOf(settings)} cards, which is not enough for ${settings.minPlayers} players with a hand of ${settings.handSize}. Raise the top card or lower the hand size.`;
  }
  return null;
}

// The limit for one cheat, whichever way the settings were written. When cheatLimits is present it wins; otherwise only the
// card seeker can be on, as the old allowCardLookup said.
export function cheatLimitOf(settings: Pick<GameSettings, 'allowCardLookup' | 'cheatLimits'>, kind: CheatKind): CheatLimit {
  const given = settings.cheatLimits?.[kind];
  if (given) return given;
  return kind === 'lookup' && settings.allowCardLookup ? 'unlimited' : 'off';
}

// Writes both representations, so a container from before cheatLimits existed (it keeps serving during a deploy) still
// reads a valid allowCardLookup.
export function withCheatLimits<T extends GameSettings>(settings: T): T {
  const cheatLimits = Object.fromEntries(CHEAT_KINDS.map((kind) => [kind, cheatLimitOf(settings, kind)])) as CheatLimits;
  return { ...settings, cheatLimits, allowCardLookup: cheatLimits.lookup !== 'off' };
}
