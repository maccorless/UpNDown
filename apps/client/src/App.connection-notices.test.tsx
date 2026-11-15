import { act, render, screen, within } from '@testing-library/react';
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
const stat = { cardsPlayed: 0, totalMovement: 0, specialPlays: 0, nasCheatsUsed: 0 };

function playing(reconnection?: GameState['reconnection']): GameState {
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
    isSolitaire: false,
    ...(reconnection ? { reconnection } : {})
  };
}

async function hostGame(rejoin?: Ack extends never ? never : (payload: unknown, ack?: Ack) => void) {
  mock.state.onEmit = (event, payload, ack) => {
    if (event === 'game:create') ack?.({ ok: true, data: { gameState: playing(), playerId: 'socket-1', rejoinToken: 'tok' } });
    else if (event === 'game:listJoinable') ack?.({ ok: true, data: { games: [] } });
    else if (event === 'game:rejoin' && rejoin) rejoin(payload, ack);
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

describe('App: dropped connections in a multiplayer game', () => {
  beforeEach(() => {
    mock.socket.disconnect();
    mock.state.id = 'socket-1';
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('tells a connected player who dropped, from the server update, and the host may remove them after 90 seconds', async () => {
    const user = await hostGame();
    expect(screen.queryByText(/has lost their connection/)).toBeNull();

    act(() => mock.serverEmit('game:updated', playing({ lost: [{ playerId: 'socket-2', name: 'Ann', status: 'reconnecting' }], canKick: [], canTakeOver: null })));
    expect(screen.getByText('Ann has lost their connection. Trying to reconnect...')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Kick Ann' })).toBeNull();

    const kicks: unknown[] = [];
    const previous = mock.state.onEmit;
    mock.state.onEmit = (event, payload, ack) => {
      if (event === 'game:kickPlayer') { kicks.push(payload); ack?.({ ok: true, data: { gameState: playing() } }); return; }
      previous(event, payload, ack);
    };
    act(() => mock.serverEmit('game:updated', playing({ lost: [{ playerId: 'socket-2', name: 'Ann', status: 'lost' }], canKick: ['socket-2'], canTakeOver: null })));
    await user.click(screen.getByRole('button', { name: 'Kick Ann' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove Ann' }));
    expect(kicks).toHaveLength(1);
    expect(kicks[0]).toEqual({ gameId: 'ABC123', targetPlayerId: 'socket-2' });
  });

  it('removes the notice when the server says the player is back', async () => {
    await hostGame();
    act(() => mock.serverEmit('game:updated', playing({ lost: [{ playerId: 'socket-2', name: 'Ann', status: 'reconnecting' }], canKick: [], canTakeOver: null })));
    expect(screen.getByText(/Ann has lost their connection/)).toBeTruthy();
    act(() => mock.serverEmit('game:updated', playing()));
    expect(screen.queryByText(/has lost their connection/)).toBeNull();
  });

  it('says plainly that the player was removed while away when the server refuses the rejoin', async () => {
    await hostGame((_payload, ack) => ack?.({ ok: false, error: 'Unable to rejoin game', gone: true }));
    mock.state.id = 'socket-9';
    act(() => mock.serverEmit('connect'));
    expect(await screen.findByText('You were removed from game ABC123 while you were disconnected.')).toBeTruthy();
    expect(screen.queryByTestId('end-game-top')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /OK|Close|Back|Got it/i }));
    expect(screen.queryByText(/while you were disconnected/)).toBeNull();
  });

  // A refusal without `gone` may pass (a rate limit): the board stays and the player is told to reload, not told they were removed.
  it('does not claim the player was removed when the refusal is temporary', async () => {
    await hostGame((_payload, ack) => ack?.({ ok: false, error: 'Too many rejoin attempts. Please wait a moment and try again.' }));
    mock.state.id = 'socket-9';
    act(() => mock.serverEmit('connect'));
    expect(await screen.findByText(/Could not rejoin your game yet/)).toBeTruthy();
    expect(screen.queryByText(/removed from game/)).toBeNull();
    expect(screen.getByTestId('end-game-top')).toBeTruthy();
  });

  it('keeps the seat in this browser while a game is being played, and forgets it when the game is left or over', async () => {
    await hostGame();
    const saved = JSON.parse(window.localStorage.getItem('upndown.seat') ?? 'null') as Record<string, unknown> | null;
    expect(saved).toMatchObject({ gameId: 'ABC123', playerId: 'socket-1', rejoinToken: 'tok' });
    act(() => mock.serverEmit('game:updated', { ...playing(), gamePhase: 'won' }));
    expect(window.localStorage.getItem('upndown.seat')).toBeNull();
  });

  it('takes the seat back on its own when the page is opened again after the tab was closed', async () => {
    window.localStorage.setItem('upndown.seat', JSON.stringify({ gameId: 'ABC123', playerId: 'old-socket', rejoinToken: 'tok-old', savedAtMs: Date.now() }));
    const asked: unknown[] = [];
    mock.state.id = 'socket-new';
    mock.state.onEmit = (event, payload, ack) => {
      if (event === 'game:rejoin') { asked.push(payload); ack?.({ ok: true, data: { gameState: playing(), playerId: 'socket-new', rejoinToken: 'tok-new' } }); } else ack?.({ ok: false, error: 'unhandled' });
    };
    render(<App />);
    expect(await screen.findByTestId('end-game-top')).toBeTruthy();
    expect(asked).toEqual([{ gameId: 'ABC123', previousPlayerId: 'old-socket', rejoinToken: 'tok-old' }]);
  });

  it('drops a saved seat the server no longer has, and says so', async () => {
    window.localStorage.setItem('upndown.seat', JSON.stringify({ gameId: 'ABC123', playerId: 'old-socket', rejoinToken: 'tok-old', savedAtMs: Date.now() }));
    mock.state.id = 'socket-new';
    mock.state.onEmit = (_event, _payload, ack) => ack?.({ ok: false, error: 'Unable to rejoin game', gone: true });
    render(<App />);
    expect(await screen.findByText('You were removed from game ABC123 while you were disconnected.')).toBeTruthy();
    expect(window.localStorage.getItem('upndown.seat')).toBeNull();
  });

  it('puts a signed-in player back in a game they still hold when they open multiplayer with nothing saved', async () => {
    const asked: string[] = [];
    mock.state.onEmit = (event, _payload, ack) => {
      asked.push(event);
      if (event === 'game:rejoinMine') ack?.({ ok: true, data: { gameState: playing(), playerId: 'socket-1', rejoinToken: 'tok-mine' } });
      else if (event === 'game:listJoinable') ack?.({ ok: true, data: { games: [] } });
      else ack?.({ ok: false, error: 'unhandled' });
    };
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('mode-multiplayer'));
    expect(await screen.findByTestId('end-game-top')).toBeTruthy();
    expect(asked).toContain('game:rejoinMine');
  });

  it('shows nothing when there is no seat to take back', async () => {
    mock.state.onEmit = (event, _payload, ack) => {
      if (event === 'game:rejoinMine') ack?.({ ok: false, error: 'Unable to rejoin game', gone: true });
      else if (event === 'game:listJoinable') ack?.({ ok: true, data: { games: [] } });
      else ack?.({ ok: false, error: 'unhandled' });
    };
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('mode-multiplayer'));
    await screen.findByLabelText('Player Name');
    expect(screen.queryByText(/removed from game/)).toBeNull();
    expect(screen.queryByTestId('end-game-top')).toBeNull();
  });
});
