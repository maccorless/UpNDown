import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultMultiplayerSettings } from '@upndown/shared-types';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSettings } from '../src/auth/config.js';
import { hashToken } from '../src/auth/sessions.js';
import { createRealtimeServer } from '../src/index.js';
import { createFakeProvider } from './helpers/fake-provider.js';
import { MemoryProfileStore } from './helpers/memory-store.js';

const settings: AuthSettings = {
  databaseUrl: 'unused', publicBaseUrl: 'https://upndown.cloud', stateSecret: 's'.repeat(40), googleClientId: 'id', googleClientSecret: 'secret', legacyHost: undefined
};
type Ack = { ok: boolean; data?: { gameState: { gameId: string } }; error?: string };

describe('server hardening', () => {
  let server: ReturnType<typeof createRealtimeServer>;
  let store: MemoryProfileStore;
  let url = '';
  let distDir = '';
  const sockets: Socket[] = [];
  const logs: string[] = [];

  beforeEach(async () => {
    process.env.ALLOWED_ORIGINS = 'https://upndown.cloud';
    distDir = mkdtempSync(path.join(tmpdir(), 'upndown-dist-'));
    writeFileSync(path.join(distDir, 'index.html'), '<title>UpNDown</title>');
    process.env.CLIENT_DIST_DIR = distDir;
    const sink = (line: unknown): void => { logs.push(String(line)); };
    vi.spyOn(console, 'log').mockImplementation(sink);
    vi.spyOn(console, 'warn').mockImplementation(sink);
    vi.spyOn(console, 'error').mockImplementation(sink);
    store = new MemoryProfileStore();
    server = createRealtimeServer(0, { settings, store, provider: createFakeProvider() });
    await server.auth.start();
    await new Promise<void>((resolve) => server.httpServer.listen(0, () => resolve()));
    url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.CLIENT_DIST_DIR;
    sockets.splice(0).forEach((s) => s.close());
    logs.length = 0;
    vi.restoreAllMocks();
    await server.auth.stop();
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
    rmSync(distDir, { recursive: true, force: true });
  });

  const open = (extraHeaders: Record<string, string> = {}): Promise<Socket> => new Promise((resolve, reject) => {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders });
    sockets.push(socket);
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
  const ask = (socket: Socket, event: string, payload: unknown): Promise<Ack> => new Promise((resolve) => { socket.emit(event, payload, resolve); });

  describe('response headers', () => {
    it('tells browsers not to sniff types or frame the page, and does not advertise the framework', async () => {
      const res = await fetch(`${url}/health`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(res.headers.has('x-powered-by')).toBe(false);
    });

    it('sends them on the client page and on errors too', async () => {
      for (const p of ['/', '/api/nothing']) {
        const res = await fetch(`${url}${p}`);
        expect(res.headers.get('x-frame-options')).toBe('DENY');
      }
    });
  });

  describe('unknown API paths', () => {
    // The client page is served for any unknown path so invite links work. That must not apply to the API.
    it('answer 404 as JSON, not the client page with a 200', async () => {
      for (const [method, p] of [['GET', '/api/nothing'], ['POST', '/api/me/nothing'], ['GET', '/auth/unknown/path']] as const) {
        const res = await fetch(`${url}${p}`, { method });
        expect(res.status).toBe(404);
        expect(res.headers.get('content-type')).toContain('application/json');
      }
    });

    it('still serve the client page for an ordinary unknown path, so invite links work', async () => {
      const res = await fetch(`${url}/?game=ABC123`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<title>UpNDown</title>');
      expect((await fetch(`${url}/anything/else`)).status).toBe(200);
    });
  });

  // The cors option is what refuses a foreign page here, on the websocket upgrade as well as on polling (checked: with
  // no other check in place a hostile origin is still refused). It is a library behaviour, so it is pinned by a test:
  // an upgrade of the dependency that stopped doing this would show up here.
  describe('the websocket upgrade', () => {
    it('accepts a page from an allowed origin, and a client that sends no origin', async () => {
      await expect(open({ origin: 'https://upndown.cloud' })).resolves.toBeDefined();
      await expect(open()).resolves.toBeDefined();
    });

    it('refuses a page from any other origin, and logs that it did', async () => {
      await expect(open({ origin: 'https://evil.example' })).rejects.toBeDefined();
      await expect(open({ origin: 'https://upndown.cloud.evil.example' })).rejects.toBeDefined();
      const refusals = logs.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r?.event === 'cors.origin_rejected');
      expect(refusals.map((r) => r.origin)).toEqual(['https://evil.example', 'https://upndown.cloud.evil.example']);
    });
  });

  describe('message size', () => {
    it('closes a connection that sends a message far larger than any real one', async () => {
      const socket = await open();
      const closed = new Promise<string>((resolve) => socket.on('disconnect', (reason) => resolve(reason)));
      socket.emit('game:lookup', { gameId: 'A'.repeat(64 * 1024) });
      expect(await closed).toMatch(/close|error/);
    });

    it('still carries ordinary messages', async () => {
      const socket = await open();
      const res = await ask(socket, 'game:lookup', { gameId: 'ZZZZZZ' });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not available/);
    });
  });

  describe('the handshake and the database', () => {
    // Games must not depend on the database. A session lookup that never answers must not hold a connection forever.
    it('lets a connection in as a guest when the session lookup never answers', async () => {
      store.findSession = () => new Promise(() => undefined);
      const { userId } = await store.findOrCreateUser('google', 'g-stuck');
      await store.createSession(userId, hashToken('stuck-token'), new Date(Date.now() + 1e9));
      const started = Date.now();
      const socket = await open({ cookie: '__Host-upndown_session=stuck-token' });
      const took = Date.now() - started;
      expect(took).toBeGreaterThanOrEqual(1400);
      expect(took).toBeLessThan(5000);
      expect(server.io.sockets.sockets.get(socket.id!)?.data.userId).toBeUndefined();
      expect(logs.join('\n')).toContain('auth.session_lookup_timeout');
    });

    it('is not slowed when the lookup answers promptly', async () => {
      const { userId } = await store.findOrCreateUser('google', 'g-fast');
      await store.createSession(userId, hashToken('fast-token'), new Date(Date.now() + 1e9));
      const started = Date.now();
      const socket = await open({ cookie: '__Host-upndown_session=fast-token' });
      expect(Date.now() - started).toBeLessThan(1000);
      expect(server.io.sockets.sockets.get(socket.id!)?.data.userId).toBe(userId);
    });
  });

  describe('what the log says about card lookups', () => {
    it('records that a lookup happened, never which card or what it turned out to be', async () => {
      const host = await open();
      const guest = await open();
      const created = await ask(host, 'game:create', { playerName: 'Host', settings: { ...defaultMultiplayerSettings, maxPlayers: 4, allowCardLookup: true }, isSolitaire: false });
      const gameId = created.data!.gameState.gameId;
      await ask(guest, 'game:join', { gameId, playerName: 'Guest' });
      await ask(host, 'game:start', { gameId });
      const looked = await ask(host, 'game:cardLookup', { gameId, cardValue: 42 });
      expect(looked.ok).toBe(true);
      const line = logs.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((r) => r?.event === 'game.card_lookup');
      expect(line).toBeDefined();
      expect(line).not.toHaveProperty('cardValue');
      expect(line).not.toHaveProperty('status');
    });
  });
});
