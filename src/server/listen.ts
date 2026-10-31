import { serve } from '@hono/node-server';
import type { Hono } from 'hono';

/**
 * Loopback only. There is no authentication, and a configured provider key would let anyone who
 * can reach this port spend it. Pulled out of main.ts so a test can hold it to this.
 */
export const LISTEN_HOST = '127.0.0.1';

export function listen(app: Hono, port: number, onListen?: (port: number) => void) {
  return serve({ fetch: app.fetch, port, hostname: LISTEN_HOST }, (info) => onListen?.(info.port));
}
