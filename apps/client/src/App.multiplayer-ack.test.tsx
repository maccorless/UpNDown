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
    statistics: {
      turns: 0,
      startedAtMs: null,
      endedAtMs: null,
      players: {
        'socket-1': {
          cardsPlayed: 0,
          totalMovement: 0,
          specialPlays: 0,
          nasCheatsUsed: 0
        }
      }
    },
    nasCheat: {
      enabledPlayerIds: [],
      usedThisTurnByPlayerId: {
        'socket-1': false
      }
    },
    settings: multiplayerSettings,
    isSolitaire: false
  };
}

function createEndedState(): GameState {
  return {
    ...createLobbyState(),
    gamePhase: 'won',
    players: [
      { id: 'socket-1', name: 'Alex', hand: [], isHost: true },
      { id: 'socket-2', name: 'Guest', hand: [], isHost: false }
    ],
    drawPile: [],
    statistics: {
      turns: 0,
      startedAtMs: Date.now(),
      endedAtMs: Date.now(),
      players: {
        'socket-1': { cardsPlayed: 3, totalMovement: 33, specialPlays: 1, nasCheatsUsed: 2 },
        'socket-2': { cardsPlayed: 2, totalMovement: 18, specialPlays: 0, nasCheatsUsed: 0 }
      }
    },
    nasCheat: {
      enabledPlayerIds: ['socket-1'],
      usedThisTurnByPlayerId: {
        'socket-1': true,
        'socket-2': false
      }
    }
  };
}

function createPlayingNasState(): GameState {
  return {
    ...createEndedState(),
    gamePhase: 'playing',
    currentPlayerIndex: 0,
    players: [
      { id: 'socket-1', name: 'nas', hand: [{ id: 'c-21', value: 21 }], isHost: true },
      { id: 'socket-2', name: 'Guest', hand: [{ id: 'c-34', value: 34 }], isHost: false }
    ],
    drawPile: [{ id: 'c-55', value: 55 }],
    cardsPlayedThisTurn: 0,
    statistics: {
      turns: 1,
      startedAtMs: Date.now(),
      endedAtMs: null,
      players: {
        'socket-1': { cardsPlayed: 1, totalMovement: 10, specialPlays: 0, nasCheatsUsed: 0 },
        'socket-2': { cardsPlayed: 1, totalMovement: 9, specialPlays: 0, nasCheatsUsed: 0 }
      }
    },
    nasCheat: {
      enabledPlayerIds: ['socket-1'],
      usedThisTurnByPlayerId: {
        'socket-1': false,
        'socket-2': false
      }
    }
  };
}

function createPlayingState(): GameState {
  return {
    ...createLobbyState(),
    gamePhase: 'playing',
    currentPlayerIndex: 0,
    players: [
      { id: 'socket-1', name: 'Alex', hand: [{ id: 'c-21', value: 21 }], isHost: true },
      { id: 'socket-2', name: 'Guest', hand: [{ id: 'c-34', value: 34 }], isHost: false }
    ],
    drawPile: [{ id: 'c-55', value: 55 }],
    cardsPlayedThisTurn: 0,
    statistics: {
      turns: 1,
      startedAtMs: Date.now(),
      endedAtMs: null,
      players: {
        'socket-1': { cardsPlayed: 1, totalMovement: 10, specialPlays: 0, nasCheatsUsed: 0 },
        'socket-2': { cardsPlayed: 1, totalMovement: 9, specialPlays: 0, nasCheatsUsed: 0 }
      }
    },
    nasCheat: {
      enabledPlayerIds: [],
      usedThisTurnByPlayerId: {
        'socket-1': false,
        'socket-2': false
      }
    }
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

  it('shows host-ended modal and returns to landing only after acknowledgement', async () => {
    const playingState = createPlayingState();
    const endedLobbyState: GameState = {
      ...createLobbyState(),
      gameId: playingState.gameId,
      hostId: 'socket-1',
      players: [
        { id: 'socket-1', name: 'Alex', hand: [], isHost: true },
        { id: 'socket-2', name: 'Guest', hand: [], isHost: false }
      ],
      statistics: {
        turns: 0,
        startedAtMs: null,
        endedAtMs: null,
        players: {
          'socket-1': { cardsPlayed: 0, totalMovement: 0, specialPlays: 0, nasCheatsUsed: 0 },
          'socket-2': { cardsPlayed: 0, totalMovement: 0, specialPlays: 0, nasCheatsUsed: 0 }
        }
      },
      nasCheat: {
        enabledPlayerIds: [],
        usedThisTurnByPlayerId: {
          'socket-1': false,
          'socket-2': false
        }
      }
    };
    let leaveCalls = 0;

    emitHandler = (event, _payload, ack) => {
      if (event === 'game:create') {
        ack?.({ ok: true, data: { gameState: playingState, playerId: 'socket-1' } });
        return;
      }
      if (event === 'game:endGame') {
        ack?.({ ok: true, data: { gameState: endedLobbyState } });
        return;
      }
      if (event === 'game:leave') {
        leaveCalls += 1;
        ack?.({ ok: true, data: { gameState: null } });
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

    expect(await screen.findByTestId('end-game-top')).toBeTruthy();
    await user.click(screen.getByTestId('end-game-top'));

    expect(await screen.findByRole('dialog', { name: 'host ended the game' })).toBeTruthy();
    expect(screen.queryByTestId('mode-solitaire')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back To Home' }));
    expect(await screen.findByTestId('mode-solitaire')).toBeTruthy();
    expect(leaveCalls).toBe(1);
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

  it('auto-joins deep-linked game when player name is already known', async () => {
    window.history.replaceState(null, '', '/?game=Q7M2K9');
    window.localStorage.setItem('upndown.multiplayer.playerName.v1', 'Alex');
    const joinedState: GameState = {
      ...createLobbyState(),
      gameId: 'Q7M2K9',
      players: [
        { id: 'socket-1', name: 'Alex', hand: [], isHost: false },
        { id: 'socket-host', name: 'Host', hand: [], isHost: true }
      ],
      hostId: 'socket-host'
    };

    let joinCalls = 0;
    emitHandler = (event, payload, ack) => {
      if (event === 'game:join') {
        joinCalls += 1;
        expect(payload).toEqual({ gameId: 'Q7M2K9', playerName: 'Alex' });
        ack?.({ ok: true, data: { gameState: joinedState, playerId: 'socket-1' } });
        return;
      }
      if (event === 'game:listJoinable') {
        ack?.({ ok: true, data: { games: [] } });
        return;
      }
      ack?.({ ok: false, error: `Unhandled event: ${event}` });
    };

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Game Q7M2K9' })).toBeTruthy();
    expect(joinCalls).toBe(1);
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

  it('shows end-game statistics modal with summary and player rows', async () => {
    const endedState = createEndedState();
    emitHandler = (event, _payload, ack) => {
      if (event === 'game:create') {
        ack?.({ ok: true, data: { gameState: endedState, playerId: 'socket-1' } });
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

    expect(await screen.findByRole('dialog', { name: 'end game statistics' })).toBeTruthy();
    expect(screen.getAllByText('Cards Played').length).toBeGreaterThan(0);
    expect(screen.getByText('Nascheats Used')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Nascheats' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Player' })).toBeTruthy();
    expect(screen.getByText('Alex')).toBeTruthy();
    expect(screen.getByText('Guest')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'end game statistics' })).toBeNull();
  });

  it('shows nas cheat intro modal for nas player and closes only when X is clicked', async () => {
    const playingState = createPlayingNasState();
    emitHandler = (event, _payload, ack) => {
      if (event === 'game:create') {
        ack?.({ ok: true, data: { gameState: playingState, playerId: 'socket-1' } });
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
    await user.type(screen.getByLabelText('Player Name'), 'nas');
    await user.click(screen.getByTestId('flow-host'));

    expect(await screen.findByRole('dialog', { name: 'nas cheat mode enabled' })).toBeTruthy();
    expect(screen.getByTestId('nas-cheat')).toBeTruthy();

    await act(async () => {
      await sleep(5100);
    });

    expect(screen.getByRole('dialog', { name: 'nas cheat mode enabled' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close Nas Cheat Info' }));
    expect(screen.queryByRole('dialog', { name: 'nas cheat mode enabled' })).toBeNull();
  }, 10000);
});
