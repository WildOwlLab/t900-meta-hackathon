import { describe, expect, it, vi } from 'vitest';
import { examples, getExample } from '../../src/examples';
import type { ApiErrorBody, ConfigResponse } from '../../src/shared/api';
import { KEY, LIVE_ENV, LIVE_URL, countingFixtureClient, fetchSpy, makeApp, post, previewOf, readJson, sha256 } from './helpers';

const refund = getExample('refund-window')!;

describe('GET /api/health and /api/config', () => {
  it('answers the health check', async () => {
    const response = await makeApp().request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('with no provider variables: fixture is the default and live is off, with a reason', async () => {
    const config = await readJson<ConfigResponse>(await makeApp().request('/api/config'));
    expect(config.defaultMode).toBe('fixture');
    expect(config.fixture.available).toBe(true);
    expect(config.live.available).toBe(false);
    if (!config.live.available) expect(config.live.reason).toContain('META_API_KEY');
  });

  it('with live configured: still defaults to fixture, shows the destination and model, never the key', async () => {
    const response = await makeApp({ env: LIVE_ENV }).request('/api/config');
    const text = await response.text();
    const config = JSON.parse(text) as ConfigResponse;
    expect(config.defaultMode).toBe('fixture');
    expect(config.live).toEqual({ available: true, destination: LIVE_URL, model: 'stub-model', responseFormat: 'json_schema' });
    expect(text).not.toContain(KEY);
  });

  it('answers unknown routes with a JSON 404', async () => {
    const app = makeApp();
    for (const path of ['/api/nope', '/api/analyze', '/api/preview', '/api/apply']) {
      const response = await app.request(path); // GET on a POST-only route
      expect(response.status, path).toBe(404);
      expect((await readJson<ApiErrorBody>(response)).error.code).toBe('not_found');
    }
  });
});

describe('POST /api/preview', () => {
  it.each(examples.map((e) => [e.slug, e] as const))('%s: returns the outbound text, its SHA-256, and says nothing is sent in fixture mode', async (_slug, example) => {
    const preview = await previewOf(makeApp(), 'fixture', example.input);
    expect(preview.mode).toBe('fixture');
    expect(preview.sentToProvider).toBe(false);
    expect(preview.destination).toBeNull();
    expect(preview.hashAlgorithm).toBe('SHA-256');
    expect(preview.hash).toBe(sha256(preview.text));
    expect(preview.text.startsWith('mode: fixture\n')).toBe(true);
    expect(preview.text.endsWith(preview.body)).toBe(true);
    expect(preview.body).toContain(example.input.task.slice(0, 40));
  });

  it('live preview names the destination and model and says it will be sent', async () => {
    const preview = await previewOf(makeApp({ env: LIVE_ENV }), 'live', refund.input);
    expect(preview.sentToProvider).toBe(true);
    expect(preview.destination).toBe(LIVE_URL);
    expect(preview.model).toBe('stub-model');
    expect(preview.text.startsWith(`mode: live\ndestination: POST ${LIVE_URL}\n`)).toBe(true);
    expect(JSON.stringify(preview)).not.toContain(KEY);
  });

  it('refuses a live preview when live is not configured', async () => {
    const response = await post(makeApp(), '/api/preview', { mode: 'live', input: refund.input });
    expect(response.status).toBe(409);
    const { error } = await readJson<ApiErrorBody>(response);
    expect(error.code).toBe('live_unavailable');
    expect(error.message).toContain('META_API_KEY');
  });

  it('is deterministic', async () => {
    const app = makeApp();
    const a = await previewOf(app, 'fixture', refund.input);
    const b = await previewOf(app, 'fixture', structuredClone(refund.input));
    expect(b).toEqual(a);
  });

  it('never calls a model or the network', async () => {
    const fixture = countingFixtureClient();
    const fetch = fetchSpy();
    const app = makeApp({ env: LIVE_ENV, clients: { fixture }, fetchImpl: fetch });
    await previewOf(app, 'fixture', refund.input);
    await previewOf(app, 'live', refund.input);
    expect(fixture.calls).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid input with the offending paths', async () => {
    const app = makeApp();
    const duplicate = structuredClone(refund.input);
    duplicate.sources[1]!.id = duplicate.sources[0]!.id;
    const cases: Array<[string, unknown, string]> = [
      ['duplicate source IDs', { mode: 'fixture', input: duplicate }, 'input.sources[1].id'],
      ['pack with an unknown ID', { mode: 'fixture', input: { ...refund.input, pack: ['nope-1'] } }, 'input.pack[0]'],
      ['missing task', { mode: 'fixture', input: { ...refund.input, task: '' } }, 'input.task'],
      ['extra field on input', { mode: 'fixture', input: { ...refund.input, extra: 1 } }, 'input'],
      ['extra field on request', { mode: 'fixture', input: refund.input, extra: 1 }, '(root)'],
      ['unknown mode', { mode: 'turbo', input: refund.input }, 'mode'],
      ['missing mode', { input: refund.input }, 'mode'],
    ];
    for (const [name, body, path] of cases) {
      const response = await post(app, '/api/preview', body);
      expect(response.status, name).toBe(400);
      const { error } = await readJson<ApiErrorBody>(response);
      expect(error.code, name).toBe('invalid_request');
      expect(error.issues?.some((issue) => issue.path === path), `${name}: ${JSON.stringify(error.issues)}`).toBe(true);
    }
  });
});

describe('request hygiene on every POST route', () => {
  const routes = ['/api/preview', '/api/analyze', '/api/apply'];
  const valid = { mode: 'fixture', input: refund.input, approvedHash: 'a'.repeat(64) };

  it('requires application/json, so a cross-site page cannot send it without a preflight', async () => {
    const fixture = countingFixtureClient();
    const app = makeApp({ clients: { fixture } });
    for (const route of routes) {
      for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', '']) {
        const response = await app.request(route, {
          method: 'POST',
          headers: type ? { 'content-type': type } : {},
          body: JSON.stringify(valid),
        });
        expect(response.status, `${route} ${type}`).toBe(415);
        expect((await readJson<ApiErrorBody>(response)).error.code).toBe('unsupported_media_type');
      }
    }
    expect(fixture.calls).toBe(0);
  });

  it('accepts application/json with a charset', async () => {
    const response = await post(makeApp(), '/api/preview', { mode: 'fixture', input: refund.input }, { 'content-type': 'application/json; charset=utf-8' });
    expect(response.status).toBe(200);
  });

  it('rejects bodies that are not valid JSON', async () => {
    const app = makeApp();
    for (const route of routes) {
      for (const body of ['{not json', '', 'undefined']) {
        const response = await post(app, route, body);
        expect(response.status, `${route} ${JSON.stringify(body)}`).toBe(400);
        expect((await readJson<ApiErrorBody>(response)).error.code).toBe('invalid_request');
      }
    }
  });

  it('rejects JSON that is not an object', async () => {
    const app = makeApp();
    for (const route of routes) {
      for (const body of ['null', '[]', '"text"', '42']) {
        const response = await post(app, route, body);
        expect(response.status, `${route} ${body}`).toBe(400);
      }
    }
  });

  it('rejects an oversized body with 413 before doing any work', async () => {
    const fixture = countingFixtureClient();
    const app = makeApp({ clients: { fixture } });
    const huge = JSON.stringify({ mode: 'fixture', input: refund.input, pad: 'x'.repeat(600 * 1024) });
    const response = await post(app, '/api/analyze', huge, { 'content-length': String(huge.length) });
    expect(response.status).toBe(413);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe('payload_too_large');
    expect(fixture.calls).toBe(0);
  });

  it('turns an unexpected failure into a generic 500 that says nothing about the request', async () => {
    const spies = (['log', 'error', 'warn', 'info'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
    const app = makeApp({
      clients: {
        fixture: {
          mode: 'fixture',
          complete: () => Promise.reject(new Error(`boom with ${KEY} and task text`)),
        },
      },
    });
    const preview = await previewOf(app, 'fixture', refund.input);
    const response = await post(app, '/api/analyze', { mode: 'fixture', input: refund.input, approvedHash: preview.hash });
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text).error.code).toBe('internal_error');
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('boom');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    spies.forEach((spy) => spy.mockRestore());
  });
});
