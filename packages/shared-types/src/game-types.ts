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
  // A person who has turned on auto-mark (a player setting, not a cheat): the server marks the piles for them, by the robots' rule, while they are off turn.
  autoMark?: boolean | undefined;
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
  // Per-game limit on each cheat. Absent means off, except that a saved game or setting from before this existed keeps
  // meaning what allowCardLookup said for the card seeker. Use cheatLimitOf to read it.
  cheatLimits?: CheatLimits | undefined;
  // How long a robot waits before each thing it does (every card and the end of its turn), in milliseconds, when a person is at the table. The wait is this
  // long plus a random 0 to this much more. Absent means the server's default (800). Use ROBOT_PAUSE_DEFAULT_MS for that default.
  robotPauseMs?: number | undefined;
}

export const ROBOT_PAUSE_DEFAULT_MS = 800;
export const ROBOT_PAUSE_CHOICES_MS: readonly number[] = [100, 400, 800, 1500, 3000];

export type CheatKind = 'lookup' | 'nas' | 'monty' | 'skip' | 'trade' | 'hint';
// off: not available. once: one use per player per game. unlimited: no limit.
export type CheatLimit = 'off' | 'once' | 'unlimited';
// The Nas check and the full Monty are optional here: settings saved before them have no entry, and that reads as off (see cheatLimitOf).
export type CheatLimits = Record<Exclude<CheatKind, 'nas' | 'monty'>, CheatLimit> & { nas?: CheatLimit | undefined; monty?: CheatLimit | undefined };
export const CHEAT_KINDS: readonly CheatKind[] = ['lookup', 'nas', 'monty', 'skip', 'trade', 'hint'];
// The Nas check is for a player named Nas, in any capitals, with spaces at the ends ignored. The server gives a second player
// with the same name a suffix (Nas-1, Nas-2), and those players have the check too.
export const isNasName = (name: string): boolean => /^nas(-\d+)?$/.test(name.trim().toLowerCase());

// The full Monty shows every card from 1 to 100. Cards outside the game's range are grayed out.
export const MONTY_GRID_MIN = 1;
export const MONTY_GRID_MAX = 100;
// 'mine': in your hand. 'hand': in another player's hand. 'top': a played card that is on top of a foundation pile.
export type MontyCell = 'draw' | 'mine' | 'hand' | 'top' | 'played' | 'out';
export const inCardRange = (settings: Pick<GameSettings, 'minCardValue' | 'maxCardValue'>, value: number): boolean =>
  value >= settings.minCardValue && value <= settings.maxCardValue;

export interface PlayerStatistics {
  cardsPlayed: number;
  totalMovement: number;
  specialPlays: number;
  // The old card swap, kept readable for saved games and stored results. New games count swaps as tradesUsed.
  nasCheatsUsed: number;
  skipsUsed: number;
  tradesUsed: number;
  // Card checks, the card seeker's and the Nas check's together. Like the other cheat counts, an undo does not take them back.
  lookupsUsed: number;
  // How many of those lookups were made under the Nas check (so the card seeker's "once" is not spent by them).
  nasChecksUsed: number;
  // Uses of the full Monty. It is also a lookup, so it is in lookupsUsed as well.
  montyUsed: number;
  hintsUsed: number;
  // Undos this player took, and pile marks they placed. Neither is refunded by an undo (see carryAfterUndo).
  undosUsed: number;
  marksPlaced: number;
  // Backward 10s this player played when no card in their hand had a normal play (the only way forward). Rolled back by an undo.
  lifelines: number;
  // Plays by a teammate on a pile this player had marked by hand, one for each such play. Rolled back by an undo.
  markFollows: number;
}

export interface GameStatistics {
  turns: number;
  startedAtMs: number | null;
  endedAtMs: number | null;
  players: Record<string, PlayerStatistics>;
  // The player whose card play won the game. Set only by a winning play; a game won any other way leaves it unset.
  finishedById?: string | null | undefined;
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
  // The id of this run of the game (a room code is reused). Only the server's player view carries it; it is never stored.
  runId?: string | undefined;
  hostId: string;
  players: Player[];
  foundationPiles: FoundationPile[];
  drawPile: Card[];
  currentPlayerIndex: number;
  gamePhase: GamePhase;
  cardsPlayedThisTurn: number;
  statistics: GameStatistics;
  settings: GameSettings;
  isSolitaire: boolean;
  // Skips in a row with no card played in between; a full round of them ends the game as a loss.
  consecutiveSkips?: number | undefined;
  // The cards each player played on their most recent turn, in the order played (an empty list after a skip), and the cards
  // played so far on the turn in progress. Public, so every player sees them. Absent in games saved before this existed.
  lastTurnPlays?: Record<string, Card[]> | undefined;
  turnPlays?: Card[] | undefined;
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

// Pushed to the host when someone asks to join a game in progress with an invitation.
export interface JoinRequestEvent {
  requestId: string;
  playerName: string;
}

// Pushed to the person who asked, when the host answers (or the request lapses).
export type JoinResolvedEvent =
  | { approved: true; gameState: GameState; playerId: string; rejoinToken: string }
  | { approved: false; reason: string };

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

// out-of-range: the card is not one of this game's cards at all, so it is not where anyone can hold it. Not counted as a use.
export type CardLookupStatus = 'in-draw' | 'in-hand' | 'played' | 'out-of-range';

export interface FullMontyResult {
  // Cell i is card value MONTY_GRID_MIN + i.
  cells: MontyCell[];
}

export interface CardLookupPayload {
  gameId: string;
  cardValue: number;
  // Which cheat the check is made under. Absent means the card seeker.
  kind?: 'lookup' | 'nas';
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

// The Easy preset. Measured with the strategy (packages/engine/tools/sim.ts): Easy won 100% of solitaire games, Normal 5.0%,
// so a first game at Normal was almost always lost. Normal and Hard stay one tap away in Settings.
export const defaultSolitaireSettings: GameSettings = {
  minCardValue: 2,
  maxCardValue: 59,
  handSize: 8,
  minPlayers: 1,
  maxPlayers: 1,
  minCardsPerTurn: 1,
  autoRefillHand: true,
  allowUndo: false,
  privateGame: false,
  allowCardLookup: false
};

// The Normal preset for solitaire. The training benchmark, the tuning report and the "standard settings" in the badges all mean
// this, so it stays put when the default moves.
export const normalSolitaireSettings: GameSettings = { ...defaultSolitaireSettings, maxCardValue: 99, handSize: 7, minCardsPerTurn: 2 };

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
// The Nas check is an easter egg with no setting of its own: it is unlimited whenever the game has any other cheat on.
export function cheatLimitOf(settings: Pick<GameSettings, 'allowCardLookup' | 'cheatLimits'>, kind: CheatKind): CheatLimit {
  if (kind === 'nas') {
    return CHEAT_KINDS.some((other) => other !== 'nas' && cheatLimitOf(settings, other) !== 'off') ? 'unlimited' : 'off';
  }
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
