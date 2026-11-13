import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { io as ioClient } from 'socket.io-client';
import { createRealtimeServer } from '../src/index.js';

// Per-IP rate limits key on the resolved client IP. Too few trusted hops makes every user share the
// proxy's address; too many lets a client spoof its own. Each platform has a different proxy count.
describe('DEPLOY_TARGET proxy hop defaults', () => {
  afterEach(() => {
    delete process.env.DEPLOY_TARGET;
    delete process.env.TRUSTED_PROXY_HOPS;
    vi.restoreAllMocks();
  });

  async function resolvedClientIp(): Promise<string> {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => { logs.push(line); });
    const { httpServer } = createRealtimeServer(0);
    await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    const socket = ioClient(`http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`, {
      transports: ['websocket'],
      extraHeaders: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1' }
    });
    await new Promise<void>((resolve) => socket.on('server:ready', () => resolve()));
    socket.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    const connected = logs.map((l) => JSON.parse(l)).find((r) => r.event === 'socket.connected');
    return connected.clientIp;
  }

  it('skiff trusts two proxies', async () => {
    process.env.DEPLOY_TARGET = 'skiff';
    expect(await resolvedClientIp()).toBe('9.9.9.9');
  });

  it('railway trusts one proxy', async () => {
    process.env.DEPLOY_TARGET = 'railway';
    expect(await resolvedClientIp()).toBe('1.1.1.1');
  });

  it('explicit TRUSTED_PROXY_HOPS overrides the target default', async () => {
    process.env.DEPLOY_TARGET = 'skiff';
    process.env.TRUSTED_PROXY_HOPS = '1';
    expect(await resolvedClientIp()).toBe('1.1.1.1');
  });
});
