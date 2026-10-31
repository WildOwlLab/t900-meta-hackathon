import { Hono } from 'hono';

/**
 * Milestone 1 exposes only a health route. Preview, analyze and apply routes
 * (with the approval gates) arrive in a later milestone.
 */
export const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true }));
