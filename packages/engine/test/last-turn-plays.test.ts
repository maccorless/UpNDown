import { describe, expect, it } from 'vitest';
import type { Card, FoundationPile, GameSettings, GameState } from '@upndown/shared-types';
import { buildDeck } from '../src/init.js';
import { createStartedGameState, endTurn, playCard, skipTurn } from '../src/transitions.js';

const settings: GameSettings = {
  minCardValue: 2, maxCardValue: 99, handSize: 5, minPlayers: 2, maxPlayers: 6, minCardsPerTurn: 1,
  autoRefillHand: false, allowUndo: true, privateGame: false, allowCardLookup: false,
  cheatLimits: { lookup: 'off', skip: 'unlimited', trade: 'off', hint: 'off' }
};
const card = (value: number): Card => ({ id: `c-${value}`, value });

// Two players at a table where both piles are open, so every card in these hands is a normal play.
function table(): GameState {
  const state = createStartedGameState({ gameId: 'G', hostId: 'p1', players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Ben' }], settings, isSolitaire: false, deck: buildDeck(settings) });
  state.foundationPiles = [
    { id: 0, type: 'ascending', topCard: card(10) },
    { id: 1, type: 'descending', topCard: card(90) }
  ] satisfies FoundationPile[];
  state.drawPile = [card(60), card(61)];
  state.currentPlayerIndex = 0;
  state.players[0]!.hand = [card(11), card(12), card(13)];
  state.players[1]!.hand = [card(20)];
  return state;
}

// Whose turn it is decides what counts as that player's last turn: a turn's plays are kept for the player who played them,
// once their turn ends, and a skip leaves an empty list. Robots' turns are recorded the same way, so the table can show them.
describe('the cards each player played on their last turn', () => {
  it('keeps the turn in progress apart, and records it for the player once their turn ends', () => {
    const playing = playCard(playCard(table(), 'p1', 'c-11', 0), 'p1', 'c-12', 0);
    expect(playing.turnPlays).toEqual([card(11), card(12)]);
    expect(playing.lastTurnPlays?.p1).toBeUndefined();

    const ended = endTurn(playing, 'p1');
    expect(ended.lastTurnPlays?.p1).toEqual([card(11), card(12)]);
    expect(ended.turnPlays).toEqual([]);
  });

  it('leaves an empty list after a skip, and leaves the other players\' last turns alone', () => {
    const afterFirst = endTurn(playCard(table(), 'p1', 'c-11', 0), 'p1');
    const skipped = skipTurn(afterFirst, 'p2');
    expect(skipped.lastTurnPlays?.p2).toEqual([]);
    expect(skipped.lastTurnPlays?.p1).toEqual([card(11)]);
  });

  it('replaces the last turn with the next one, rather than adding to it', () => {
    const afterFirst = endTurn(playCard(table(), 'p1', 'c-11', 0), 'p1');
    const afterSkip = skipTurn(afterFirst, 'p2');
    const secondTurn = endTurn(playCard(afterSkip, 'p1', 'c-12', 0), 'p1');
    expect(secondTurn.lastTurnPlays?.p1).toEqual([card(12)]);
  });
});
