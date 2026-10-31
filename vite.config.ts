import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API runs as a separate Hono process (npm run dev:server) bound to 127.0.0.1.
// In dev, /api is proxied to it. API_PORT lets the e2e run use its own server.
const apiPort = process.env.API_PORT ?? '8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
});
