import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry'
  },
  webServer: [
    {
      command: 'cd ../../ && npm run dev --workspace @upndown/server',
      port: 3001,
      reuseExistingServer: true,
      timeout: 120_000
    },
    {
      command: 'cd ../../ && npm run dev --workspace @upndown/client -- --host 127.0.0.1 --port 5173',
      port: 5173,
      reuseExistingServer: true,
      timeout: 120_000
    }
  ],
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] }
    }
  ]
});
