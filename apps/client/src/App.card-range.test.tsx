import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { defaultMultiplayerSettings, defaultSolitaireSettings } from '@upndown/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

vi.mock('socket.io-client', () => {
  const socket = { connected: false, id: 'socket-1', on: () => socket, off: () => socket, connect: () => socket, disconnect: () => socket, emit: () => socket };
  return { io: () => socket };
});

// Solitaire's cards are 2 to 59 by default. The card seeker is once per player here.
const withCardSeeker = () => {
  window.localStorage.setItem('upndown.settings.v1', JSON.stringify({
    solitaire: { ...defaultSolitaireSettings, cheatLimits: { lookup: 'once', skip: 'off', trade: 'off', hint: 'off' } },
    multiplayer: defaultMultiplayerSettings
  }));
};

describe('the card seeker and cards outside the game', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.spyOn(Math, 'random').mockReturnValue(0.42);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  // A card the game does not have cannot be held by anyone, so it is said to be outside the game. That is not a use of the check.
  it('says a card outside the game\'s range is not one of its cards, and leaves the card seeker unused', async () => {
    withCardSeeker();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('mode-solitaire'));
    await user.click(await screen.findByTestId('start-solitaire'));
    await user.click(screen.getByTestId('open-cheats'));
    await user.click(screen.getByTestId('cheat-lookup'));
    await user.type(await screen.findByPlaceholderText('e.g. 34'), '65{Enter}');
    await waitFor(() => expect(document.querySelector('.card-lookup-toast')?.textContent).toContain("Not one of this game's cards (2 to 59)"));
    await user.click(screen.getByTestId('open-cheats'));
    expect((screen.getByTestId('cheat-lookup') as HTMLButtonElement).disabled).toBe(false);
  });
});
