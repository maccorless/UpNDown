import type { GameState } from '@upndown/shared-types';
import { describe, expect, it } from 'vitest';
import { defaultMultiplayerSettings } from '../src/game-manager.js';
import { buildResultRows } from '../src/profile/result-rows.js';

const state = (over: Partial<GameState> = {}): GameState => ({
  gameId: 'ABC123',
  hostId: 'p1',
  players: [
    { id: 'p1', name: 'Ann', hand: [], isHost: true },
    { id: 'p2', name: 'Bob', hand: [{ id: 'c-5', value: 5 }, { id: 'c-6', value: 6 }], isHost: false },
    { id: 'p3', name: 'Cy', hand: [], isHost: false }
  ],
  foundationPiles: [],
  drawPile: [{ id: 'c-9', value: 9 }],
  currentPlayerIndex: 0,
  gamePhase: 'lost',
  cardsPlayedThisTurn: 0,
  statistics: {
    turns: 14,
    startedAtMs: 1_000_000,
    endedAtMs: 1_090_000,
    players: {
      p1: { cardsPlayed: 30, totalMovement: 150, specialPlays: 2, nasCheatsUsed: 0, skipsUsed: 0, tradesUsed: 0, lookupsUsed: 0, nasChecksUsed: 0, montyUsed: 0, hintsUsed: 0 },
      p2: { cardsPlayed: 20, totalMovement: -8, specialPlays: 5, nasCheatsUsed: 1, skipsUsed: 0, tradesUsed: 0, lookupsUsed: 0, nasChecksUsed: 0, montyUsed: 0, hintsUsed: 0 }
    }
  },
  settings: defaultMultiplayerSettings,
  isSolitaire: false,
  ...over
});

const users = new Map([['p1', 'u1'], ['p2', 'u2']]); // p3 is a guest

describe('buildResultRows', () => {
  it('makes one row per signed-in player and none for a guest', () => {
    const rows = buildResultRows({ state: state(), runId: 'run-1', outcome: 'lost', userIdByPlayerId: users, nowMs: 5 });
    expect(rows.map((r) => r.userId)).toEqual(['u1', 'u2']);
  });

  it('gives each player the team result and their own contribution, and only the count of co-players', () => {
    const [ann, bob] = buildResultRows({ state: state(), runId: 'run-1', outcome: 'lost', userIdByPlayerId: users, nowMs: 5 });
    expect(ann).toMatchObject({
      gameId: 'run-1', mode: 'multiplayer', outcome: 'lost', turns: 14, playerCount: 3,
      durationMs: 90_000, myCardsPlayed: 30, myTotalMovement: 150, mySpecialPlays: 2, myNasCheats: 0
    });
    // A backward 10 counts as -10, so a player's net movement can be negative.
    expect(bob).toMatchObject({ myCardsPlayed: 20, myTotalMovement: -8, mySpecialPlays: 5, myNasCheats: 1 });
    expect(ann!.startedAt.getTime()).toBe(1_000_000);
    expect(ann!.endedAt.getTime()).toBe(1_090_000);
    expect(JSON.stringify(ann)).not.toContain('Bob');
    expect(JSON.stringify(ann)).not.toContain('u2');
  });

  it('counts the cards still unplayed: the draw pile and every hand', () => {
    const [row] = buildResultRows({ state: state(), runId: 'r', outcome: 'lost', userIdByPlayerId: users, nowMs: 5 });
    expect(row!.cardsLeft).toBe(3);
    expect(row!.cardsTotal).toBe(defaultMultiplayerSettings.maxCardValue - defaultMultiplayerSettings.minCardValue + 1);
    const [won] = buildResultRows({ state: state({ drawPile: [], players: state().players.map((p) => ({ ...p, hand: [] })) }), runId: 'r', outcome: 'won', userIdByPlayerId: users, nowMs: 5 });
    expect(won!.cardsLeft).toBe(0);
  });

  it('snapshots the settings that made the game easy or hard', () => {
    const [row] = buildResultRows({ state: state(), runId: 'r', outcome: 'won', userIdByPlayerId: users, nowMs: 5 });
    expect(row).toMatchObject({
      handSize: defaultMultiplayerSettings.handSize,
      minCardsPerTurn: defaultMultiplayerSettings.minCardsPerTurn,
      maxCard: defaultMultiplayerSettings.maxCardValue,
      settings: { ...defaultMultiplayerSettings }
    });
  });

  it('gives a player the engine counters or zeros when none exist yet', () => {
    const [, , cy] = buildResultRows({ state: state(), runId: 'r', outcome: 'lost', userIdByPlayerId: new Map([['p1', 'u1'], ['p2', 'u2'], ['p3', 'u3']]), nowMs: 5 });
    expect(cy).toMatchObject({ userId: 'u3', myCardsPlayed: 0, myTotalMovement: 0, mySpecialPlays: 0, myNasCheats: 0 });
  });

  // The host chose to stop; the others did not. So a quit is the host's row alone, ended when the host ended it.
  it('builds an abandoned row for the named player only, ended now rather than at the engine\'s stamp', () => {
    const rows = buildResultRows({
      state: state({ gamePhase: 'playing', statistics: { ...state().statistics, endedAtMs: null } }),
      runId: 'r', outcome: 'abandoned', userIdByPlayerId: users, nowMs: 1_240_000, onlyPlayerId: 'p1'
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 'u1', outcome: 'abandoned', durationMs: 240_000, myCardsPlayed: 30 });
    expect(rows[0]!.endedAt.getTime()).toBe(1_240_000);
  });

  // A game started and left before any card was played is not one anyone played, so it is not counted as abandoned.
  it('writes no abandoned row when nobody at the table had played a card', () => {
    const unplayed = state({
      gamePhase: 'playing',
      statistics: { ...state().statistics, endedAtMs: null, players: { p1: { ...state().statistics.players.p1!, cardsPlayed: 0 }, p2: { ...state().statistics.players.p2!, cardsPlayed: 0 } } }
    });
    expect(buildResultRows({ state: unplayed, runId: 'r', outcome: 'abandoned', userIdByPlayerId: users, nowMs: 1_240_000, onlyPlayerId: 'p1' })).toEqual([]);
  });

  it('never reports an end before the start, or a negative duration', () => {
    const [row] = buildResultRows({
      state: state({ statistics: { ...state().statistics, startedAtMs: 2_000_000, endedAtMs: 1_000_000 } }),
      runId: 'r', outcome: 'won', userIdByPlayerId: users, nowMs: 3
    });
    expect(row!.durationMs).toBe(0);
    expect(row!.endedAt.getTime()).toBe(row!.startedAt.getTime());
  });
});

describe('cheats in a result row', () => {
  it('carries each player\'s skips, trades, lookups and hints into their own row', () => {
    const base = state();
    const cheated = state({
      statistics: {
        ...base.statistics,
        players: {
          p1: { ...base.statistics.players.p1!, skipsUsed: 1, lookupsUsed: 4, nasChecksUsed: 0, montyUsed: 0 },
          p2: { ...base.statistics.players.p2!, tradesUsed: 2, hintsUsed: 3 }
        }
      }
    });
    const [ann, bob] = buildResultRows({ state: cheated, runId: 'run-1', outcome: 'won', userIdByPlayerId: users, nowMs: 5 });
    expect(ann).toMatchObject({ mySkips: 1, myTrades: 0, myLookups: 4, myHints: 0 });
    expect(bob).toMatchObject({ mySkips: 0, myTrades: 2, myLookups: 0, myHints: 3 });
  });
});

