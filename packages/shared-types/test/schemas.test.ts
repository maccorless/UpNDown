import { describe, expect, it } from 'vitest';
import {
  createGamePayloadSchema,
  gameSettingsSchema,
  joinGamePayloadSchema,
  nasCheatPayloadSchema,
  updateSettingsPayloadSchema
} from '../src/schemas.js';

const validSettings = {
  minCardValue: 2,
  maxCardValue: 50,
  handSize: 7,
  minPlayers: 2,
  maxPlayers: 6,
  minCardsPerTurn: 2,
  autoRefillHand: true,
  allowUndo: false,
  privateGame: false
};

describe('gameSettingsSchema', () => {
  it('accepts valid settings', () => {
    const parsed = gameSettingsSchema.safeParse(validSettings);
    expect(parsed.success).toBe(true);
  });

  it('rejects deck sizes below 18 cards', () => {
    const parsed = gameSettingsSchema.safeParse({
      ...validSettings,
      minCardValue: 2,
      maxCardValue: 18
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects hand sizes outside 5-9', () => {
    const parsed = gameSettingsSchema.safeParse({ ...validSettings, handSize: 4 });
    expect(parsed.success).toBe(false);
  });

  it('accepts settings even when full max-table deal is not possible', () => {
    const parsed = gameSettingsSchema.safeParse({
      ...validSettings,
      minCardValue: 2,
      maxCardValue: 20,
      handSize: 5,
      maxPlayers: 6
    });
    expect(parsed.success).toBe(true);
  });
});

describe('createGamePayloadSchema', () => {
  it('rejects multiplayer payloads with fewer than 2 players in settings', () => {
    const parsed = createGamePayloadSchema.safeParse({
      playerName: 'Ken',
      isSolitaire: false,
      settings: { ...validSettings, minPlayers: 1, maxPlayers: 1 }
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects solitaire payloads unless min/max players are both 1', () => {
    const parsed = createGamePayloadSchema.safeParse({
      playerName: 'Ken',
      isSolitaire: true,
      settings: { ...validSettings, minPlayers: 2, maxPlayers: 6 }
    });
    expect(parsed.success).toBe(false);
  });
});

describe('joinGamePayloadSchema', () => {
  it('accepts a valid game key', () => {
    expect(joinGamePayloadSchema.safeParse({ gameId: 'Q7M2K9', playerName: 'Ken' }).success).toBe(true);
  });

  it('rejects lowercase or malformed game keys', () => {
    expect(joinGamePayloadSchema.safeParse({ gameId: 'q7m2k9', playerName: 'Ken' }).success).toBe(false);
    expect(joinGamePayloadSchema.safeParse({ gameId: 'ABC', playerName: 'Ken' }).success).toBe(false);
  });
});

describe('updateSettingsPayloadSchema', () => {
  it('accepts a valid update settings payload', () => {
    expect(updateSettingsPayloadSchema.safeParse({ gameId: 'Q7M2K9', settings: validSettings }).success).toBe(true);
  });

  it('rejects multiplayer updates that set player counts below 2', () => {
    expect(updateSettingsPayloadSchema.safeParse({
      gameId: 'Q7M2K9',
      settings: { ...validSettings, minPlayers: 1, maxPlayers: 1 }
    }).success).toBe(false);
  });
});

describe('nasCheatPayloadSchema', () => {
  it('accepts a valid nas cheat payload', () => {
    expect(nasCheatPayloadSchema.safeParse({ gameId: 'Q7M2K9', cardId: 'c-42' }).success).toBe(true);
  });

  it('rejects malformed nas cheat payloads', () => {
    expect(nasCheatPayloadSchema.safeParse({ gameId: 'abc', cardId: '' }).success).toBe(false);
  });
});
