import type { AddressInfo } from 'node:net';
import { defaultMultiplayerSettings, type CheatUsedEvent, type GameState } from '@upndown/shared-types';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRealtimeServer } from '../src/index.js';

type Ack = { ok: boolean; data?: { gameState: GameState; result?: { status: string; holderName?: string } }; error?: string };

// The cheats over the real socket protocol: who is told, what they are told, and what cannot be taken back.
describe('cheats over sockets', () => {
  let server: ReturnType<typeof createRealtimeServer>;
  let url = '';
  const sockets: Socket[] = [];
  beforeEach(async () => {
    server = createRealtimeServer(0);
    await new Promise<void>((resolve) => server.httpServer.listen(0, () => resolve()));
    url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    sockets.splice(0).forEach((x) => x.close());
    await server.stop().catch(() => undefined);
  });
  const open = (): Promise<Socket> => new Promise((resolve, reject) => {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(socket);
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
  const ask = (socket: Socket, event: string, payload: unknown): Promise<Ack> => new Promise((resolve) => { socket.emit(event, payload, resolve); });
  const events = (socket: Socket): CheatUsedEvent[] => {
    const seen: CheatUsedEvent[] = [];
    socket.on('game:cheatUsed', (event: CheatUsedEvent) => seen.push(event));
    return seen;
  };
  const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 60); });

  async function table(limits: { lookup?: 'off' | 'once' | 'unlimited'; skip?: 'off' | 'once' | 'unlimited'; trade?: 'off' | 'once' | 'unlimited' }, allowUndo = false) {
    const [host, guest] = [await open(), await open()];
    const created = await ask(host, 'game:create', {
      playerName: 'Host', isSolitaire: false,
      settings: { ...defaultMultiplayerSettings, maxPlayers: 4, allowUndo, cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off', ...limits } }
    });
    const gameId = created.data!.gameState.gameId;
    await ask(guest, 'game:join', { gameId, playerName: 'Guest' });
    const hostSeen = events(host);
    const guestSeen = events(guest);
    const started = await ask(host, 'game:start', { gameId });
    return { host, guest, gameId, hostSeen, guestSeen, hostView: started.data!.gameState };
  }

  it('lets the active player skip once, tells the other player, and refuses the second skip', async () => {
    const { host, guest, gameId, guestSeen } = await table({ skip: 'once' });
    expect((await ask(guest, 'game:skip', { gameId })).ok).toBe(false); // not their turn
    const skipped = await ask(host, 'game:skip', { gameId });
    expect(skipped.ok).toBe(true);
    await settle();
    expect(guestSeen).toEqual([{ playerId: host.id, playerName: 'Host', kind: 'skip' }]);
    // The turn passed to the guest. Skipping is off the table for the host now, so there is nothing to undo or repeat.
    expect(skipped.data!.gameState.players[skipped.data!.gameState.currentPlayerIndex]!.name).toBe('Guest');
    expect((await ask(host, 'game:skip', { gameId })).ok).toBe(false);
  });

  it('refuses skip and trade when the game does not allow them', async () => {
    const { host, gameId, hostView } = await table({});
    expect((await ask(host, 'game:skip', { gameId })).ok).toBe(false);
    expect((await ask(host, 'game:trade', { gameId, cardId: hostView.players.find((p) => p.name === 'Host')!.hand[0]!.id })).ok).toBe(false);
  });

  it('trades a card for the next one, once, and the other player is told only that a trade happened', async () => {
    const { host, gameId, hostView, guestSeen } = await table({ trade: 'once' });
    const mine = hostView.players.find((p) => p.name === 'Host')!.hand;
    const traded = await ask(host, 'game:trade', { gameId, cardId: mine[0]!.id });
    expect(traded.ok).toBe(true);
    const after = traded.data!.gameState.players.find((p) => p.name === 'Host')!.hand;
    expect(after).toHaveLength(mine.length);
    expect(after.map((c) => c.id)).not.toContain(mine[0]!.id);
    await settle();
    expect(guestSeen).toEqual([{ playerId: host.id, playerName: 'Host', kind: 'trade' }]);
    expect((await ask(host, 'game:trade', { gameId, cardId: after[0]!.id })).ok).toBe(false);
  });

  // Skip and trade are for good: undo cannot take one back, and cannot refund it.
  it('does not let undo take back a trade, even after a card was played before it', async () => {
    const { host, gameId, hostView } = await table({ trade: 'unlimited' }, true);
    const mine = hostView.players.find((p) => p.name === 'Host')!.hand;
    expect((await ask(host, 'game:playCard', { gameId, cardId: mine[0]!.id, pileId: 0 })).ok).toBe(true);
    expect((await ask(host, 'game:trade', { gameId, cardId: mine[1]!.id })).ok).toBe(true);
    const undone = await ask(host, 'game:undoPlay', { gameId });
    expect(undone.ok).toBe(false);
    expect(undone.error).toContain('Nothing to undo');
  });

  it('answers a card lookup only to the asker, tells the others that one happened, and honours a single use', async () => {
    const { host, guest, gameId, hostView, hostSeen, guestSeen } = await table({ lookup: 'once' });
    let broadcast = false;
    host.on('game:cardLookupResult', () => { broadcast = true; });
    guest.on('game:cardLookupResult', () => { broadcast = true; });
    const hostCard = hostView.players.find((p) => p.name === 'Host')!.hand[0]!.value;
    const answer = await ask(guest, 'game:cardLookup', { gameId, cardValue: hostCard });
    expect(answer.ok).toBe(true);
    expect(answer.data!.result).toMatchObject({ status: 'in-hand', holderName: 'Host' });
    await settle();
    expect(broadcast).toBe(false);
    expect(hostSeen).toEqual([{ playerId: guest.id, playerName: 'Guest', kind: 'lookup' }]);
    // The notice names who and what, and carries nothing about the card or the answer.
    expect(Object.keys(hostSeen[0]!).sort()).toEqual(['kind', 'playerId', 'playerName']);
    expect(guestSeen.map((e) => e.kind)).toEqual(['lookup']);
    expect((await ask(guest, 'game:cardLookup', { gameId, cardValue: hostCard })).ok).toBe(false);
  });

  it('keeps the old card seeker switch working for a game made by an older client', async () => {
    const [host, guest] = [await open(), await open()];
    const created = await ask(host, 'game:create', { playerName: 'Host', isSolitaire: false, settings: { ...defaultMultiplayerSettings, maxPlayers: 4, allowCardLookup: true } });
    const gameId = created.data!.gameState.gameId;
    expect(created.data!.gameState.settings.cheatLimits?.lookup).toBe('unlimited');
    await ask(guest, 'game:join', { gameId, playerName: 'Guest' });
    await ask(host, 'game:start', { gameId });
    expect((await ask(guest, 'game:cardLookup', { gameId, cardValue: 50 })).ok).toBe(true);
    expect((await ask(guest, 'game:cardLookup', { gameId, cardValue: 51 })).ok).toBe(true);
  });
});
