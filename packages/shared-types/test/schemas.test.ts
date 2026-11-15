import { describe, expect, it } from 'vitest';
import {
  createGamePayloadSchema,
  gameSettingsSchema,
  gameStateSchema,
  joinGamePayloadSchema,
  nasCheatPayloadSchema,
  updateSettingsPayloadSchema
} from '../src/schemas.js';
import { cheatLimitOf, deckFitMessage, maxPlayersFor, withCheatLimits } from '../src/game-types.js';

const validSettings = {
  minCardValue: 2,
  maxCardValue: 50,
  handSize: 7,
  minPlayers: 2,
  maxPlayers: 6,
  minCardsPerTurn: 2,
  autoRefillHand: true,
  allowUndo: false,
  privateGame: false,
  allowCardLookup: false, showArrows: true
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

describe('hand size and the deck', () => {
  it('accepts a hand of 11 and rejects 12', () => {
    expect(gameSettingsSchema.safeParse({ ...validSettings, handSize: 11 }).success).toBe(true);
    expect(gameSettingsSchema.safeParse({ ...validSettings, handSize: 12 }).success).toBe(false);
  });

  // A table must never be dealt short hands: capacity is what the deck can deal, whatever maxPlayers says.
  it('limits a table to the players the deck can deal a full hand to', () => {
    const small = { ...validSettings, minCardValue: 2, maxCardValue: 29, handSize: 9, minPlayers: 2, maxPlayers: 6 };
    expect(maxPlayersFor(small)).toBe(3); // 28 cards, 9 each
    expect(deckFitMessage(small)).toBeNull();
    expect(maxPlayersFor({ ...validSettings, minCardValue: 2, maxCardValue: 99, handSize: 11, maxPlayers: 6 })).toBe(6);
  });

  it('says so when even the minimum table cannot be dealt', () => {
    const tiny = { ...validSettings, minCardValue: 2, maxCardValue: 19, handSize: 11, minPlayers: 2, maxPlayers: 4 };
    expect(deckFitMessage(tiny)).toContain('not enough');
    expect(maxPlayersFor(tiny)).toBe(1);
  });
});

describe('cheat limits', () => {
  const base = { allowCardLookup: false };
  it('reads the old card seeker switch when no limits are given', () => {
    expect(cheatLimitOf({ allowCardLookup: true }, 'lookup')).toBe('unlimited');
    expect(cheatLimitOf(base, 'lookup')).toBe('off');
    expect(cheatLimitOf({ allowCardLookup: true }, 'trade')).toBe('off');
  });

  it('lets cheatLimits win over the old switch', () => {
    const limits = { lookup: 'once', skip: 'unlimited', trade: 'off', hint: 'once' } as const;
    expect(cheatLimitOf({ allowCardLookup: false, cheatLimits: limits }, 'lookup')).toBe('once');
    expect(cheatLimitOf({ allowCardLookup: true, cheatLimits: { ...limits, lookup: 'off' } }, 'lookup')).toBe('off');
  });

  // The old container keeps serving during a deploy and reads only allowCardLookup, so both must be written.
  it('writes both forms, so a setting from either generation reads the same', () => {
    const out = withCheatLimits({ ...validSettings, allowCardLookup: true });
    expect(out.cheatLimits?.lookup).toBe('unlimited');
    expect(out.allowCardLookup).toBe(true);
    const off = withCheatLimits({ ...validSettings, cheatLimits: { lookup: 'off', skip: 'once', trade: 'off', hint: 'off' }, allowCardLookup: true });
    expect(off.allowCardLookup).toBe(false);
    expect(gameSettingsSchema.safeParse(off).success).toBe(true);
  });

  it('still parses settings saved before limits existed', () => {
    expect(gameSettingsSchema.safeParse(validSettings).success).toBe(true);
  });
});

describe('statistics from before cheats were counted by kind', () => {
  it('reads the old card swap count as trades, and fills the new counters with zero', () => {
    const parsed = gameStateSchema.shape.statistics.parse({
      turns: 3, startedAtMs: 1, endedAtMs: null,
      players: { p1: { cardsPlayed: 4, totalMovement: 9, specialPlays: 1, nasCheatsUsed: 2 } }
    });
    expect(parsed.players.p1).toEqual({ cardsPlayed: 4, totalMovement: 9, specialPlays: 1, nasCheatsUsed: 2, skipsUsed: 0, tradesUsed: 2, lookupsUsed: 0, hintsUsed: 0 });
  });
});

