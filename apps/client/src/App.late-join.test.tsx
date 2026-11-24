import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheatLimits, GameState } from '@upndown/shared-types';

import { App } from './App.js';

type Ack = (response: { ok: boolean; data?: unknown; error?: string; gone?: boolean }) => void;
type Listener = (...args: unknown[]) => void;

const mock = vi.hoisted(() => {
  const handlers: Record<string, Set<Listener>> = {};
  const state = {
    connected: false,
    id: 'socket-1',
    onEmit: (_event: string, _payload: unknown, ack?: Ack): void => { ack?.({ ok: false, error: 'unhandled' }); }
  };
  const socket = {
    get connected() { return state.connected; },
    get id() { return state.id; },
    on(event: string, cb: Listener) { (handlers[event] ??= new Set()).add(cb); return socket; },
    off(event: string, cb: Listener) { handlers[event]?.delete(cb); return socket; },
    connect() { state.connected = true; handlers.connect?.forEach((cb) => cb()); return socket; },
    disconnect() { state.connected = false; return socket; },
    emit(event: string, payload: unknown, ack?: Ack) { state.onEmit(event, payload, ack); return socket; }
  };
  const serverEmit = (event: string, ...args: unknown[]): void => { handlers[event]?.forEach((cb) => cb(...args)); };
  return { socket, state, serverEmit };
});

vi.mock('socket.io-client', () => ({ io: () => mock.socket }));

const settings = {
  minCardValue: 2, maxCardValue: 99, handSize: 7, minPlayers: 2, maxPlayers: 6, minCardsPerTurn: 2,
  autoRefillHand: false, allowUndo: false, privateGame: false, allowCardLookup: false
};
const stat = { cardsPlayed: 0, totalMovement: 0, specialPlays: 0, nasCheatsUsed: 0, skipsUsed: 0, tradesUsed: 0, lookupsUsed: 0, nasChecksUsed: 0, montyUsed: 0, hintsUsed: 0, undosUsed: 0, marksPlaced: 0, lifelines: 0, markFollows: 0 };

function playing(limits: CheatLimits = { lookup: 'unlimited', skip: 'once', trade: 'once', hint: 'off' }, used: Partial<Record<'skipsUsed' | 'tradesUsed' | 'lookupsUsed', number>> = {}): GameState {
  return {
    gameId: 'ABC123',
    hostId: 'socket-1',
    players: [
      { id: 'socket-1', name: 'Alex', hand: [{ id: 'c-21', value: 21 }], isHost: true },
      { id: 'socket-2', name: 'Ann', hand: [{ id: 'c-34', value: 34 }], isHost: false }
    ],
    foundationPiles: [
      { id: 0, type: 'ascending', topCard: { id: 'p0', value: 1 } },
      { id: 1, type: 'ascending', topCard: { id: 'p1', value: 1 } },
      { id: 2, type: 'descending', topCard: { id: 'p2', value: 100 } },
      { id: 3, type: 'descending', topCard: { id: 'p3', value: 100 } }
    ],
    drawPile: [{ id: 'c-55', value: 55 }],
    currentPlayerIndex: 0,
    gamePhase: 'playing',
    cardsPlayedThisTurn: 0,
    statistics: { turns: 1, startedAtMs: Date.now(), endedAtMs: null, players: { 'socket-1': { ...stat, ...used }, 'socket-2': stat } },
    nasCheat: { enabledPlayerIds: [], usedThisTurnByPlayerId: { 'socket-1': false, 'socket-2': false } },
    settings: { ...settings, cheatLimits: limits },
    isSolitaire: false
  };
}


async function hostGame(state: GameState, onEmit?: (event: string, payload: unknown, ack?: Ack) => boolean) {
  mock.state.onEmit = (event, payload, ack) => {
    if (onEmit?.(event, payload, ack)) return;
    if (event === 'game:create') ack?.({ ok: true, data: { gameState: state, playerId: 'socket-1', rejoinToken: 'tok' } });
    else if (event === 'game:listJoinable') ack?.({ ok: true, data: { games: [] } });
    else ack?.({ ok: false, error: `Unhandled event: ${event}` });
  };
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByTestId('mode-multiplayer'));
  await user.type(screen.getByLabelText('Player Name'), 'Alex');
  await user.click(screen.getByTestId('flow-host'));
  expect(await screen.findByTestId('end-game-top')).toBeTruthy();
  return user;
}


const NAME_KEY = 'upndown.multiplayer.playerName.v1';
const TOKEN = 'inv-0123456789abcdefghij';

describe('App: joining a game in progress by invitation', () => {
  beforeEach(() => {
    mock.socket.disconnect();
    mock.state.id = 'socket-1';
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('lets the host make an invitation link that carries the game and the single-use token', async () => {
    const user = await hostGame(playing(), (event, _payload, ack) => {
      if (event !== 'game:createInvite') return false;
      ack?.({ ok: true, data: { token: TOKEN, expiresAtMs: Date.now() + 30 * 60_000 } });
      return true;
    });
    await user.click(screen.getByTestId('invite-late'));
    const link = (await screen.findByTestId('invite-late-link') as HTMLInputElement).value;
    const url = new URL(link);
    expect(url.searchParams.get('game')).toBe('ABC123');
    expect(url.searchParams.get('invite')).toBe(TOKEN);
    expect(screen.getByText(/It works once/)).toBeTruthy();
  });

  it('asks the host before anyone joins, and sends the answer', async () => {
    const answers: unknown[] = [];
    const user = await hostGame(playing(), (event, payload, ack) => {
      if (event !== 'game:resolveJoin') return false;
      answers.push(payload);
      ack?.({ ok: true, data: { gameState: playing() } });
      return true;
    });
    act(() => mock.serverEmit('game:joinRequest', { requestId: 'r1', playerName: 'Nia' }));
    expect(await screen.findByRole('dialog', { name: 'someone wants to join' })).toBeTruthy();
    expect(screen.getByText('Nia wants to join')).toBeTruthy();
    await user.click(screen.getByTestId('accept-join'));
    await waitFor(() => expect(answers).toEqual([{ gameId: 'ABC123', requestId: 'r1', approve: true }]));
    expect(screen.queryByRole('dialog', { name: 'someone wants to join' })).toBeNull();

    act(() => mock.serverEmit('game:joinRequest', { requestId: 'r2', playerName: 'Omar' }));
    await user.click(await screen.findByTestId('decline-join'));
    await waitFor(() => expect(answers).toHaveLength(2));
    expect(answers[1]).toEqual({ gameId: 'ABC123', requestId: 'r2', approve: false });
  });

  it('takes the question away when the person gives up', async () => {
    await hostGame(playing());
    act(() => mock.serverEmit('game:joinRequest', { requestId: 'r1', playerName: 'Nia' }));
    expect(await screen.findByTestId('accept-join')).toBeTruthy();
    act(() => mock.serverEmit('game:joinRequestCancelled', { requestId: 'r1' }));
    await waitFor(() => expect(screen.queryByTestId('accept-join')).toBeNull());
  });

  it('shows no invite button to a player who is not the host', async () => {
    const guestView: GameState = { ...playing(), hostId: 'socket-2' };
    await hostGame(guestView);
    expect(screen.queryByTestId('invite-late')).toBeNull();
    act(() => mock.serverEmit('game:joinRequest', { requestId: 'r1', playerName: 'Nia' }));
    expect(screen.queryByTestId('accept-join')).toBeNull();
  });

  describe('the person invited', () => {
    const sent: Array<[string, unknown]> = [];
    const open = (name: string | null = 'Alex') => {
      sent.length = 0;
      window.history.replaceState(null, '', `/?game=ABC123&invite=${TOKEN}`);
      if (name) window.localStorage.setItem(NAME_KEY, name);
      mock.state.id = 'socket-9';
      mock.state.onEmit = (event, payload, ack) => {
        sent.push([event, payload]);
        if (event === 'game:requestJoin') ack?.({ ok: true, data: { requestId: 'r1' } });
        else if (event === 'game:listJoinable') ack?.({ ok: true, data: { games: [] } });
        else ack?.({ ok: false, error: `Unhandled event: ${event}` });
      };
      return render(<App />);
    };

    it('asks to join with the invitation instead of joining a lobby, and waits for the host', async () => {
      open();
      await waitFor(() => expect(sent.some(([event]) => event === 'game:requestJoin')).toBe(true));
      expect(sent.find(([event]) => event === 'game:requestJoin')![1]).toEqual({ gameId: 'ABC123', inviteToken: TOKEN, playerName: 'Alex' });
      expect(sent.some(([event]) => event === 'game:join')).toBe(false);
      expect((await screen.findByTestId('join-waiting')).textContent).toContain('Asking the host');
    });

    it('opens the game when the host says yes, and takes the used invitation out of the address', async () => {
      open();
      await screen.findByTestId('join-waiting');
      act(() => mock.serverEmit('game:joinResolved', { approved: true, gameState: playing(), playerId: 'socket-9', rejoinToken: 'tok-new' }));
      expect(await screen.findByTestId('end-game-top')).toBeTruthy();
      expect(screen.queryByTestId('join-waiting')).toBeNull();
      expect(window.location.search).not.toContain('invite=');
    });

    it('says so when the host says no, and stops waiting', async () => {
      open();
      await screen.findByTestId('join-waiting');
      act(() => mock.serverEmit('game:joinResolved', { approved: false, reason: 'The host said no.' }));
      expect(await screen.findByText('The host said no.')).toBeTruthy();
      expect(screen.queryByTestId('join-waiting')).toBeNull();
    });
  });
});
