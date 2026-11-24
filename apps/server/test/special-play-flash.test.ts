import type { AddressInfo } from 'node:net';
import { defaultMultiplayerSettings, type GameState } from '@upndown/shared-types';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRealtimeServer } from '../src/index.js';

type Ack = { ok: boolean; data?: { gameState: GameState }; error?: string };
type SpecialPlay = { pileId: number; playerId: string; lifeline: boolean };
type Internals = { rooms: Map<string, { gameState: GameState }> };

// The golden flash on the table: what every other seat is told when a backward 10 lands, and whether it was a lifeline.
describe('the flash over a backward 10, as the other players see it', () => {
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

  // A started table with the host on turn. The piles have met (ascending at 30 twice, descending at 20 twice), so a 20 on
  // an ascending pile is a backward 10 and, with nothing else in the hand that can go, the only way forward.
  async function table(hostHand: Array<{ id: string; value: number }>) {
    const [host, guest] = [await open(), await open()];
    const created = await ask(host, 'game:create', { playerName: 'Host', isSolitaire: false, settings: { ...defaultMultiplayerSettings, maxPlayers: 4 } });
    const gameId = created.data!.gameState.gameId;
    await ask(guest, 'game:join', { gameId, playerName: 'Guest' });
    await ask(host, 'game:start', { gameId });
    const room = (server.manager as unknown as Internals).rooms.get(gameId)!;
    const state = structuredClone(room.gameState);
    state.currentPlayerIndex = state.players.findIndex((p) => p.id === host.id);
    state.foundationPiles = [
      { id: 0, type: 'ascending', topCard: { id: 'f-0', value: 30 } },
      { id: 1, type: 'ascending', topCard: { id: 'f-1', value: 30 } },
      { id: 2, type: 'descending', topCard: { id: 'f-2', value: 20 } },
      { id: 3, type: 'descending', topCard: { id: 'f-3', value: 20 } }
    ];
    for (const p of state.players) p.hand = p.id === host.id ? hostHand : [{ id: 'c-held', value: 5 }];
    room.gameState = state;
    const seen: SpecialPlay[] = [];
    guest.on('game:specialPlay', (event: SpecialPlay) => seen.push(event));
    return { host, gameId, seen, hostId: host.id };
  }

  it('tells the others it was a lifeline when the backward 10 was the only play in the hand', async () => {
    const { host, gameId, seen, hostId } = await table([{ id: 'c-20', value: 20 }, { id: 'c-25', value: 25 }]);
    expect((await ask(host, 'game:playCard', { gameId, cardId: 'c-20', pileId: 0 })).ok).toBe(true);
    await settle();
    expect(seen).toEqual([{ pileId: 0, playerId: hostId, lifeline: true }]);
  });

  it('says it was not a lifeline when a normal play was still in the hand', async () => {
    const { host, gameId, seen, hostId } = await table([{ id: 'c-20', value: 20 }, { id: 'c-31', value: 31 }]);
    expect((await ask(host, 'game:playCard', { gameId, cardId: 'c-20', pileId: 0 })).ok).toBe(true);
    await settle();
    expect(seen).toEqual([{ pileId: 0, playerId: hostId, lifeline: false }]);
  });

  it('sends no flash for a normal play, because only the backward 10 is the event the table is shown', async () => {
    const { host, gameId, seen } = await table([{ id: 'c-31', value: 31 }, { id: 'c-45', value: 45 }]);
    expect((await ask(host, 'game:playCard', { gameId, cardId: 'c-31', pileId: 0 })).ok).toBe(true);
    await settle();
    expect(seen).toEqual([]);
  });
});
