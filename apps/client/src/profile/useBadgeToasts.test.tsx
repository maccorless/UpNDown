import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalHistory } from './local-history.js';
import { dataFor, row } from './profile-fixtures.js';

// Pinned to mid-afternoon UTC. A row's hour is what sets Early Bird, and the fixture's own counter must not decide it.
const game = (over: Parameters<typeof row>[0] = {}) => row({ endedAtMs: Date.parse('2026-11-20T15:00:00Z'), ...over });
import type { ProfileSource } from './source.js';
import { useBadgeToasts } from './useBadgeToasts.js';

const source = (rows = [game()]): ProfileSource => ({ kind: 'local', load: async () => dataFor(rows), history: async () => ({ rows: [], next: null }) });

type Props = { key: string | null; seen?: Record<string, number>; nudge?: boolean; src?: ProfileSource; now?: number };
const setup = (initial: Props) => {
  const history = createLocalHistory();
  const markSeen = vi.fn();
  const hook = renderHook((p: Props) => useBadgeToasts({ source: p.src ?? source(), finishedKey: p.key, seen: p.seen ?? {}, markSeen, nudge: p.nudge ?? false, history, now: () => p.now ?? 1_000_000_000_000 }), { initialProps: initial });
  return { history, markSeen, ...hook };
};

describe('badge toasts', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('shows nothing while no game has finished (never mid-game)', async () => {
    const { result, markSeen } = setup({ key: null });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.toasts).toEqual([]);
    expect(markSeen).not.toHaveBeenCalled();
  });

  it('announces each new badge after a game, with its name, tier and one line, and marks them seen', async () => {
    const { result, markSeen } = setup({ key: 'solo:1' });
    await waitFor(() => expect(result.current.toasts.length).toBe(4));
    expect(result.current.toasts.map((t) => t.title)).toEqual(['First Steps', 'Up and Away, Bronze', 'Duet, Bronze', 'Speedrunner, Bronze']);
    expect(result.current.toasts[0]!.body).toBe('Finish your first game, win or lose.');
    expect(markSeen).toHaveBeenCalledWith(expect.objectContaining({ 'first-steps': 1, 'up-and-away': 1 }));
  });

  it('does not announce a tier the player was already shown, and does not announce the same game twice', async () => {
    const { result, rerender } = setup({ key: 'solo:1', seen: { 'first-steps': 1, 'up-and-away': 1, duet: 1, speedrunner: 1 } });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.toasts).toEqual([]);
    rerender({ key: 'solo:1', seen: {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.toasts).toEqual([]);
  });

  it('turns a flood into one summary instead of a stack of toasts (a backfill, or the first game after an upgrade)', async () => {
    const many = Array.from({ length: 12 }, () => game({ specialPlays: 10, handSize: 5, playedLastCard: true, playerCount: 6 }));
    const { result, markSeen } = setup({ key: 'solo:2', src: source(many) });
    await waitFor(() => expect(result.current.toasts.length).toBe(1));
    expect(result.current.toasts[0]!.title).toMatch(/^\d+ new badges$/);
    expect(markSeen).toHaveBeenCalled();
  });

  it('shows nothing, and marks nothing seen, when the profile could not be read', async () => {
    const failing: ProfileSource = { kind: 'account', load: async () => { throw new Error('offline'); }, history: async () => ({ rows: [], next: null }) };
    const { result, markSeen } = setup({ key: 'solo:3', src: failing });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.toasts).toEqual([]);
    expect(markSeen).not.toHaveBeenCalled();
  });

  it('dismisses one toast and leaves the rest', async () => {
    const { result } = setup({ key: 'solo:4' });
    await waitFor(() => expect(result.current.toasts.length).toBe(4));
    act(() => result.current.dismiss(result.current.toasts[0]!.id));
    expect(result.current.toasts.length).toBe(3);
  });

  it('records what the latest game changed, and replaces it when a later game changes nothing', async () => {
    const { result, rerender } = setup({ key: 'solo:9' });
    await waitFor(() => expect(result.current.lastGame.size).toBeGreaterThan(0));
    expect(result.current.lastGame.get('first-steps')).toEqual({ tierUp: true, from: 0, to: 1 });
    // A game after which every badge reads just as it did before the game.
    const unchanged = (): ProfileSource => {
      const data = dataFor([row()]);
      return { kind: 'local', load: async () => ({ ...data, beforeLatest: data.badges }), history: async () => ({ rows: [], next: null }) };
    };
    rerender({ key: 'solo:10', src: unchanged() });
    await waitFor(() => expect(result.current.lastGame.size).toBe(0));
  });

  describe('asking a guest to sign in', () => {
    it('adds "Sign in to keep this." to the first toast of a guest, once, and not again within a week', async () => {
      const first = setup({ key: 'solo:5', nudge: true });
      await waitFor(() => expect(first.result.current.toasts.length).toBe(4));
      expect(first.result.current.toasts[0]!.extra).toBe('Sign in to keep this.');
      expect(first.history.nudgedAtMs()).toBe(1_000_000_000_000);
      first.unmount();
      const again = renderHook(() => useBadgeToasts({ source: source(), finishedKey: 'solo:6', seen: {}, markSeen: vi.fn(), nudge: true, history: first.history, now: () => 1_000_000_000_000 + 3 * 24 * 3_600_000 }));
      await waitFor(() => expect(again.result.current.toasts.length).toBe(4));
      expect(again.result.current.toasts[0]!.extra).toBeUndefined();
    });

    it('asks again after a week', async () => {
      const history = createLocalHistory();
      history.setNudgedAtMs(1_000_000_000_000);
      const hook = renderHook(() => useBadgeToasts({ source: source(), finishedKey: 'solo:7', seen: {}, markSeen: vi.fn(), nudge: true, history, now: () => 1_000_000_000_000 + 8 * 24 * 3_600_000 }));
      await waitFor(() => expect(hook.result.current.toasts.length).toBe(4));
      expect(hook.result.current.toasts[0]!.extra).toBe('Sign in to keep this.');
    });

    it('never asks a signed-in player, or a guest where signing in is not available', async () => {
      const { result } = setup({ key: 'solo:8', nudge: false });
      await waitFor(() => expect(result.current.toasts.length).toBe(4));
      expect(result.current.toasts.every((t) => t.extra === undefined)).toBe(true);
    });
  });
});
