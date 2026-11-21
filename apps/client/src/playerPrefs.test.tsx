import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { buildDeck, createStartedGameState } from '@upndown/engine';
import { defaultMultiplayerSettings, defaultSolitaireSettings, type GameState } from '@upndown/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAutoMarkSync, usePlayerPrefs } from './playerPrefs.js';

afterEach(() => window.localStorage.clear());

describe('usePlayerPrefs', () => {
  it('starts with arrows on and auto-mark off, and remembers a change on this device', () => {
    const first = renderHook(() => usePlayerPrefs());
    expect(first.result.current).toMatchObject({ showArrows: true, autoMark: false });
    act(() => { first.result.current.changeShowArrows(false); first.result.current.changeAutoMark(true); });
    first.unmount();
    const second = renderHook(() => usePlayerPrefs());
    expect(second.result.current).toMatchObject({ showArrows: false, autoMark: true });
  });
});

const table = (seatOn: boolean, over: Partial<GameState> = {}): GameState => {
  const s = createStartedGameState({ gameId: 'ABC123', hostId: 'p1', players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bob' }], settings: defaultMultiplayerSettings, isSolitaire: false, deck: buildDeck(defaultMultiplayerSettings) });
  return { ...s, players: s.players.map((p) => (p.id === 'p2' ? { ...p, autoMark: seatOn } : p)), ...over };
};

describe('useAutoMarkSync', () => {
  const run = (args: { autoMark: boolean; state: GameState | null; connected?: boolean }) => {
    const send = vi.fn(async () => true);
    const hook = renderHook((props) => useAutoMarkSync({ playerId: 'p2', connected: true, send, ...props }), { initialProps: args });
    return { send, ...hook };
  };

  it('tells the server when the preference is on and the seat is not, which is what puts the marks on the table', () => {
    const { send } = run({ autoMark: true, state: table(false) });
    expect(send).toHaveBeenCalledWith('ABC123', true);
  });

  it('tells the server when the preference is switched off while the seat is on, so the marks come down', () => {
    const { send } = run({ autoMark: false, state: table(true) });
    expect(send).toHaveBeenCalledWith('ABC123', false);
  });

  it('says nothing when the seat already matches', () => {
    expect(run({ autoMark: true, state: table(true) }).send).not.toHaveBeenCalled();
    expect(run({ autoMark: false, state: table(false) }).send).not.toHaveBeenCalled();
  });

  it('does not ask before a game is being played, or while offline, or in solitaire', () => {
    expect(run({ autoMark: true, state: table(false, { gamePhase: 'lobby' }) }).send).not.toHaveBeenCalled();
    expect(run({ autoMark: true, state: table(false), connected: false }).send).not.toHaveBeenCalled();
    const solo = createStartedGameState({ gameId: 'SOLO01', hostId: 'p2', players: [{ id: 'p2', name: 'Me' }], settings: defaultSolitaireSettings, isSolitaire: true, deck: buildDeck(defaultSolitaireSettings) });
    expect(run({ autoMark: true, state: solo }).send).not.toHaveBeenCalled();
  });

  it('asks once for one change and not again on every re-render, but asks again when the person changes their mind', () => {
    const { send, rerender } = run({ autoMark: true, state: table(false) });
    rerender({ autoMark: true, state: table(false) });
    expect(send).toHaveBeenCalledTimes(1);
    rerender({ autoMark: false, state: table(true) });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('ABC123', false);
  });
});
