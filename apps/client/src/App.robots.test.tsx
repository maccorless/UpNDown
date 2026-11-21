import { render, screen, waitFor } from '@testing-library/react';
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
const stat = { cardsPlayed: 0, totalMovement: 0, specialPlays: 0, nasCheatsUsed: 0, skipsUsed: 0, tradesUsed: 0, lookupsUsed: 0, hintsUsed: 0, undosUsed: 0, marksPlaced: 0 };

function lobbyOf(limits: CheatLimits = { lookup: 'unlimited', skip: 'once', trade: 'once', hint: 'off' }, used: Partial<Record<'skipsUsed' | 'tradesUsed' | 'lookupsUsed', number>> = {}): GameState {
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



const lobby = (players: Array<{ id: string; name: string; robot?: boolean; isHost?: boolean }>, over: Partial<GameState['settings']> = {}): GameState => ({
  ...lobbyOf(),
  gamePhase: 'lobby',
  hostId: 'socket-1',
  players: players.map((p) => ({ id: p.id, name: p.name, hand: [], isHost: p.isHost ?? false, ...(p.robot ? { robot: true } : {}) })),
  settings: { ...settings, ...over }
});

async function enterLobby(state: GameState, onEmit?: (event: string, payload: unknown, ack?: Ack) => boolean) {
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
  return user;
}

describe('App: robots in the lobby', () => {
  beforeEach(() => {
    mock.socket.disconnect();
    mock.state.id = 'socket-1';
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('lets the host add a robot, and shows it as a robot with its own remove button', async () => {
    const sent: unknown[] = [];
    const withBot = lobby([{ id: 'socket-1', name: 'Alex', isHost: true }, { id: 'bot-1', name: 'Robot 1', robot: true }]);
    const user = await enterLobby(lobby([{ id: 'socket-1', name: 'Alex', isHost: true }]), (event, payload, ack) => {
      if (event !== 'game:addRobot') return false;
      sent.push(payload);
      ack?.({ ok: true, data: { gameState: withBot } });
      return true;
    });
    await user.click(await screen.findByTestId('add-robot'));
    await waitFor(() => expect(sent).toEqual([{ gameId: 'ABC123' }]));
    await waitFor(() => expect(document.querySelector('.players-list')!.textContent).toContain('Robot 1 [Robot]'));
    expect(screen.getByTestId('kick-bot-1')).toBeTruthy();
  });

  it('removes a robot with the robot call, never the kick call', async () => {
    const sent: Array<[string, unknown]> = [];
    const user = await enterLobby(lobby([{ id: 'socket-1', name: 'Alex', isHost: true }, { id: 'bot-1', name: 'Robot 1', robot: true }]), (event, payload, ack) => {
      if (event !== 'game:removeRobot' && event !== 'game:kickPlayer') return false;
      sent.push([event, payload]);
      ack?.({ ok: true, data: { gameState: lobby([{ id: 'socket-1', name: 'Alex', isHost: true }]) } });
      return true;
    });
    await user.click(await screen.findByTestId('kick-bot-1'));
    await waitFor(() => expect(sent).toEqual([['game:removeRobot', { gameId: 'ABC123', playerId: 'bot-1' }]]));
    await waitFor(() => expect(document.querySelector('.players-list')!.textContent).not.toContain('Robot 1'));
  });

  it('does not offer to add a robot to a table that is full', async () => {
    await enterLobby(lobby([{ id: 'socket-1', name: 'Alex', isHost: true }, { id: 'bot-1', name: 'Robot 1', robot: true }], { maxPlayers: 2 }));
    expect((await screen.findByTestId('add-robot') as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not offer robots to someone who is not the host', async () => {
    await enterLobby({ ...lobby([{ id: 'socket-1', name: 'Alex' }, { id: 'socket-2', name: 'Host', isHost: true }]), hostId: 'socket-2' });
    await screen.findByText(/Only host can start the game/);
    expect(screen.queryByTestId('add-robot')).toBeNull();
  });
});
