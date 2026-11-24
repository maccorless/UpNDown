import { describe, expect, it } from 'vitest';
import { cheatLimitOf, isNasName, withCheatLimits, type Card, type GameSettings, type GameState } from '@upndown/shared-types';
import { buildDeck } from '../src/init.js';
import { carryAfterUndo, createStartedGameState, recordCheatUse } from '../src/transitions.js';

const card = (value: number): Card => ({ id: `c-${value}`, value });
const settingsWith = (cheatLimits: Partial<Record<'lookup' | 'nas' | 'skip' | 'trade' | 'hint', 'off' | 'once' | 'unlimited'>>): GameSettings => ({
  minCardValue: 2, maxCardValue: 30, handSize: 5, minPlayers: 2, maxPlayers: 6, minCardsPerTurn: 2,
  autoRefillHand: false, allowUndo: true, privateGame: false, allowCardLookup: false,
  cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off', nas: 'off', ...cheatLimits }
});
const table = (settings: GameSettings, names: [string, string] = ['Nas', 'Ken']): GameState => {
  const state = createStartedGameState({
    gameId: 'G', hostId: 'p1', players: [{ id: 'p1', name: names[0] }, { id: 'p2', name: names[1] }], settings, isSolitaire: false, deck: buildDeck(settings)
  });
  state.players[0]!.hand = [card(5)];
  state.players[1]!.hand = [card(9)];
  state.drawPile = [card(20)];
  return state;
};

// The Nas check is for a player named Nas, in any capitals, with spaces at the ends ignored. It is a cheat with the usual
// off, once or unlimited setting, and it counts as a lookup, but its "once" is its own.
describe('the Nas check', () => {
  it('recognises the name Nas in any capitals and with spaces at the ends, and nothing else', () => {
    expect(['Nas', 'nas', ' NAS ', 'nAs'].every(isNasName)).toBe(true);
    expect(['Nasty', 'Nas Ken', 'Ken', ''].some(isNasName)).toBe(false);
  });

  it('is off unless the game turns it on, so a game without it on is the same as before', () => {
    expect(cheatLimitOf(settingsWith({}), 'nas')).toBe('off');
    expect(cheatLimitOf({ allowCardLookup: true }, 'nas')).toBe('off');
    expect(withCheatLimits(settingsWith({ nas: 'once' })).cheatLimits!.nas).toBe('once');
  });

  it('lets a player named Nas check a card, and refuses it to anyone else', () => {
    const state = table(settingsWith({ nas: 'unlimited' }));
    expect(() => recordCheatUse(state, 'p1', 'nas')).not.toThrow();
    expect(() => recordCheatUse(state, 'p2', 'nas')).toThrow('Only a player named Nas can use the Nas check');
  });

  it('is refused while the game has it off', () => {
    expect(() => recordCheatUse(table(settingsWith({})), 'p1', 'nas')).toThrow('This cheat is not enabled for this game');
  });

  it('allows one check under once, and no more', () => {
    const state = table(settingsWith({ nas: 'once' }));
    const after = recordCheatUse(state, 'p1', 'nas');
    expect(() => recordCheatUse(after, 'p1', 'nas')).toThrow('You have already used this cheat');
  });

  it('counts each check as a lookup as well, so the totals and Clean Hands see it', () => {
    const after = recordCheatUse(table(settingsWith({ nas: 'unlimited' })), 'p1', 'nas');
    expect(after.statistics.players.p1).toMatchObject({ lookupsUsed: 1, nasChecksUsed: 1, montyUsed: 0 });
  });

  it('keeps the card seeker and the Nas check on their own "once": one does not spend the other', () => {
    const state = table(settingsWith({ lookup: 'once', nas: 'once' }));
    const afterNas = recordCheatUse(state, 'p1', 'nas');
    const afterSeeker = recordCheatUse(afterNas, 'p1', 'lookup');
    expect(afterSeeker.statistics.players.p1).toMatchObject({ lookupsUsed: 2, nasChecksUsed: 1, montyUsed: 0 });
    expect(() => recordCheatUse(afterSeeker, 'p1', 'lookup')).toThrow('You have already used this cheat');
    expect(() => recordCheatUse(afterSeeker, 'p1', 'nas')).toThrow('You have already used this cheat');
  });

  it('is not given back by an undo, since a check is not something an undo takes back', () => {
    const before = table(settingsWith({ nas: 'once' }));
    const after = recordCheatUse(before, 'p1', 'nas');
    const restored = carryAfterUndo(before, after, 'p2');
    expect(restored.statistics.players.p1).toMatchObject({ nasChecksUsed: 1, montyUsed: 0 });
  });
});
