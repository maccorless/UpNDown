import type { AddressInfo } from 'node:net';
import { defaultMultiplayerSettings, type GameState } from '@upndown/shared-types';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthSettings } from '../src/auth/config.js';
import { hashToken } from '../src/auth/sessions.js';
import { createRealtimeServer } from '../src/index.js';
import { createFakeProvider } from './helpers/fake-provider.js';
import { MemoryProfileStore } from './helpers/memory-store.js';
import { setUpWin } from './helpers/rig.js';

const settings: AuthSettings = {
  databaseUrl: 'unused', publicBaseUrl: 'https://upndown.cloud', stateSecret: 's'.repeat(40),
  googleClientId: 'id', googleClientSecret: 'secret', legacyHost: undefined
};

type Ack = { ok: boolean; data?: { gameState: GameState }; error?: string; gone?: boolean };

describe('results through real sockets', () => {
  let server: ReturnType<typeof createRealtimeServer>;
  let store: MemoryProfileStore;
  let url = '';
  const sockets: Socket[] = [];

  beforeEach(async () => {
    process.env.ALLOWED_ORIGINS = 'https://upndown.cloud';
    store = new MemoryProfileStore();
    server = createRealtimeServer(0, { settings, store, provider: createFakeProvider() });
    await server.auth.start();
    await new Promise<void>((resolve) => server.httpServer.listen(0, () => resolve()));
    url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    delete process.env.ALLOWED_ORIGINS;
    sockets.splice(0).forEach((s) => s.close());
    await server.auth.stop();
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  });

  const open = async (googleId?: string): Promise<{ socket: Socket; userId?: string }> => {
    let cookie: string | undefined;
    let userId: string | undefined;
    if (googleId) {
      ({ userId } = await store.findOrCreateUser('google', googleId));
      await store.createSession(userId, hashToken(`token-${googleId}`), new Date(Date.now() + 1e9));
      cookie = `__Host-upndown_session=token-${googleId}`;
    }
    const socket = connect(url, { transports: ['websocket'], forceNew: true, ...(cookie ? { extraHeaders: { cookie } } : {}) });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.on('connect', () => resolve()); socket.on('connect_error', reject); });
    return { socket, ...(userId ? { userId } : {}) };
  };
  const ask = (socket: Socket, event: string, payload: unknown): Promise<Ack> => new Promise((resolve) => { socket.emit(event, payload, resolve); });
  const until = async (check: () => boolean): Promise<void> => {
    for (let i = 0; i < 100 && !check(); i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
  };
  const room = (gameId: string) => (server.manager as unknown as { rooms: Map<string, { gameState: GameState }> }).rooms.get(gameId)!;

  async function table() {
    const ann = await open('google-ann');
    const bob = await open('google-bob');
    const cy = await open(); // a guest
    const created = await ask(ann.socket, 'game:create', { playerName: 'Ann', settings: { ...defaultMultiplayerSettings, maxPlayers: 4 }, isSolitaire: false });
    const gameId = created.data!.gameState.gameId;
    await ask(bob.socket, 'game:join', { gameId, playerName: 'Bob' });
    await ask(cy.socket, 'game:join', { gameId, playerName: 'Cy' });
    return { ann, bob, cy, gameId, annId: ann.socket.id!, };
  }

  it('records a win for the two signed-in players and not the guest, keyed on a run id and not the room code', async () => {
    const { ann, bob, gameId, annId } = await table();
    expect((await ask(ann.socket, 'game:start', { gameId })).ok).toBe(true);
    const state = structuredClone(room(gameId).gameState);
    setUpWin(state, annId);
    room(gameId).gameState = state;
    expect((await ask(ann.socket, 'game:playCard', { gameId, cardId: 'c-2', pileId: 0 })).data?.gameState.gamePhase).toBe('won');
    await until(() => store.results.length >= 2);

    expect(store.results.map((r) => r.userId).sort()).toEqual([ann.userId, bob.userId].sort());
    expect(store.results.every((r) => r.outcome === 'won' && r.playerCount === 3)).toBe(true);
    expect(new Set(store.results.map((r) => r.gameId)).size).toBe(1);
    expect(store.results[0]!.gameId).not.toBe(gameId);
  });

  it('records nothing when the host returns a finished room to the lobby, and an abandoned row for the host when a live game is ended', async () => {
    const { ann, gameId, annId } = await table();
    await ask(ann.socket, 'game:start', { gameId });
    const state = structuredClone(room(gameId).gameState);
    setUpWin(state, annId);
    room(gameId).gameState = state;
    await ask(ann.socket, 'game:playCard', { gameId, cardId: 'c-2', pileId: 0 });
    await until(() => store.results.length >= 2);
    expect((await ask(ann.socket, 'game:endGame', { gameId })).ok).toBe(true);
    await new Promise<void>((resolve) => { setTimeout(resolve, 60); });
    expect(store.results).toHaveLength(2);

    // A second game in the same room, ended by the host while it is still being played.
    await ask(ann.socket, 'game:start', { gameId });
    expect((await ask(ann.socket, 'game:endGame', { gameId })).ok).toBe(true);
    await until(() => store.results.length >= 3);
    expect(store.results).toHaveLength(3);
    const quit = store.results[2]!;
    expect(quit).toMatchObject({ userId: ann.userId, outcome: 'abandoned' });
    expect(new Set(store.results.map((r) => r.gameId)).size).toBe(2);
  });

  it('records nothing for a table of guests, with auth on', async () => {
    const a = await open();
    const b = await open();
    const created = await ask(a.socket, 'game:create', { playerName: 'A', settings: { ...defaultMultiplayerSettings, maxPlayers: 4 }, isSolitaire: false });
    const gameId = created.data!.gameState.gameId;
    await ask(b.socket, 'game:join', { gameId, playerName: 'B' });
    await ask(a.socket, 'game:start', { gameId });
    const state = structuredClone(room(gameId).gameState);
    setUpWin(state, a.socket.id!);
    room(gameId).gameState = state;
    await ask(a.socket, 'game:playCard', { gameId, cardId: 'c-2', pileId: 0 });
    await new Promise<void>((resolve) => { setTimeout(resolve, 60); });
    expect(store.results).toHaveLength(0);
  });

  // A signed-in player whose browser closed takes the seat back by account, on any device; a guest has only the rejoin token.
  it('lets a signed-in player take back a held seat by account, with their own hand, and nobody else', async () => {
    const { ann, gameId, annId } = await table();
    await ask(ann.socket, 'game:start', { gameId });
    const hand = room(gameId).gameState.players.find((p) => p.id === annId)!.hand.map((c) => c.id);
    ann.socket.close();

    const back = await open('google-ann');
    const taken = await ask(back.socket, 'game:rejoinMine', {});
    expect(taken.ok).toBe(true);
    const mine = taken.data!.gameState.players.find((p) => p.id === back.socket.id)!;
    expect(mine.hand.map((c) => c.id)).toEqual(hand);
    expect(taken.data!.gameState.hostId).toBe(back.socket.id);

    const stranger = await open('google-dan');
    const refused = await ask(stranger.socket, 'game:rejoinMine', {});
    expect(refused).toMatchObject({ ok: false, gone: true });
    const guest = await open();
    expect(await ask(guest.socket, 'game:rejoinMine', {})).toMatchObject({ ok: false, gone: true });
  });

  it('answers a refused rejoin with gone, so the client stops trying', async () => {
    const { cy, gameId } = await table();
    const fresh = await open();
    const refused = await ask(fresh.socket, 'game:rejoin', { gameId, previousPlayerId: cy.socket.id, rejoinToken: 'wrong' });
    expect(refused).toMatchObject({ ok: false, gone: true });
  });

  // The seat was taken signed in. Signing out later (here, the session ends) does not change whose game it was.
  it('still credits a seat taken while signed in after the player\'s session is revoked', async () => {
    const { ann, bob, gameId, annId } = await table();
    await store.revokeSession(hashToken('token-google-bob'));
    await ask(ann.socket, 'game:start', { gameId });
    const state = structuredClone(room(gameId).gameState);
    setUpWin(state, annId);
    room(gameId).gameState = state;
    await ask(ann.socket, 'game:playCard', { gameId, cardId: 'c-2', pileId: 0 });
    await until(() => store.results.length >= 2);
    expect(store.results.map((r) => r.userId).sort()).toEqual([ann.userId, bob.userId].sort());
  });
});

// The host's kick is how a seat held by a dropped connection gets freed in a live game, over the real socket protocol.
describe('kicking a player whose connection dropped', () => {
  let server: ReturnType<typeof createRealtimeServer>;
  let url = '';
  const sockets: Socket[] = [];
  beforeEach(async () => {
    process.env.ALLOWED_ORIGINS = 'https://upndown.cloud';
    server = createRealtimeServer(0, { settings, store: new MemoryProfileStore(), provider: createFakeProvider() }, { noticeMs: 30, kickMs: 100 });
    await server.auth.start();
    await new Promise<void>((resolve) => server.httpServer.listen(0, () => resolve()));
    url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    delete process.env.ALLOWED_ORIGINS;
    sockets.splice(0).forEach((s) => s.close());
    await server.auth.stop();
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  });
  const open = async (): Promise<Socket> => {
    const socket = connect(url, { transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.on('connect', () => resolve()); socket.on('connect_error', reject); });
    return socket;
  };
  const ask = (socket: Socket, event: string, payload: unknown): Promise<Ack> => new Promise((resolve) => { socket.emit(event, payload, resolve); });
  const room = (gameId: string) => (server.manager as unknown as { rooms: Map<string, { gameState: GameState }> }).rooms.get(gameId)!;

  it('leaves the seat and its cards in place when the connection drops, then lets the host kick it and recovers the cards', async () => {
    const host = await open();
    const dropper = await open();
    const other = await open();
    const created = await ask(host, 'game:create', { playerName: 'Host', settings: { ...defaultMultiplayerSettings, maxPlayers: 4 }, isSolitaire: false });
    const gameId = created.data!.gameState.gameId;
    await ask(dropper, 'game:join', { gameId, playerName: 'Dropper' });
    await ask(other, 'game:join', { gameId, playerName: 'Other' });
    await ask(host, 'game:start', { gameId });

    const droppedId = dropper.id!;
    const handSize = room(gameId).gameState.players.find((p) => p.id === droppedId)!.hand.length;
    const pileBefore = room(gameId).gameState.drawPile.length;

    dropper.close();
    await new Promise<void>((resolve) => { setTimeout(resolve, 150); });
    // The dropped player is still seated, hand and all: a live game does not lose a player to a flaky connection.
    expect(room(gameId).gameState.players.map((p) => p.id)).toContain(droppedId);
    expect(room(gameId).gameState.drawPile).toHaveLength(pileBefore);

    const kicked = await ask(host, 'game:kickPlayer', { gameId, targetPlayerId: droppedId });
    expect(kicked.ok).toBe(true);
    const after = room(gameId).gameState;
    expect(after.players.map((p) => p.id)).not.toContain(droppedId);
    expect(after.drawPile).toHaveLength(pileBefore + handSize);
    expect(after.gamePhase).toBe('playing');
  });

  it('refuses a kick from anyone but the host over the socket', async () => {
    const host = await open();
    const guest = await open();
    const third = await open();
    const created = await ask(host, 'game:create', { playerName: 'Host', settings: { ...defaultMultiplayerSettings, maxPlayers: 4 }, isSolitaire: false });
    const gameId = created.data!.gameState.gameId;
    await ask(guest, 'game:join', { gameId, playerName: 'G' });
    await ask(third, 'game:join', { gameId, playerName: 'T' });
    await ask(host, 'game:start', { gameId });
    const refused = await ask(guest, 'game:kickPlayer', { gameId, targetPlayerId: third.id });
    expect(refused.ok).toBe(false);
    expect(room(gameId).gameState.players).toHaveLength(3);
  });
});
