import { buildDeck, createStartedGameState, shuffle } from '@upndown/engine';
import { defaultSolitaireSettings, type GameState } from '@upndown/shared-types';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { listSolitaireSaves, writeSolitaireSave } from './solitaire-save.js';

vi.mock('socket.io-client', () => {
  const socket = { connected: false, id: 'socket-1', on: () => socket, off: () => socket, connect: () => socket, disconnect: () => socket, emit: () => socket };
  return { io: () => socket };
});

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// One card from winning: the player holds a 2, the draw pile is empty, and 97 cards are already down.
function oneCardFromWinning(): GameState {
  const state = structuredClone(createStartedGameState({
    gameId: 'SOLITAIRE', hostId: 'solo-player', players: [{ id: 'solo-player', name: 'You', color: 'cyan' }],
    settings: defaultSolitaireSettings, isSolitaire: true, deck: shuffle(buildDeck(defaultSolitaireSettings))
  }));
  state.drawPile = [];
  state.players[0]!.hand = [{ id: 'c-2', value: 2 }];
  state.statistics.startedAtMs = Date.now() - 600_000;
  state.statistics.players['solo-player'] = { cardsPlayed: 97, totalMovement: 400, specialPlays: 3, nasCheatsUsed: 0, skipsUsed: 0, tradesUsed: 0, lookupsUsed: 0, hintsUsed: 0, undosUsed: 0, marksPlaced: 0 };
  return state;
}

type Call = { url: string; method: string; body?: Record<string, unknown> };

// A network with the sign-in endpoints and the result endpoint, recording every request the page makes.
function network(opts: { signedIn: boolean; results?: Array<() => Response> }): Call[] {
  const calls: Call[] = [];
  const results = [...(opts.results ?? [])];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(init.body as string) as Record<string, unknown> } : {}) });
    if (url === '/api/auth/config') return json({ enabled: true, providers: ['google'] });
    if (url === '/api/me') return opts.signedIn ? json({ playerName: 'Pat Quincy', nameConfirmed: true, settings: { playerName: 'Pat Quincy' } }) : json({}, 401);
    if (url === '/api/me/settings') return json({ settings: {} });
    if (url === '/api/me/solitaire-results') return (results.shift() ?? (() => json({ outcome: 'inserted' })))();
    throw new Error(`unexpected request ${url}`);
  }));
  return calls;
}
const resultCalls = (calls: Call[]) => calls.filter((c) => c.url === '/api/me/solitaire-results');

async function resumeAndWin(user: ReturnType<typeof userEvent.setup>) {
  writeSolitaireSave(oneCardFromWinning(), [], Date.now(), 'saved-run-1');
  render(<App />);
  await user.click(await screen.findByTestId('continue-solitaire'));
  await user.click(await screen.findByTestId('hand-card-c-2'));
  await user.click(screen.getByTestId('pile-0'));
}

describe('saving a solitaire result', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('sends a signed-in player\'s win to the server, under the id the game started with, and says it was saved', async () => {
    const calls = network({ signedIn: true });
    const user = userEvent.setup();
    await resumeAndWin(user);
    expect(await screen.findByText('Saved to your history.')).toBeTruthy();
    const sent = resultCalls(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: 'POST', body: { gameId: 'saved-run-1', outcome: 'won', cardsLeft: 0, cardsTotal: 98, cardsPlayed: 98 } });
  });

  it('offers a retry when saving fails, and the retry is the same game, so it counts once', async () => {
    const calls = network({ signedIn: true, results: [() => json({}, 500)] });
    const user = userEvent.setup();
    await resumeAndWin(user);
    expect(await screen.findByText(/Could not save this game to your history/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Saved to your history.')).toBeTruthy();
    const sent = resultCalls(calls);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body).toEqual(sent[0]!.body);
  });

  it('asks nothing of the server for a guest, and shows no save message', async () => {
    const calls = network({ signedIn: false });
    const user = userEvent.setup();
    await resumeAndWin(user);
    expect((await screen.findAllByText('Game Won')).length).toBeGreaterThan(0);
    expect(resultCalls(calls)).toHaveLength(0);
    expect(screen.queryByText(/your history/)).toBeNull();
  });

  it('sends nothing when a signed-in player ends the game on purpose', async () => {
    const calls = network({ signedIn: true });
    const user = userEvent.setup();
    writeSolitaireSave(oneCardFromWinning(), [], Date.now(), 'saved-run-2');
    render(<App />);
    await user.click(await screen.findByTestId('continue-solitaire'));
    await user.click(await screen.findByTestId('end-game-top'));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(resultCalls(calls)).toHaveLength(0);
  });

  it('keeps the same id for a game across a reload, so a result sent afterwards is the same game', async () => {
    network({ signedIn: false });
    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(await screen.findByTestId('mode-solitaire'));
    await user.click(await screen.findByTestId('start-solitaire'));
    await user.click(screen.getAllByTestId(/hand-card-/)[0]!);
    await user.click(screen.getByTestId('pile-0'));
    const id = listSolitaireSaves()[0]!.runId;
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    first.unmount();

    render(<App />);
    await user.click(await screen.findByTestId('continue-solitaire'));
    await user.click(screen.getAllByTestId(/hand-card-/)[0]!);
    await user.click(screen.getByTestId('pile-1'));
    await waitFor(() => expect(listSolitaireSaves()[0]!.state.statistics.players['solo-player']!.cardsPlayed).toBeGreaterThan(1));
    expect(listSolitaireSaves()[0]!.runId).toBe(id);
  });

  it('gives a new game a new id', async () => {
    network({ signedIn: false });
    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(await screen.findByTestId('mode-solitaire'));
    await user.click(await screen.findByTestId('start-solitaire'));
    await user.click(screen.getAllByTestId(/hand-card-/)[0]!);
    await user.click(screen.getByTestId('pile-0'));
    const one = listSolitaireSaves()[0]!.runId;
    first.unmount();
    window.localStorage.clear();

    render(<App />);
    await user.click(await screen.findByTestId('mode-solitaire'));
    await user.click(await screen.findByTestId('start-solitaire'));
    await user.click(screen.getAllByTestId(/hand-card-/)[0]!);
    await user.click(screen.getByTestId('pile-0'));
    expect(listSolitaireSaves()[0]!.runId).not.toBe(one);
  });
});

// The point of keeping solitaire off the server: it is the same game with no connection at all, which is also what a
// native app will have. Everything the page asks of the server while solitaire is played is counted here.
describe('solitaire with no connection', () => {
  beforeEach(() => { window.localStorage.clear(); window.history.replaceState(null, '', '/'); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('plays, saves, resumes and finishes a game with the network completely down, asking for nothing but the page\'s own sign-in check', async () => {
    const attempted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { attempted.push(url); throw new TypeError('Failed to fetch'); }));
    const user = userEvent.setup();

    writeSolitaireSave(oneCardFromWinning(), [], Date.now(), 'offline-run');
    render(<App />);
    expect((await screen.findByTestId('continue-solitaire')).textContent).toBeTruthy();
    await user.click(screen.getByTestId('continue-solitaire'));
    await user.click(await screen.findByTestId('hand-card-c-2'));
    await user.click(screen.getByTestId('pile-0'));
    expect((await screen.findAllByText('Game Won')).length).toBeGreaterThan(0);

    expect(attempted.every((url) => url === '/api/auth/config')).toBe(true);
    expect(screen.queryByText(/your history/)).toBeNull();
  });

  it('a fresh game with no connection is fully playable and saved, with no request beyond the sign-in check', async () => {
    const attempted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { attempted.push(url); throw new TypeError('Failed to fetch'); }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('mode-solitaire'));
    await user.click(await screen.findByTestId('start-solitaire'));
    for (let i = 0; i < 3; i += 1) {
      await user.click(screen.getAllByTestId(/hand-card-/)[0]!);
      await user.click(screen.getByTestId('pile-0'));
    }
    expect(listSolitaireSaves()[0] ?? null).not.toBeNull();
    expect(attempted.every((url) => url === '/api/auth/config')).toBe(true);
  });

  // Signed in, then the connection drops mid-game: the result cannot be sent, and the game is not harmed.
  it('keeps a finished game intact when it cannot be sent, and says so', async () => {
    const network = { online: true };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!network.online) throw new TypeError('Failed to fetch');
      if (url === '/api/auth/config') return json({ enabled: true, providers: ['google'] });
      if (url === '/api/me') return json({ playerName: 'Pat Quincy', nameConfirmed: true, settings: { playerName: 'Pat Quincy' } });
      return json({ settings: {} });
    }));
    const user = userEvent.setup();
    writeSolitaireSave(oneCardFromWinning(), [], Date.now(), 'dropped-run');
    render(<App />);
    await user.click(await screen.findByTestId('continue-solitaire'));
    network.online = false;
    await user.click(await screen.findByTestId('hand-card-c-2'));
    await user.click(screen.getByTestId('pile-0'));
    expect((await screen.findAllByText('Game Won')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Could not save this game to your history/)).toBeTruthy();
    expect(listSolitaireSaves()[0] ?? null).toBeNull(); // a finished game is not offered for resuming
  });
});
