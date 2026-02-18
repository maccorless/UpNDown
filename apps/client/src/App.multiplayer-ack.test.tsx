import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('socket.io-client', () => ({
  io: () => socket
}));

describe('multiplayer ack handling', () => {
  beforeEach(() => {
    socket.disconnect();
    emitHandler = (event, _payload, ack) => {
      if (event === 'game:listJoinable') {
        ack?.({ ok: true, data: { games: [] } });
        return;
      }
      ack?.({ ok: false, error: `Unhandled event: ${event}` });
    };
    window.localStorage.clear();
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
});
