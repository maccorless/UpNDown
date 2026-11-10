import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRealtimeServer } from '../src/index.js';

// The single-container deploy depends on the server handing out the client:
// invite links (/?game=ABC123) and deep paths must load the app, while /health stays an API.
describe('built client serving', () => {
  let closeServer: (() => Promise<void>) | null = null;
  let distDir = '';

  afterEach(async () => {
    delete process.env.CLIENT_DIST_DIR;
    if (closeServer) {
      await closeServer();
      closeServer = null;
    }
    if (distDir) {
      rmSync(distDir, { recursive: true, force: true });
      distDir = '';
    }
  });

  async function start(): Promise<string> {
    const { httpServer } = createRealtimeServer(0);
    await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    closeServer = () => new Promise<void>((resolve, reject) => httpServer.close((err) => (err ? reject(err) : resolve())));
    return `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  }

  it('serves the client for invite links and unknown paths, and keeps /health as JSON', async () => {
    distDir = mkdtempSync(path.join(tmpdir(), 'upndown-dist-'));
    writeFileSync(path.join(distDir, 'index.html'), '<title>UpNDown</title>');
    writeFileSync(path.join(distDir, 'app.js'), 'console.log(1);');
    process.env.CLIENT_DIST_DIR = distDir;
    const url = await start();

    const invite = await fetch(`${url}/?game=ABC123`);
    expect(invite.status).toBe(200);
    expect(await invite.text()).toContain('UpNDown');

    const deepPath = await fetch(`${url}/some/route`);
    expect(await deepPath.text()).toContain('UpNDown');

    const asset = await fetch(`${url}/app.js`);
    expect(await asset.text()).toBe('console.log(1);');

    const health = await fetch(`${url}/health`);
    expect((await health.json()).ok).toBe(true);
  });

  it('serves no client when CLIENT_DIST_DIR is unset, so local dev keeps using Vite', async () => {
    const url = await start();
    const response = await fetch(`${url}/`);
    expect(response.status).toBe(404);
  });
});
