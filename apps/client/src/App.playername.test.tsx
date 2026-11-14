import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PRESIDENT_FIRST_NAMES, PRESIDENT_LAST_NAMES } from '@upndown/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

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
      emit() { return socket; }
    };
    return socket;
  }
}));

const KEY = 'upndown.multiplayer.playerName.v1';
const nameInLobby = async (): Promise<string> => {
  await userEvent.click(await screen.findByTestId('mode-multiplayer'));
  return (await screen.findByLabelText('Player Name') as HTMLInputElement).value;
};
const isPresidentName = (name: string): boolean => {
  const [first, ...rest] = name.split(' ');
  return (PRESIDENT_FIRST_NAMES as readonly string[]).includes(first ?? '') && (PRESIDENT_LAST_NAMES as readonly string[]).includes(rest.join(' '));
};

describe('starting player name', () => {
  beforeEach(() => { window.localStorage.clear(); window.history.replaceState(null, '', '/'); vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); })); });
  afterEach(() => vi.unstubAllGlobals());

  it('gives a visitor with no saved name a president name, saves it, and keeps it on the next visit', async () => {
    const first = render(<App />);
    const name = await nameInLobby();
    expect(isPresidentName(name)).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe(name);
    first.unmount();

    render(<App />);
    expect(await nameInLobby()).toBe(name);
  });

  it('leaves a name the player already saved alone', async () => {
    window.localStorage.setItem(KEY, 'Sam Typed');
    render(<App />);
    expect(await nameInLobby()).toBe('Sam Typed');
  });

  it('lets the player replace the generated name with their own', async () => {
    render(<App />);
    await nameInLobby();
    const input = screen.getByLabelText('Player Name') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'My Own Name');
    expect(input.value).toBe('My Own Name');
    expect(window.localStorage.getItem(KEY)).toBe('My Own Name');
  });
});
