import { defineConfig } from '@playwright/test';

// Browsers: run `npx playwright install chromium` on a fresh machine.
// In the cloud sandbox a matching Chromium is pre-installed (PLAYWRIGHT_BROWSERS_PATH).
// Set PW_NO_SANDBOX=1 when running as root inside a container.
const args = process.env.PW_NO_SANDBOX ? ['--no-sandbox'] : [];

// The e2e run starts its OWN servers on their own ports and never reuses one that is already
// running, so a dev server that holds a real provider key can never be picked up by accident.
// Provider variables are blanked, so the run is always fixture-only, whatever the shell has set.
const apiPort = 8788;
const webPort = 5174;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${webPort}`,
    launchOptions: { args },
  },
  webServer: [
    {
      command: 'npx tsx src/server/main.ts',
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(apiPort),
        META_API_KEY: '',
        META_API_URL: '',
        META_MODEL: '',
        META_RESPONSE_FORMAT: '',
      },
    },
    {
      command: `npx vite --port ${webPort} --strictPort`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_PORT: String(apiPort) },
    },
  ],
});
