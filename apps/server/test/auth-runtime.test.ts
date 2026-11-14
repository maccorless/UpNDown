import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuthRuntime } from '../src/auth/runtime.js';
import { createRealtimeServer } from '../src/index.js';

const logs: Array<{ level: string; event: string; fields?: Record<string, unknown> | undefined }> = [];
const log = (level: string, event: string, fields?: Record<string, unknown>) => { logs.push({ level, event, fields }); };

describe('auth runtime', () => {
  afterEach(() => { logs.length = 0; });

  it('stays off and logs why when unconfigured', async () => {
    const auth = createAuthRuntime({}, log as never);
    await auth.start();
    expect(auth.isEnabled()).toBe(false);
    expect(logs).toEqual([{ level: 'info', event: 'auth.disabled', fields: { reason: 'not configured' } }]);
  });

  // The game must never depend on the database: a bad DATABASE_URL leaves login off and start() resolving.
  it('stays off, does not throw and logs an error when the database is unreachable', async () => {
    const auth = createAuthRuntime({
      DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none',
      PUBLIC_BASE_URL: 'https://upndown.cloud',
      AUTH_STATE_SECRET: 'x'.repeat(32),
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret'
    }, log as never);
    await expect(auth.start()).resolves.toBeUndefined();
    expect(auth.isEnabled()).toBe(false);
    expect(logs.find((entry) => entry.event === 'auth.disabled')?.level).toBe('error');
    expect(JSON.stringify(logs)).not.toContain('postgres://');
    await auth.stop();
  });
});

describe('GET /api/auth/config', () => {
  let close: (() => Promise<void>) | null = null;
  let distDir = '';
  afterEach(async () => {
    delete process.env.CLIENT_DIST_DIR;
    await close?.();
    close = null;
    if (distDir) rmSync(distDir, { recursive: true, force: true });
    distDir = '';
  });

  it('reports auth off as JSON, not as the client page the catch-all would serve', async () => {
    distDir = mkdtempSync(path.join(tmpdir(), 'upndown-dist-'));
    writeFileSync(path.join(distDir, 'index.html'), '<title>UpNDown</title>');
    process.env.CLIENT_DIST_DIR = distDir;
    const { httpServer } = createRealtimeServer(0);
    await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    close = () => new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve())));

    const response = await fetch(`http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/api/auth/config`);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ enabled: false, providers: [] });
  });
});
