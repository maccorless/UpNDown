import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRealtimeServer } from '../src/index.js';

// A rejected origin used to leave only a stack trace, so nobody could tell a real player on the wrong
// domain from a bot. The log must name the origin that was refused.
describe('CORS rejection logging', () => {
  let close: (() => Promise<void>) | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.ALLOWED_ORIGINS;
    await close?.();
    close = null;
  });

  it('logs the refused origin and still refuses it', async () => {
    process.env.ALLOWED_ORIGINS = 'https://allowed.example';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { httpServer } = createRealtimeServer(0);
    await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    close = () => new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve())));
    const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

    const refused = await fetch(`${url}/health`, { headers: { Origin: 'https://other.example' } });
    expect(refused.status).toBe(500);
    expect(warn.mock.calls.map(([line]) => String(line)).join('\n')).toContain('"origin":"https://other.example"');

    const accepted = await fetch(`${url}/health`, { headers: { Origin: 'https://allowed.example' } });
    expect(accepted.status).toBe(200);
  });
});
