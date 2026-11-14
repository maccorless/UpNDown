import { buildDeck, createStartedGameState, playCard, shuffle } from '@upndown/engine';
import { defaultSolitaireSettings, gameStateSchema, type GameState } from '@upndown/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SAVED_UNDO, SOLITAIRE_SAVE_KEY, clearSolitaireSave, describeAge, readSolitaireSave, resumeClock, summarizeSave, writeSolitaireSave
} from './solitaire-save.js';

const fresh = (): GameState => createStartedGameState({
  gameId: 'SOLITAIRE', hostId: 'solo-player', players: [{ id: 'solo-player', name: 'You', color: 'cyan' }],
  settings: defaultSolitaireSettings, isSolitaire: true, deck: shuffle(buildDeck(defaultSolitaireSettings))
});

// Plays real moves with the real engine, so the saved states are the shapes the game actually produces.
function playSome(state: GameState, moves: number): { state: GameState; history: GameState[] } {
  const history: GameState[] = [];
  let current = state;
  for (let i = 0; i < moves && current.gamePhase === 'playing'; i += 1) {
    const hand = current.players[0]!.hand;
    let next: GameState | null = null;
    for (const card of hand) {
      for (const pile of current.foundationPiles) {
        try { next = playCard(current, 'solo-player', card.id, pile.id); break; } catch { /* try another */ }
      }
      if (next) break;
    }
    if (!next) break;
    history.push(current);
    current = next;
  }
  return { state: current, history };
}

const raw = () => window.localStorage.getItem(SOLITAIRE_SAVE_KEY);
const tamper = (edit: (save: Record<string, any>) => void): void => {
  const save = JSON.parse(raw()!);
  edit(save);
  window.localStorage.setItem(SOLITAIRE_SAVE_KEY, JSON.stringify(save));
};

describe('the saved solitaire game', () => {
  beforeEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });
  afterEach(() => vi.restoreAllMocks());

  it('is exactly the game that was saved, after real moves, with its undo history', () => {
    const { state, history } = playSome(fresh(), 6);
    expect(history.length).toBeGreaterThan(2);
    writeSolitaireSave(state, history, 1_000);
    const back = readSolitaireSave()!;
    expect(back.state).toEqual(state);
    expect(back.undo).toEqual(history);
    expect(back.savedAtMs).toBe(1_000);
  });

  it('is accepted by the shared game schema as the engine produces it, move after move', () => {
    let current = fresh();
    for (let i = 0; i < 8; i += 1) {
      expect(gameStateSchema.safeParse(current).success).toBe(true);
      current = playSome(current, 1).state;
    }
  });

  it('keeps only the most recent undo steps, because each one is a whole game', () => {
    const { state, history: real } = playSome(fresh(), 6);
    // Forty steps, the last one distinguishable, so we can see it is the recent end that survives.
    const history = Array.from({ length: 40 }, (_, i) => (i === 39 ? real.at(-1)! : real[0]!));
    writeSolitaireSave(state, history);
    const back = readSolitaireSave()!;
    expect(back.undo).toHaveLength(MAX_SAVED_UNDO);
    expect(back.undo.at(-1)).toEqual(real.at(-1));
  });

  it('is gone after it is cleared, and reads as nothing when there never was one', () => {
    expect(readSolitaireSave()).toBeNull();
    writeSolitaireSave(fresh(), []);
    clearSolitaireSave();
    expect(readSolitaireSave()).toBeNull();
    expect(raw()).toBeNull();
  });

  it('summarises how far along it is: the draw pile and the hand', () => {
    const state = fresh();
    const left = state.drawPile.length + state.players[0]!.hand.length;
    writeSolitaireSave(state, [], 5_000);
    expect(summarizeSave(readSolitaireSave())).toEqual({ cardsLeft: left, savedAtMs: 5_000 });
    expect(summarizeSave(null)).toBeNull();
  });
});

// A save comes back from storage the player, an extension or another build could have touched. Anything that is not a
// game this build can safely resume is dropped, never loaded half-way.
describe('a save that must not be resumed', () => {
  beforeEach(() => { window.localStorage.clear(); writeSolitaireSave(playSome(fresh(), 3).state, []); });

  it.each([
    ['not JSON', () => window.localStorage.setItem(SOLITAIRE_SAVE_KEY, '{nope')],
    ['from another version of the format', () => tamper((s) => { s.v = 2; })],
    ['missing its game', () => tamper((s) => { delete s.state; })],
    ['a game that is already over', () => tamper((s) => { s.state.gamePhase = 'won'; })],
    ['a multiplayer game', () => tamper((s) => { s.state.isSolitaire = false; })],
    ['with the wrong number of foundation piles', () => tamper((s) => { s.state.foundationPiles.pop(); })],
    ['with a card that is not a card', () => tamper((s) => { s.state.drawPile[0] = { id: 'x', value: 'ten' }; })],
    ['with a card value outside the deck', () => tamper((s) => { s.state.drawPile[0].value = 500; })],
    ['with the same card twice', () => tamper((s) => { s.state.drawPile[1] = { ...s.state.drawPile[0] }; })],
    ['with invalid settings', () => tamper((s) => { s.state.settings.handSize = 99; })],
    ['with too many undo steps', () => tamper((s) => { s.undo = Array.from({ length: MAX_SAVED_UNDO + 1 }, () => s.state); })],
    ['with a damaged undo step', () => tamper((s) => { s.undo = [{ ...s.state, drawPile: 'gone' }]; })],
    ['with a time that is not a number', () => tamper((s) => { s.savedAtMs = 'yesterday'; })]
  ])('is refused when it is %s, and removed so it is not re-checked every visit', (_why, damage) => {
    damage();
    expect(readSolitaireSave()).toBeNull();
    expect(raw()).toBeNull();
  });

  it('is simply unavailable, without an error, when storage cannot be read or written', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readSolitaireSave()).toBeNull();
    expect(() => writeSolitaireSave(fresh(), [])).not.toThrow();
    expect(() => clearSolitaireSave()).not.toThrow();
  });
});

// Coming back after a night away must not make the game look like it took twelve hours.
describe('the clock on a resumed game', () => {
  it('stops while the game is away, for the game and for every undo step', () => {
    const base = fresh();
    const started = 1_000_000;
    const at = (s: GameState): GameState => ({ ...s, statistics: { ...s.statistics, startedAtMs: started } });
    const saved = { state: at(base), undo: [at(base)], savedAtMs: started + 600_000 };
    const resumed = resumeClock(saved, started + 600_000 + 8 * 3_600_000);
    const elapsed = (s: GameState, now: number): number => now - s.statistics.startedAtMs!;
    const now = started + 600_000 + 8 * 3_600_000;
    expect(elapsed(resumed.state, now)).toBe(600_000);
    expect(elapsed(resumed.undo[0]!, now)).toBe(600_000);
    expect(resumed.savedAtMs).toBe(now);
  });

  it('never moves the start backwards if the clock went the other way', () => {
    const base = fresh();
    const saved = { state: base, undo: [], savedAtMs: 5_000_000 };
    expect(resumeClock(saved, 1_000).state.statistics.startedAtMs).toBe(base.statistics.startedAtMs);
  });

  it('leaves a game with no start time alone', () => {
    const base = { ...fresh(), statistics: { ...fresh().statistics, startedAtMs: null } };
    expect(resumeClock({ state: base, undo: [], savedAtMs: 1 }, 99).state.statistics.startedAtMs).toBeNull();
  });
});

describe('describeAge', () => {
  const now = 10_000_000_000;
  it.each([
    [30_000, 'just now'], [60_000, '1 minute ago'], [5 * 60_000, '5 minutes ago'], [60 * 60_000, '1 hour ago'],
    [3 * 3_600_000, '3 hours ago'], [24 * 3_600_000, '1 day ago'], [4 * 24 * 3_600_000, '4 days ago']
  ])('%i ms ago reads "%s"', (ago, text) => {
    expect(describeAge(now - ago, now)).toBe(text);
  });
  it('never says a negative time', () => {
    expect(describeAge(now + 5_000, now)).toBe('just now');
  });
});
