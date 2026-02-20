import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameSettings, GameState } from '@upndown/shared-types';

import { App } from './App.js';

type MockAck<T> = { ok: true; data: T } | { ok: false; error: string };
type EmitHandler = (event: string, payload: unknown, ack?: (response: MockAck<unknown>) => void) => void;

class MockSocket {
  connected = false;

  id = 'socket-1';

  private handlers: Record<string, Set<(...args: unknown[]) => void>> = {};

  on(event: string, callback: (...args: unknown[]) => void): this {
    if (!this.handlers[event]) {
      this.handlers[event] = new Set();
    }
    this.handlers[event]?.add(callback);
    return this;
  }

  off(event: string, callback: (...args: unknown[]) => void): this {
    this.handlers[event]?.delete(callback);
    return this;
  }

  connect(): this {
    this.connected = true;
    this.handlers.connect?.forEach((callback) => callback());
    return this;
  }

  disconnect(): this {
    this.connected = false;
    this.handlers.disconnect?.forEach((callback) => callback('client disconnect'));
    return this;
  }

  emit(event: string, payload: unknown, ack?: (response: MockAck<unknown>) => void): this {
    emitHandler(event, payload, ack);
    return this;
  }
}

const socket = new MockSocket();

let emitHandler: EmitHandler = (event, _payload, ack) => {
  if (event === 'game:listJoinable') {
    ack?.({ ok: true, data: { games: [] } });
    return;
  }
  ack?.({ ok: false, error: `Unhandled event: ${event}` });
};
let listJoinableCalls = 0;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => { window.setTimeout(resolve, ms); });

vi.mock('socket.io-client', () => ({
  io: () => socket
}));

const multiplayerSettings: GameSettings = {
  minCardValue: 2,
  maxCardValue: 99,
  handSize: 7,
  minPlayers: 2,
  maxPlayers: 6,
  minCardsPerTurn: 2,
  autoRefillHand: false,
  allowUndo: false,
  privateGame: false
};

function createLobbyState(): GameState {
  return {
    gameId: 'ABC123',
    hostId: 'socket-1',
    players: [{ id: 'socket-1', name: 'Alex', hand: [], isHost: true }],
    foundationPiles: [
      { id: 0, type: 'ascending', topCard: { id: 'p0', value: 1 } },
      { id: 1, type: 'ascending', topCard: { id: 'p1', value: 1 } },
      { id: 2, type: 'descending', topCard: { id: 'p2', value: 100 } },
      { id: 3, type: 'descending', topCard: { id: 'p3', value: 100 } }
    ],
    drawPile: [],
    currentPlayerIndex: 0,
    gamePhase: 'lobby',
    cardsPlayedThisTurn: 0,
    settings: multiplayerSettings,
    isSolitaire: false
  };
}

describe('multiplayer ack handling', () => {
  beforeEach(() => {
    socket.disconnect();
    listJoinableCalls = 0;
    emitHandler = (event, _payload, ack) => {
      if (event === 'game:listJoinable') {
        listJoinableCalls += 1;
        ack?.({ ok: true, data: { games: [] } });
        return;
      }
      ack?.({ ok: false, error: `Unhandled event: ${event}` });
    };
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('times out create-game ack and clears pending action', async () => {
    emitHandler = (event, _payload, ack) => {
      if (event === 'game:create') {
        return;
      }
      if (event === 'game:listJoinable') {
        ack?.({ ok: true, data: { games: [] } });
      }
    };

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTestId('mode-multiplayer'));
    await user.type(screen.getByLabelText('Player Name'), 'Alex');
    await user.click(screen.getByTestId('flow-host'));

    expect(screen.getByText('Hosting...')).toBeTruthy();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Request timed out. Please check your connection and try again.');
    expect(screen.getByTestId('flow-host').textContent).toContain('Host Game');
  });

  it('keeps multiplayer state when leave ack fails', async () => {
    const lobbyState = createLobbyState();
    emitHandler = (event, _payload, ack) => {
      if (event === 'game:create') {
        ack?.({ ok: true, data: { gameState: lobbyState, playerId: 'socket-1' } });
        return;
      }
      if (event === 'game:leave') {
        ack?.({ ok: false, error: 'Leave rejected by server' });
        return;
      }
      if (event === 'game:listJoinable') {
        ack?.({ ok: true, data: { games: [] } });
      }
    };

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTestId('mode-multiplayer'));
    await user.type(screen.getByLabelText('Player Name'), 'Alex');
    await user.click(screen.getByTestId('flow-host'));
    expect(await screen.findByRole('heading', { name: 'Game ABC123' })).toBeTruthy();

    await user.click(screen.getByTestId('leave-game'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Leave rejected by server');
    expect(screen.getByRole('heading', { name: 'Game ABC123' })).toBeTruthy();
  });

  it('pauses joinable polling when tab is hidden', async () => {
    let visibilityState: 'visible' | 'hidden' = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState
    });

    emitHandler = (event, _payload, ack) => {
      if (event === 'game:listJoinable') {
        listJoinableCalls += 1;
        ack?.({ ok: true, data: { games: [] } });
        return;
      }
      ack?.({ ok: false, error: `Unhandled event: ${event}` });
    };

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTestId('mode-multiplayer'));
    await user.type(screen.getByLabelText('Player Name'), 'Alex');
    await user.click(screen.getByTestId('flow-join'));

    await sleep(30);
    expect(listJoinableCalls).toBeGreaterThan(0);
    await act(async () => {
      visibilityState = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      await sleep(350);
    });

    const pausedCount = listJoinableCalls;
    await sleep(350);
    expect(listJoinableCalls).toBe(pausedCount);
  });

  it('prefills join by id when opened from a game invite link', async () => {
    window.history.replaceState(null, '', '/?game=Q7M2K9');

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Multiplayer' })).toBeTruthy();
    expect(screen.getByTestId('show-join-by-id').textContent).toContain('Hide Join by ID');
    expect((screen.getByLabelText('Private Game ID') as HTMLInputElement).value).toBe('Q7M2K9');

    await user.type(screen.getByLabelText('Player Name'), 'Alex');
    expect((screen.getByTestId('join-game') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a shareable invite link after hosting a lobby game', async () => {
    const lobbyState = createLobbyState();
    emitHandler = (event, _payload, ack) => {
      if (event === 'game:create') {
        ack?.({ ok: true, data: { gameState: lobbyState, playerId: 'socket-1' } });
        return;
      }
      if (event === 'game:listJoinable') {
        ack?.({ ok: true, data: { games: [] } });
        return;
      }
      ack?.({ ok: false, error: `Unhandled event: ${event}` });
    };

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTestId('mode-multiplayer'));
    await user.type(screen.getByLabelText('Player Name'), 'Alex');
    await user.click(screen.getByTestId('flow-host'));

    const inviteInput = await screen.findByTestId('invite-link-input');
    expect((inviteInput as HTMLInputElement).value).toBe(`${window.location.origin}/?game=ABC123`);
    expect(window.location.search).toContain('game=ABC123');
  });

  it('remembers multiplayer player name across app remounts', async () => {
    const user = userEvent.setup();
    const firstRender = render(<App />);

    await user.click(screen.getByTestId('mode-multiplayer'));
    await user.type(screen.getByLabelText('Player Name'), 'Alex');
    expect((screen.getByLabelText('Player Name') as HTMLInputElement).value).toBe('Alex');

    firstRender.unmount();
    const secondRender = render(<App />);

    await user.click(screen.getByTestId('mode-multiplayer'));
    expect((screen.getByLabelText('Player Name') as HTMLInputElement).value).toBe('Alex');

    secondRender.unmount();
  });
});
