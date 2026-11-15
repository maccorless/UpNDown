import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from './auth/useAuth.js';

const makeAuth = (overrides: Partial<AuthState> = {}): AuthState => ({
  status: 'guest',
  storage: 'ok',
  playerName: null,
  nameConfirmed: true,
  settings: null,
  loginMessage: null,
  signIn: vi.fn(),
  signOut: vi.fn(async () => undefined),
  confirmName: async (name: string) => name,
  dismissLoginMessage: vi.fn(),
  ...overrides
});

// The entrance runs once per page load, held in module state, so each test gets a fresh copy of the module.
async function load() {
  vi.resetModules();
  return (await import('./Landing.js')).Landing;
}

const handlers = () => ({ onSolitaire: vi.fn(), onMultiplayer: vi.fn(), onChangeName: vi.fn(), solitaireSaves: [] as Array<{ runId: string; claimId: string; cardsLeft: number; savedAtMs: number }>, onResumeSolitaire: vi.fn(), onDiscardSolitaire: vi.fn(), rejoinSeats: [] as Array<{ seatKey: string; gameId: string; claimId: string }>, onRejoin: vi.fn() });

describe('Landing', () => {
  beforeEach(() => vi.resetModules());

  it('offers both ways to play as buttons, each saying what it is', async () => {
    const Landing = await load();
    const h = handlers();
    render(<Landing auth={makeAuth({ status: 'disabled' })} firstVisit={false} {...h} />);
    await userEvent.click(screen.getByTestId('mode-solitaire'));
    await userEvent.click(screen.getByTestId('mode-multiplayer'));
    expect(h.onSolitaire).toHaveBeenCalledTimes(1);
    expect(h.onMultiplayer).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('mode-solitaire').textContent).toContain('No sign-in, no waiting');
    expect(screen.getByTestId('mode-multiplayer').textContent).toContain('2 to 6 players');
    expect(screen.getByText('A cooperative card game. Win together or lose together.')).toBeTruthy();
  });

  it('shows the Google sign-in to a guest and nothing account-related when auth is off', async () => {
    const Landing = await load();
    const guest = render(<Landing auth={makeAuth()} firstVisit={false} {...handlers()} />);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    guest.unmount();
    const off = render(<Landing auth={makeAuth({ status: 'disabled' })} firstVisit={false} {...handlers()} />);
    expect(off.container.querySelector('.signin-card')).toBeNull();
    expect(off.container.querySelector('.welcome')).toBeNull();
  });

  it('greets a signed-in player by the short form of their name, and lets them change it', async () => {
    const Landing = await load();
    const h = handlers();
    render(<Landing auth={makeAuth({ status: 'signedIn', playerName: 'Grover Arthur' })} firstVisit={false} {...h} />);
    expect(screen.getByText(/Welcome back,/).textContent).toContain('Grover A');
    expect(screen.getByText(/Welcome back,/).textContent).not.toContain('Arthur');
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Change name' }));
    expect(h.onChangeName).toHaveBeenCalledTimes(1);
  });

  it('shows the first-visit hint only on a first visit', async () => {
    const Landing = await load();
    const first = render(<Landing auth={makeAuth({ status: 'disabled' })} firstVisit {...handlers()} />);
    expect(screen.getByText(/First time here\?/)).toBeTruthy();
    first.unmount();
    render(<Landing auth={makeAuth({ status: 'disabled' })} firstVisit={false} {...handlers()} />);
    expect(screen.queryByText(/First time here\?/)).toBeNull();
  });

  // Coming back to the landing from a game is not a first load; replaying the entrance there would be motion for its own sake.
  it('plays the entrance on the first mount only', async () => {
    const Landing = await load();
    const first = render(<Landing auth={makeAuth({ status: 'disabled' })} firstVisit={false} {...handlers()} />);
    expect(first.container.querySelector('.landing-hero')?.classList.contains('landing-enter')).toBe(true);
    first.unmount();
    const second = render(<Landing auth={makeAuth({ status: 'disabled' })} firstVisit={false} {...handlers()} />);
    expect(second.container.querySelector('.landing-hero')?.classList.contains('landing-enter')).toBe(false);
  });
});

describe('Landing with solitaire games saved on this device', () => {
  beforeEach(() => vi.resetModules());
  const saved = { runId: 'run-a', claimId: 'run-a', cardsLeft: 41, savedAtMs: Date.now() - 2 * 3_600_000 };
  const other = { runId: 'run-b', claimId: 'run-b', cardsLeft: 12, savedAtMs: Date.now() - 5 * 60_000 };

  // Having a saved game never gets in the way of starting another: that is the point of several tabs.
  it('always lets a new game be started, and lists each saved game with how far along it is', async () => {
    const Landing = await load();
    const h = { ...handlers(), solitaireSaves: [other, saved] };
    render(<Landing auth={makeAuth({ status: 'disabled' })} firstVisit={false} {...h} />);
    expect(screen.getByTestId('mode-solitaire').textContent).toContain('Play on your own. No sign-in, no waiting.');
    const notes = screen.getAllByTestId('solitaire-save').map((n) => n.textContent);
    expect(notes[0]).toContain('12 cards left, 5 minutes ago');
    expect(notes[1]).toContain('41 cards left, 2 hours ago');
    await userEvent.click(screen.getByTestId('mode-solitaire'));
    expect(h.onSolitaire).toHaveBeenCalledTimes(1);
    expect(h.onResumeSolitaire).not.toHaveBeenCalled();
  });

  it('continues the game that was chosen', async () => {
    const Landing = await load();
    const h = { ...handlers(), solitaireSaves: [other, saved] };
    render(<Landing auth={makeAuth({ status: 'disabled' })} firstVisit={false} {...h} />);
    await userEvent.click(screen.getAllByTestId('continue-solitaire')[1]!);
    expect(h.onResumeSolitaire).toHaveBeenCalledWith('run-a');
    expect(h.onSolitaire).not.toHaveBeenCalled();
  });

  // Discarding a saved game throws it away for good, so one stray click must not do it.
  it('discards a saved game only after a second, deliberate step', async () => {
    const Landing = await load();
    const h = { ...handlers(), solitaireSaves: [saved] };
    render(<Landing auth={makeAuth({ status: 'disabled' })} firstVisit={false} {...h} />);
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(h.onDiscardSolitaire).not.toHaveBeenCalled();
    expect(screen.getByText(/will be thrown away/).textContent).toContain('41 cards left');

    await userEvent.click(screen.getByRole('button', { name: 'Keep my saved game' }));
    expect(h.onDiscardSolitaire).not.toHaveBeenCalled();
    expect(screen.queryByText(/will be thrown away/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }));
    expect(h.onDiscardSolitaire).toHaveBeenCalledWith('run-a');
  });

  it('looks plain when nothing is saved', async () => {
    const Landing = await load();
    render(<Landing auth={makeAuth({ status: 'disabled' })} firstVisit={false} {...handlers()} />);
    expect(screen.queryByTestId('solitaire-save')).toBeNull();
    expect(screen.queryByTestId('rejoin-game')).toBeNull();
  });

  it('offers to rejoin each game in progress, naming it', async () => {
    const Landing = await load();
    const h = { ...handlers(), rejoinSeats: [{ seatKey: 'k1', gameId: 'ABC123', claimId: 'k1' }, { seatKey: 'k2', gameId: 'XYZ789', claimId: 'k2' }] };
    render(<Landing auth={makeAuth({ status: 'disabled' })} firstVisit={false} {...h} />);
    const buttons = screen.getAllByTestId('rejoin-game');
    expect(buttons.map((b) => b.textContent)).toEqual(['Rejoin game ABC123', 'Rejoin game XYZ789']);
    await userEvent.click(buttons[1]!);
    expect(h.onRejoin).toHaveBeenCalledWith('k2');
    expect(h.onMultiplayer).not.toHaveBeenCalled();
  });
});
