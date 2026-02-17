import { z } from 'zod';

const CARD_MIN = 2;
const CARD_MAX = 99;
const HAND_MIN = 5;
const HAND_MAX = 9;
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
    privateGame: z.boolean()
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

export const createGamePayloadSchema = z.object({
  playerName: z.string().trim().min(1).max(32),
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
  playerName: z.string().trim().min(1).max(32)
});

export const playCardPayloadSchema = z.object({
  gameId: z.string().length(6).regex(/^[A-Z0-9]{6}$/),
  cardId: z.string().min(1),
  pileId: z.number().int().min(0).max(3)
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

export type GameSettingsInput = z.infer<typeof gameSettingsSchema>;
