import { describe, expect, it } from 'vitest';
import { cheatLimitOf, isNasName, type Card, type GameSettings, type GameState } from '@upndown/shared-types';
import { buildDeck } from '../src/init.js';
import { carryAfterUndo, createStartedGameState, recordCheatUse } from '../src/transitions.js';

const card = (value: number): Card => ({ id: `c-${value}`, value });
const settingsWith = (cheatLimits: Partial<Record<'lookup' | 'skip' | 'trade' | 'hint', 'off' | 'once' | 'unlimited'>>): GameSettings => ({
  minCardValue: 2, maxCardValue: 30, handSize: 5, minPlayers: 2, maxPlayers: 6, minCardsPerTurn: 2,
  autoRefillHand: false, allowUndo: true, privateGame: false, allowCardLookup: false,
  cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off', ...cheatLimits }
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

// The Nas check is an easter egg with no setting of its own. It is for a player named Nas, in any capitals, with spaces at the
// ends ignored, and it is unlimited whenever the game has any other cheat on. It counts as a lookup, and has its own counter.
describe('the Nas check', () => {
  it('recognises the name Nas in any capitals and with spaces at the ends, and nothing else', () => {
    expect(['Nas', 'nas', ' NAS ', 'nAs'].every(isNasName)).toBe(true);
    expect(['Nasty', 'Nas Ken', 'Ken', ''].some(isNasName)).toBe(false);
  });

  it('is on only while the game has another cheat on, and never has a limit of its own', () => {
    expect(cheatLimitOf(settingsWith({}), 'nas')).toBe('off');
    expect(cheatLimitOf(settingsWith({ lookup: 'once' }), 'nas')).toBe('unlimited');
    expect(cheatLimitOf(settingsWith({ hint: 'unlimited' }), 'nas')).toBe('unlimited');
    expect(cheatLimitOf({ allowCardLookup: true }, 'nas')).toBe('unlimited');
  });

  it('lets a player named Nas check a card, and refuses it to anyone else', () => {
    const state = table(settingsWith({ lookup: 'unlimited' }));
    expect(() => recordCheatUse(state, 'p1', 'nas')).not.toThrow();
    expect(() => recordCheatUse(state, 'p2', 'nas')).toThrow('Only a player named Nas can use the Nas check');
  });

  it('is refused while the game has no other cheat on', () => {
    expect(() => recordCheatUse(table(settingsWith({})), 'p1', 'nas')).toThrow('This cheat is not enabled for this game');
  });

  it('has no once limit, so a second check is allowed', () => {
    const state = table(settingsWith({ lookup: 'unlimited' }));
    const after = recordCheatUse(state, 'p1', 'nas');
    expect(() => recordCheatUse(after, 'p1', 'nas')).not.toThrow();
  });

  it('counts each check as a lookup as well, so the totals and Clean Hands see it', () => {
    const after = recordCheatUse(table(settingsWith({ lookup: 'unlimited' })), 'p1', 'nas');
    expect(after.statistics.players.p1).toMatchObject({ lookupsUsed: 1, nasChecksUsed: 1, montyUsed: 0 });
  });

  it('keeps the card seeker\'s once apart from the Nas check: one does not spend the other', () => {
    const state = table(settingsWith({ lookup: 'once' }));
    const afterNas = recordCheatUse(state, 'p1', 'nas');
    const afterSeeker = recordCheatUse(afterNas, 'p1', 'lookup');
    expect(afterSeeker.statistics.players.p1).toMatchObject({ lookupsUsed: 2, nasChecksUsed: 1, montyUsed: 0 });
    expect(() => recordCheatUse(afterSeeker, 'p1', 'lookup')).toThrow('You have already used this cheat');
    expect(() => recordCheatUse(afterSeeker, 'p1', 'nas')).not.toThrow();
  });

  it('is not given back by an undo, since a check is not something an undo takes back', () => {
    const before = table(settingsWith({ lookup: 'unlimited' }));
    const after = recordCheatUse(before, 'p1', 'nas');
    const restored = carryAfterUndo(before, after, 'p2');
    expect(restored.statistics.players.p1).toMatchObject({ nasChecksUsed: 1, montyUsed: 0 });
  });
});
