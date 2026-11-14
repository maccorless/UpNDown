import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PRESIDENT_FIRST_NAMES, PRESIDENT_LAST_NAMES } from '@upndown/shared-types';
import { io as connect } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthSettings } from '../src/auth/config.js';
import { hashToken } from '../src/auth/sessions.js';
import { createRealtimeServer } from '../src/index.js';
import { createFakeProvider } from './helpers/fake-provider.js';
import { MemoryProfileStore } from './helpers/memory-store.js';

const BASE = 'https://upndown.cloud';
const settings = (over: Partial<AuthSettings> = {}): AuthSettings => ({
  databaseUrl: 'unused', publicBaseUrl: BASE, stateSecret: 's'.repeat(40), googleClientId: 'id', googleClientSecret: 'secret',
  legacyHost: undefined, ...over
});

type Jar = Map<string, string>;
const absorb = (jar: Jar, res: Response): void => {
  for (const line of res.headers.getSetCookie()) {
    const [pair = ''] = line.split(';');
    const index = pair.indexOf('=');
    const name = pair.slice(0, index);
    if (/Max-Age=0/i.test(line)) jar.delete(name); else jar.set(name, pair.slice(index + 1));
  }
};
const cookieHeader = (jar: Jar): string => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

describe('auth routes', () => {
  let url = '';
  let distDir = '';
  let store: MemoryProfileStore;
  let server: ReturnType<typeof createRealtimeServer>;
  const sockets: Array<{ close: () => void }> = [];

  async function boot(over: Partial<AuthSettings> = {}, providerBehavior = {}): Promise<ReturnType<typeof createFakeProvider>> {
    const provider = createFakeProvider(providerBehavior);
    store = new MemoryProfileStore();
    server = createRealtimeServer(0, { settings: settings(over), store, provider });
    await server.auth.start();
    await new Promise<void>((resolve) => server.httpServer.listen(0, () => resolve()));
    url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
    return provider;
  }

  beforeEach(() => {
    distDir = mkdtempSync(path.join(tmpdir(), 'upndown-dist-'));
    writeFileSync(path.join(distDir, 'index.html'), '<title>UpNDown</title>');
    process.env.CLIENT_DIST_DIR = distDir;
    // Production sets this; without it the existing CORS check refuses the canonical origin.
    process.env.ALLOWED_ORIGINS = 'https://upndown.cloud,http://localhost:5173';
  });
  afterEach(async () => {
    delete process.env.CLIENT_DIST_DIR;
    delete process.env.ALLOWED_ORIGINS;
    sockets.splice(0).forEach((s) => s.close());
    await server.auth.stop();
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
    rmSync(distDir, { recursive: true, force: true });
  });

  const get = (p: string, jar?: Jar, headers: Record<string, string> = {}) =>
    fetch(`${url}${p}`, { redirect: 'manual', headers: { ...(jar ? { cookie: cookieHeader(jar) } : {}), ...headers } });

  // fetch ignores a Host override, so the host-dependent tests use node:http.
  const rawGet = (p: string, headers: Record<string, string>): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> =>
    new Promise((resolve, reject) => {
      const port = (server.httpServer.address() as AddressInfo).port;
      const req = request({ host: '127.0.0.1', port, path: p, headers }, (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
      });
      req.on('error', reject);
      req.end();
    });

  // Walks start then callback like a browser would, returning the jar holding the new session.
  async function signIn(returnPath = '/', jar: Jar = new Map()): Promise<{ jar: Jar; callback: Response }> {
    const start = await get(`/auth/google/start?return=${encodeURIComponent(returnPath)}`, jar);
    absorb(jar, start);
    const state = new URL(start.headers.get('location') as string).searchParams.get('state') as string;
    const callback = await get(`/auth/google/callback?code=c0de&state=${state}`, jar);
    absorb(jar, callback);
    return { jar, callback };
  }

  it('says auth is on, lists google, and answers as JSON rather than the client page', async () => {
    await boot();
    const res = await get('/api/auth/config');
    expect(await res.json()).toEqual({ enabled: true, providers: ['google'] });
    const unknown = await get('/auth/facebook/start');
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('content-type')).toContain('application/json');
  });

  it('start sends the browser to Google with state and an S256 challenge, and signs a short-lived cookie', async () => {
    await boot();
    const res = await get('/auth/google/start?return=/%3Fgame%3DABC123');
    expect(res.status).toBe(302);
    const target = new URL(res.headers.get('location') as string);
    expect(target.origin).toBe('https://provider.test');
    expect(target.searchParams.get('redirect_uri')).toBe(`${BASE}/auth/google/callback`);
    expect(target.searchParams.get('state')).toHaveLength(32);
    expect(target.searchParams.get('code_challenge')).toBeTruthy();
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('oauth_state='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/Path=\/auth/);
    expect(cookie).toMatch(/Max-Age=600/);
  });

  it('completes a sign-in: session cookie set, return path honoured, only a hash stored, /api/me works', async () => {
    const provider = await boot();
    const { jar, callback } = await signIn('/?game=ABC123');
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe(`${BASE}/?game=ABC123`);

    const session = callback.headers.getSetCookie().find((c) => c.startsWith('__Host-upndown_session='));
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/Secure/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(session).toMatch(/Path=\/(;|$)/);
    expect(session).not.toMatch(/Domain/i);
    expect(session).toMatch(/Max-Age=77\d{5}/); // 90 days

    const token = jar.get('__Host-upndown_session') as string;
    expect([...store.sessions.keys()].some((key) => key.includes(Buffer.from(token).toString('hex')))).toBe(false);
    expect(store.sessions.size).toBe(1);
    expect(provider.exchangeCalls).toHaveLength(1);
    expect(provider.exchangeCalls[0]?.redirectUri).toBe(`${BASE}/auth/google/callback`);
    expect(provider.exchangeCalls[0]?.codeVerifier.length).toBeGreaterThan(30);

    const me = await get('/api/me', jar);
    expect(me.status).toBe(200);
    const body = await me.json() as { playerName: string; settings: { playerName: string } };
    expect(body.playerName).toMatch(/^\S+ .+$/);
    expect(body.settings).toEqual({ playerName: body.playerName });
    expect(me.headers.get('cache-control')).toBe('no-store');
  });

  it('uses plain cookie names and no Secure flag on http localhost', async () => {
    await boot({ publicBaseUrl: 'http://localhost:5173' });
    const { callback } = await signIn();
    const cookies = callback.headers.getSetCookie().join('\n');
    expect(cookies).toMatch(/^upndown_session=/m);
    expect(cookies).not.toMatch(/Secure/);
  });

  it('gives the same account the same user on a second sign-in', async () => {
    await boot();
    await signIn();
    await signIn();
    expect(store.users.size).toBe(1);
    expect(store.sessions.size).toBe(2);
  });

  it('treats a guest as 401, and a forged or unknown session cookie the same way', async () => {
    await boot();
    expect((await get('/api/me')).status).toBe(401);
    expect((await get('/api/me', new Map([['__Host-upndown_session', 'forged']]))).status).toBe(401);
  });

  describe('failed sign-ins land on /?login= and never create a session', () => {
    it('cancelled when the player says no at Google', async () => {
      await boot();
      const res = await get('/auth/google/callback?error=access_denied');
      expect(res.headers.get('location')).toBe(`${BASE}/?login=cancelled`);
      expect(store.sessions.size).toBe(0);
    });

    it('failed for any other provider error', async () => {
      await boot();
      expect((await get('/auth/google/callback?error=server_error')).headers.get('location')).toBe(`${BASE}/?login=failed`);
    });

    // Without the state check, anyone could trick a browser into finishing their login (login CSRF).
    it('failed when state does not match the cookie', async () => {
      await boot();
      const jar: Jar = new Map();
      absorb(jar, await get('/auth/google/start', jar));
      const res = await get('/auth/google/callback?code=c&state=not-the-state', jar);
      expect(res.headers.get('location')).toBe(`${BASE}/?login=failed`);
      expect(store.sessions.size).toBe(0);
    });

    it('failed with no state cookie at all', async () => {
      await boot();
      expect((await get('/auth/google/callback?code=c&state=x')).headers.get('location')).toBe(`${BASE}/?login=failed`);
    });

    it('failed when the state cookie was tampered with', async () => {
      await boot();
      const jar: Jar = new Map();
      const start = await get('/auth/google/start', jar);
      absorb(jar, start);
      const state = new URL(start.headers.get('location') as string).searchParams.get('state');
      const [, sig] = (jar.get('oauth_state') as string).split('.');
      const forged = Buffer.from(JSON.stringify({ state, verifier: 'x', returnPath: 'https://evil.com', expiresAtMs: Date.now() + 1e6 })).toString('base64url');
      jar.set('oauth_state', `${forged}.${sig}`);
      const res = await get(`/auth/google/callback?code=c&state=${state}`, jar);
      expect(res.headers.get('location')).toBe(`${BASE}/?login=failed`);
    });

    it('failed when Google rejects the code exchange', async () => {
      await boot({}, { failAt: 'exchange' });
      const { callback } = await signIn();
      expect(callback.headers.get('location')).toBe(`${BASE}/?login=failed`);
      expect(store.sessions.size).toBe(0);
    });

    it('failed when the profile cannot be read, and leaves no half-made account', async () => {
      await boot({}, { failAt: 'profile' });
      await signIn();
      expect(store.users.size).toBe(0);
    });

    it('a state cookie works once: the callback clears it', async () => {
      await boot();
      const { jar } = await signIn();
      expect(jar.has('oauth_state')).toBe(false);
    });
  });

  it('never redirects off site, whatever return says', async () => {
    await boot();
    for (const evil of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
      const { callback } = await signIn(evil);
      expect(callback.headers.get('location')).toBe(`${BASE}/`);
    }
  });

  describe('sign out', () => {
    const logout = (jar: Jar, headers: Record<string, string> = { 'content-type': 'application/json', origin: BASE }) =>
      fetch(`${url}/api/auth/logout`, { method: 'POST', headers: { ...headers, cookie: cookieHeader(jar) }, body: '{}' });

    it('revokes the session server side, so a copied cookie stops working', async () => {
      await boot();
      const { jar } = await signIn();
      const copy: Jar = new Map(jar);
      const res = await logout(jar);
      expect(res.status).toBe(200);
      absorb(jar, res);
      expect(jar.has('__Host-upndown_session')).toBe(false);
      expect(store.sessions.size).toBe(0);
      expect((await get('/api/me', copy)).status).toBe(401);
    });

    it('refuses a foreign Origin or a non-JSON body, and keeps the session', async () => {
      await boot();
      const { jar } = await signIn();
      // An origin the CORS list allows but that is not the canonical host reaches our own check.
      expect((await logout(jar, { 'content-type': 'application/json', origin: 'http://localhost:5173' })).status).toBe(403);
      // A hostile origin is refused earlier, by the CORS layer.
      expect((await logout(jar, { 'content-type': 'application/json', origin: 'https://evil.com' })).status).toBeGreaterThanOrEqual(400);
      expect((await logout(jar, { 'content-type': 'application/json' })).status).toBe(403);
      expect((await logout(jar, { 'content-type': 'text/plain', origin: BASE })).status).toBe(403);
      expect(store.sessions.size).toBe(1);
      expect((await get('/api/me', jar)).status).toBe(200);
    });

    it('is harmless with no session', async () => {
      await boot();
      expect((await logout(new Map())).status).toBe(200);
    });
  });

  describe('account name and settings', () => {
    const json = { 'content-type': 'application/json', origin: BASE };
    const put = (jar: Jar, body: unknown, headers: Record<string, string> = json) =>
      fetch(`${url}/api/me/settings`, { method: 'PUT', headers: { ...headers, cookie: cookieHeader(jar) }, body: JSON.stringify(body) });
    const me = async (jar: Jar) => (await (await get('/api/me', jar)).json()) as { playerName: string; settings: Record<string, unknown> };
    // A genuinely different account: the fake provider always returns one Google account, so sign-in cannot make a second.
    const otherUserJar = async (googleId: string): Promise<Jar> => {
      const { userId } = await store.findOrCreateUser('google', googleId);
      await store.createSession(userId, hashToken(`token-${googleId}`), new Date(Date.now() + 1e9));
      return new Map([['__Host-upndown_session', `token-${googleId}`]]);
    };
    const solitaire = { minCardValue: 2, maxCardValue: 99, handSize: 7, minPlayers: 1, maxPlayers: 1, minCardsPerTurn: 2, autoRefillHand: true, allowUndo: true, privateGame: false, allowCardLookup: false, showArrows: true };

    it('names a new account with a president mash-up and keeps that name', async () => {
      await boot();
      const { jar } = await signIn();
      const first = await me(jar);
      const [firstName, ...rest] = first.playerName.split(' ');
      expect(PRESIDENT_FIRST_NAMES as readonly string[]).toContain(firstName);
      expect(PRESIDENT_LAST_NAMES as readonly string[]).toContain(rest.join(' '));
      expect((await me(jar)).playerName).toBe(first.playerName);
    });

    it('names an older account that has settings but no name, without losing the settings', async () => {
      await boot();
      const { jar } = await signIn();
      const [user] = [...store.users.values()];
      user!.settings = { enableSounds: false };
      const body = await me(jar);
      expect(body.settings).toEqual({ enableSounds: false, playerName: body.playerName });
    });

    it('replaces the stored document, keeps the name when the body has none, and drops unknown keys', async () => {
      await boot();
      const { jar } = await signIn();
      const { playerName } = await me(jar);
      expect((await put(jar, { enableSounds: false, solitaire, evil: 'x' })).status).toBe(200);
      expect((await me(jar)).settings).toEqual({ playerName, enableSounds: false, solitaire });
      // A second write replaces the first rather than merging into it.
      expect((await put(jar, { enableSounds: true })).status).toBe(200);
      expect((await me(jar)).settings).toEqual({ playerName, enableSounds: true });
    });

    it('saves a new name, cleaned of control and bidirectional characters', async () => {
      await boot();
      const { jar } = await signIn();
      await me(jar);
      const res = await put(jar, { playerName: '  Ab\u202Ee\u0007  ' });
      expect(res.status).toBe(200);
      expect((await me(jar)).playerName).toBe('Abe');
    });

    it('refuses a name that is empty after cleaning, and an invalid settings block, and changes nothing', async () => {
      await boot();
      const { jar } = await signIn();
      const { playerName } = await me(jar);
      for (const bad of [{ playerName: '   ' }, { playerName: '\u202E' }, { solitaire: { minCardValue: 1 } }, { enableSounds: 'yes' }]) {
        expect((await put(jar, bad)).status).toBe(400);
      }
      expect((await me(jar)).settings).toEqual({ playerName });
    });

    it('requires a session, the canonical Origin and a JSON body', async () => {
      await boot();
      expect((await put(new Map(), { enableSounds: false })).status).toBe(401);
      const { jar } = await signIn();
      expect((await put(jar, { enableSounds: false }, { 'content-type': 'application/json', origin: 'http://localhost:5173' })).status).toBe(403);
      expect((await put(jar, { enableSounds: false }, { 'content-type': 'application/json' })).status).toBe(403);
      expect((await put(jar, { enableSounds: false }, { 'content-type': 'text/plain', origin: BASE })).status).toBe(403);
    });

    it('keeps one account\'s settings away from another\'s', async () => {
      await boot();
      const a = (await signIn()).jar;
      await me(a);
      await put(a, { enableSounds: false });
      const b = await otherUserJar('someone-else');
      const bSettings = (await me(b)).settings;
      expect(bSettings).not.toHaveProperty('enableSounds');
      expect((await me(a)).settings).toHaveProperty('enableSounds', false);
    });

    // The per-IP limit would let one person write all day; many people share an address, so a user limit sits on top.
    it('limits one user to 30 saves a minute without blocking other users on the same address', async () => {
      await boot();
      const a = (await signIn()).jar;
      await me(a);
      const codes: number[] = [];
      for (let i = 0; i < 32; i += 1) codes.push((await put(a, { enableSounds: i % 2 === 0 })).status);
      expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
      expect(codes.slice(30)).toEqual([429, 429]);
      const b = await otherUserJar('another-person');
      await me(b);
      expect((await put(b, { enableSounds: false })).status).toBe(200);
    });
  });

  describe('session sliding', () => {
    it('extends a session not used for a day and re-sends the cookie, but not one used today', async () => {
      await boot();
      const { jar } = await signIn();
      const first = await get('/api/me', jar);
      expect(first.headers.getSetCookie()).toHaveLength(0);

      const [entry] = [...store.sessions.values()];
      entry!.lastSeenAt = new Date(Date.now() - 2 * 86_400_000);
      entry!.expiresAt = new Date(Date.now() + 10 * 86_400_000);
      const second = await get('/api/me', jar);
      expect(second.headers.getSetCookie().join()).toMatch(/__Host-upndown_session=/);
      expect(entry!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 80 * 86_400_000);
    });
  });

  describe('rate limit', () => {
    it('stops a flood of sign-in starts from one address', async () => {
      await boot();
      const codes: number[] = [];
      for (let i = 0; i < 12; i += 1) codes.push((await get('/auth/google/start')).status);
      expect(codes.slice(0, 10).every((c) => c === 302)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
    });

    it('counts the address trustedProxyHops from the right, so a spoofed X-Forwarded-For does not dodge it', async () => {
      process.env.TRUSTED_PROXY_HOPS = '1';
      try {
        await boot();
        const codes: number[] = [];
        // The client prepends a new fake address each time; the proxy appends the real one (9.9.9.9) last.
        for (let i = 0; i < 12; i += 1) codes.push((await get('/auth/google/start', undefined, { 'x-forwarded-for': `6.6.6.${i}, 9.9.9.9` })).status);
        expect(codes.slice(10)).toEqual([429, 429]);
      } finally {
        delete process.env.TRUSTED_PROXY_HOPS;
      }
    });
  });

  describe('old address redirect', () => {
    const page = { accept: 'text/html,application/xhtml+xml' };
    it('sends page loads on the legacy host to the canonical host and keeps the invite path', async () => {
      await boot({ legacyHost: 'old.up.railway.app' });
      const res = await rawGet('/?game=ABC123', { ...page, host: 'old.up.railway.app' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`${BASE}/?game=ABC123`);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers.vary).toBe('Host, Accept');
    });

    it('leaves the API, health checks and the canonical host alone', async () => {
      await boot({ legacyHost: 'old.up.railway.app' });
      expect((await rawGet('/health', { host: 'old.up.railway.app' })).status).toBe(200);
      expect((await rawGet('/api/auth/config', { host: 'old.up.railway.app', accept: 'application/json' })).status).toBe(200);
      expect((await rawGet('/', { ...page, host: 'upndown.cloud' })).status).toBe(200);
      expect((await rawGet('/', { ...page, host: 'somewhere.else' })).status).toBe(200);
    });

    it('does nothing when no legacy host is configured (Skiff)', async () => {
      await boot();
      expect((await rawGet('/', { ...page, host: 'old.up.railway.app' })).status).toBe(200);
    });

    it('never redirects to itself if PUBLIC_BASE_URL is the legacy host', async () => {
      await boot({ publicBaseUrl: 'https://old.up.railway.app', legacyHost: 'old.up.railway.app' });
      expect((await rawGet('/', { ...page, host: 'old.up.railway.app' })).status).toBe(200);
    });

    it('refuses a request path that could escape the concatenated host', async () => {
      await boot({ legacyHost: 'old.up.railway.app' });
      const res = await rawGet('//evil.com/x', { ...page, host: 'old.up.railway.app' });
      expect(res.status).not.toBe(302);
    });
  });

  describe('socket handshake', () => {
    const open = async (jar?: Jar): Promise<string> => {
      const client = connect(url, { transports: ['websocket'], extraHeaders: jar ? { cookie: cookieHeader(jar) } : {}, forceNew: true });
      sockets.push(client);
      await new Promise<void>((resolve, reject) => { client.on('connect', () => resolve()); client.on('connect_error', reject); });
      return client.id as string;
    };

    it('attaches the user to the socket for a signed-in browser, and nothing for a guest', async () => {
      await boot();
      const { jar } = await signIn();
      const signed = server.io.sockets.sockets.get(await open(jar));
      const guest = server.io.sockets.sockets.get(await open());
      expect(signed?.data.userId).toBe([...store.users.keys()][0]);
      expect(signed?.data.sessionId).toBeTruthy();
      expect(guest?.data.userId).toBeUndefined();
    });

    it('still connects as a guest when the cookie is junk', async () => {
      await boot();
      const socket = server.io.sockets.sockets.get(await open(new Map([['__Host-upndown_session', 'junk']])));
      expect(socket?.data.userId).toBeUndefined();
    });

    // A stale socket must not keep crediting an account whose session was just revoked.
    it('clears the user from live sockets when that session signs out, and leaves other sockets alone', async () => {
      await boot();
      const { jar } = await signIn();
      const { jar: otherJar } = await signIn();
      const mine = server.io.sockets.sockets.get(await open(jar));
      const other = server.io.sockets.sockets.get(await open(otherJar));
      await fetch(`${url}/api/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, cookie: cookieHeader(jar) }, body: '{}' });
      expect(mine?.data.userId).toBeUndefined();
      expect(mine?.data.sessionId).toBeUndefined();
      expect(other?.data.userId).toBeTruthy();
    });
  });
});
