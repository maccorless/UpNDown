import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@upndown/shared-types': fileURLToPath(new URL('../shared-types/src/index.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    globals: true
  }
});
