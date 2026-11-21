import { buildDeck, createStartedGameState, shuffle } from '@upndown/engine';
import { defaultSolitaireSettings, type GameState } from '@upndown/shared-types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSolitaireResult } from './useSolitaireResult.js';
import { createLocalHistory } from './profile/local-history.js';
import { createOutbox } from './profile/outbox.js';

const playing = (): GameState => createStartedGameState({
  gameId: 'SOLITAIRE', hostId: 'solo-player', players: [{ id: 'solo-player', name: 'You', color: 'cyan' }],
  settings: defaultSolitaireSettings, isSolitaire: true, deck: shuffle(buildDeck(defaultSolitaireSettings))
});
const won = (): GameState => {
  const state = structuredClone(playing());
  state.drawPile = [];
  state.players[0]!.hand = [];
  state.gamePhase = 'won';
  state.statistics.startedAtMs = Date.now() - 600_000;
  state.statistics.endedAtMs = Date.now();
  state.statistics.players['solo-player'] = { cardsPlayed: 98, totalMovement: 300, specialPlays: 2, nasCheatsUsed: 0, skipsUsed: 0, tradesUsed: 0, lookupsUsed: 0, hintsUsed: 0, automarksUsed: 0, undosUsed: 0, marksPlaced: 0 };
  return state;
};
const lost = (): GameState => ({ ...won(), gamePhase: 'lost', drawPile: playing().drawPile.slice(0, 30) , statistics: { ...won().statistics, players: { 'solo-player': { cardsPlayed: 68, totalMovement: 200, specialPlays: 1, nasCheatsUsed: 0, skipsUsed: 0, tradesUsed: 0, lookupsUsed: 0, hintsUsed: 0, automarksUsed: 0, undosUsed: 0, marksPlaced: 0 } } } });

type Props = { active: boolean; state: GameState; runId: string; signedIn: boolean; guest?: boolean; userId?: string | null; history?: ReturnType<typeof createLocalHistory> };
const render = (initial: Props) => renderHook((p: Props) => useSolitaireResult(p), { initialProps: initial });

describe('useSolitaireResult', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(async () => new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => vi.unstubAllGlobals());
  const posts = () => fetchMock.mock.calls.filter(([url]) => url === '/api/me/solitaire-results');
  const bodyOf = (n: number) => JSON.parse((posts()[n]![1] as RequestInit).body as string);

  it('saves a signed-in player\'s win once, and reports that it was saved', async () => {
    const { result } = render({ active: true, state: won(), runId: 'run-a', signedIn: true });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(posts()).toHaveLength(1);
    expect(bodyOf(0)).toMatchObject({ gameId: 'run-a', outcome: 'won', cardsLeft: 0 });
  });

  it('saves a loss the same way', async () => {
    const { result } = render({ active: true, state: lost(), runId: 'run-b', signedIn: true });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(bodyOf(0)).toMatchObject({ outcome: 'lost' });
    expect(bodyOf(0).cardsLeft).toBeGreaterThan(0);
  });

  // Solitaire has to work with no connection. A guest has nothing to save to, so a guest must not even try.
  it.each([['a guest', false], ['a player whose sign-in is not known', false]])('makes no request at all for %s', async (_who, signedIn) => {
    const { result } = render({ active: true, state: won(), runId: 'run-c', signedIn });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('makes no request while the game is being played, or after it was ended on purpose', async () => {
    const { rerender } = render({ active: true, state: playing(), runId: 'run-d', signedIn: true });
    rerender({ active: true, state: playing(), runId: 'run-d', signedIn: true });
    rerender({ active: false, state: playing(), runId: 'run-d', signedIn: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not save a finished game that is no longer the active one', async () => {
    render({ active: false, state: won(), runId: 'run-e', signedIn: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saves a game once however many times the screen redraws', async () => {
    const state = won();
    const { rerender, result } = render({ active: true, state, runId: 'run-f', signedIn: true });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    for (let i = 0; i < 4; i += 1) rerender({ active: true, state: { ...state }, runId: 'run-f', signedIn: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(posts()).toHaveLength(1);
  });

  it('waits for the sign-in to be known, then saves', async () => {
    const state = won();
    const { rerender, result } = render({ active: true, state, runId: 'run-g', signedIn: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts()).toHaveLength(0);
    rerender({ active: true, state, runId: 'run-g', signedIn: true });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(posts()).toHaveLength(1);
  });

  it('reports a failure, and a retry sends the very same game, so it cannot be counted twice', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 500 }));
    const { result } = render({ active: true, state: won(), runId: 'run-h', signedIn: true });
    await waitFor(() => expect(result.current.status).toBe('failed'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(posts()).toHaveLength(2);
    expect(bodyOf(1)).toEqual(bodyOf(0));
  });

  it('reports a failure with no connection, without throwing', async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    const { result } = render({ active: true, state: won(), runId: 'run-i', signedIn: true });
    await waitFor(() => expect(result.current.status).toBe('failed'));
  });

  it('starts clean for the next game, and saves that one too', async () => {
    const { rerender, result } = render({ active: true, state: won(), runId: 'run-j1', signedIn: true });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    rerender({ active: true, state: playing(), runId: 'run-j2', signedIn: true });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    rerender({ active: true, state: won(), runId: 'run-j2', signedIn: true });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(posts().map((_, n) => bodyOf(n).gameId)).toEqual(['run-j1', 'run-j2']);
  });

  it('ignores a late answer for a game that is over, so it cannot mark the next one saved', async () => {
    let release: (r: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    const { rerender, result } = render({ active: true, state: won(), runId: 'run-k1', signedIn: true });
    await waitFor(() => expect(result.current.status).toBe('saving'));
    rerender({ active: true, state: playing(), runId: 'run-k2', signedIn: true });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    release(new Response('{}', { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.status).toBe('idle');
  });

  describe('on this device and offline', () => {
    beforeEach(() => { window.localStorage.clear(); });

    it('keeps a guest\'s finished game on the device and makes no request', async () => {
      const history = createLocalHistory();
      const { result } = render({ active: true, state: won(), runId: 'run-g1', signedIn: false, guest: true, history });
      await waitFor(() => expect(result.current.status).toBe('local'));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(history.load().rows).toMatchObject([{ gameId: 'run-g1', mode: 'solitaire', outcome: 'won' }]);
    });

    it('keeps a game once however many times the screen redraws, for a guest', async () => {
      const history = createLocalHistory();
      const state = won();
      const { rerender, result } = render({ active: true, state, runId: 'run-g2', signedIn: false, guest: true, history });
      await waitFor(() => expect(result.current.status).toBe('local'));
      for (let i = 0; i < 3; i += 1) rerender({ active: true, state: { ...state }, runId: 'run-g2', signedIn: false, guest: true, history });
      expect(history.load().rows).toHaveLength(1);
    });

    it('queues a signed-in game when there is no connection, keeps playing, and sends it when the connection returns', async () => {
      let online = false;
      fetchMock.mockImplementation(async () => { if (!online) throw new TypeError('Failed to fetch'); return new Response('{}', { status: 200 }); });
      const { result } = render({ active: true, state: won(), runId: 'run-q1', signedIn: true, userId: 'user-1' });
      await waitFor(() => expect(result.current.status).toBe('queued'));
      expect(createOutbox('user-1').pending().map((p) => p.gameId)).toEqual(['run-q1']);
      online = true;
      window.dispatchEvent(new Event('online'));
      await waitFor(() => expect(createOutbox('user-1').pending()).toEqual([]));
    });

    it('drops a game the server refused for good, and says so', async () => {
      fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 400 }));
      const { result } = render({ active: true, state: won(), runId: 'run-q2', signedIn: true, userId: 'user-1' });
      await waitFor(() => expect(result.current.status).toBe('failed'));
      expect(createOutbox('user-1').pending()).toEqual([]);
    });

    it('keeps a throttled game for later instead of dropping it', async () => {
      fetchMock.mockImplementation(async () => new Response('{}', { status: 429 }));
      const { result } = render({ active: true, state: won(), runId: 'run-q3', signedIn: true, userId: 'user-1' });
      await waitFor(() => expect(result.current.status).toBe('queued'));
      expect(createOutbox('user-1').pending()).toHaveLength(1);
    });
  });
});
