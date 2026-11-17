import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { defaultMultiplayerSettings, defaultSolitaireSettings } from '@upndown/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

vi.mock('socket.io-client', () => {
  const socket = { connected: false, id: 'socket-1', on: () => socket, off: () => socket, connect: () => socket, disconnect: () => socket, emit: () => socket };
  return { io: () => socket };
});

const withCheats = (lookup: 'off' | 'once' | 'unlimited', trade: 'off' | 'once' | 'unlimited', hint: 'off' | 'once' | 'unlimited' = 'off') => {
  window.localStorage.setItem('upndown.settings.v1', JSON.stringify({
    solitaire: { ...defaultSolitaireSettings, cheatLimits: { lookup, skip: 'unlimited', trade, hint } },
    multiplayer: defaultMultiplayerSettings
  }));
};
const handIds = () => screen.getAllByTestId(/hand-card-/).map((el) => el.getAttribute('data-testid')!);

// Solitaire runs with no connection: every cheat here works with fetch rejecting.
describe('cheats in solitaire', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.spyOn(Math, 'random').mockReturnValue(0.42);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('offers no cheats unless the settings turn them on', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('mode-solitaire'));
    expect(screen.queryByTestId('open-cheats')).toBeNull();
  });

  it('lists trade and the card seeker but never skip, since there is no turn to skip', async () => {
    withCheats('once', 'once');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('mode-solitaire'));
    await user.click(screen.getByTestId('open-cheats'));
    expect(screen.getByTestId('cheat-lookup')).toBeTruthy();
    expect(screen.getByTestId('cheat-trade')).toBeTruthy();
    expect(screen.queryByTestId('cheat-skip')).toBeNull();
  });

  it('trades the selected card for the next draw card once, then grays trade out', async () => {
    withCheats('off', 'once');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('mode-solitaire'));
    const before = handIds();
    await user.click(screen.getAllByTestId(/hand-card-/)[0]!);
    await user.click(screen.getByTestId('open-cheats'));
    await user.click(screen.getByTestId('cheat-trade'));
    await waitFor(() => expect(handIds()).not.toEqual(before));
    expect(handIds()).toHaveLength(before.length);

    await user.click(screen.getAllByTestId(/hand-card-/)[0]!);
    await user.click(screen.getByTestId('open-cheats'));
    expect((screen.getByTestId('cheat-trade') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Already used')).toBeTruthy();
  });

  // A trade is for good: undo must not take it back.
  it('offers no undo for anything before a trade', async () => {
    withCheats('off', 'unlimited');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('mode-solitaire'));
    await user.click(screen.getAllByTestId(/hand-card-/)[0]!);
    await user.click(screen.getByTestId('pile-0'));
    expect((screen.getByTestId('undo') as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getAllByTestId(/hand-card-/)[0]!);
    await user.click(screen.getByTestId('open-cheats'));
    await user.click(screen.getByTestId('cheat-trade'));
    await waitFor(() => expect(screen.queryByTestId('undo')).toBeNull());
  });

  // A lookup cannot be taken back either: undoing a play must not hand the single use back.
  it('does not give a card seeker use back when a play is undone', async () => {
    withCheats('once', 'off');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('mode-solitaire'));
    await user.click(screen.getAllByTestId(/hand-card-/)[0]!);
    await user.click(screen.getByTestId('pile-0'));
    await user.click(screen.getByTestId('open-cheats'));
    await user.click(screen.getByTestId('cheat-lookup'));
    await user.type(await screen.findByPlaceholderText('e.g. 34'), '50{Enter}');
    await waitFor(() => expect(document.querySelector('.card-lookup-toast')).not.toBeNull());
    await user.click(screen.getByTestId('undo'));
    await user.click(screen.getByTestId('open-cheats'));
    expect((screen.getByTestId('cheat-lookup') as HTMLButtonElement).disabled).toBe(true);
  });

  // The strategy runs in the browser from the cards the player can see: no request is made.
  it('gives a hint with no connection at all, lights up a card, and counts it against a single use (the only request allowed is the network file, which sends nothing)', async () => {
    withCheats('off', 'off', 'once');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('mode-solitaire'));
    const requestsBefore = vi.mocked(fetch).mock.calls.length; // the page asked about sign-in when it loaded
    await user.click(screen.getByTestId('open-cheats'));
    await user.click(screen.getByTestId('cheat-hint'));
    expect(screen.getByTestId('hint-banner').textContent).toMatch(/^Hint: play \d+ on the (up|down) pile showing \d+\.$/);
    expect(document.querySelectorAll('.card.hinted')).toHaveLength(1);
    expect(document.querySelectorAll('.pile-unit.hinted')).toHaveLength(1);
    // The screen-only network is a static file fetched once, with no data sent; if it cannot be fetched the written strategy gives the hint, as here.
    const newCalls = vi.mocked(fetch).mock.calls.slice(requestsBefore).map((call) => String(call[0]));
    expect(newCalls.every((url) => url === '/models/hint.json')).toBe(true);
    await user.click(screen.getByTestId('open-cheats'));
    expect((screen.getByTestId('cheat-hint') as HTMLButtonElement).disabled).toBe(true);
  });
});

