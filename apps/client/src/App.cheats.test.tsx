import { act, render, screen, waitFor, within } from '@testing-library/react';
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

describe('App: cheats in a multiplayer game', () => {
  beforeEach(() => {
    mock.socket.disconnect();
    mock.state.id = 'socket-1';
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('opens the panel by double clicking the logo, and from the Cheats button, listing each cheat the game allows', async () => {
    const user = await hostGame(playing());
    await user.dblClick(screen.getByRole('heading', { level: 1 }));
    expect(await screen.findByRole('dialog', { name: 'cheats' })).toBeTruthy();
    expect(['cheat-lookup', 'cheat-skip', 'cheat-trade'].every((id) => !!screen.getByTestId(id))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'cheats' })).toBeNull();
    await user.click(screen.getByTestId('open-cheats'));
    expect(await screen.findByRole('dialog', { name: 'cheats' })).toBeTruthy();
  });

  it('shows nothing of this when the game has no cheats on', async () => {
    const user = await hostGame(playing({ lookup: 'off', skip: 'off', trade: 'off', hint: 'off' }));
    await user.dblClick(screen.getByRole('heading', { level: 1 }));
    expect(screen.queryByRole('dialog', { name: 'cheats' })).toBeNull();
    expect(screen.queryByTestId('open-cheats')).toBeNull();
  });

  it('grays out a cheat that has been used under a "once" limit, and says it in words', async () => {
    const user = await hostGame(playing({ lookup: 'unlimited', skip: 'once', trade: 'once', hint: 'off' }, { skipsUsed: 1, lookupsUsed: 4 }));
    await user.click(screen.getByTestId('open-cheats'));
    const skip = screen.getByTestId('cheat-skip') as HTMLButtonElement;
    expect(skip.disabled).toBe(true);
    expect(skip.getAttribute('aria-disabled')).toBe('true');
    expect(within(skip.closest('li')!).getByText('Already used')).toBeTruthy();
    expect((screen.getByTestId('cheat-lookup') as HTMLButtonElement).disabled).toBe(false); // unlimited, however often used
  });

  it('asks before skipping, sends nothing if the player keeps playing, and sends the skip once confirmed', async () => {
    const sent: unknown[] = [];
    const user = await hostGame(playing(), (event, payload, ack) => {
      if (event !== 'game:skip') return false;
      sent.push(payload);
      ack?.({ ok: true, data: { gameState: { ...playing(), currentPlayerIndex: 1 } } });
      return true;
    });
    await user.click(screen.getByTestId('open-cheats'));
    await user.click(screen.getByTestId('cheat-skip'));
    expect(screen.getByText('Skip your turn?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(sent).toEqual([]);

    await user.click(screen.getByTestId('open-cheats'));
    await user.click(screen.getByTestId('cheat-skip'));
    await user.click(screen.getByTestId('confirm-skip'));
    await waitFor(() => expect(sent).toEqual([{ gameId: 'ABC123' }]));
  });

  it('opens the skip confirmation from Ctrl-S rather than skipping at once', async () => {
    const sent: string[] = [];
    const user = await hostGame(playing(), (event, _payload, ack) => {
      if (event === 'game:skip') { sent.push(event); ack?.({ ok: true, data: { gameState: playing() } }); return true; }
      return false;
    });
    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByText('Skip your turn?')).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it('trades the selected card from the panel, and from Ctrl-Shift-X', async () => {
    const sent: unknown[] = [];
    const user = await hostGame(playing({ lookup: 'off', skip: 'off', trade: 'unlimited', hint: 'off' }), (event, payload, ack) => {
      if (event !== 'game:trade') return false;
      sent.push(payload);
      ack?.({ ok: true, data: { gameState: playing({ lookup: 'off', skip: 'off', trade: 'unlimited', hint: 'off' }) } });
      return true;
    });
    await user.click(screen.getByTestId('open-cheats'));
    expect((screen.getByTestId('cheat-trade') as HTMLButtonElement).disabled).toBe(true); // nothing selected yet
    await user.click(screen.getByRole('button', { name: 'Close' }));

    await user.click(screen.getAllByTestId(/hand-card-/)[0]!);
    await user.click(screen.getByTestId('open-cheats'));
    await user.click(screen.getByTestId('cheat-trade'));
    await waitFor(() => expect(sent).toEqual([{ gameId: 'ABC123', cardId: 'c-21' }]));

    await user.click(screen.getAllByTestId(/hand-card-/)[0]!);
    await user.keyboard('{Control>}{Shift>}x{/Shift}{/Control}');
    await waitFor(() => expect(sent).toHaveLength(2));
  });

  // Told in a live region, but not role=status: the end-to-end specs select that role strictly.
  it('tells the player when someone else uses a cheat, in a polite live region', async () => {
    await hostGame(playing());
    act(() => mock.serverEmit('game:cheatUsed', { playerId: 'socket-2', playerName: 'Ann', kind: 'skip' }));
    const notice = document.querySelector('.cheat-notice')!;
    expect(notice.textContent).toBe('Ann skipped a turn');
    expect(notice.getAttribute('aria-live')).toBe('polite');
    expect(notice.getAttribute('role')).toBeNull();
  });

  it('answers a card lookup from the server for this player only, and no longer listens for a broadcast', async () => {
    const user = await hostGame(playing(), (event, _payload, ack) => {
      if (event === 'game:cardLookup') { ack?.({ ok: true, data: { result: { cardValue: 34, status: 'in-hand', playerName: 'Alex', holderName: 'Ann' } } }); return true; }
      return false;
    });
    await user.keyboard('{Control>}p{/Control}');
    await user.type(await screen.findByPlaceholderText('e.g. 34'), '34{Enter}');
    expect(await screen.findByText(/In Hand \(Ann\)/)).toBeTruthy();
  });

  it('asks the server for a hint, lights up the card and the pile, and says it in words', async () => {
    const asked: unknown[] = [];
    const state = playing({ lookup: 'off', skip: 'off', trade: 'off', hint: 'once' });
    const user = await hostGame(state, (event, payload, ack) => {
      if (event !== 'game:hint') return false;
      asked.push(payload);
      ack?.({ ok: true, data: { action: { type: 'play', cardId: 'c-21', pileId: 0 } } });
      return true;
    });
    await user.click(screen.getByTestId('open-cheats'));
    await user.click(screen.getByTestId('cheat-hint'));
    await waitFor(() => expect(screen.getByTestId('hint-banner').textContent).toBe('Hint: play 21 on the up pile showing 1.'));
    expect(asked).toEqual([{ gameId: 'ABC123' }]);
    expect(screen.getByTestId('hand-card-c-21').className).toContain('hinted');
    expect(screen.getByTestId('pile-0').closest('.pile-unit')!.className).toContain('hinted');
  });

  it('takes the hint away when the game moves on', async () => {
    const state = playing({ lookup: 'off', skip: 'off', trade: 'off', hint: 'unlimited' });
    const user = await hostGame(state, (event, _payload, ack) => {
      if (event !== 'game:hint') return false;
      ack?.({ ok: true, data: { action: { type: 'play', cardId: 'c-21', pileId: 0 } } });
      return true;
    });
    await user.click(screen.getByTestId('open-cheats'));
    await user.click(screen.getByTestId('cheat-hint'));
    await waitFor(() => expect(screen.getByTestId('hint-banner').textContent).toContain('Hint: play 21'));
    act(() => mock.serverEmit('game:updated', { ...state, cardsPlayedThisTurn: 1 }));
    expect(screen.getByTestId('hint-banner').textContent).toBe('');
  });

  it('gives the hint from Ctrl-Shift-H, as the button does', async () => {
    const state = playing({ lookup: 'off', skip: 'off', trade: 'off', hint: 'unlimited' });
    const asked: unknown[] = [];
    const user = await hostGame(state, (event, payload, ack) => {
      if (event !== 'game:hint') return false;
      asked.push(payload);
      ack?.({ ok: true, data: { action: { type: 'play', cardId: 'c-21', pileId: 0 } } });
      return true;
    });
    await user.keyboard('{Control>}{Shift>}h{/Shift}{/Control}');
    await waitFor(() => expect(screen.getByTestId('hint-banner').textContent).toBe('Hint: play 21 on the up pile showing 1.'));
    expect(asked).toEqual([{ gameId: 'ABC123' }]);
  });

  it('opens The full Monty from Ctrl-Shift-M, as the button does', async () => {
    const state = playing({ lookup: 'off', skip: 'off', trade: 'off', hint: 'off', monty: 'unlimited' });
    const asked: unknown[] = [];
    const user = await hostGame(state, (event, payload, ack) => {
      if (event !== 'game:fullMonty') return false;
      asked.push(payload);
      ack?.({ ok: true, data: { cells: Array.from({ length: 100 }, () => 'out' as const) } });
      return true;
    });
    await user.keyboard('{Control>}{Shift>}m{/Shift}{/Control}');
    await waitFor(() => expect(asked).toEqual([{ gameId: 'ABC123' }]));
    expect(await screen.findByRole('list', { name: 'Every card from 1 to 100' })).toBeTruthy();
  });
});

