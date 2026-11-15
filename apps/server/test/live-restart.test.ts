import type { AddressInfo } from 'node:net';
import { defaultMultiplayerSettings, type GameState } from '@upndown/shared-types';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthSettings } from '../src/auth/config.js';
import { hashToken } from '../src/auth/sessions.js';
import { createRealtimeServer } from '../src/index.js';
import { MemoryGameStore } from '../src/live/game-store.js';
import { createFakeProvider } from './helpers/fake-provider.js';
import { FakeLock } from './helpers/fake-lock.js';
import { MemoryProfileStore } from './helpers/memory-store.js';

const settings: AuthSettings = {
  databaseUrl: 'unused', publicBaseUrl: 'https://upndown.cloud', stateSecret: 's'.repeat(40),
  googleClientId: 'id', googleClientSecret: 'secret', legacyHost: undefined
};
type Ack = { ok: boolean; data?: { gameState: GameState; playerId: string; rejoinToken: string }; error?: string; gone?: boolean };
const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

// The whole point of saving games: a server restart, as a deploy does, must not end the game in progress. Over real
// sockets, with a real second server started on what the first one saved.
describe('a game in progress across a server restart', () => {
  const sockets: Socket[] = [];
  const servers: Array<ReturnType<typeof createRealtimeServer>> = [];
  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.close());
    await Promise.all(servers.splice(0).map((s) => s.stop().catch(() => undefined)));
  });

  const boot = async (store: MemoryGameStore, profiles: MemoryProfileStore) => {
    process.env.ALLOWED_ORIGINS = 'https://upndown.cloud';
    const server = createRealtimeServer(0, { settings, store: profiles, provider: createFakeProvider() }, { noticeMs: 30, kickMs: 100 }, { store, lock: new FakeLock(), intervalMs: 10, retryMs: 10 });
    servers.push(server);
    await server.auth.start();
    await new Promise<void>((resolve) => server.httpServer.listen(0, () => resolve()));
    return { server, url: `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}` };
  };
  const open = async (url: string, profiles?: MemoryProfileStore, googleId?: string): Promise<Socket> => {
    let cookie: string | undefined;
    if (googleId && profiles) {
      const { userId } = await profiles.findOrCreateUser('google', googleId);
      await profiles.createSession(userId, hashToken(`token-${googleId}`), new Date(Date.now() + 1e9));
      cookie = `__Host-upndown_session=token-${googleId}`;
    }
    const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false, ...(cookie ? { extraHeaders: { cookie } } : {}) });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.on('connect', () => resolve()); socket.on('connect_error', reject); });
    return socket;
  };
  const ask = (socket: Socket, event: string, payload: unknown): Promise<Ack> => new Promise((resolve) => { socket.emit(event, payload, resolve); });
  const until = async (check: () => boolean, ms = 3000): Promise<void> => {
    const end = Date.now() + ms;
    while (Date.now() < end && !check()) await wait(10);
    expect(check()).toBe(true);
  };

  it('lets a guest take their seat back with the token they saved, and a signed-in player by account, with their own cards', async () => {
    const store = new MemoryGameStore();
    const profiles = new MemoryProfileStore();
    const first = await boot(store, profiles);

    const ann = await open(first.url, profiles, 'google-ann');
    const guest = await open(first.url);
    const created = await ask(ann, 'game:create', { playerName: 'Ann', settings: { ...defaultMultiplayerSettings, maxPlayers: 4 }, isSolitaire: false });
    const gameId = created.data!.gameState.gameId;
    const joined = await ask(guest, 'game:join', { gameId, playerName: 'Cy' });
    const guestToken = joined.data!.rejoinToken;
    const guestOldId = joined.data!.playerId;
    expect((await ask(ann, 'game:start', { gameId })).ok).toBe(true);
    const guestHandBefore = first.server.manager.peekState(gameId)!.players.find((p) => p.id === guestOldId)!.hand.map((c) => c.id);
    await until(() => store.rows.has(gameId));
    await wait(60); // let the sweep catch up with the last move

    // The restart: the first server stops, a second one starts on what was saved.
    sockets.splice(0).forEach((s) => s.close());
    await first.server.stop().catch(() => undefined);
    const second = await boot(store, profiles);
    await until(() => second.server.manager.peekState(gameId) !== undefined);

    const guest2 = await open(second.url);
    const back = await ask(guest2, 'game:rejoin', { gameId, previousPlayerId: guestOldId, rejoinToken: guestToken });
    expect(back.ok).toBe(true);
    const mine = back.data!.gameState.players.find((p) => p.id === guest2.id)!;
    expect(mine.name).toBe('Cy');
    expect(mine.hand.map((c) => c.id)).toEqual(guestHandBefore);
    expect(back.data!.rejoinToken).not.toBe(guestToken);

    const ann2 = await open(second.url, profiles, 'google-ann');
    const annBack = await ask(ann2, 'game:rejoinMine', {});
    expect(annBack.ok).toBe(true);
    expect(annBack.data!.gameState.gameId).toBe(gameId);
    expect(annBack.data!.gameState.hostId).toBe(ann2.id);

    // The wrong token still opens nothing.
    const stranger = await open(second.url);
    expect(await ask(stranger, 'game:rejoin', { gameId, previousPlayerId: guestOldId, rejoinToken: 'guess' })).toMatchObject({ ok: false, gone: true });
  });

  it('tells the table, after the usual notice time, that the players of a restored game are away', async () => {
    const store = new MemoryGameStore();
    const profiles = new MemoryProfileStore();
    const first = await boot(store, profiles);
    const a = await open(first.url);
    const b = await open(first.url);
    const created = await ask(a, 'game:create', { playerName: 'A', settings: { ...defaultMultiplayerSettings, maxPlayers: 4 }, isSolitaire: false });
    const gameId = created.data!.gameState.gameId;
    const joined = await ask(b, 'game:join', { gameId, playerName: 'B' });
    await ask(a, 'game:start', { gameId });
    await until(() => store.rows.has(gameId));
    sockets.splice(0).forEach((s) => s.close());
    await first.server.stop().catch(() => undefined);

    const second = await boot(store, profiles);
    await until(() => second.server.manager.peekState(gameId) !== undefined);
    const b2 = await open(second.url);
    const seen: GameState[] = [];
    b2.on('game:updated', (state: GameState) => seen.push(state));
    await ask(b2, 'game:rejoin', { gameId, previousPlayerId: joined.data!.playerId, rejoinToken: joined.data!.rejoinToken });
    await until(() => seen.some((s) => s.reconnection?.lost.some((x) => x.name === 'A')));
  });

  // An account can hold seats in several games (two tabs). It is told which, and goes back to the one it chooses.
  it('lists the games an account holds a seat in, and goes back to the one chosen', async () => {
    const store = new MemoryGameStore();
    const profiles = new MemoryProfileStore();
    const { server, url } = await boot(store, profiles);
    const startGame = async (googleId: string, friend: string) => {
      const host = await open(url, profiles, googleId);
      const guest = await open(url);
      const made = await ask(host, 'game:create', { playerName: googleId, settings: { ...defaultMultiplayerSettings, maxPlayers: 4 }, isSolitaire: false });
      const gameId = made.data!.gameState.gameId;
      await ask(guest, 'game:join', { gameId, playerName: friend });
      await ask(host, 'game:start', { gameId });
      return gameId;
    };
    const one = await startGame('google-ann', 'Cy');
    const two = await startGame('google-ann', 'Di');

    const guest = await open(url);
    expect((await ask(guest, 'game:mySeats', {})).data).toEqual({ gameIds: [] });

    const back = await open(url, profiles, 'google-ann');
    const seats = (await ask(back, 'game:mySeats', {})) as unknown as { data: { gameIds: string[] } };
    expect(seats.data.gameIds.sort()).toEqual([one, two].sort());
    const chosen = await ask(back, 'game:rejoinMine', { gameId: two });
    expect(chosen.data!.gameState.gameId).toBe(two);
    expect(server.manager.heldGamesByAccount('nobody')).toEqual([]);
  });
});

