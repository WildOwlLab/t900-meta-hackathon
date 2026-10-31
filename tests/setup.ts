import { vi } from 'vitest';

// Unit tests must never reach the network. Any test that needs fetch injects its own stub.
vi.stubGlobal('fetch', () => {
  throw new Error('Network access is disabled in unit tests. Inject a fetch stub instead.');
});
