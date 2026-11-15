import { buildDeck, createStartedGameState, shuffle } from '@upndown/engine';
import { defaultSolitaireSettings, type GameState } from '@upndown/shared-types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SOLITAIRE_SAVE_PREFIX, readSolitaireSave, writeSolitaireSave } from './solitaire-save.js';
import { fakeLocks } from './test-locks.js';
import { useSolitaireSave } from './useSolitaireSave.js';

const fresh = (): GameState => createStartedGameState({
  gameId: 'SOLITAIRE', hostId: 'solo-player', players: [{ id: 'solo-player', name: 'You', color: 'cyan' }],
  settings: defaultSolitaireSettings, isSolitaire: true, deck: shuffle(buildDeck(defaultSolitaireSettings))
});
const finished = (phase: 'won' | 'lost'): GameState => ({ ...fresh(), gamePhase: phase });
// A game with one card played, which is the least that is worth saving.
const played = (): GameState => {
  const state = fresh();
  return { ...state, statistics: { ...state.statistics, players: { 'solo-player': { cardsPlayed: 1, totalMovement: 5, specialPlays: 0, nasCheatsUsed: 0, skipsUsed: 0, tradesUsed: 0, lookupsUsed: 0, hintsUsed: 0 } } } };
};
const RUN = 'run-test';
// Saves are dated near now, because a game left for over a month is forgotten.
const NOW = Date.now();
const raw = (runId = RUN) => window.localStorage.getItem(SOLITAIRE_SAVE_PREFIX + runId);
const idle = (runId = RUN) => ({ active: false, state: fresh(), undoStack: [] as GameState[], runId });

describe('useSolitaireSave', () => {
  beforeEach(() => window.localStorage.clear());

  it('saves the game once a card has been played, and updates the save as it changes', () => {
    const first = played();
    const { rerender } = renderHook((props) => useSolitaireSave(props), { initialProps: { active: true, state: first, undoStack: [] as GameState[], runId: RUN } });
    expect(readSolitaireSave(RUN)!.state).toEqual(first);
    const second = { ...first, cardsPlayedThisTurn: 1 };
    rerender({ active: true, state: second, undoStack: [first], runId: RUN });
    const saved = readSolitaireSave(RUN)!;
    expect(saved.state.cardsPlayedThisTurn).toBe(1);
    expect(saved.undo).toHaveLength(1);
  });

  it('does not keep a game nobody has played a card in', () => {
    renderHook(() => useSolitaireSave({ active: true, state: fresh(), undoStack: [], runId: RUN }));
    expect(raw()).toBeNull();
  });

  // Undo back to the first position, then close the tab: coming back must not resume a position the player took back.
  it('forgets the save when undo takes the game back to the start', () => {
    const { rerender } = renderHook((props) => useSolitaireSave(props), { initialProps: { active: true, state: played(), undoStack: [fresh()] as GameState[], runId: RUN } });
    expect(raw()).not.toBeNull();
    rerender({ active: true, state: fresh(), undoStack: [], runId: RUN });
    expect(raw()).toBeNull();
  });

  // The page loads with no game active. If that cleared the saves, nothing could ever be resumed.
  it('leaves saved games alone when the page loads with no game active, and offers them', () => {
    const state = fresh();
    writeSolitaireSave(state, [], NOW - 3_000, 'older');
    writeSolitaireSave(state, [], NOW - 2_000, 'newer');
    const { result } = renderHook(() => useSolitaireSave(idle()));
    expect(raw('older')).not.toBeNull();
    expect(result.current.saves.map((x) => x.runId)).toEqual(['newer', 'older']);
    expect(result.current.saves[0]!.cardsLeft).toBe(state.drawPile.length + state.players[0]!.hand.length);
  });

  it('does not save a game nobody is playing', () => {
    renderHook(() => useSolitaireSave(idle()));
    expect(raw()).toBeNull();
  });

  // A new game must not cost the player the one they left: its save is a different key.
  it('keeps another game\'s save when a new game is played', () => {
    writeSolitaireSave(played(), [], NOW - 3_000, 'left-behind');
    renderHook(() => useSolitaireSave({ active: true, state: played(), undoStack: [], runId: 'new-run' }));
    expect(raw('left-behind')).not.toBeNull();
    expect(raw('new-run')).not.toBeNull();
  });

  it.each(['won', 'lost'] as const)('forgets only this game\'s save when it is %s, so a finished game is never offered', (phase) => {
    writeSolitaireSave(played(), [], NOW - 3_000, 'other');
    const { rerender } = renderHook((props) => useSolitaireSave(props), { initialProps: { active: true, state: played(), undoStack: [] as GameState[], runId: RUN } });
    expect(raw()).not.toBeNull();
    rerender({ active: true, state: finished(phase), undoStack: [], runId: RUN });
    expect(raw()).toBeNull();
    expect(raw('other')).not.toBeNull();
  });

  it('does not offer the game this tab is playing', () => {
    writeSolitaireSave(played(), [], NOW - 3_000, 'other');
    const { result } = renderHook(() => useSolitaireSave({ active: true, state: played(), undoStack: [], runId: RUN }));
    expect(result.current.saves.map((x) => x.runId)).toEqual(['other']);
  });

  it('discards the game asked for, and only that one', () => {
    writeSolitaireSave(fresh(), [], NOW - 3_000, 'a');
    writeSolitaireSave(fresh(), [], NOW - 2_000, 'b');
    const { result } = renderHook(() => useSolitaireSave(idle()));
    act(() => result.current.discard('a'));
    expect(raw('a')).toBeNull();
    expect(raw('b')).not.toBeNull();
    expect(result.current.saves.map((x) => x.runId)).toEqual(['b']);
  });

  it('notices a game saved or discarded in another tab, and ignores unrelated storage', () => {
    const { result } = renderHook(() => useSolitaireSave(idle()));
    expect(result.current.saves).toEqual([]);
    act(() => {
      writeSolitaireSave(fresh(), [], NOW - 2_000, 'elsewhere');
      window.dispatchEvent(new StorageEvent('storage', { key: SOLITAIRE_SAVE_PREFIX + 'elsewhere' }));
    });
    expect(result.current.saves.map((x) => x.savedAtMs)).toEqual([NOW - 2_000]);
    act(() => {
      window.localStorage.removeItem(SOLITAIRE_SAVE_PREFIX + 'elsewhere');
      window.dispatchEvent(new StorageEvent('storage', { key: SOLITAIRE_SAVE_PREFIX + 'elsewhere' }));
    });
    expect(result.current.saves).toEqual([]);
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' })); });
    expect(result.current.saves).toEqual([]);
  });

  it('loads a save with the clock stopped for the time away, or null when there is none', async () => {
    const { result } = renderHook(() => useSolitaireSave(idle()));
    expect(await result.current.load('missing')).toBeNull();
    const state = { ...fresh(), statistics: { ...fresh().statistics, startedAtMs: NOW - 61_000 } };
    writeSolitaireSave(state, [], NOW - 1_000, 'away');
    const loaded = (await result.current.load('away'))!;
    // 60s were played; however long the game was away, the elapsed time is still 60s.
    expect(Date.now() - loaded.state.statistics.startedAtMs!).toBeGreaterThanOrEqual(60_000);
    expect(Date.now() - loaded.state.statistics.startedAtMs!).toBeLessThan(61_000);
  });
});

// A new tab is treated like another browser: it is offered what is left behind, never what another tab has open.
describe('useSolitaireSave with other tabs', () => {
  let locks: ReturnType<typeof fakeLocks>;
  beforeEach(() => { window.localStorage.clear(); locks = fakeLocks(); });
  afterEach(() => locks.remove());

  it('offers a saved game no tab has open, and not one another tab holds', async () => {
    writeSolitaireSave(fresh(), [], NOW - 3_000, 'orphan');
    writeSolitaireSave(fresh(), [], NOW - 2_000, 'open-elsewhere');
    locks.held.add('solitaire:open-elsewhere');
    const { result } = renderHook(() => useSolitaireSave(idle()));
    await waitFor(() => expect(result.current.saves.map((x) => x.runId)).toEqual(['orphan']));
  });

  it('claims the game it is playing while it plays, and lets go when it stops or the tab closes', async () => {
    const { rerender, unmount } = renderHook((props) => useSolitaireSave(props), { initialProps: { ...idle(), active: true } });
    await waitFor(() => expect(locks.held.has(`solitaire:${RUN}`)).toBe(true));
    rerender({ ...idle(), active: false });
    await waitFor(() => expect(locks.held.has(`solitaire:${RUN}`)).toBe(false));
    rerender({ ...idle(), active: true });
    await waitFor(() => expect(locks.held.has(`solitaire:${RUN}`)).toBe(true));
    unmount();
    await waitFor(() => expect(locks.held.has(`solitaire:${RUN}`)).toBe(false));
  });

  it('refuses to load a game another tab opened after the list was drawn, so two tabs never play one game', async () => {
    writeSolitaireSave(fresh(), [], NOW - 3_000, 'raced');
    const { result } = renderHook(() => useSolitaireSave(idle()));
    await waitFor(() => expect(result.current.saves).toHaveLength(1));
    locks.held.add('solitaire:raced');
    expect(await result.current.load('raced')).toBeNull();
    await waitFor(() => expect(result.current.saves).toHaveLength(0));
  });
});
