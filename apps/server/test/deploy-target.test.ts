import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { io as ioClient } from 'socket.io-client';
import { createRealtimeServer } from '../src/index.js';

// Per-IP rate limits key on the resolved client IP. Too few trusted hops makes every user share the
// proxy's address; too many lets a client spoof its own. Each platform has a different proxy count.
// The address is not logged, so this watches what it is for: whether four visitors behind one proxy share a limit.
describe('DEPLOY_TARGET proxy hop defaults', () => {
  afterEach(() => {
    delete process.env.DEPLOY_TARGET;
    delete process.env.TRUSTED_PROXY_HOPS;
  });

  // Four visitors, each arriving as "10.0.0.N, 1.1.1.1": 1.1.1.1 is the proxy and the TCP peer is behind it. Each does
  // 20 game lookups, which a socket may (20 per 10s). One address may do 60 per 10s, so the fourth visitor is refused
  // if, and only if, the four were counted as one address.
  async function refusedWhenFourVisitorsArriveBehindOneProxy(): Promise<number> {
    const { httpServer } = createRealtimeServer(0);
    await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
    let refused = 0;
    for (let visitor = 1; visitor <= 4; visitor += 1) {
      const socket = ioClient(url, { transports: ['websocket'], forceNew: true, extraHeaders: { 'x-forwarded-for': `10.0.0.${visitor}, 1.1.1.1` } });
      await new Promise<void>((resolve) => socket.on('server:ready', () => resolve()));
      for (let i = 0; i < 20; i += 1) {
        const ack = await new Promise<{ ok: boolean; error?: string }>((resolve) => { socket.emit('game:lookup', { gameId: 'ZZZZZZ' }, resolve); });
        if (!ack.ok && /Too many/.test(ack.error ?? '')) refused += 1;
      }
      socket.close();
    }
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    return refused;
  }

  it('skiff trusts two proxies, so each visitor is their own address', async () => {
    process.env.DEPLOY_TARGET = 'skiff';
    expect(await refusedWhenFourVisitorsArriveBehindOneProxy()).toBe(0);
  });

  it('railway trusts one proxy, so visitors behind it share one address', async () => {
    process.env.DEPLOY_TARGET = 'railway';
    expect(await refusedWhenFourVisitorsArriveBehindOneProxy()).toBe(20);
  });

  it('explicit TRUSTED_PROXY_HOPS overrides the target default', async () => {
    process.env.DEPLOY_TARGET = 'skiff';
    process.env.TRUSTED_PROXY_HOPS = '1';
    expect(await refusedWhenFourVisitorsArriveBehindOneProxy()).toBe(20);
  });

  it('with no platform set, the address is the connection itself, so every visitor shares it', async () => {
    expect(await refusedWhenFourVisitorsArriveBehindOneProxy()).toBe(20);
  });
});

// The address is used for rate limits and nothing else. Writing it to the log would keep it on disk for no reason.
describe('the client address is not logged', () => {
  afterEach(() => { delete process.env.TRUSTED_PROXY_HOPS; vi.restoreAllMocks(); });

  it('appears in no log line when someone connects, however the proxies describe them', async () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    const logs: string[] = [];
    const sink = (line: unknown): void => { logs.push(String(line)); };
    vi.spyOn(console, 'log').mockImplementation(sink);
    vi.spyOn(console, 'warn').mockImplementation(sink);
    vi.spyOn(console, 'error').mockImplementation(sink);
    const { httpServer } = createRealtimeServer(0);
    await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    const socket = ioClient(`http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`, {
      transports: ['websocket'], extraHeaders: { 'x-forwarded-for': '203.0.113.7, 198.51.100.9' }
    });
    await new Promise<void>((resolve) => socket.on('server:ready', () => resolve()));
    socket.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));

    const connected = logs.map((l) => JSON.parse(l)).find((r) => r.event === 'socket.connected');
    expect(connected).toBeDefined();
    expect(connected).not.toHaveProperty('clientIp');
    const everything = logs.join('\n');
    for (const address of ['203.0.113.7', '198.51.100.9', '127.0.0.1']) expect(everything).not.toContain(address);
  });
});

