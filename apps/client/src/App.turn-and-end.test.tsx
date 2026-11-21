import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '@upndown/shared-types';

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
  autoRefillHand: false, allowUndo: false, privateGame: false, allowCardLookup: false, showArrows: true
};
const stat = { cardsPlayed: 0, totalMovement: 0, specialPlays: 0, nasCheatsUsed: 0, skipsUsed: 0, tradesUsed: 0, lookupsUsed: 0, hintsUsed: 0, undosUsed: 0, marksPlaced: 0 };

function playing(): GameState {
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
    statistics: { turns: 1, startedAtMs: Date.now(), endedAtMs: null, players: { 'socket-1': stat, 'socket-2': stat } },
    nasCheat: { enabledPlayerIds: [], usedThisTurnByPlayerId: { 'socket-1': false, 'socket-2': false } },
    settings,
    isSolitaire: false
  };
}


async function hostGame() {
  mock.state.onEmit = (event, _payload, ack) => {
    if (event === 'game:create') ack?.({ ok: true, data: { gameState: playing(), playerId: 'socket-1', rejoinToken: 'tok' } });
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


describe('App: a multiplayer turn and the end of a game', () => {
  beforeEach(() => {
    mock.socket.disconnect();
    mock.state.id = 'socket-1';
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  // Sound and a tab title are easy to miss: the board itself must say, in words, that the turn is yours and what it asks of you.
  it('says on the board that the turn is yours, and what it asks, and only while it is', async () => {
    await hostGame();
    expect(screen.getByTestId('your-turn-banner').textContent).toBe('Your turn: play at least 2 cards');
    act(() => mock.serverEmit('game:updated', { ...playing(), currentPlayerIndex: 1 }));
    expect(screen.queryByTestId('your-turn-banner')).toBeNull();
    act(() => mock.serverEmit('game:updated', { ...playing(), cardsPlayedThisTurn: 0, statistics: { ...playing().statistics, turns: 3 } }));
    expect(screen.getByTestId('your-turn-banner')).toBeTruthy();
  });

  // The game is over: there is nothing left to end, so the way on is the results (play again, back to the lobby), never End Game.
  it('offers no End Game once the game is won or lost, and the results can be brought back after closing them', async () => {
    const user = await hostGame();
    act(() => mock.serverEmit('game:updated', { ...playing(), gamePhase: 'won', drawPile: [], players: playing().players.map((p) => ({ ...p, hand: [] })) }));
    expect(screen.queryByTestId('end-game-top')).toBeNull();
    expect(screen.queryByTestId('your-turn-banner')).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    await user.click(screen.getByTestId('show-results'));
    expect(screen.getByRole('button', { name: 'Back to Lobby' })).toBeTruthy();
  });
});
