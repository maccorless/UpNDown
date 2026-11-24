import type { ResultRow } from '@upndown/shared-types';

let n = 0;
// A finished multiplayer game with sensible numbers; override what a test is about.
export function row(over: Partial<ResultRow> = {}): ResultRow {
  n += 1;
  const endedAtMs = over.endedAtMs ?? 1_000_000 + n * 60_000;
  return {
    gameId: `g${n}`, mode: 'multiplayer', outcome: 'won', startedAtMs: endedAtMs - 600_000, endedAtMs, durationMs: 600_000, turns: 12,
    playerCount: 2, robotCount: 0, cardsTotal: 98, cardsLeft: 0, cardsPlayed: 40, totalMovement: 50, specialPlays: 1,
    skips: 0, trades: 0, lookups: 0, hints: 0, undos: 0, marks: 0, playedLastCard: false, lifelines: 0, markFollows: 0,
    handSize: 7, minCardsPerTurn: 2, maxCard: 99, cheatsAllowed: false, undoAllowed: false, ...over
  };
}

// A game that ended at a given local time in a given zone, written as a UTC instant.
export const at = (iso: string): number => Date.parse(iso);
