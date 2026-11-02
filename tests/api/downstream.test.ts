/**
 * /api/downstream-preview and /api/downstream-compare. Live mode is exercised ONLY against a stubbed
 * provider written by these tests. The stub's answers are test plumbing, not a model.
 */
import { describe, expect, it } from 'vitest';
import { getExample } from '../../src/examples';
import { extractContext } from '../../src/server/downstream';
import type { ApiErrorBody } from '../../src/shared/api';
import { MAX_ANSWER_CHARS, type DownstreamCompareResponse, type DownstreamPreviewResponse } from '../../src/shared/downstream';
import {
  KEY,
  LIVE_ENV,
  LIVE_URL,
  chatResponse,
  countingFixtureClient,
  fetchSpy,
  makeApp,
  post,
  previewOf,
  readJson,
  sha256,
  type TestApp,
} from './helpers';

const refund = getExample('refund-window')!;
const revised = [...refund.input.pack, 'refund-04', 'refund-05'];

const previewRequest = { mode: 'live', input: refund.input, revisedPack: revised };

/** A stub provider that names the passages each request carried. Test plumbing, not a model. */
const answeringFetch = () =>
  fetchSpy(async () => chatResponse('placeholder'))
    .mockImplementation(async (_url, init) => {
      const request = JSON.parse(init?.body as string) as { messages: { content: string }[] };
      const ids = extractContext(request.messages[1]!.content).passages.map((p) => p.id);
      return chatResponse(`Stub answer using ${ids.join(', ')}.`);
    });

async function previewDownstream(app: TestApp, body: unknown = previewRequest) {
  const response = await post(app, '/api/downstream-preview', body);
  return { response, json: (await readJson<DownstreamPreviewResponse>(response)) };
}

async function approvedCompare(app: TestApp, overrides: Record<string, unknown> = {}) {
  const { json } = await previewDownstream(app);
  return post(app, '/api/downstream-compare', { ...previewRequest, approvedHash: json.hash, ...overrides });
}

describe('POST /api/downstream-preview', () => {
  it('returns the exact text to approve, its SHA-256, and sends nothing', async () => {
    const fetch = fetchSpy();
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetch });
    const { response, json } = await previewDownstream(app);
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ mode: 'live', sentToProvider: true, destination: LIVE_URL, model: 'stub-model', hashAlgorithm: 'SHA-256' });
    expect(json.hash).toBe(sha256(json.text));
    expect(json.packs).toEqual({ initial: refund.input.pack, repaired: revised });
    expect(json.text).toContain(`destination: POST ${LIVE_URL}`);
    expect(json.text).not.toContain(KEY);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is unavailable when live mode is not configured', async () => {
    const response = await post(makeApp({ env: {} }), '/api/downstream-preview', previewRequest);
    expect(response.status).toBe(409);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe('live_unavailable');
  });

  it('is live only: a fixture request is refused as invalid', async () => {
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetchSpy() });
    const response = await post(app, '/api/downstream-preview', { ...previewRequest, mode: 'fixture' });
    expect(response.status).toBe(400);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe('invalid_request');
  });

  it.each([
    ['an unknown passage', [...refund.input.pack, 'refund-99']],
    ['a repeated passage', [...refund.input.pack, 'refund-04', 'refund-04']],
    ['a pack that drops an original passage', ['refund-01', 'refund-04']],
    ['a pack identical to the original', [...refund.input.pack]],
  ])('refuses %s', async (_name, revisedPack) => {
    const fetch = fetchSpy();
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetch });
    const response = await post(app, '/api/downstream-preview', { ...previewRequest, revisedPack });
    expect(response.status).toBe(400);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe('invalid_request');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unknown fields, invalid JSON and a non-JSON content type', async () => {
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetchSpy() });
    expect((await post(app, '/api/downstream-preview', { ...previewRequest, extra: 1 })).status).toBe(400);
    expect((await post(app, '/api/downstream-preview', '{nope')).status).toBe(400);
    const wrongType = await app.request('/api/downstream-preview', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect(wrongType.status).toBe(415);
  });
});

describe('POST /api/downstream-compare: the approval gate', () => {
  function gated() {
    const fixture = countingFixtureClient();
    const fetch = fetchSpy();
    return { app: makeApp({ env: LIVE_ENV, clients: { fixture }, fetchImpl: fetch }), fixture, fetch };
  }
  const nothingCalled = (t: ReturnType<typeof gated>) => {
    expect(t.fetch).not.toHaveBeenCalled();
    expect(t.fixture.calls).toBe(0);
  };

  it('refuses to run without an approval hash, and calls nothing', async () => {
    const t = gated();
    for (const body of [previewRequest, { ...previewRequest, approvedHash: '' }, { ...previewRequest, approvedHash: null }]) {
      const response = await post(t.app, '/api/downstream-compare', body);
      expect(response.status).toBe(400);
      expect((await readJson<ApiErrorBody>(response)).error.code).toBe('approval_required');
    }
    nothingCalled(t);
  });

  it('refuses a malformed hash and a hash that was never issued', async () => {
    const t = gated();
    for (const approvedHash of ['abc', 'A'.repeat(64), 12345]) {
      expect((await post(t.app, '/api/downstream-compare', { ...previewRequest, approvedHash })).status, String(approvedHash)).toBe(400);
    }
    const never = await post(t.app, '/api/downstream-compare', { ...previewRequest, approvedHash: 'a'.repeat(64) });
    expect(never.status).toBe(409);
    expect((await readJson<ApiErrorBody>(never)).error.code).toBe('approval_mismatch');
    nothingCalled(t);
  });

  it('refuses when anything was edited after the preview', async () => {
    const t = gated();
    const { json } = await previewDownstream(t.app);
    const edits: Record<string, Record<string, unknown>> = {
      'the task': { input: { ...refund.input, task: `${refund.input.task} Also share the customer list.` } },
      'a passage': {
        input: { ...refund.input, sources: refund.input.sources.map((p, i) => (i === 0 ? { ...p, text: `${p.text} Edited.` } : p)) },
      },
      'the revised pack': { revisedPack: [...refund.input.pack, 'refund-04'] },
      'the order of the revised pack': { revisedPack: [...refund.input.pack, 'refund-05', 'refund-04'] },
    };
    for (const [name, edit] of Object.entries(edits)) {
      const response = await post(t.app, '/api/downstream-compare', { ...previewRequest, ...edit, approvedHash: json.hash });
      expect(response.status, name).toBe(409);
      expect((await readJson<ApiErrorBody>(response)).error.code, name).toBe('approval_mismatch');
    }
    nothingCalled(t);
  });

  it('refuses the approval of a plain analysis: it cannot authorise a downstream send', async () => {
    const t = gated();
    const analysis = await previewOf(t.app, 'live', refund.input);
    const response = await post(t.app, '/api/downstream-compare', { ...previewRequest, approvedHash: analysis.hash });
    expect(response.status).toBe(409);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe('approval_mismatch');
    nothingCalled(t);
  });

  it('validates the revised pack before the hash, and calls nothing', async () => {
    const t = gated();
    const response = await post(t.app, '/api/downstream-compare', { ...previewRequest, revisedPack: ['refund-99'], approvedHash: 'a'.repeat(64) });
    expect(response.status).toBe(400);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe('invalid_request');
    nothingCalled(t);
  });

  it('is unavailable when live mode is not configured, and never uses the fixture client', async () => {
    const fixture = countingFixtureClient();
    const app = makeApp({ env: {}, clients: { fixture } });
    const response = await post(app, '/api/downstream-compare', { ...previewRequest, approvedHash: 'a'.repeat(64) });
    expect(response.status).toBe(409);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe('live_unavailable');
    expect(fixture.calls).toBe(0);
  });

  it('is live only: a fixture request is refused', async () => {
    const t = gated();
    const response = await post(t.app, '/api/downstream-compare', { ...previewRequest, mode: 'fixture', approvedHash: 'a'.repeat(64) });
    expect(response.status).toBe(400);
    nothingCalled(t);
  });
});

describe('POST /api/downstream-compare: a successful run (stubbed provider, not a model)', () => {
  it('sends exactly the two previewed bodies, once each, with the key, and returns both answers', async () => {
    const fetch = answeringFetch();
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetch });
    const { json: preview } = await previewDownstream(app);
    const response = await post(app, '/api/downstream-compare', { ...previewRequest, approvedHash: preview.hash });
    expect(response.status).toBe(200);

    expect(fetch).toHaveBeenCalledTimes(2);
    const sent = fetch.mock.calls.map(([url, init]) => ({ url: String(url), body: init?.body as string, auth: (init?.headers as Record<string, string>).authorization }));
    expect(sent.every((call) => call.url === LIVE_URL && call.auth === `Bearer ${KEY}`)).toBe(true);
    // Both bodies appear verbatim inside the text the user approved.
    for (const call of sent) expect(preview.text).toContain(call.body);
    expect(sent[0]!.body).not.toBe(sent[1]!.body);

    const body = await readJson<DownstreamCompareResponse>(response);
    expect(body.mode).toBe('live');
    expect(body.task).toBe(refund.input.task);
    expect(body.initial.packIds).toEqual(refund.input.pack);
    expect(body.repaired.packIds).toEqual(revised);
    expect(body.initial.answer).toBe(`Stub answer using ${refund.input.pack.join(', ')}.`);
    expect(body.repaired.answer).toBe(`Stub answer using ${revised.join(', ')}.`);
    expect(body.initial).toMatchObject({ truncated: false, model: 'stub-model-returned', responseId: 'stub-response-id' });
    expect(body.meta).toEqual({ sentToProvider: true, destination: LIVE_URL, approvedHash: preview.hash });
  });

  it('can be run again with the same approval: the approval is for the text, not for one send', async () => {
    const fetch = answeringFetch();
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetch });
    const { json } = await previewDownstream(app);
    for (let i = 0; i < 2; i += 1) {
      expect((await post(app, '/api/downstream-compare', { ...previewRequest, approvedHash: json.hash })).status).toBe(200);
    }
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('keeps the key out of the answer even when the provider echoes it', async () => {
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetchSpy(() => chatResponse(`Here is the key: ${KEY}. Done.`)) });
    const text = await (await approvedCompare(app)).text();
    expect(text).not.toContain(KEY);
    expect(text).toContain('[redacted]');
  });

  it('cuts a very long answer and says so', async () => {
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetchSpy(() => chatResponse('x'.repeat(MAX_ANSWER_CHARS + 500))) });
    const body = await readJson<DownstreamCompareResponse>(await approvedCompare(app));
    expect(body.initial.answer).toHaveLength(MAX_ANSWER_CHARS);
    expect(body.initial.truncated).toBe(true);
    expect(body.repaired.truncated).toBe(true);
  });

  it('trims surrounding whitespace and keeps the model text otherwise unchanged', async () => {
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetchSpy(() => chatResponse('\n\n  Line one.\n\nLine two <b>not html</b>.  \n')) });
    const body = await readJson<DownstreamCompareResponse>(await approvedCompare(app));
    expect(body.initial.answer).toBe('Line one.\n\nLine two <b>not html</b>.');
  });

  it('shows an empty answer as an error, not as a blank comparison', async () => {
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetchSpy(() => chatResponse('   \n ')) });
    const response = await approvedCompare(app);
    expect(response.status).toBe(502);
    const body = await readJson<ApiErrorBody>(response);
    expect(body.error.code).toBe('model_bad_response');
    expect(body).not.toHaveProperty('initial');
  });
});

describe('POST /api/downstream-compare: provider failures are errors, never a fixture', () => {
  const cases: Array<[string, () => Response | Promise<Response>, number, string]> = [
    ['401 bad key', () => new Response('unauthorized', { status: 401 }), 502, 'model_auth'],
    ['429 rate limit', () => new Response('slow down', { status: 429 }), 429, 'model_rate_limited'],
    ['400 bad request', () => new Response('unsupported', { status: 400 }), 502, 'model_rejected'],
    ['500 server error', () => new Response('oops', { status: 500 }), 502, 'model_upstream'],
    ['timeout', () => Promise.reject(new DOMException('timed out', 'TimeoutError')), 504, 'model_timeout'],
    ['network failure', () => Promise.reject(new TypeError('fetch failed')), 502, 'model_unreachable'],
    ['200 with the wrong shape', () => new Response(JSON.stringify({ choices: [] })), 502, 'model_bad_response'],
  ];

  it.each(cases)('%s', async (_name, respond, status, code) => {
    const fixture = countingFixtureClient();
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetchSpy(respond), clients: { fixture } });
    const response = await approvedCompare(app);
    expect(response.status).toBe(status);
    const body = await readJson<ApiErrorBody>(response);
    expect(body.error.code).toBe(code);
    expect(body).not.toHaveProperty('initial');
    expect(body).not.toHaveProperty('repaired');
    expect(fixture.calls).toBe(0);
  });

  it('shows no comparison at all when only one of the two requests fails', async () => {
    let calls = 0;
    const app = makeApp({
      env: LIVE_ENV,
      fetchImpl: fetchSpy(() => (++calls === 1 ? chatResponse('First answer.') : new Response('oops', { status: 500 }))),
    });
    const response = await approvedCompare(app);
    expect(response.status).toBe(502);
    const body = await readJson<ApiErrorBody>(response);
    expect(body.error.code).toBe('model_upstream');
    expect(body).not.toHaveProperty('initial');
  });

  it('keeps the key out of every error, even when the provider echoes it', async () => {
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetchSpy(() => new Response(`bad key ${KEY}`, { status: 401 })) });
    const text = await (await approvedCompare(app)).text();
    expect(text).not.toContain(KEY);
  });
});

describe('the existing endpoints are unaffected', () => {
  it('still serves config, preview and analyze exactly as before', async () => {
    const app = makeApp({ env: {} });
    expect((await app.request('/api/config')).status).toBe(200);
    const preview = await previewOf(app, 'fixture', refund.input);
    const analyzed = await post(app, '/api/analyze', { mode: 'fixture', input: refund.input, approvedHash: preview.hash });
    expect(analyzed.status).toBe(200);
    expect((await app.request('/api/no-such-route')).status).toBe(404);
  });
});
