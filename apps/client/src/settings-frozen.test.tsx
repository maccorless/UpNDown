import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

// A socket that never connects: enough for the multiplayer screen to render without a server.
vi.mock('socket.io-client', () => {
  const socket = { connected: false, id: 'socket-1', on: () => socket, off: () => socket, connect: () => socket, disconnect: () => socket, emit: () => socket };
  return { io: () => socket };
});

// The ice must follow the same rule as the dialog's "View only" chip, so a player never sees one without the other.
describe('Settings button ice', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('is iced and described as view only while a solitaire game is running, and the dialog agrees', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('mode-solitaire'));
    await user.click(await screen.findByTestId('start-solitaire'));

    const button = screen.getByTestId('open-settings');
    expect(button.classList.contains('settings-frozen')).toBe(true);
    const hintId = button.getAttribute('aria-describedby') as string;
    expect(document.getElementById(hintId)?.textContent).toBe('Settings are view only right now');
    // The hint describes the button; it must not change the button's own name.
    expect(button.textContent).toBe('Settings');

    await user.click(button);
    expect(screen.getByText('View only')).toBeTruthy();
  });

  it('is plain when the settings can be edited (multiplayer, before any lobby)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('mode-multiplayer'));

    const button = screen.getByTestId('open-settings');
    expect(button.classList.contains('settings-frozen')).toBe(false);
    expect(button.hasAttribute('aria-describedby')).toBe(false);
    expect(document.getElementById('settings-frozen-hint')).toBeNull();
  });
});
