import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

const emitted: Array<{ event: string; payload: unknown }> = [];

vi.mock('socket.io-client', () => ({
  io: () => {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const socket = {
      id: 'socket-1',
      connected: false,
      on(event: string, cb: (...args: unknown[]) => void) { (handlers[event] ??= []).push(cb); return socket; },
      off() { return socket; },
      connect() { socket.connected = true; handlers.connect?.forEach((cb) => cb()); return socket; },
      disconnect() { socket.connected = false; return socket; },
      emit(event: string, payload: unknown, ack?: (r: unknown) => void) {
        emitted.push({ event, payload });
        if (event === 'game:listJoinable') ack?.({ ok: true, data: { games: [] } });
        return socket;
      }
    };
    return socket;
  }
}));

const NAME_KEY = 'upndown.multiplayer.playerName.v1';
const joins = () => emitted.filter((e) => e.event === 'game:join');
const settle = () => new Promise<void>((resolve) => { window.setTimeout(resolve, 300); });

// An invite link used to join at once only when the player had a name. Now everyone has a generated one, so
// auto-joining on it would put a first-time guest in a lobby under a name they never saw, with no way to rename.
describe('invite link auto-join', () => {
  beforeEach(() => {
    emitted.length = 0;
    window.localStorage.clear();
    window.history.replaceState(null, '', '/?game=Q7M2K9');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('holds a first-time visitor on the join screen, with the game id and a generated name filled in', async () => {
    render(<App />);
    await settle();
    expect(joins()).toHaveLength(0);
    expect((await screen.findByLabelText('Player Name') as HTMLInputElement).value).toMatch(/^\S+ .+$/);
    expect((screen.getByTestId('join-game') ?? screen.getByTestId('lookup-game'))).toBeTruthy();
  });

  it('also holds a visitor whose saved name is a generated one they never chose', async () => {
    window.localStorage.setItem(NAME_KEY, 'William Ford');
    render(<App />);
    await settle();
    expect(joins()).toHaveLength(0);
  });

  it('joins at once for a name saved before this change', async () => {
    window.localStorage.setItem(NAME_KEY, 'Alex');
    render(<App />);
    await waitFor(() => expect(joins()).toHaveLength(1));
    expect(joins()[0]?.payload).toEqual({ gameId: 'Q7M2K9', playerName: 'Alex' });
  });

  it('joins at once on the next visit after the player edited their name', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    const field = await screen.findByLabelText('Player Name');
    await user.clear(field);
    await user.type(field, 'Sam');
    first.unmount();
    emitted.length = 0;

    render(<App />);
    await waitFor(() => expect(joins()).toHaveLength(1));
    expect(joins()[0]?.payload).toEqual({ gameId: 'Q7M2K9', playerName: 'Sam' });
  });

  it('counts a generated name as theirs once they use it to host a game', async () => {
    window.history.replaceState(null, '', '/');
    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(await screen.findByTestId('mode-multiplayer'));
    const generated = (await screen.findByLabelText('Player Name') as HTMLInputElement).value;
    await user.click(await screen.findByTestId('flow-host'));
    expect(window.localStorage.getItem('upndown.multiplayer.playerNameConfirmed.v1')).toBe('1');
    first.unmount();
    emitted.length = 0;

    window.history.replaceState(null, '', '/?game=Q7M2K9');
    render(<App />);
    await waitFor(() => expect(joins()).toHaveLength(1));
    expect((joins()[0]?.payload as { playerName: string }).playerName).toBe(generated);
  });
});
