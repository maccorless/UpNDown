import { z } from 'zod';
import { CHEAT_KINDS, cheatLimitOf, type GameSettings } from './game-types.js';

// One finished (or abandoned) game, as one player saw it. The same row is kept in a guest's browser and, for a signed-in
// player, in the database. Times are epoch milliseconds. A fact that was never recorded is null, never zero.
const MAX_PLAY_MS = 24 * 24 * 3_600_000;

export const resultRowSchema = z.object({
  gameId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  mode: z.enum(['solitaire', 'multiplayer']),
  outcome: z.enum(['won', 'lost', 'abandoned']),
  startedAtMs: z.number().int().min(0),
  endedAtMs: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  turns: z.number().int().min(0).max(100_000),
  playerCount: z.number().int().min(1).max(6),
  robotCount: z.number().int().min(0).max(6).nullable().default(null),
  cardsTotal: z.number().int().min(1).max(200),
  cardsLeft: z.number().int().min(0).max(200),
  cardsPlayed: z.number().int().min(0).max(200),
  totalMovement: z.number().int().min(-100_000).max(100_000),
  specialPlays: z.number().int().min(0).max(200),
  skips: z.number().int().min(0).max(2000),
  trades: z.number().int().min(0).max(2000),
  lookups: z.number().int().min(0).max(2000),
  hints: z.number().int().min(0).max(2000),
  undos: z.number().int().min(0).max(10_000).nullable().default(null),
  marks: z.number().int().min(0).max(100_000).nullable().default(null),
  playedLastCard: z.boolean().nullable().default(null),
  // Null for a stored row written before these counters existed: unknown, not zero.
  lifelines: z.number().int().min(0).max(100_000).nullable().default(null),
  markFollows: z.number().int().min(0).max(100_000).nullable().default(null),
  handSize: z.number().int().min(1).max(30),
  minCardsPerTurn: z.number().int().min(1).max(30),
  maxCard: z.number().int().min(1).max(1000),
  cheatsAllowed: z.boolean(),
  undoAllowed: z.boolean()
}).superRefine((r, ctx) => {
  const fail = (message: string): void => { ctx.addIssue({ code: z.ZodIssueCode.custom, message }); };
  if (r.endedAtMs < r.startedAtMs) fail('endedAtMs before startedAtMs');
  if (r.durationMs !== r.endedAtMs - r.startedAtMs) fail('durationMs does not match the times');
  if (r.durationMs > MAX_PLAY_MS) fail('duration too long');
  if (r.robotCount !== null && r.robotCount >= r.playerCount) fail('a table needs a person');
  if (r.cardsLeft > r.cardsTotal || r.cardsPlayed > r.cardsTotal || r.cardsPlayed + r.cardsLeft > r.cardsTotal) fail('cards do not add up');
  if (r.specialPlays > r.cardsPlayed) fail('more special plays than plays');
  if (r.outcome === 'won' && r.cardsLeft !== 0) fail('a win leaves no cards');
  if (r.outcome === 'lost' && r.cardsLeft === 0) fail('a loss leaves cards');
  if (r.mode === 'solitaire' && r.playerCount !== 1) fail('solitaire has one player');
});

export type ResultRow = z.infer<typeof resultRowSchema>;

// True when at least one cheat can be used in a game with these settings.
export const cheatsAllowedBy = (settings: Pick<GameSettings, 'allowCardLookup' | 'cheatLimits'>): boolean =>
  CHEAT_KINDS.some((kind) => cheatLimitOf(settings, kind) !== 'off');
