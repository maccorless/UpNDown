import { act, renderHook } from '@testing-library/react';
import { defaultMultiplayerSettings, defaultSolitaireSettings, type GameSettings } from '@upndown/shared-types';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccountSync } from './useAccountSync.js';
import type { AuthState } from './useAuth.js';

const localSolitaire: GameSettings = { ...defaultSolitaireSettings, handSize: 6 };
const localMultiplayer: GameSettings = { ...defaultMultiplayerSettings, handSize: 8 };
const serverSolitaire: GameSettings = { ...defaultSolitaireSettings, handSize: 9 };

const makeAuth = (overrides: Partial<AuthState> = {}): AuthState => ({
  status: 'signedIn',
  storage: 'ok', userId: null, playerName: 'Abraham Lincoln', settings: { playerName: 'Abraham Lincoln' }, loginMessage: null,
  nameConfirmed: true, confirmName: async (name: string) => name,
  signIn: () => undefined, signOut: async () => undefined, dismissLoginMessage: () => undefined, ...overrides
});

// Stands in for App: the same four pieces of state, owned by React.
function useHarness(auth: AuthState, initialName = 'Guest Person', seenBadges: Record<string, number> = {}) {
  const [playerName, setPlayerName] = useState(initialName);
  const [solitaire, setSolitaire] = useState(localSolitaire);
  const [multiplayer, setMultiplayer] = useState(localMultiplayer);
  const [enableSounds, setEnableSounds] = useState(true);
  useAccountSync(auth, { playerName, setPlayerName, solitaire, setSolitaire, multiplayer, setMultiplayer, enableSounds, setEnableSounds, seenBadges });
  return { playerName, setPlayerName, solitaire, multiplayer, enableSounds, setEnableSounds };
}

const ok = () => new Response('{}', { status: 200 });
let fetchMock: ReturnType<typeof vi.fn>;
const puts = () => fetchMock.mock.calls.filter(([url, init]) => url === '/api/me/settings' && (init as RequestInit).method === 'PUT');
const lastBody = () => JSON.parse((puts().at(-1)?.[1] as RequestInit).body as string) as Record<string, unknown>;
const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('useAccountSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('replaces the local copy with the server settings, and uploads nothing', async () => {
    const auth = makeAuth({ settings: { playerName: 'Abraham Lincoln', solitaire: serverSolitaire, enableSounds: false } });
    const { result } = renderHook(() => useHarness(auth));
    await settle(3000);
    expect(result.current.solitaire.handSize).toBe(9);
    expect(result.current.enableSounds).toBe(false);
    expect(result.current.multiplayer.handSize).toBe(8); // the server had none: the local one stays
    // The values just applied must not be echoed back to the server.
    expect(puts()).toHaveLength(0);
  });

  it('uploads the local settings with the account name in one PUT when the server has only a name', async () => {
    const { result } = renderHook(() => useHarness(makeAuth()));
    await settle(3000);
    expect(puts()).toHaveLength(1);
    expect(lastBody()).toEqual({ playerName: 'Abraham Lincoln', solitaire: localSolitaire, multiplayer: localMultiplayer, enableSounds: true });
    expect(result.current.solitaire.handSize).toBe(6);
  });

  it('sends the badges the player has been shown with the rest of the document, and sends none when there are none', async () => {
    renderHook(() => useHarness(makeAuth(), 'Abraham Lincoln', { duet: 1 }));
    await settle(3000);
    expect(lastBody()).toMatchObject({ seenBadges: { duet: 1 } });
    puts().length = 0;
    fetchMock.mockClear();
    renderHook(() => useHarness(makeAuth(), 'Abraham Lincoln'));
    await settle(3000);
    expect(lastBody()).not.toHaveProperty('seenBadges');
  });

  it('keeps the badges the account already has when this device knows none (the first save must not wipe them)', async () => {
    const auth = makeAuth({ settings: { playerName: 'Abraham Lincoln', seenBadges: { solo: 2 } } });
    renderHook(() => useHarness(auth));
    await settle(3000);
    // The account had no sounds or table settings, so the device's are uploaded, and the badges it had go up with them.
    expect(puts().length).toBeGreaterThan(0);
    for (const [, init] of puts()) expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ seenBadges: { solo: 2 } });
  });

  // Ken's rule: the account name wins over whatever a guest had typed on this device.
  it('puts the account name in the field, over a name stored on this device', async () => {
    const { result } = renderHook(() => useHarness(makeAuth(), 'Zed Stored'));
    await settle();
    expect(result.current.playerName).toBe('Abraham Lincoln');
  });

  it('does nothing while signed out, and stops after signing out', async () => {
    let auth = makeAuth({ status: 'guest', playerName: null, settings: null });
    const { result, rerender } = renderHook(() => useHarness(auth));
    await act(async () => { result.current.setEnableSounds(false); });
    await settle(3000);
    expect(puts()).toHaveLength(0);
    expect(result.current.playerName).toBe('Guest Person');

    auth = makeAuth({ settings: { playerName: 'Abraham Lincoln', solitaire: serverSolitaire } });
    rerender();
    await settle(3000);
    auth = makeAuth({ status: 'guest', playerName: null, settings: null });
    rerender();
    await act(async () => { result.current.setEnableSounds(true); });
    await settle(3000);
    expect(puts()).toHaveLength(0);
  });

  describe('after the account is loaded', () => {
    const signedIn = async () => {
      const hook = renderHook(() => useHarness(makeAuth({ settings: { playerName: 'Abraham Lincoln', solitaire: serverSolitaire } })));
      await settle(3000);
      expect(puts()).toHaveLength(0);
      return hook;
    };

    // Typing a name sends a character at a time; the server must see one PUT with the last value.
    it('sends one PUT with the last value after a burst of changes', async () => {
      const { result } = await signedIn();
      for (const text of ['J', 'Jo', 'Joh', 'John', 'John Adams']) {
        await act(async () => { result.current.setPlayerName(text); });
        await settle(200);
      }
      expect(puts()).toHaveLength(0);
      await settle(1000);
      expect(puts()).toHaveLength(1);
      expect(lastBody()).toMatchObject({ playerName: 'John Adams', solitaire: serverSolitaire });
    });

    it('sends a changed setting too', async () => {
      const { result } = await signedIn();
      await act(async () => { result.current.setEnableSounds(false); });
      await settle(1000);
      expect(lastBody()).toMatchObject({ enableSounds: false, playerName: 'Abraham Lincoln' });
    });

    it('sends the cleaned name, with control and bidirectional characters removed', async () => {
      const { result } = await signedIn();
      await act(async () => { result.current.setPlayerName('  Ab‮e  '); });
      await settle(1000);
      expect(lastBody().playerName).toBe('Abe');
    });

    it('never sends an empty name, and later PUTs keep the last good one', async () => {
      const { result } = await signedIn();
      await act(async () => { result.current.setPlayerName(''); });
      await settle(2000);
      await act(async () => { result.current.setPlayerName('‮ \u0007'); });
      await settle(2000);
      expect(puts()).toHaveLength(0);
      await act(async () => { result.current.setEnableSounds(false); });
      await settle(1000);
      expect(puts()).toHaveLength(1);
      expect(lastBody().playerName).toBe('Abraham Lincoln');
    });

    // Play must never depend on the network: a failed save is a console warning, and the next change tries again.
    it('survives a failed PUT with a warning and retries on the next change', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { result } = await signedIn();
      fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 500 }));
      await act(async () => { result.current.setPlayerName('James Madison'); });
      await settle(1000);
      expect(warn).toHaveBeenCalled();
      fetchMock.mockImplementationOnce(async () => { throw new TypeError('offline'); });
      await act(async () => { result.current.setPlayerName('James Monroe'); });
      await settle(1000);
      await act(async () => { result.current.setPlayerName('John Adams'); });
      await settle(1000);
      expect(puts()).toHaveLength(3);
      expect(lastBody().playerName).toBe('John Adams');
      expect(result.current.playerName).toBe('John Adams');
    });
  });
});
