import { describe, expect, it } from 'vitest';
import { MONTY_GRID_MAX, MONTY_GRID_MIN, type Card, type GameSettings, type GameState, type MontyCell } from '@upndown/shared-types';
import { buildDeck } from '../src/init.js';
import { fullMontyCells } from '../src/monty.js';
import { createStartedGameState, recordCheatUse } from '../src/transitions.js';

const card = (value: number): Card => ({ id: `c-${value}`, value });
const settingsWith = (cheatLimits: Partial<Record<'lookup' | 'nas' | 'monty' | 'skip' | 'trade' | 'hint', 'off' | 'once' | 'unlimited'>>, range: [number, number] = [2, 59]): GameSettings => ({
  minCardValue: range[0], maxCardValue: range[1], handSize: 5, minPlayers: 2, maxPlayers: 6, minCardsPerTurn: 2,
  autoRefillHand: false, allowUndo: true, privateGame: false, allowCardLookup: false,
  cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off', nas: 'off', monty: 'off', ...cheatLimits }
});
const table = (settings: GameSettings, names: [string, string] = ['Ken', 'Ann']): GameState => {
  const state = createStartedGameState({
    gameId: 'G', hostId: 'p1', players: [{ id: 'p1', name: names[0] }, { id: 'p2', name: names[1] }], settings, isSolitaire: false, deck: buildDeck(settings)
  });
  state.players[0]!.hand = [card(20)];
  state.players[1]!.hand = [card(30)];
  state.drawPile = [card(10)];
  return state;
};
const count = (cells: MontyCell[], status: MontyCell) => cells.filter((cell) => cell === status).length;

// The full Monty: every card from 1 to 100, colored by where it is. Cards outside the game's range are "out"; the rest are in the
// draw pile, in a hand, or, since a pile keeps only its top card, played to a pile (whatever is in neither).
describe('the full Monty', () => {
  it('has one cell for every card from 1 to 100, in order', () => {
    expect(MONTY_GRID_MIN).toBe(1);
    expect(MONTY_GRID_MAX).toBe(100);
    expect(fullMontyCells(table(settingsWith({})), 'p1').length).toBe(100);
  });

  it('shows the draw pile, the hands and the played cards of a game, and grays every card outside its range', () => {
    const cells = fullMontyCells(table(settingsWith({}, [2, 59])), 'p1');
    expect(cells[9]).toBe('draw'); // 10
    expect(cells[19]).toBe('mine'); // 20, in Ken's hand (p1)
    expect(cells[29]).toBe('hand'); // 30
    expect(cells[1]).toBe('played'); // 2, in range and in neither the draw pile nor a hand
    expect(cells[0]).toBe('out'); // 1
    expect(cells[59]).toBe('out'); // 60
  });

  it('accounts for every card in the game exactly once, so the counts add up to the deck and the rest is gray', () => {
    const cells = fullMontyCells(table(settingsWith({}, [2, 59])), 'p1');
    expect(count(cells, 'draw') + count(cells, 'mine') + count(cells, 'hand') + count(cells, 'played')).toBe(58);
    expect(count(cells, 'out')).toBe(42);
  });

  it("marks the viewer own hand apart from the other players hands, and changes nothing else with who asks", () => {
    const state = table(settingsWith({}));
    const asKen = fullMontyCells(state, 'p1');
    const asAnn = fullMontyCells(state, 'p2');
    expect(asKen[19]).toBe('mine'); // 20 is Ken's
    expect(asKen[29]).toBe('hand'); // 30 is Ann's
    expect(asAnn[29]).toBe('mine');
    expect(asAnn[19]).toBe('hand');
    const others = (cells: MontyCell[]) => cells.filter((_, i) => i !== 19 && i !== 29);
    expect(others(asKen)).toEqual(others(asAnn));
  });

  it('marks a played card that is still on top of a pile, and leaves the ones underneath as played', () => {
    const state = table(settingsWith({}, [2, 59]));
    state.foundationPiles = [
      { id: 0, type: 'ascending', topCard: card(4) },
      { id: 1, type: 'ascending', topCard: card(6) },
      { id: 2, type: 'descending', topCard: card(40) },
      { id: 3, type: 'descending', topCard: card(35) }
    ];
    const cells = fullMontyCells(state, 'p1');
    expect(cells[3]).toBe('top'); // 4
    expect(cells[5]).toBe('top'); // 6
    expect(cells[39]).toBe('top'); // 40
    expect(cells[34]).toBe('top'); // 35
    expect(cells[4]).toBe('played'); // 5
  });

  it('is a use of its own cheat under its own once, and also counts as a lookup, but does not spend the card seeker\'s once', () => {
    const state = table(settingsWith({ monty: 'once', lookup: 'once' }));
    const afterMonty = recordCheatUse(state, 'p1', 'monty');
    expect(afterMonty.statistics.players.p1).toMatchObject({ montyUsed: 1, lookupsUsed: 1 });
    expect(() => recordCheatUse(afterMonty, 'p1', 'monty')).toThrow('You have already used this cheat');
    const afterSeeker = recordCheatUse(afterMonty, 'p1', 'lookup');
    expect(afterSeeker.statistics.players.p1).toMatchObject({ montyUsed: 1, lookupsUsed: 2 });
  });

  it('is refused while the game has it off, and anyone may use it, whatever their name', () => {
    expect(() => recordCheatUse(table(settingsWith({})), 'p1', 'monty')).toThrow('This cheat is not enabled for this game');
    expect(() => recordCheatUse(table(settingsWith({ monty: 'unlimited' }), ['Ken', 'Ann']), 'p2', 'monty')).not.toThrow();
  });
});
