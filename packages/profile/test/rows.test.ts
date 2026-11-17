import { describe, expect, it } from 'vitest';
import { buildDeck, createStartedGameState } from '@upndown/engine';
import type { GameSettings, GameState } from '@upndown/shared-types';
import { resultRowSchema } from '@upndown/shared-types';
import { resultRowFromState } from '../src/rows.js';

const settings: GameSettings = {
  minCardValue: 2, maxCardValue: 30, handSize: 5, minPlayers: 2, maxPlayers: 6, minCardsPerTurn: 2, autoRefillHand: false,
  allowUndo: false, privateGame: false, allowCardLookup: false, showArrows: true,
  cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off' }
};

function game(): GameState {
  return createStartedGameState({
    gameId: 'G', hostId: 'p1', players: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'Bot', robot: true }],
    settings, isSolitaire: false, deck: buildDeck(settings)
  });
}

describe('resultRowFromState', () => {
  it('counts the robots at the table and the player\'s own counters, and passes its own schema', () => {
    const state = game();
    state.statistics.players.p1 = { ...state.statistics.players.p1!, cardsPlayed: 0, specialPlays: 0, hintsUsed: 2, undosUsed: 3, marksPlaced: 5 };
    state.statistics = { ...state.statistics, startedAtMs: 1_000, endedAtMs: 61_000 };
    const row = resultRowFromState({ state, runId: 'run-1', outcome: 'lost', playerId: 'p1', nowMs: 99_000 });
    expect(row).toMatchObject({ gameId: 'run-1', mode: 'multiplayer', playerCount: 3, robotCount: 1, cardsPlayed: 0, hints: 2, undos: 3, marks: 5, durationMs: 60_000, cheatsAllowed: false, undoAllowed: false });
    expect(resultRowSchema.safeParse(row).success).toBe(true);
  });

  it('gives "played the last card" to the winner only, and leaves it unknown for a win from before winners were recorded', () => {
    const won = { ...game(), gamePhase: 'won' as const };
    won.drawPile = []; won.players.forEach((p) => { p.hand = []; });
    won.statistics = { ...won.statistics, finishedById: 'p2' };
    const as = (playerId: string) => resultRowFromState({ state: won, runId: 'r', outcome: 'won', playerId, nowMs: 5 }).playedLastCard;
    expect(as('p2')).toBe(true);
    expect(as('p1')).toBe(false);
    const rest = { ...won.statistics };
    delete rest.finishedById;
    expect(resultRowFromState({ state: { ...won, statistics: rest }, runId: 'r', outcome: 'won', playerId: 'p1', nowMs: 5 }).playedLastCard).toBeNull();
  });

  it('ends an abandoned game when it was abandoned, not when the engine last stamped a time', () => {
    const state = game();
    state.statistics = { ...state.statistics, startedAtMs: 1_000 };
    const row = resultRowFromState({ state, runId: 'r', outcome: 'abandoned', playerId: 'p1', nowMs: 51_000 });
    expect(row.endedAtMs).toBe(51_000);
    expect(row.playedLastCard).toBe(false);
  });
});
