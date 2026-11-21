import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

vi.mock('socket.io-client', () => {
  const socket = { connected: false, id: 'socket-1', on: () => socket, off: () => socket, connect: () => socket, disconnect: () => socket, emit: () => socket };
  return { io: () => socket };
});

// Settings are fixed once a solitaire game is dealt, so choosing Solitaire opens a step where they can be checked and changed first.
describe('starting solitaire', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('shows the settings and a choice, and deals nothing until Start is pressed', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('mode-solitaire'));
    expect(screen.getByTestId('solitaire-setup')).toBeTruthy();
    expect(screen.getByTestId('solitaire-summary').textContent).toContain('Cards 2 to 99 (98 cards)');
    expect(screen.getByTestId('solitaire-summary').textContent).toContain('Hand of 7');
    expect(screen.getByTestId('solitaire-summary').textContent).toContain('No cheats');
    expect(screen.queryAllByTestId(/hand-card-/)).toHaveLength(0);
    expect(screen.getByTestId('open-settings').classList.contains('settings-frozen')).toBe(false);
    await user.click(screen.getByTestId('start-solitaire'));
    expect(screen.queryByTestId('solitaire-setup')).toBeNull();
    expect(screen.getAllByTestId(/hand-card-/)).toHaveLength(7);
  });

  it('lets the settings be changed first, and the game that starts has them', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('mode-solitaire'));
    await user.click(screen.getByTestId('solitaire-change-settings'));
    expect(screen.queryByText('View only')).toBeNull(); // editable, not frozen
    await user.click(screen.getAllByLabelText('Unlimited')[1]!); // the Hint row
    await user.click(screen.getByRole('button', { name: 'Save game rules' }));
    expect(screen.getByTestId('solitaire-summary').textContent).toContain('Hint (unlimited)');
    expect(screen.queryAllByTestId(/hand-card-/)).toHaveLength(0);
    await user.click(screen.getByTestId('start-solitaire'));
    await user.click(screen.getByTestId('open-cheats'));
    expect((screen.getByTestId('cheat-hint') as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps the settings fixed while a game is on, and gets back to the choice from the end of a game', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('mode-solitaire'));
    await user.click(screen.getByTestId('start-solitaire'));
    expect(screen.getByTestId('open-settings').classList.contains('settings-frozen')).toBe(true);
    await user.click(screen.getByRole('button', { name: /end game/i }));
    const confirm = screen.queryByRole('button', { name: /^end game$/i });
    if (confirm) await user.click(confirm);
    expect(await screen.findByTestId('solitaire-setup')).toBeTruthy();
  });
});
