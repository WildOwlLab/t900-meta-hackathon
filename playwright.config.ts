import { defineConfig } from '@playwright/test';

// Browsers: run `npx playwright install chromium` on a fresh machine.
// In the cloud sandbox a matching Chromium is pre-installed (PLAYWRIGHT_BROWSERS_PATH).
// Set PW_NO_SANDBOX=1 when running as root inside a container.
const args = process.env.PW_NO_SANDBOX ? ['--no-sandbox'] : [];

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: { args },
  },
  webServer: {
    command: 'npm run dev:web -- --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
