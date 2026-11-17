import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@upndown/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
      '@upndown/shared-types': fileURLToPath(new URL('../shared-types/src/index.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    globals: true
  }
});
