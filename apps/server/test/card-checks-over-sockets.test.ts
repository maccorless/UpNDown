import type { AddressInfo } from 'node:net';
import { defaultMultiplayerSettings, type CheatLimits, type CheatUsedEvent, type GameState } from '@upndown/shared-types';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRealtimeServer } from '../src/index.js';

type Ack = { ok: boolean; data?: { gameState?: GameState; result?: { status: string; playerName: string }; cells?: string[] }; error?: string };

// The card seeker, the Nas check and the full Monty over the real socket protocol: who is told what, and what is counted.
describe('card checks and the full Monty over sockets', () => {
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
  const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 60); });
  const heard = (socket: Socket): CheatUsedEvent[] => {
    const seen: CheatUsedEvent[] = [];
    socket.on('game:cheatUsed', (event: CheatUsedEvent) => seen.push(event));
    return seen;
  };

  // A started table: the host (named hostName) and a guest (named guestName), with the cheats and the highest card as given.
  async function table(hostName: string, guestName: string, limits: Partial<CheatLimits>, maxCard = 99) {
    const [host, guest] = [await open(), await open()];
    const created = await ask(host, 'game:create', {
      playerName: hostName,
      isSolitaire: false,
      settings: { ...defaultMultiplayerSettings, maxPlayers: 4, maxCardValue: maxCard, cheatLimits: { lookup: 'off', skip: 'off', trade: 'off', hint: 'off', nas: 'off', monty: 'off', ...limits } }
    });
    const gameId = created.data!.gameState!.gameId;
    const guestHeard = heard(guest);
    await ask(guest, 'game:join', { gameId, playerName: guestName });
    await ask(host, 'game:start', { gameId });
    return { host, guest, gameId, guestHeard, hostId: host.id };
  }

  it('answers a card outside the game\'s range as outside it, and does not use up the card seeker', async () => {
    const { host, gameId, guestHeard } = await table('Ken', 'Ann', { lookup: 'once' }, 59);
    const outside = await ask(host, 'game:cardLookup', { gameId, cardValue: 65 });
    expect(outside).toMatchObject({ ok: true, data: { result: { status: 'out-of-range' } } });
    const inside = await ask(host, 'game:cardLookup', { gameId, cardValue: 20 });
    expect(inside.ok).toBe(true);
    expect(inside.data!.result!.status).not.toBe('out-of-range');
    await settle();
    expect(guestHeard).toEqual([{ playerId: expect.any(String), playerName: 'Ken', kind: 'lookup' }]);
    expect(server.manager.peekState(gameId)!.statistics.players[host.id]!.lookupsUsed).toBe(1);
  });

  it('gives the Nas check silently: the others are not told it was used, while the card seeker still tells them', async () => {
    const { host, gameId, guestHeard } = await table('Nas', 'Ann', { nas: 'unlimited', lookup: 'unlimited' });
    expect((await ask(host, 'game:cardLookup', { gameId, cardValue: 20, kind: 'nas' })).ok).toBe(true);
    await settle();
    expect(guestHeard).toEqual([]);
    expect((await ask(host, 'game:cardLookup', { gameId, cardValue: 20 })).ok).toBe(true);
    await settle();
    expect(guestHeard.map((event) => event.kind)).toEqual(['lookup']);
  });

  it('gives the Nas check to both players when both are named Nas, the second under a suffix', async () => {
    const { guest, gameId } = await table('nas', 'Nas', { nas: 'unlimited' });
    const answer = await ask(guest, 'game:cardLookup', { gameId, cardValue: 20, kind: 'nas' });
    expect(answer.ok).toBe(true);
    expect(server.manager.peekState(gameId)!.players.map((player) => player.name)).toEqual(['nas', 'Nas-1']);
  });

  it('refuses the Nas check to a player who is not named Nas', async () => {
    const { guest, gameId } = await table('Ken', 'Ann', { nas: 'unlimited' });
    expect((await ask(guest, 'game:cardLookup', { gameId, cardValue: 20, kind: 'nas' })).ok).toBe(false);
  });

  it('shows the asker the whole grid and tells the others only that the full Monty was used', async () => {
    const { host, gameId, guestHeard } = await table('Ken', 'Ann', { monty: 'once' });
    const grid = await ask(host, 'game:fullMonty', { gameId });
    expect(grid.ok).toBe(true);
    expect(grid.data!.cells).toHaveLength(100);
    await settle();
    expect(guestHeard).toEqual([{ playerId: host.id, playerName: 'Ken', kind: 'monty' }]);
    expect(server.manager.peekState(gameId)!.statistics.players[host.id]).toMatchObject({ montyUsed: 1, lookupsUsed: 1 });
  });

  it('refuses a second full Monty under once', async () => {
    const { host, gameId } = await table('Ken', 'Ann', { monty: 'once' });
    expect((await ask(host, 'game:fullMonty', { gameId })).ok).toBe(true);
    expect((await ask(host, 'game:fullMonty', { gameId })).ok).toBe(false);
  });
});
