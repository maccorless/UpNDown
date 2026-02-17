import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const allowedHosts = ['localhost', '127.0.0.1', '.railway.app', 'upndown.cloud', '.upndown.cloud'];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@upndown/engine': fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url)),
      '@upndown/shared-types': fileURLToPath(new URL('../../packages/shared-types/src/index.ts', import.meta.url))
    }
  },
  server: {
    port: 5173,
    allowedHosts
  },
  preview: {
    allowedHosts
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: []
  }
});
