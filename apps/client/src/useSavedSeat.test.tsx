import type { GameState } from '@upndown/shared-types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SAVED_SEAT_PREFIX, listSavedSeats } from './saved-seat.js';
import { fakeLocks } from './test-locks.js';
import { useSavedSeat } from './useSavedSeat.js';

const game = (gameId: string, phase: GameState['gamePhase'] = 'playing'): GameState => ({
  gameId, hostId: 'me', gamePhase: phase, players: [{ id: 'me', name: 'Me', hand: [], isHost: true }]
} as unknown as GameState);
const keys = (): string[] => Object.keys(window.localStorage).filter((k) => k.startsWith(SAVED_SEAT_PREFIX));
const token = (value: string) => ({ current: value });

describe('useSavedSeat', () => {
  let locks: ReturnType<typeof fakeLocks>;
  beforeEach(() => { window.localStorage.clear(); locks = fakeLocks(); });
  afterEach(() => locks.remove());

  // Two tabs, two games, one browser: neither may overwrite or erase the other's seat.
  it('keeps each tab\'s seat apart, and ending one game forgets only that seat', async () => {
    const a = renderHook(() => useSavedSeat(game('AAAAAA'), 'me', token('tok-a'), false));
    const b = renderHook(() => useSavedSeat(game('BBBBBB'), 'me', token('tok-b'), false));
    await waitFor(() => expect(keys()).toHaveLength(2));
    expect(listSavedSeats().map((s) => s.gameId).sort()).toEqual(['AAAAAA', 'BBBBBB']);

    a.rerender();
    const aOver = renderHook(() => useSavedSeat(game('AAAAAA', 'won'), 'me', token('tok-a'), false));
    expect(aOver.result.current.seatKey).toBeNull();
    // The tab whose game ended was a different hook instance than the one that saved, so nothing of b's is touched.
    expect(listSavedSeats().some((s) => s.gameId === 'BBBBBB')).toBe(true);
    expect(b.result.current.seatKey).not.toBeNull();
  });

  it('clears its own seat when the game ends', async () => {
    const { result, rerender } = renderHook((props) => useSavedSeat(props.state, 'me', token('tok'), false), { initialProps: { state: game('AAAAAA') } });
    await waitFor(() => expect(keys()).toHaveLength(1));
    rerender({ state: game('AAAAAA', 'lost') });
    await waitFor(() => expect(keys()).toHaveLength(0));
    expect(result.current.seatKey).toBeNull();
  });

  it('does not save a seat it does not hold yet (no token, or the player is not in the game)', () => {
    renderHook(() => useSavedSeat(game('AAAAAA'), 'me', token(''), false));
    renderHook(() => useSavedSeat(game('AAAAAA'), 'stranger', token('tok'), false));
    expect(keys()).toHaveLength(0);
  });

  it('claims the seat while it holds it, and releases it on forgetting (the game is left at the same moment)', async () => {
    const { result, rerender } = renderHook((props) => useSavedSeat(props.state, 'me', token('tok'), false), { initialProps: { state: game('AAAAAA') as GameState | null } });
    await waitFor(() => expect(locks.held.size).toBe(1));
    act(() => { result.current.forget(); rerender({ state: null }); });
    await waitFor(() => expect(locks.held.size).toBe(0));
    expect(keys()).toHaveLength(0);
  });

  it('offers seats on the landing that no tab holds', async () => {
    window.localStorage.setItem(`${SAVED_SEAT_PREFIX}free`, JSON.stringify({ gameId: 'FREE12', playerId: 'p', rejoinToken: 't', savedAtMs: Date.now() }));
    window.localStorage.setItem(`${SAVED_SEAT_PREFIX}busy`, JSON.stringify({ gameId: 'BUSY12', playerId: 'p', rejoinToken: 't', savedAtMs: Date.now() }));
    locks.held.add('seat:busy');
    const { result } = renderHook(() => useSavedSeat(null, null, token(''), true));
    await waitFor(() => expect(result.current.offers.map((o) => o.gameId)).toEqual(['FREE12']));
  });
});
