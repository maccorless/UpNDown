import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@upndown/engine': fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url)),
      '@upndown/profile': fileURLToPath(new URL('../../packages/profile/src/index.ts', import.meta.url)),
      '@upndown/shared-types': fileURLToPath(new URL('../../packages/shared-types/src/index.ts', import.meta.url))
    }
  },
  server: {
    port: 5173,
    allowedHosts: ['localhost', '127.0.0.1'],
    // Login and its API are same-origin in production; in dev the server is on :3001.
    proxy: { '/auth': 'http://localhost:3001', '/api': 'http://localhost:3001' }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: []
  }
});
