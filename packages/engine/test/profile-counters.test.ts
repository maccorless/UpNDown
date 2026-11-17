import { describe, expect, it } from 'vitest';
import type { Card, GameSettings, GameState } from '@upndown/shared-types';
import { buildDeck } from '../src/init.js';
import { carryAfterUndo, createStartedGameState, emptyPlayerStats, playCard } from '../src/transitions.js';

const settings: GameSettings = {
  minCardValue: 2, maxCardValue: 30, handSize: 5, minPlayers: 2, maxPlayers: 6, minCardsPerTurn: 2,
  autoRefillHand: false, allowUndo: true, privateGame: false
};
const card = (value: number): Card => ({ id: `c-${value}`, value });

function started(): GameState {
  return createStartedGameState({ gameId: 'G', hostId: 'p1', players: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }], settings, isSolitaire: false, deck: buildDeck(settings) });
}

describe('profile counters in game statistics', () => {
  it('starts every player with no undos and no marks (a saved game from before this release reads the same way)', () => {
    expect(emptyPlayerStats()).toMatchObject({ undosUsed: 0, marksPlaced: 0 });
  });

  it('names the player whose card play won the game, because the "Closer" badge belongs to that player only', () => {
    const state = started();
    state.drawPile = [];
    state.currentPlayerIndex = 0;
    state.players[0]!.hand = [card(2)];
    state.players[1]!.hand = [];
    const won = playCard(state, 'p1', 'c-2', 0);
    expect(won.gamePhase).toBe('won');
    expect(won.statistics.finishedById).toBe('p1');
  });

  it('leaves the winner unset for a play that does not end the game', () => {
    const state = started();
    state.currentPlayerIndex = 0;
    state.players[0]!.hand = [card(2), card(3)];
    const next = playCard(state, 'p1', 'c-2', 0);
    expect(next.gamePhase).toBe('playing');
    expect(next.statistics.finishedById ?? null).toBeNull();
  });
});

describe('carryAfterUndo', () => {
  it('takes the play back but keeps hints, marks and everyone\'s irreversible counts, and counts the undo for the undoing player only', () => {
    const before = started();
    const snapshot = structuredClone(before);
    const current = structuredClone(before);
    current.statistics.players.p1 = { ...current.statistics.players.p1!, cardsPlayed: 1, totalMovement: 3, hintsUsed: 1, undosUsed: 2 };
    current.statistics.players.p2 = { ...current.statistics.players.p2!, marksPlaced: 4, lookupsUsed: 1 };

    const restored = carryAfterUndo(snapshot, current, 'p1');

    expect(restored.statistics.players.p1).toMatchObject({ cardsPlayed: 0, totalMovement: 0, hintsUsed: 1, undosUsed: 3 });
    expect(restored.statistics.players.p2).toMatchObject({ marksPlaced: 4, lookupsUsed: 1, undosUsed: 0 });
    expect(restored.foundationPiles).toBe(snapshot.foundationPiles);
  });
});
