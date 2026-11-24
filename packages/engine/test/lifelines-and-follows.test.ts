import { describe, expect, it } from 'vitest';
import type { Card, FoundationPile, GameSettings, GameState, PlayerStatistics } from '@upndown/shared-types';
import { buildDeck } from '../src/init.js';
import { carryAfterUndo, createStartedGameState, playCard } from '../src/transitions.js';

const settings: GameSettings = {
  minCardValue: 2, maxCardValue: 40, handSize: 5, minPlayers: 2, maxPlayers: 6, minCardsPerTurn: 1,
  autoRefillHand: false, allowUndo: true, privateGame: false
};
const card = (value: number): Card => ({ id: `c-${value}`, value });

// Two piles that have met: the ascending pile is at 30 and the descending pile at 20. A card from 20 to 30 has no normal play
// anywhere, so 20 on the ascending pile is a backward 10 and the only way forward. Any card above 30 is a normal play.
function converged(hand: Card[], hand2: Card[] = []): GameState {
  const state = createStartedGameState({ gameId: 'G', hostId: 'p1', players: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }], settings, isSolitaire: false, deck: buildDeck(settings) });
  state.foundationPiles = [
    { id: 0, type: 'ascending', topCard: card(30) },
    { id: 1, type: 'descending', topCard: card(20) }
  ] satisfies FoundationPile[];
  state.drawPile = [];
  state.currentPlayerIndex = 0;
  state.players[0]!.hand = hand;
  state.players[1]!.hand = hand2;
  return state;
}

describe('lifelines', () => {
  it('counts a backward 10 played with no normal play left in the hand, because that play was the only way forward', () => {
    const state = converged([card(20), card(25)]);
    const next = playCard(state, 'p1', 'c-20', 0);
    expect(next.statistics.players.p1?.lifelines).toBe(1);
    expect(next.statistics.players.p1?.specialPlays).toBe(1);
  });

  it('does not count a backward 10 when a normal play was available, because then it was a choice, not a rescue', () => {
    const state = converged([card(20), card(31)]);
    const next = playCard(state, 'p1', 'c-20', 0);
    expect(next.statistics.players.p1?.specialPlays).toBe(1);
    expect(next.statistics.players.p1?.lifelines).toBe(0);
  });

  it('counts the card played too, so a backward 10 is no rescue when that same card could go normal on the other pile', () => {
    // Ascending piles at 30 and 10. Playing 20 on the 30 is a backward 10, but 20 is a normal play on the 10.
    const state = converged([card(20), card(5)]);
    state.foundationPiles[1] = { id: 1, type: 'ascending', topCard: card(10) };
    const next = playCard(state, 'p1', 'c-20', 0);
    expect(next.statistics.players.p1?.specialPlays).toBe(1);
    expect(next.statistics.players.p1?.lifelines).toBe(0);
  });

  it('never counts a normal play as a lifeline', () => {
    const state = converged([card(31), card(25)]);
    const next = playCard(state, 'p1', 'c-31', 0);
    expect(next.statistics.players.p1?.lifelines).toBe(0);
  });

  it('reads a game saved before this counter existed as zero, not as undefined', () => {
    const state = converged([card(20), card(25)]);
    const old = { ...state.statistics.players } as Record<string, Partial<PlayerStatistics>>;
    delete old.p1!.lifelines;
    delete old.p1!.markFollows;
    state.statistics = { ...state.statistics, players: old as GameState['statistics']['players'] };
    const next = playCard(state, 'p1', 'c-20', 0);
    expect(next.statistics.players.p1?.lifelines).toBe(1);
    expect(Number.isNaN(next.statistics.players.p1?.lifelines)).toBe(false);
  });
});

describe('mark follows', () => {
  it('credits the player whose hand-placed mark was on the pile when a teammate played on it', () => {
    const state = converged([card(31)], [card(5)]);
    const next = playCard(state, 'p1', 'c-31', 0, ['p2']);
    expect(next.statistics.players.p2?.markFollows).toBe(1);
  });

  it('never credits the player who made the play, because a mark is only a signal to someone else', () => {
    const state = converged([card(31)]);
    const next = playCard(state, 'p1', 'c-31', 0, ['p1']);
    expect(next.statistics.players.p1?.markFollows).toBe(0);
  });

  it('takes a follow back when the play is undone, so a team cannot farm credit by playing and undoing', () => {
    const before = converged([card(31)], [card(5)]);
    const after = playCard(before, 'p1', 'c-31', 0, ['p2']);
    expect(after.statistics.players.p2?.markFollows).toBe(1);
    const restored = carryAfterUndo(before, after, 'p1');
    expect(restored.statistics.players.p2?.markFollows ?? 0).toBe(0);
  });
});
