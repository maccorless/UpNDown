import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useGameSocket, type GameSocketOptions } from './useGameSocket.js';

// The table's flash listener: a backward 10 from any seat sets the pile to flash, and says whether it was a lifeline.
describe('the flash listener on the socket', () => {
  function setUp() {
    const handlers = new Map<string, (data: { pileId: number; lifeline?: boolean }) => void>();
    const socket = {
      id: 'me',
      connect: vi.fn(),
      disconnect: vi.fn(),
      emit: vi.fn(),
      on: vi.fn((event: string, handler: (data: { pileId: number; lifeline?: boolean }) => void) => { handlers.set(event, handler); }),
      off: vi.fn()
    };
    const setSpecialPlayPileId = vi.fn();
    const setSpecialPlayLifeline = vi.fn();
    const options = {
      mode: 'multiplayer',
      getSocket: () => socket,
      setConnectionState: vi.fn(),
      previousPlayerIdRef: { current: null },
      activeGameIdRef: { current: null },
      rejoinTokenRef: { current: null },
      playerIdRef: { current: null },
      adoptSeat: vi.fn(),
      resetToLanding: vi.fn(),
      setKickedWhileAway: vi.fn(),
      setKickedFromGameId: vi.fn(),
      setError: vi.fn(),
      rejoinMine: vi.fn(),
      setSeatChoices: vi.fn(),
      setPlayerId: vi.fn(),
      setPendingLobbyState: vi.fn(),
      setMultiplayerState: vi.fn(),
      setGameReactions: vi.fn(),
      setSpecialPlayPileId,
      setSpecialPlayLifeline,
      specialPlayTimerRef: { current: null },
      forgetSeatRef: { current: vi.fn() },
      setMultiplayerSelectedCardId: vi.fn(),
      setCheatNotice: vi.fn(),
      cheatNoticeTimerRef: { current: null },
      setJoinRequests: vi.fn(),
      setJoinWaiting: vi.fn(),
      inviteTokenRef: { current: null }
    } as unknown as GameSocketOptions;
    renderHook(() => useGameSocket(options));
    return { handler: handlers.get('game:specialPlay')!, setSpecialPlayPileId, setSpecialPlayLifeline };
  }

  it('flashes the pile and marks it a lifeline when the server says so', () => {
    const { handler, setSpecialPlayPileId, setSpecialPlayLifeline } = setUp();
    handler({ pileId: 2, lifeline: true });
    expect(setSpecialPlayPileId).toHaveBeenCalledWith(2);
    expect(setSpecialPlayLifeline).toHaveBeenLastCalledWith(true);
  });

  it('reads a flash with no lifeline flag as an ordinary backward 10, so an older server still gets the usual label', () => {
    const { handler, setSpecialPlayLifeline } = setUp();
    handler({ pileId: 0 });
    expect(setSpecialPlayLifeline).toHaveBeenLastCalledWith(false);
  });
});
