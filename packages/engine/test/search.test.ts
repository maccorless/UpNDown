import { describe, expect, it } from 'vitest';
import { playedValues } from '../src/belief.js';
import { buildDeck } from '../src/init.js';
import { searchPolicy } from '../src/search.js';
import { seededRandom, shuffleWith } from '../src/simulate.js';
import { chooseAction, observe } from '../src/strategy.js';
import { tableById } from '../src/tables.js';
import { createStartedGameState } from '../src/transitions.js';

const solo = tableById('s2-solo-79-h7');
const start = (seed: number) => createStartedGameState({ gameId: 'SRCH', hostId: 'p1', players: [{ id: 'p1', name: 'P1' }], settings: solo.settings, isSolitaire: true, deck: shuffleWith(buildDeck(solo.settings), seededRandom(seed)) });

describe('the search teacher', () => {
  it('only plays a card that can legally go where it says, with a hand dealt from the real game', () => {
    for (const seed of [1, 2, 3]) {
      const state = start(seed);
      const obs = observe(state, 'p1', undefined, playedValues(state));
      const action = searchPolicy({ settings: solo.settings, worlds: 4, margin: 2 })(obs, seededRandom(seed));
      expect(action.type).toBe('play');
    }
  });

  it('keeps the strategy\'s own play when it demands an impossible margin, however few worlds it looked at', () => {
    for (const seed of [1, 2, 3, 4]) {
      const state = start(seed);
      const obs = observe(state, 'p1', undefined, playedValues(state));
      expect(searchPolicy({ settings: solo.settings, worlds: 3, margin: 1e9 })(obs, seededRandom(seed))).toEqual(chooseAction(obs));
    }
  });

  it('is reproducible from one seed', () => {
    const state = start(7);
    const obs = observe(state, 'p1', undefined, playedValues(state));
    const policy = searchPolicy({ settings: solo.settings, worlds: 5, margin: 0 });
    expect(policy(obs, seededRandom(3))).toEqual(policy(obs, seededRandom(3)));
  });

  it('refuses a table with other players, where the hidden cards are not uniform', () => {
    const t = tableById('s2-4p-79-h7');
    const state = createStartedGameState({ gameId: 'SRCH4', hostId: 'p1', players: [1, 2, 3, 4].map((i) => ({ id: `p${i}`, name: `P${i}` })), settings: t.settings, isSolitaire: false, deck: shuffleWith(buildDeck(t.settings), seededRandom(1)) });
    expect(() => searchPolicy({ settings: t.settings, worlds: 2 })(observe(state, 'p1'), seededRandom(1))).toThrow('solitaire only');
  });
});
