import { defineConfig } from '@playwright/test';
import {
  FIXTURE_API_PORT,
  FIXTURE_WEB_PORT,
  LIVE_API_PORT,
  LIVE_WEB_PORT,
  STUB_BASE_URL,
  STUB_KEY,
  STUB_ORIGIN,
} from './tests/e2e/support/constants';

// Browsers: run `npx playwright install chromium` on a fresh machine.
// In the cloud sandbox a matching Chromium is pre-installed (PLAYWRIGHT_BROWSERS_PATH).
// Set PW_NO_SANDBOX=1 when running as root inside a container.
const args = process.env.PW_NO_SANDBOX ? ['--no-sandbox'] : [];

// The e2e run starts its OWN servers on their own ports and never reuses one that is already running,
// so a dev server that holds a real provider key can never be picked up by accident.
//
// Two stacks:
//   fixture    API with every provider variable blanked, so live is off whatever the shell has set.
//   live-stub  API whose "provider" is a stub on 127.0.0.1 with a made-up key. This exercises the live
//              path in a browser with no external network call. The stub is test plumbing, not a model.
const blank = { META_API_KEY: '', META_API_URL: '', META_MODEL: '', META_RESPONSE_FORMAT: '' };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: { launchOptions: { args } },
  projects: [
    {
      name: 'fixture',
      testMatch: /(flow|custom-input|export)\.spec\.ts/,
      use: { baseURL: `http://localhost:${FIXTURE_WEB_PORT}` },
    },
    {
      name: 'live-stub',
      testMatch: /live-stub\.spec\.ts/,
      use: { baseURL: `http://localhost:${LIVE_WEB_PORT}` },
    },
  ],
  webServer: [
    {
      command: 'npx tsx tests/e2e/support/stub-provider.ts',
      url: `${STUB_ORIGIN}/__health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npx tsx src/server/main.ts',
      url: `http://127.0.0.1:${FIXTURE_API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...blank, PORT: String(FIXTURE_API_PORT) },
    },
    {
      command: 'npx tsx src/server/main.ts',
      url: `http://127.0.0.1:${LIVE_API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(LIVE_API_PORT),
        META_API_KEY: STUB_KEY,
        META_API_URL: STUB_BASE_URL,
        META_MODEL: 'stub-model',
        META_RESPONSE_FORMAT: '',
      },
    },
    {
      command: `npx vite --port ${FIXTURE_WEB_PORT} --strictPort`,
      url: `http://localhost:${FIXTURE_WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_PORT: String(FIXTURE_API_PORT) },
    },
    {
      command: `npx vite --port ${LIVE_WEB_PORT} --strictPort`,
      url: `http://localhost:${LIVE_WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_PORT: String(LIVE_API_PORT) },
    },
  ],
});
