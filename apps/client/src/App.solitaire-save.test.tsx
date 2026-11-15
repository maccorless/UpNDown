import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { SOLITAIRE_SAVE_PREFIX, listSolitaireSaves } from './solitaire-save.js';
import { fakeLocks } from './test-locks.js';

vi.mock('socket.io-client', () => {
  const socket = { connected: false, id: 'socket-1', on: () => socket, off: () => socket, connect: () => socket, disconnect: () => socket, emit: () => socket };
  return { io: () => socket };
});

const savedKeys = (): string[] => Object.keys(window.localStorage).filter((k) => k.startsWith(SOLITAIRE_SAVE_PREFIX)).sort();
const raw = (): string | null => { const [key] = savedKeys(); return key ? window.localStorage.getItem(key) : null; };
const handIds = () => screen.getAllByTestId(/hand-card-/).map((el) => el.getAttribute('data-testid')!);

async function startAndPlayOneCard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId('mode-solitaire'));
  const before = handIds();
  await user.click(screen.getAllByTestId(/hand-card-/)[0]!);
  await user.click(screen.getByTestId('pile-0'));
  return { before, top: screen.getByTestId('pile-top-0').textContent };
}

// A game left in the middle should be there when the player comes back, on this device, and nowhere else.
describe('saving and resuming solitaire', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.spyOn(Math, 'random').mockReturnValue(0.42);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('saves as you play, offers to continue next visit, and puts you back exactly where you were, undo and all', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    const { before, top } = await startAndPlayOneCard(user);
    const handAfterPlay = handIds();
    expect(handAfterPlay).not.toEqual(before);
    expect(raw()).not.toBeNull();
    first.unmount();

    render(<App />);
    expect((await screen.findByTestId('solitaire-save')).textContent).toMatch(/\d+ cards left, just now\./);
    await user.click(screen.getByTestId('continue-solitaire'));

    expect(screen.getByTestId('pile-top-0').textContent).toBe(top);
    expect(handIds()).toEqual(handAfterPlay);
    // The undo history came along: undoing the card played before leaving brings back the hand as it was before that play.
    await user.click(screen.getByTestId('undo'));
    expect(screen.getByTestId('pile-top-0').textContent).not.toBe(top);
    expect(handIds()).toEqual(before);
  });

  it('does not touch the save when the page merely loads, so it can still be resumed after a reload and another reload', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await startAndPlayOneCard(user);
    const saved = raw();
    first.unmount();
    for (let i = 0; i < 2; i += 1) {
      const view = render(<App />);
      await screen.findByTestId('continue-solitaire');
      expect(raw()).toBe(saved);
      view.unmount();
    }
  });

  it('forgets the game when the player ends it on purpose', async () => {
    const user = userEvent.setup();
    render(<App />);
    await startAndPlayOneCard(user);
    expect(raw()).not.toBeNull();
    await user.click(screen.getByTestId('end-game-top'));
    expect(raw()).toBeNull();
  });

  // Several games at once: starting another never costs the player the one they left.
  it('starts a new game straight away and keeps the saved one, which can still be continued', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await startAndPlayOneCard(user);
    const [oldKey] = savedKeys();
    first.unmount();

    render(<App />);
    await screen.findByTestId('continue-solitaire');
    await user.click(screen.getByTestId('mode-solitaire'));
    await waitFor(() => expect(screen.getAllByTestId(/hand-card-/).length).toBeGreaterThan(0));
    expect(savedKeys()).toEqual([oldKey]);
    await user.click(screen.getAllByTestId(/hand-card-/)[0]!);
    await user.click(screen.getByTestId('pile-0'));
    const keys = savedKeys();
    expect(keys).toHaveLength(2);
    expect(keys).toContain(oldKey);
    expect(listSolitaireSaves().every((save) => save.state.statistics.players['solo-player']!.cardsPlayed === 1)).toBe(true);
  });

  it('discards a saved game only when asked, after confirming', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await startAndPlayOneCard(user);
    first.unmount();

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(savedKeys()).toHaveLength(1);
    await user.click(within(screen.getByRole('dialog', { hidden: true })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(savedKeys()).toHaveLength(0));
    expect(screen.queryByTestId('solitaire-save')).toBeNull();
  });

  // The tab that has a game open owns it. A second tab is offered only what is left behind.
  it('does not offer a game another tab has open, and offers it once that tab is gone', async () => {
    const locks = fakeLocks();
    try {
      const user = userEvent.setup();
      const first = render(<App />);
      await startAndPlayOneCard(user);
      const [key] = savedKeys();
      const runId = key!.slice(SOLITAIRE_SAVE_PREFIX.length);
      first.unmount();

      locks.held.add(`solitaire:${runId}`); // another tab has it open
      const second = render(<App />);
      await screen.findByTestId('mode-solitaire');
      await waitFor(() => expect(screen.queryByTestId('solitaire-save')).toBeNull());
      second.unmount();

      locks.held.delete(`solitaire:${runId}`); // that tab closed
      render(<App />);
      expect(await screen.findByTestId('solitaire-save')).toBeTruthy();
    } finally {
      locks.remove();
    }
  });

  it('leaves nothing to continue when a game was started and never played', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(await screen.findByTestId('mode-solitaire'));
    expect(screen.getAllByTestId(/hand-card-/).length).toBeGreaterThan(0);
    expect(raw()).toBeNull();
    first.unmount();
    render(<App />);
    expect((await screen.findByTestId('mode-solitaire')).textContent).toContain('Play on your own');
  });

  it('never saves multiplayer, and shows the plain landing when there is no save', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect((await screen.findByTestId('mode-solitaire')).textContent).toContain('Play on your own');
    await user.click(screen.getByTestId('mode-multiplayer'));
    expect(raw()).toBeNull();
  });

  it('treats a damaged save as no save, without breaking the landing', async () => {
    window.localStorage.setItem(`${SOLITAIRE_SAVE_PREFIX}bad`, '{"v":1,"state":"garbage"}');
    render(<App />);
    expect((await screen.findByTestId('mode-solitaire')).textContent).toContain('Play on your own');
    expect(raw()).toBeNull();
  });
});
