import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API runs as a separate Hono process (npm run dev:server). In dev, /api is proxied to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
