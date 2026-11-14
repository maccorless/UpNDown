import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from './useAuth.js';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(handlers: Record<string, () => Response | Promise<Response>>) {
  const fetchMock = vi.fn(async (url: string) => {
    const handler = handlers[url];
    if (!handler) throw new Error(`unexpected fetch ${url}`);
    return handler();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('useAuth', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));
  afterEach(() => vi.unstubAllGlobals());

  // Until both answers are in, no card may render: a signed-in player must never see login buttons flash.
  it('is loading until the config and the session have both answered', async () => {
    stubFetch({ '/api/auth/config': () => json({ enabled: true, providers: ['google'] }), '/api/me': () => json({}, 401) });
    const { result } = renderHook(() => useAuth());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('guest'));
  });

  it('is disabled when the server has auth off, and never asks for a session', async () => {
    const fetchMock = stubFetch({ '/api/auth/config': () => json({ enabled: false, providers: [] }) });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('disabled'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is signedIn with the player name from /api/me, or null when the account has none', async () => {
    stubFetch({ '/api/auth/config': () => json({ enabled: true, providers: ['google'] }), '/api/me': () => json({ playerName: 'Ken' }) });
    const named = renderHook(() => useAuth());
    await waitFor(() => expect(named.result.current.status).toBe('signedIn'));
    expect(named.result.current.playerName).toBe('Ken');

    stubFetch({ '/api/auth/config': () => json({ enabled: true, providers: ['google'] }), '/api/me': () => json({ playerName: null }) });
    const unnamed = renderHook(() => useAuth());
    await waitFor(() => expect(unnamed.result.current.status).toBe('signedIn'));
    expect(unnamed.result.current.playerName).toBeNull();
  });

  it('exposes the stored settings from /api/me, and null when they are not valid', async () => {
    const cfg = () => json({ enabled: true, providers: ['google'] });
    stubFetch({ '/api/auth/config': cfg, '/api/me': () => json({ playerName: 'Abraham Lincoln', settings: { playerName: 'Abraham Lincoln', enableSounds: false, junk: 1 } }) });
    const good = renderHook(() => useAuth());
    await waitFor(() => expect(good.result.current.status).toBe('signedIn'));
    expect(good.result.current.settings).toEqual({ playerName: 'Abraham Lincoln', enableSounds: false });

    stubFetch({ '/api/auth/config': cfg, '/api/me': () => json({ playerName: 'Abraham Lincoln', settings: { enableSounds: 'loud' } }) });
    const bad = renderHook(() => useAuth());
    await waitFor(() => expect(bad.result.current.status).toBe('signedIn'));
    expect(bad.result.current.settings).toBeNull();
  });

  // The game must play exactly as before whenever auth cannot be used.
  it.each([
    ['the network is down', () => { throw new TypeError('Failed to fetch'); }],
    ['the config is not JSON (the client page served for an unknown path)', () => new Response('<html></html>', { status: 200 })],
    ['the config request fails', () => json({}, 500)]
  ])('falls back to disabled when %s', async (_why, config) => {
    stubFetch({ '/api/auth/config': config });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('disabled'));
  });

  it('falls back to disabled when /api/me fails with a server error, which is not "signed out"', async () => {
    stubFetch({ '/api/auth/config': () => json({ enabled: true, providers: ['google'] }), '/api/me': () => json({}, 500) });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('disabled'));
  });

  describe('?login= message', () => {
    beforeEach(() => {
      stubFetch({ '/api/auth/config': () => json({ enabled: true, providers: ['google'] }), '/api/me': () => json({}, 401) });
    });

    it('shows it once and removes only that parameter from the address', async () => {
      window.history.replaceState(null, '', '/?game=ABC123&login=failed');
      const first = renderHook(() => useAuth());
      await waitFor(() => expect(first.result.current.status).toBe('guest'));
      expect(first.result.current.loginMessage).toBe('failed');
      expect(window.location.search).toBe('?game=ABC123');

      const second = renderHook(() => useAuth());
      await waitFor(() => expect(second.result.current.status).toBe('guest'));
      expect(second.result.current.loginMessage).toBeNull();
    });

    it('maps cancelled, ignores unknown values but still cleans the address', async () => {
      window.history.replaceState(null, '', '/?login=cancelled');
      const cancelled = renderHook(() => useAuth());
      await waitFor(() => expect(cancelled.result.current.status).toBe('guest'));
      expect(cancelled.result.current.loginMessage).toBe('cancelled');

      window.history.replaceState(null, '', '/?login=bogus');
      const bogus = renderHook(() => useAuth());
      await waitFor(() => expect(bogus.result.current.status).toBe('guest'));
      expect(bogus.result.current.loginMessage).toBeNull();
      expect(window.location.search).toBe('');
    });

    it('dismissLoginMessage clears it', async () => {
      window.history.replaceState(null, '', '/?login=failed');
      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.status).toBe('guest'));
      expect(result.current.loginMessage).toBe('failed');
      act(() => result.current.dismissLoginMessage());
      expect(result.current.loginMessage).toBeNull();
    });
  });

  // An invite link must survive the round trip through Google, or the guest lands on the home page and loses the game.
  it('signIn sends the current path and query as the return address', async () => {
    stubFetch({ '/api/auth/config': () => json({ enabled: false }) });
    window.history.replaceState(null, '', '/?game=ABC123');
    const navigate = vi.fn();
    const { result } = renderHook(() => useAuth(navigate));
    await waitFor(() => expect(result.current.status).toBe('disabled'));
    act(() => result.current.signIn());
    expect(navigate).toHaveBeenCalledWith('/auth/google/start?return=%2F%3Fgame%3DABC123');
  });

  describe('signOut', () => {
    const signedIn = (logout: () => Response) => stubFetch({
      '/api/auth/config': () => json({ enabled: true, providers: ['google'] }),
      '/api/me': () => json({ playerName: 'Ken' }),
      '/api/auth/logout': logout
    });

    it('posts JSON with the cookie, then becomes a guest', async () => {
      const fetchMock = signedIn(() => json({ ok: true }));
      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.status).toBe('signedIn'));
      await act(() => result.current.signOut());
      const call = fetchMock.mock.calls.find(([url]) => url === '/api/auth/logout') as unknown as [string, RequestInit];
      expect(call[1]).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{}', headers: { 'Content-Type': 'application/json' } });
      expect(result.current.status).toBe('guest');
      expect(result.current.playerName).toBeNull();
    });

    it('stays signed in when the server did not revoke the session', async () => {
      signedIn(() => json({}, 500));
      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.status).toBe('signedIn'));
      await act(() => result.current.signOut());
      expect(result.current.status).toBe('signedIn');
    });
  });
});

describe('useAuth name confirmation', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));
  afterEach(() => vi.unstubAllGlobals());

  const signedInWith = (me: unknown, extra: Record<string, () => Response | Promise<Response>> = {}) =>
    stubFetch({ '/api/auth/config': () => json({ enabled: true, providers: ['google'] }), '/api/me': () => json(me), ...extra });

  it('reports a name the player has not chosen yet, which is what triggers the first-sign-in prompt', async () => {
    signedInWith({ playerName: 'Grover Arthur', nameConfirmed: false });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signedIn'));
    expect(result.current.nameConfirmed).toBe(false);
  });

  // An older server does not say. Treating silence as "ask" would show a prompt that nothing can answer.
  it('treats a server that says nothing, or says true, as already chosen', async () => {
    signedInWith({ playerName: 'Ken' });
    const silent = renderHook(() => useAuth());
    await waitFor(() => expect(silent.result.current.status).toBe('signedIn'));
    expect(silent.result.current.nameConfirmed).toBe(true);

    signedInWith({ playerName: 'Ken', nameConfirmed: true });
    const said = renderHook(() => useAuth());
    await waitFor(() => expect(said.result.current.status).toBe('signedIn'));
    expect(said.result.current.nameConfirmed).toBe(true);
  });

  it('confirmName sends the name, then shows it as chosen everywhere', async () => {
    const fetchMock = signedInWith({ playerName: 'Grover Arthur', nameConfirmed: false, settings: { playerName: 'Grover Arthur' } }, {
      '/api/me/name': () => json({ playerName: 'Pat', nameConfirmed: true })
    });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signedIn'));
    let saved: string | null = null;
    await act(async () => { saved = await result.current.confirmName('Pat'); });
    expect(saved).toBe('Pat');
    expect(result.current).toMatchObject({ playerName: 'Pat', nameConfirmed: true, settings: { playerName: 'Pat' } });
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/me/name') as unknown as [string, RequestInit];
    expect(call[1].method).toBe('PUT');
    expect(JSON.parse(call[1].body as string)).toEqual({ playerName: 'Pat' });
  });

  it('keeps the prompt open when saving fails, over a bad status or a dead network', async () => {
    signedInWith({ playerName: 'Grover Arthur', nameConfirmed: false }, { '/api/me/name': () => json({}, 400) });
    const bad = renderHook(() => useAuth());
    await waitFor(() => expect(bad.result.current.status).toBe('signedIn'));
    await act(async () => { expect(await bad.result.current.confirmName('Pat')).toBeNull(); });
    expect(bad.result.current).toMatchObject({ playerName: 'Grover Arthur', nameConfirmed: false });

    signedInWith({ playerName: 'Grover Arthur', nameConfirmed: false }, { '/api/me/name': () => { throw new TypeError('offline'); } });
    const down = renderHook(() => useAuth());
    await waitFor(() => expect(down.result.current.status).toBe('signedIn'));
    await act(async () => { expect(await down.result.current.confirmName('Pat')).toBeNull(); });
    expect(down.result.current.nameConfirmed).toBe(false);
  });
});

