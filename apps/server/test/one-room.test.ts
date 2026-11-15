import type { AddressInfo } from 'node:net';
import { defaultMultiplayerSettings, type GameState } from '@upndown/shared-types';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameManager } from '../src/game-manager.js';
import { createRealtimeServer } from '../src/index.js';

const settings = { ...defaultMultiplayerSettings, maxPlayers: 4 };
const host = (id: string) => ({ playerName: id, settings, isSolitaire: false as const });

// One connection, one game. Nothing is gained by one connection owning many rooms, and a script could use them to fill memory.
describe('one game per connection (manager)', () => {
  it('refuses a second room for a connection that already has a seat', () => {
    const manager = new GameManager();
    manager.createGame('a', host('A'));
    expect(() => manager.createGame('a', host('A'))).toThrow('already in a game');
  });

  it('refuses joining a different room while seated, but joining the same room again is harmless', () => {
    const manager = new GameManager();
    const one = manager.createGame('a', host('A'));
    const two = manager.createGame('b', host('B'));
    expect(() => manager.joinGame('a', { gameId: two.gameId, playerName: 'A' })).toThrow('already in a game');
    expect(manager.joinGame('a', { gameId: one.gameId, playerName: 'A' }).players).toHaveLength(1);
  });

  it('knows which room a connection is in, and none once it has left', () => {
    const manager = new GameManager();
    const room = manager.createGame('a', host('A'));
    expect(manager.seatedGameOf('a')).toBe(room.gameId);
    expect(manager.seatedGameOf('stranger')).toBeNull();
    manager.leaveGame('a', room.gameId);
    expect(manager.seatedGameOf('a')).toBeNull();
    expect(() => manager.createGame('a', host('A'))).not.toThrow();
  });
});

describe('room cap and lobby list limit', () => {
  it('refuses a new room once the cap is reached, and allows one again when a room goes', () => {
    const manager = new GameManager({ maxRooms: 3 });
    const first = manager.createGame('a', host('A'));
    manager.createGame('b', host('B'));
    manager.createGame('c', host('C'));
    expect(() => manager.createGame('d', host('D'))).toThrow('server is full');
    manager.leaveGame('a', first.gameId);
    expect(() => manager.createGame('d', host('D'))).not.toThrow();
  });

  it('lists at most the 50 newest lobbies, newest first', () => {
    vi.useFakeTimers();
    try {
      const manager = new GameManager({ maxRooms: 200 });
      const ids: string[] = [];
      for (let i = 0; i < 60; i += 1) {
        vi.setSystemTime(1_000_000 + i * 1000);
        ids.push(manager.createGame(`host-${i}`, host(`H${i}`)).gameId);
      }
      const listed = manager.listJoinableGames().map((g) => g.gameId);
      expect(listed).toHaveLength(50);
      expect(listed).toEqual(ids.slice(10).reverse());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('one game per connection (sockets)', () => {
  let server: ReturnType<typeof createRealtimeServer>;
  let url = '';
  const sockets: Socket[] = [];
  beforeEach(async () => {
    server = createRealtimeServer(0);
    await new Promise<void>((resolve) => server.httpServer.listen(0, () => resolve()));
    url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.close());
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  });
  const open = (): Promise<Socket> => new Promise((resolve, reject) => {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(socket);
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
  type Ack = { ok: boolean; data?: { gameState: GameState }; error?: string };
  const ask = (socket: Socket, event: string, payload: unknown): Promise<Ack> => new Promise((resolve) => { socket.emit(event, payload, resolve); });
  const create = (socket: Socket) => ask(socket, 'game:create', { playerName: 'Host', settings, isSolitaire: false });
  const rooms = () => (server.manager as unknown as { rooms: Map<string, { gameState: GameState }> }).rooms;

  it('leaves the old lobby when the same connection starts another, so it never holds two rooms', async () => {
    const a = await open();
    const first = (await create(a)).data!.gameState.gameId;
    const second = (await create(a)).data!.gameState.gameId;
    expect(second).not.toBe(first);
    expect(rooms().has(first)).toBe(false);
    expect(rooms().get(second)!.gameState.players).toHaveLength(1);
    expect(server.manager.seatedGameOf(a.id!)).toBe(second);
  });

  it('hands an old lobby on to the players still in it when its host starts another room', async () => {
    const a = await open();
    const b = await open();
    const first = (await create(a)).data!.gameState.gameId;
    await ask(b, 'game:join', { gameId: first, playerName: 'Bee' });
    await create(a);
    const old = rooms().get(first)!.gameState;
    expect(old.players.map((p) => p.id)).toEqual([b.id]);
    expect(old.hostId).toBe(b.id);
  });

  it('leaves a lobby to join another game, rather than sitting in two', async () => {
    const a = await open();
    const b = await open();
    const lobbyA = (await create(a)).data!.gameState.gameId;
    const lobbyB = (await create(b)).data!.gameState.gameId;
    const joined = await ask(a, 'game:join', { gameId: lobbyB, playerName: 'Ann' });
    expect(joined.ok).toBe(true);
    expect(rooms().has(lobbyA)).toBe(false);
    expect(server.manager.seatedGameOf(a.id!)).toBe(lobbyB);
  });

  // A game in progress cannot be left, so another cannot be started from it. The refusal must say why.
  it('refuses to start or join another game from one that is being played, saying why, and creates nothing', async () => {
    const a = await open();
    const b = await open();
    const live = (await create(a)).data!.gameState.gameId;
    await ask(b, 'game:join', { gameId: live, playerName: 'Bee' });
    expect((await ask(a, 'game:start', { gameId: live })).ok).toBe(true);
    const before = rooms().size;

    const again = await create(a);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/still being played/);
    expect(rooms().size).toBe(before);

    const c = await open();
    const other = (await create(c)).data!.gameState.gameId;
    const join = await ask(a, 'game:join', { gameId: other, playerName: 'Ann' });
    expect(join.ok).toBe(false);
    expect(join.error).toMatch(/still being played/);
    expect(server.manager.seatedGameOf(a.id!)).toBe(live);
  });
});
