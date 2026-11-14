import { buildDeck, createStartedGameState, shuffle } from '@upndown/engine';
import { defaultSolitaireSettings, type GameState } from '@upndown/shared-types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SOLITAIRE_SAVE_KEY, readSolitaireSave, writeSolitaireSave } from './solitaire-save.js';
import { useSolitaireSave } from './useSolitaireSave.js';

const fresh = (): GameState => createStartedGameState({
  gameId: 'SOLITAIRE', hostId: 'solo-player', players: [{ id: 'solo-player', name: 'You', color: 'cyan' }],
  settings: defaultSolitaireSettings, isSolitaire: true, deck: shuffle(buildDeck(defaultSolitaireSettings))
});
const finished = (phase: 'won' | 'lost'): GameState => ({ ...fresh(), gamePhase: phase });
// A game with one card played, which is the least that is worth saving.
const played = (): GameState => {
  const state = fresh();
  return { ...state, statistics: { ...state.statistics, players: { 'solo-player': { cardsPlayed: 1, totalMovement: 5, specialPlays: 0, nasCheatsUsed: 0 } } } };
};
const raw = () => window.localStorage.getItem(SOLITAIRE_SAVE_KEY);

describe('useSolitaireSave', () => {
  beforeEach(() => window.localStorage.clear());

  it('saves the game once a card has been played, and updates the save as it changes', () => {
    const first = played();
    const { rerender } = renderHook((props) => useSolitaireSave(props), { initialProps: { active: true, state: first, undoStack: [] as GameState[], runId: 'run-test' } });
    expect(readSolitaireSave()!.state).toEqual(first);
    const second = { ...first, cardsPlayedThisTurn: 1 };
    rerender({ active: true, state: second, undoStack: [first], runId: 'run-test' });
    const saved = readSolitaireSave()!;
    expect(saved.state.cardsPlayedThisTurn).toBe(1);
    expect(saved.undo).toHaveLength(1);
  });

  it('does not keep a game nobody has played a card in', () => {
    const { result } = renderHook(() => useSolitaireSave({ active: true, state: fresh(), undoStack: [], runId: 'run-test' }));
    expect(raw()).toBeNull();
    expect(result.current.summary).toBeNull();
  });

  // Undo back to the first position, then close the tab: coming back must not resume a position the player took back.
  it('forgets the save when undo takes the game back to the start', () => {
    const { result, rerender } = renderHook((props) => useSolitaireSave(props), { initialProps: { active: true, state: played(), undoStack: [fresh()] as GameState[], runId: 'run-test' } });
    expect(raw()).not.toBeNull();
    rerender({ active: true, state: fresh(), undoStack: [], runId: 'run-test' });
    expect(raw()).toBeNull();
    expect(result.current.summary).toBeNull();
  });

  // The page loads with no game active. If that cleared the save, nothing could ever be resumed.
  it('leaves a save alone when the page loads with no game active, and offers it', () => {
    const state = fresh();
    writeSolitaireSave(state, [], 1_000);
    const { result } = renderHook(() => useSolitaireSave({ active: false, state: fresh(), undoStack: [], runId: 'run-test' }));
    expect(raw()).not.toBeNull();
    expect(result.current.summary?.cardsLeft).toBe(state.drawPile.length + state.players[0]!.hand.length);
  });

  it('does not save a game nobody is playing', () => {
    renderHook(() => useSolitaireSave({ active: false, state: fresh(), undoStack: [], runId: 'run-test' }));
    expect(raw()).toBeNull();
  });

  it.each(['won', 'lost'] as const)('forgets the save when the game is %s, so a finished game is never offered', (phase) => {
    writeSolitaireSave(fresh(), []);
    const { result, rerender } = renderHook((props) => useSolitaireSave(props), { initialProps: { active: true, state: played(), undoStack: [] as GameState[], runId: 'run-test' } });
    expect(result.current.summary).not.toBeNull();
    rerender({ active: true, state: finished(phase), undoStack: [], runId: 'run-test' });
    expect(raw()).toBeNull();
    expect(result.current.summary).toBeNull();
  });

  it('discards on request', () => {
    writeSolitaireSave(fresh(), []);
    const { result } = renderHook(() => useSolitaireSave({ active: false, state: fresh(), undoStack: [], runId: 'run-test' }));
    expect(result.current.summary).not.toBeNull();
    act(() => result.current.discard());
    expect(raw()).toBeNull();
    expect(result.current.summary).toBeNull();
  });

  it('notices a game saved or discarded in another tab', () => {
    const { result } = renderHook(() => useSolitaireSave({ active: false, state: fresh(), undoStack: [], runId: 'run-test' }));
    expect(result.current.summary).toBeNull();
    act(() => {
      writeSolitaireSave(fresh(), [], 2_000);
      window.dispatchEvent(new StorageEvent('storage', { key: SOLITAIRE_SAVE_KEY }));
    });
    expect(result.current.summary?.savedAtMs).toBe(2_000);
    act(() => {
      window.localStorage.removeItem(SOLITAIRE_SAVE_KEY);
      window.dispatchEvent(new StorageEvent('storage', { key: SOLITAIRE_SAVE_KEY }));
    });
    expect(result.current.summary).toBeNull();
    // Another key changing is none of its business.
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' })); });
    expect(result.current.summary).toBeNull();
  });

  it('loads the save with the clock stopped for the time away, or null when there is none', () => {
    const { result } = renderHook(() => useSolitaireSave({ active: false, state: fresh(), undoStack: [], runId: 'run-test' }));
    expect(result.current.load()).toBeNull();
    const state = { ...fresh(), statistics: { ...fresh().statistics, startedAtMs: 1_000 } };
    writeSolitaireSave(state, [], 61_000);
    const loaded = result.current.load()!;
    // 60s were played; however long the game was away, the elapsed time is still 60s.
    expect(Date.now() - loaded.state.statistics.startedAtMs!).toBeGreaterThanOrEqual(60_000);
    expect(Date.now() - loaded.state.statistics.startedAtMs!).toBeLessThan(61_000);
  });
});
