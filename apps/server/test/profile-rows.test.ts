import { describe, expect, it } from 'vitest';
import type { ResultRow } from '@upndown/shared-types';
import { toResultRow, toStoredRow } from '../src/profile/rows.js';

const row: ResultRow = {
  gameId: 'run-1', mode: 'solitaire', outcome: 'won', startedAtMs: 1_000, endedAtMs: 61_000, durationMs: 60_000, turns: 9,
  playerCount: 1, robotCount: 0, cardsTotal: 98, cardsLeft: 0, cardsPlayed: 98, totalMovement: 120, specialPlays: 3,
  skips: 1, trades: 2, lookups: 3, hints: 4, undos: null, marks: 0, playedLastCard: true,
  handSize: 7, minCardsPerTurn: 2, maxCard: 99, cheatsAllowed: true, undoAllowed: true
};

describe('stored rows', () => {
  it('read back exactly as they were written (an imported guest game must come out of the account the way it went in)', () => {
    expect(toResultRow(toStoredRow('u1', row))).toEqual(row);
  });

  it('works out the cheat and undo flags from the full settings of a row the server watched', () => {
    const stored = toStoredRow('u1', row);
    const watched = { ...stored, settings: { allowUndo: true, allowCardLookup: false, cheatLimits: { lookup: 'off', skip: 'once', trade: 'off', hint: 'off' } } };
    expect(toResultRow(watched)).toMatchObject({ cheatsAllowed: true, undoAllowed: true });
    const none = { ...stored, settings: { allowUndo: false, cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off' } } };
    expect(toResultRow(none)).toMatchObject({ cheatsAllowed: false, undoAllowed: false });
  });

  it('adds the old card-swap column to trades, as rows from before migration 003 need', () => {
    expect(toResultRow({ ...toStoredRow('u1', row), myTrades: 1, myNasCheats: 2 }).trades).toBe(3);
  });
});
