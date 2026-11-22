import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { dataFor } from './profile/profile-fixtures.js';

vi.mock('socket.io-client', () => {
  const socket = { connected: false, id: 'socket-1', on: () => socket, off: () => socket, connect: () => socket, disconnect: () => socket, emit: () => socket };
  return { io: () => socket };
});

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('changing your name from the profile', () => {
  beforeEach(() => { window.localStorage.clear(); window.history.replaceState(null, '', '/'); });
  afterEach(() => vi.unstubAllGlobals());

  // The only other place is a link on the landing page, which a player who opens their profile to look for it does not find.
  it('opens the name dialog from the profile and saves the new name for the account', async () => {
    const puts: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/config') return json({ enabled: true, providers: ['google'] });
      if (url === '/api/me') return json({ playerName: 'Pat Quincy', nameConfirmed: true, settings: { playerName: 'Pat Quincy' } });
      if (url === '/api/me/name') { puts.push(JSON.parse(init!.body as string)); return json({ playerName: 'Pat Q' }); }
      if (url.startsWith('/api/me/stats')) return json({ stats: dataFor([], true).stats });
      if (url.startsWith('/api/me/achievements')) return json({ badges: dataFor([], true).badges });
      if (url.startsWith('/api/me/games')) return json({ rows: [], next: null });
      if (url.startsWith('/api/me')) return json({ settings: {} });
      throw new Error(`unexpected request ${url}`);
    }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Pat/ }));
    await user.click(await screen.findByRole('menuitem', { name: /profile/i }));
    // The landing page behind the profile has its own Change name link; this one is the profile's.
    await screen.findByText('Your profile');
    await user.click(within(document.querySelector('dialog.profile-page') as HTMLElement).getByRole('button', { name: 'Change name' }));
    const field = await screen.findByLabelText('Player name');
    await user.clear(field);
    await user.type(field, 'Pat Q');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(puts).toEqual([{ playerName: 'Pat Q' }]));
  });
});
