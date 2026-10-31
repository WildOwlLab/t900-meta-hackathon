import { describe, expect, it } from 'vitest';
import { app } from '../../src/server/app';

describe('server scaffold', () => {
  it('answers the health check', async () => {
    const response = await app.request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('exposes no analysis route yet, so nothing can reach a model', async () => {
    for (const path of ['/api/analyze', '/api/preview', '/api/apply']) {
      const response = await app.request(path, { method: 'POST', body: '{}' });
      expect(response.status, path).toBe(404);
    }
  });
});
