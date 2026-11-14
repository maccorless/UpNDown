import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from './auth/useAuth.js';

const makeAuth = (overrides: Partial<AuthState> = {}): AuthState => ({
  status: 'guest',
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

const handlers = () => ({ onSolitaire: vi.fn(), onMultiplayer: vi.fn(), onChangeName: vi.fn(), solitaireSave: null, onResumeSolitaire: vi.fn() });

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

describe('Landing with a solitaire game saved on this device', () => {
  beforeEach(() => vi.resetModules());
  const saved = { cardsLeft: 41, savedAtMs: Date.now() - 2 * 3_600_000 };

  it('offers to continue it, says how far along it is and where it is kept, and does not start a new game', async () => {
    const Landing = await load();
    const h = { ...handlers(), solitaireSave: saved };
    render(<Landing auth={makeAuth({ status: 'disabled' })} firstVisit={false} {...h} />);
    const card = screen.getByTestId('mode-solitaire');
    expect(card.textContent).toContain('Continue solitaire');
    expect(card.textContent).toContain('41 cards left. Saved 2 hours ago.');
    expect(screen.getByText(/Saved on this device only/)).toBeTruthy();
    await userEvent.click(card);
    expect(h.onResumeSolitaire).toHaveBeenCalledTimes(1);
    expect(h.onSolitaire).not.toHaveBeenCalled();
  });

  // Starting over throws the saved game away for good, so one stray click must not do it.
  it('starts a new game only after a second, deliberate step, and keeps the save if the player backs out', async () => {
    const Landing = await load();
    const h = { ...handlers(), solitaireSave: saved };
    render(<Landing auth={makeAuth({ status: 'disabled' })} firstVisit={false} {...h} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start a new solitaire game' }));
    expect(h.onSolitaire).not.toHaveBeenCalled();
    expect(screen.getByText(/will be discarded/).textContent).toContain('41 cards left');

    await userEvent.click(screen.getByRole('button', { name: 'Keep my saved game' }));
    expect(h.onSolitaire).not.toHaveBeenCalled();
    expect(screen.queryByText(/will be discarded/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Start a new solitaire game' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard and start new' }));
    expect(h.onSolitaire).toHaveBeenCalledTimes(1);
    expect(h.onResumeSolitaire).not.toHaveBeenCalled();
  });

  it('looks exactly as before when nothing is saved', async () => {
    const Landing = await load();
    const h = handlers();
    render(<Landing auth={makeAuth({ status: 'disabled' })} firstVisit={false} {...h} />);
    expect(screen.getByTestId('mode-solitaire').textContent).toContain('Play on your own. No sign-in, no waiting.');
    expect(screen.queryByText(/Saved on this device only/)).toBeNull();
    await userEvent.click(screen.getByTestId('mode-solitaire'));
    expect(h.onSolitaire).toHaveBeenCalledTimes(1);
  });
});

