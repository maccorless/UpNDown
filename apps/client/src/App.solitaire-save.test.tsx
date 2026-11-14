import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { SOLITAIRE_SAVE_KEY, readSolitaireSave } from './solitaire-save.js';

vi.mock('socket.io-client', () => {
  const socket = { connected: false, id: 'socket-1', on: () => socket, off: () => socket, connect: () => socket, disconnect: () => socket, emit: () => socket };
  return { io: () => socket };
});

const raw = () => window.localStorage.getItem(SOLITAIRE_SAVE_KEY);
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
    const card = await screen.findByTestId('mode-solitaire');
    expect(card.textContent).toContain('Continue solitaire');
    expect(card.textContent).toMatch(/\d+ cards left\. Saved just now\./);
    await user.click(card);

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
      await screen.findByText('Continue solitaire');
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

  it('starts a new game only after confirmation, and then the old save is gone at once, played or not', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await startAndPlayOneCard(user);
    expect(readSolitaireSave()!.state.statistics.players['solo-player']!.cardsPlayed).toBeGreaterThan(0);
    first.unmount();

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Start a new solitaire game' }));
    expect(raw()).not.toBeNull();
    expect(screen.queryAllByTestId(/hand-card-/)).toHaveLength(0); // still on the landing: nothing was started yet
    await user.click(within(screen.getByRole('dialog', { hidden: true })).getByRole('button', { name: 'Discard and start new' }));
    await waitFor(() => expect(screen.getAllByTestId(/hand-card-/).length).toBeGreaterThan(0));
    // The dialog promised the old game would be discarded. It must be, even if the new game is never played.
    expect(raw()).toBeNull();
    // And once a card is played in the new game, that is what is saved.
    await user.click(screen.getAllByTestId(/hand-card-/)[0]!);
    await user.click(screen.getByTestId('pile-0'));
    const now = readSolitaireSave()!;
    expect(now.state.statistics.players['solo-player']!.cardsPlayed).toBe(1);
    expect(now.undo).toHaveLength(1);
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
    window.localStorage.setItem(SOLITAIRE_SAVE_KEY, '{"v":1,"state":"garbage"}');
    render(<App />);
    expect((await screen.findByTestId('mode-solitaire')).textContent).toContain('Play on your own');
    expect(raw()).toBeNull();
  });
});
