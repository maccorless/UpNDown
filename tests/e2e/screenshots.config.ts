import { defineConfig, devices } from '@playwright/test';

// Takes the pictures on the How to Play page from the real app, so they can be made again whenever the screens change:
//   npm run screenshots
// It starts the same servers as the smoke tests. Nothing here is a test of the app; it only writes image files.
export default defineConfig({
  testDir: './screenshots',
  testMatch: '**/*.shots.ts',
  timeout: 120_000,
  workers: 1,
  use: { baseURL: 'http://localhost:5173', colorScheme: 'dark', viewport: { width: 1280, height: 900 } },
  webServer: [
    { command: 'cd ../../ && npm run dev --workspace @upndown/server', port: 3001, reuseExistingServer: true, timeout: 120_000 },
    { command: 'cd ../../ && npm run dev --workspace @upndown/client -- --host 127.0.0.1 --port 5173', port: 5173, reuseExistingServer: true, timeout: 120_000 }
  ],
  projects: [{ name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }]
});
