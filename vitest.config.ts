import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/hygiene/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
