import type { AddressInfo } from 'node:net';
import { defaultMultiplayerSettings } from '@upndown/shared-types';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthSettings } from '../src/auth/config.js';
import { createRealtimeServer } from '../src/index.js';
import { MemoryGameStore } from '../src/live/game-store.js';
import { createFakeProvider } from './helpers/fake-provider.js';
import { FakeLock } from './helpers/fake-lock.js';
import { MemoryProfileStore } from './helpers/memory-store.js';

const settings: AuthSettings = {
  databaseUrl: 'unused', publicBaseUrl: 'https://upndown.cloud', stateSecret: 's'.repeat(40),
  googleClientId: 'id', googleClientSecret: 'secret', legacyHost: undefined
};
type Ack = { ok: boolean; data?: { gameState: { gameId: string }; playerId: string; rejoinToken: string }; error?: string };

// The front page asks, over plain HTTP, whether a seat saved on the device can still be taken back. It has no socket open, so
// this is the only way it can tell a live game from one that is gone.
describe('the seat check the front page makes before offering Rejoin', () => {
  const sockets: Socket[] = [];
  const servers: Array<ReturnType<typeof createRealtimeServer>> = [];
  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.close());
    await Promise.all(servers.splice(0).map((s) => s.stop().catch(() => undefined)));
  });

  const boot = async () => {
    process.env.ALLOWED_ORIGINS = 'https://upndown.cloud';
    const server = createRealtimeServer(0, { settings, store: new MemoryProfileStore(), provider: createFakeProvider() }, { noticeMs: 30, kickMs: 100 }, { store: new MemoryGameStore(), lock: new FakeLock(), intervalMs: 10, retryMs: 10 });
    servers.push(server);
    await server.auth.start();
    await new Promise<void>((resolve) => server.httpServer.listen(0, () => resolve()));
    return `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  };
  const open = async (url: string): Promise<Socket> => {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.on('connect', () => resolve()); socket.on('connect_error', reject); });
    return socket;
  };
  const ask = (socket: Socket, event: string, payload: unknown): Promise<Ack> => new Promise((resolve) => { socket.emit(event, payload, resolve); });
  const check = async (url: string, body: unknown): Promise<{ status: number; live?: boolean }> => {
    const response = await fetch(`${url}/api/seat-check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, ...((await response.json()) as { live?: boolean }) };
  };

  it('says a seat is live while its game is kept and the token is the one it was given', async () => {
    const url = await boot();
    const ann = await open(url);
    const guest = await open(url);
    const created = await ask(ann, 'game:create', { playerName: 'Ann', settings: { ...defaultMultiplayerSettings, maxPlayers: 4 }, isSolitaire: false });
    const gameId = created.data!.gameState.gameId;
    const joined = await ask(guest, 'game:join', { gameId, playerName: 'Cy' });
    const seat = { gameId, previousPlayerId: joined.data!.playerId, rejoinToken: joined.data!.rejoinToken };

    expect(await check(url, seat)).toEqual({ status: 200, live: true });
    expect(await check(url, { ...seat, rejoinToken: 'guess' })).toEqual({ status: 200, live: false });
    expect(await check(url, { ...seat, gameId: 'NOPE00' })).toEqual({ status: 200, live: false });
  });

  it('answers a request that is not a seat with live false, rather than an error', async () => {
    const url = await boot();
    expect(await check(url, { nonsense: true })).toEqual({ status: 200, live: false });
  });
});
