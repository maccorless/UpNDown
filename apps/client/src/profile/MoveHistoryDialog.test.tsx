import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalHistory } from './local-history.js';
import { MoveHistoryDialog } from './MoveHistoryDialog.js';
import { authOf, row, sourceOf } from './profile-fixtures.js';

const ok = (init?: RequestInit) => new Response(JSON.stringify({ results: (JSON.parse(init!.body as string) as { rows: Array<{ gameId: string }> }).rows.map((r) => ({ gameId: r.gameId, status: 'inserted' })) }), { status: 200 });
const signedIn = () => authOf({ status: 'signedIn', userId: 'u1', playerName: 'Ann Lee' });

describe('the offer to add this device\'s games to the account', () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const setup = (n = 3, auth = signedIn()) => {
    const history = createLocalHistory();
    for (let i = 0; i < n; i += 1) history.add(row());
    const markSeen = vi.fn();
    render(<MoveHistoryDialog auth={auth} history={history} source={sourceOf(history.load().rows)} markSeen={markSeen} />);
    return { history, markSeen };
  };

  it('asks first, with the number of games, the dates they were played and the badges they earned, and sends nothing yet', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setup(3);
    expect(screen.getByRole('heading', { name: 'Add the 3 games from this device to your account?' })).toBeTruthy();
    expect(screen.getByText(/played on this device as a guest, between .* and .*\. They earned \d+ badges?\./)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not appear for a guest, for an account whose device holds no games, or while sign-in is unknown', () => {
    setup(3, authOf({ status: 'guest' }));
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('stays out of the way when the device holds nothing', () => {
    setup(0);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('keeps the games on the device when the player says not now', () => {
    const { history } = setup(3);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('heading')).toBeNull();
    expect(history.load().rows).toHaveLength(3);
  });

  it('moves the games, reports how many, and hands what was shown over to the account', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => ok(init)));
    const { history, markSeen } = setup(3);
    history.setSeen({ 'first-steps': 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Add to my account' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Added 3 games to your account.' })).toBeTruthy());
    expect(history.load().rows).toHaveLength(0);
    expect(history.movedAtMs()).not.toBeNull();
    expect(history.seen()).toEqual({});
    expect(markSeen).toHaveBeenCalledWith({ 'first-steps': 1 });
    expect(markSeen.mock.calls.length).toBeGreaterThan(1);
  });

  it('says the history is safe on the device when it cannot reach the server, and offers a retry that finishes the job', async () => {
    let up = false;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => { if (!up) throw new TypeError('Failed to fetch'); return ok(init); }));
    const { history } = setup(3);
    fireEvent.click(screen.getByRole('button', { name: 'Add to my account' }));
    await waitFor(() => expect(screen.getByText(/Your history is safe on this device\. We could not reach the server\. 3 games are still waiting\./)).toBeTruthy());
    expect(history.load().rows).toHaveLength(3);
    up = true;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Added 3 games to your account.' })).toBeTruthy());
  });

  it('says how many games could not be added, keeps them, and lets the player discard them', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const rows = (JSON.parse(init!.body as string) as { rows: Array<{ gameId: string }> }).rows;
      return new Response(JSON.stringify({ results: rows.map((r, i) => ({ gameId: r.gameId, status: i === 0 ? 'rejected' : 'inserted', ...(i === 0 ? { reason: 'invalid' } : {}) })) }), { status: 200 });
    }));
    const { history } = setup(3);
    fireEvent.click(screen.getByRole('button', { name: 'Add to my account' }));
    await waitFor(() => expect(screen.getByText('1 game could not be added, and stays on this device.')).toBeTruthy());
    expect(history.load().rejected).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Discard them' }));
    expect(history.load().rejected).toHaveLength(0);
  });
});
