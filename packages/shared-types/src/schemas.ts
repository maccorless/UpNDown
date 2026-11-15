import { z } from 'zod';
import { cleanPlayerName } from './player-names.js';

const CARD_MIN = 2;
const CARD_MAX = 99;
const HAND_MIN = 5;
const HAND_MAX = 11;
const PLAYER_MIN = 1;
const PLAYER_MAX = 6;
const TURN_MIN = 1;
const TURN_MAX = 3;
const MIN_DECK_SIZE = 18;

export const gameSettingsSchema = z
  .object({
    minCardValue: z.number().int().min(CARD_MIN).max(CARD_MAX),
    maxCardValue: z.number().int().min(CARD_MIN).max(CARD_MAX),
    handSize: z.number().int().min(HAND_MIN).max(HAND_MAX),
    minPlayers: z.number().int().min(PLAYER_MIN).max(PLAYER_MAX),
    maxPlayers: z.number().int().min(PLAYER_MIN).max(PLAYER_MAX),
    minCardsPerTurn: z.number().int().min(TURN_MIN).max(TURN_MAX),
    autoRefillHand: z.boolean(),
    allowUndo: z.boolean(),
    privateGame: z.boolean(),
    allowCardLookup: z.boolean(),
    showArrows: z.boolean()
  })
  .superRefine((settings, ctx) => {
    if (settings.maxCardValue <= settings.minCardValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxCardValue'],
        message: 'maxCardValue must be greater than minCardValue'
      });
    }

    if (settings.maxPlayers < settings.minPlayers) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxPlayers'],
        message: 'maxPlayers must be >= minPlayers'
      });
    }

    const deckSize = settings.maxCardValue - settings.minCardValue + 1;
    if (deckSize < MIN_DECK_SIZE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxCardValue'],
        message: `Deck must contain at least ${MIN_DECK_SIZE} cards`
      });
    }

  });

// A name that others will read: cleaned of control and bidirectional characters, then 1 to 32 characters. Used for an
// account's name and for the name a player takes into a game.
export const accountNameSchema = z.string().max(200).transform(cleanPlayerName).pipe(z.string().min(1).max(32));

export const createGamePayloadSchema = z.object({
  playerName: accountNameSchema,
  settings: gameSettingsSchema,
  isSolitaire: z.boolean()
}).superRefine((payload, ctx) => {
  if (payload.isSolitaire) {
    if (payload.settings.minPlayers !== 1 || payload.settings.maxPlayers !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['settings', 'minPlayers'],
        message: 'Solitaire requires minPlayers=1 and maxPlayers=1'
      });
    }
    return;
  }

  if (payload.settings.minPlayers < 2 || payload.settings.maxPlayers < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['settings', 'minPlayers'],
      message: 'Multiplayer requires at least 2 players'
    });
  }
});

export const joinGamePayloadSchema = z.object({
  gameId: z.string().length(6).regex(/^[A-Z0-9]{6}$/),
  playerName: accountNameSchema
});

export const playCardPayloadSchema = z.object({
  gameId: z.string().length(6).regex(/^[A-Z0-9]{6}$/),
  cardId: z.string().min(1),
  pileId: z.number().int().min(0).max(3)
});

export const nasCheatPayloadSchema = z.object({
  gameId: z.string().length(6).regex(/^[A-Z0-9]{6}$/),
  cardId: z.string().min(1)
});

export const updateSettingsPayloadSchema = z.object({
  gameId: z.string().length(6).regex(/^[A-Z0-9]{6}$/),
  settings: gameSettingsSchema
}).superRefine((payload, ctx) => {
  if (payload.settings.minPlayers < 2 || payload.settings.maxPlayers < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['settings', 'minPlayers'],
      message: 'Multiplayer requires at least 2 players'
    });
  }
});

export const kickPlayerPayloadSchema = z.object({
  gameId: z.string().length(6).regex(/^[A-Z0-9]{6}$/),
  targetPlayerId: z.string().min(1)
});

export const setReactionPayloadSchema = z.object({
  gameId: z.string().length(6).regex(/^[A-Z0-9]{6}$/),
  pileId: z.number().int().min(0).max(3),
  reactionType: z.enum(['like', 'love', 'really_love']).nullable()
});

export const cardLookupPayloadSchema = z.object({
  gameId: z.string().length(6).regex(/^[A-Z0-9]{6}$/),
  cardValue: z.number().int().min(1).max(999),
  secret: z.boolean().optional()
});

export const rejoinGamePayloadSchema = z.object({
  gameId: z.string().length(6).regex(/^[A-Z0-9]{6}$/),
  previousPlayerId: z.string().min(1),
  rejoinToken: z.string().min(1).max(128)
});

export type GameSettingsInput = z.infer<typeof gameSettingsSchema>;

// What an account keeps. Every key is optional so a partial document is valid; unknown keys are dropped.
export const storedSettingsSchema = z.object({
  playerName: accountNameSchema.optional(),
  solitaire: gameSettingsSchema.optional(),
  multiplayer: gameSettingsSchema.optional(),
  enableSounds: z.boolean().optional()
});

export type StoredSettings = z.infer<typeof storedSettingsSchema>;

const cardSchema = z.object({ id: z.string().min(1).max(40), value: z.number().int().min(-1000).max(1000) });

// The whole of a game, for anything that has to read one back from storage: a saved solitaire game today, and games
// in progress if they are ever kept in a database. Bounds are generous; they exist so a damaged or hand-edited value
// is refused rather than trusted. Shape only: rules (is this a legal position) stay in the engine.
export const gameStateSchema = z.object({
  gameId: z.string().max(16),
  hostId: z.string().max(100),
  players: z.array(z.object({
    id: z.string().max(100),
    name: z.string().max(64),
    hand: z.array(cardSchema).max(200),
    isHost: z.boolean(),
    color: z.enum(['red', 'orange', 'green', 'cyan', 'purple', 'pink']).optional()
  })).max(6),
  foundationPiles: z.array(z.object({
    id: z.number().int().min(0).max(7),
    type: z.enum(['ascending', 'descending']),
    topCard: cardSchema
  })).max(8),
  drawPile: z.array(cardSchema).max(300),
  currentPlayerIndex: z.number().int().min(0).max(5),
  gamePhase: z.enum(['lobby', 'playing', 'won', 'lost']),
  cardsPlayedThisTurn: z.number().int().min(0).max(1000),
  statistics: z.object({
    turns: z.number().int().min(0),
    startedAtMs: z.number().nullable(),
    endedAtMs: z.number().nullable(),
    players: z.record(z.string().max(100), z.object({
      cardsPlayed: z.number().int().min(0),
      totalMovement: z.number().int(),
      specialPlays: z.number().int().min(0),
      nasCheatsUsed: z.number().int().min(0)
    }))
  }),
  nasCheat: z.object({
    enabledPlayerIds: z.array(z.string().max(100)).max(6),
    usedThisTurnByPlayerId: z.record(z.string().max(100), z.boolean())
  }),
  settings: gameSettingsSchema,
  isSolitaire: z.boolean()
});

// What a browser reports when a signed-in player finishes a solitaire game. The server cannot watch a solitaire game,
// but the history is private to its owner, so a false report only misleads them. The rules below keep it sane, not honest.
export const solitaireResultPayloadSchema = z.object({
  // One id per game, kept with the saved game, so sending the same result twice is harmless.
  gameId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  outcome: z.enum(['won', 'lost']),
  startedAtMs: z.number().int().min(0),
  endedAtMs: z.number().int().min(0),
  turns: z.number().int().min(0).max(100_000),
  cardsTotal: z.number().int().min(1).max(200),
  cardsLeft: z.number().int().min(0).max(200),
  cardsPlayed: z.number().int().min(0).max(200),
  totalMovement: z.number().int().min(-100_000).max(100_000),
  specialPlays: z.number().int().min(0).max(200),
  nasCheats: z.number().int().min(0).max(200),
  settings: gameSettingsSchema
}).superRefine((r, ctx) => {
  const fail = (message: string): void => { ctx.addIssue({ code: z.ZodIssueCode.custom, message }); };
  if (r.endedAtMs < r.startedAtMs) fail('endedAtMs before startedAtMs');
  // Playing time, not wall time: a game left for a week and finished still reports only the time spent playing. The
  // column holds a 32-bit number of milliseconds (24.8 days), so the limit sits under that.
  if (r.endedAtMs - r.startedAtMs > 24 * 24 * 3_600_000) fail('duration too long');
  if (r.cardsTotal !== r.settings.maxCardValue - r.settings.minCardValue + 1) fail('cardsTotal does not match the settings');
  if (r.cardsLeft > r.cardsTotal || r.cardsPlayed > r.cardsTotal || r.cardsPlayed + r.cardsLeft > r.cardsTotal) fail('cards do not add up');
  if (r.specialPlays > r.cardsPlayed || r.nasCheats > r.cardsPlayed) fail('more special plays than plays');
  if (r.outcome === 'won' && r.cardsLeft !== 0) fail('a win leaves no cards');
  if (r.outcome === 'lost' && r.cardsLeft === 0) fail('a loss leaves cards');
});

export type SolitaireResultPayload = z.infer<typeof solitaireResultPayloadSchema>;

