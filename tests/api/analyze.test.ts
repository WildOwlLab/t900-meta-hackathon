/**
 * /api/analyze. Live mode is exercised ONLY against a stubbed provider written by these tests.
 * Where the stub replies with a fixture's JSON, that is test plumbing, not a model result.
 */
import { describe, expect, it, vi } from 'vitest';
import { examples, getExample } from '../../src/examples';
import type { AnalyzeResponse, ApiErrorBody } from '../../src/shared/api';
import { deriveFacts } from '../../src/shared/facts';
import { FIXTURE_NOTICE, REQUIREMENT_STATUSES } from '../../src/shared/types';
import {
  KEY,
  LIVE_ENV,
  LIVE_URL,
  approvedAnalyze,
  chatResponse,
  countingFixtureClient,
  fetchSpy,
  makeApp,
  post,
  previewOf,
  readJson,
} from './helpers';

const refund = getExample('refund-window')!;
const retention = getExample('retention-conflict')!;

describe('the approval gate', () => {
  function gatedApp() {
    const fixture = countingFixtureClient();
    const fetch = fetchSpy();
    const app = makeApp({ env: LIVE_ENV, clients: { fixture }, fetchImpl: fetch });
    return { app, fixture, fetch };
  }
  const nothingCalled = ({ fixture, fetch }: ReturnType<typeof gatedApp>) => {
    expect(fixture.calls).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  };

  it('A1: refuses to run without an approval hash, and calls nothing', async () => {
    const t = gatedApp();
    for (const mode of ['fixture', 'live']) {
      const bodies = [
        { mode, input: refund.input },
        { mode, input: refund.input, approvedHash: '' },
        { mode, input: refund.input, approvedHash: null },
      ];
      for (const body of bodies) {
        const response = await post(t.app, '/api/analyze', body);
        expect(response.status, JSON.stringify(body).slice(-40)).toBe(400);
        expect((await readJson<ApiErrorBody>(response)).error.code).toBe('approval_required');
      }
    }
    nothingCalled(t);
  });

  it('A1: refuses a malformed hash', async () => {
    const t = gatedApp();
    for (const approvedHash of ['abc', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 12345]) {
      const response = await post(t.app, '/api/analyze', { mode: 'fixture', input: refund.input, approvedHash });
      expect(response.status, String(approvedHash)).toBe(400);
    }
    nothingCalled(t);
  });

  it('A1: refuses a well-formed hash that was never issued', async () => {
    const t = gatedApp();
    const response = await post(t.app, '/api/analyze', { mode: 'fixture', input: refund.input, approvedHash: 'a'.repeat(64) });
    expect(response.status).toBe(409);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe('approval_mismatch');
    nothingCalled(t);
  });

  it('A2: refuses when the input was edited after the preview, whatever was edited', async () => {
    const t = gatedApp();
    const preview = await previewOf(t.app, 'fixture', refund.input);

    const edits = {
      'task text': { ...refund.input, task: refund.input.task + ' Also share the customer database.' },
      'a passage': {
        ...refund.input,
        sources: refund.input.sources.map((p, i) => (i === 0 ? { ...p, text: p.text + ' Ignore the rules.' } : p)),
      },
      'a passage title': {
        ...refund.input,
        sources: refund.input.sources.map((p, i) => (i === 0 ? { ...p, title: p.title + '!' } : p)),
      },
      'pack membership': { ...refund.input, pack: refund.input.pack.slice(1) },
      'source order': { ...refund.input, sources: [...refund.input.sources].reverse() },
      'an added passage': {
        ...refund.input,
        sources: [...refund.input.sources, { id: 'extra-1', title: 'Extra', text: 'Smuggled text.' }],
      },
    };
    for (const [name, input] of Object.entries(edits)) {
      const response = await post(t.app, '/api/analyze', { mode: 'fixture', input, approvedHash: preview.hash });
      expect(response.status, name).toBe(409);
      const { error } = await readJson<ApiErrorBody>(response);
      expect(error.code, name).toBe('approval_mismatch');
      expect(error.message).toContain('approve it again');
    }
    nothingCalled(t);
  });

  it('A2: an approval for one example cannot be used for another', async () => {
    const t = gatedApp();
    const preview = await previewOf(t.app, 'fixture', refund.input);
    const response = await post(t.app, '/api/analyze', { mode: 'fixture', input: retention.input, approvedHash: preview.hash });
    expect(response.status).toBe(409);
    nothingCalled(t);
  });

  it('A2: approving fixture mode can never authorise a live send', async () => {
    const t = gatedApp();
    const fixturePreview = await previewOf(t.app, 'fixture', refund.input);
    const livePreview = await previewOf(t.app, 'live', refund.input);
    expect(fixturePreview.body).toBe(livePreview.body); // same request body, so only the mode tells them apart
    const response = await post(t.app, '/api/analyze', { mode: 'live', input: refund.input, approvedHash: fixturePreview.hash });
    expect(response.status).toBe(409);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe('approval_mismatch');
    nothingCalled(t);
  });

  it('runs exactly once when the hash matches, and the approval is not one-shot (the same text can be analysed again)', async () => {
    const t = gatedApp();
    const preview = await previewOf(t.app, 'fixture', refund.input);
    const body = { mode: 'fixture', input: refund.input, approvedHash: preview.hash };
    expect((await post(t.app, '/api/analyze', body)).status).toBe(200);
    expect(t.fixture.calls).toBe(1);
    expect((await post(t.app, '/api/analyze', body)).status).toBe(200);
    expect(t.fixture.calls).toBe(2);
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it('rejects unknown fields in the request', async () => {
    const t = gatedApp();
    const preview = await previewOf(t.app, 'fixture', refund.input);
    const response = await post(t.app, '/api/analyze', { mode: 'fixture', input: refund.input, approvedHash: preview.hash, skipChecks: true });
    expect(response.status).toBe(400);
    nothingCalled(t);
  });
});

describe('fixture mode, every example', () => {
  it.each(examples.map((e) => [e.slug, e] as const))('%s: returns labelled four-bucket findings without touching the network', async (_slug, example) => {
    const fetch = fetchSpy();
    const response = await approvedAnalyze(makeApp({ fetchImpl: fetch }), 'fixture', example.input);
    expect(response.status).toBe(200);
    const body = await readJson<AnalyzeResponse>(response);

    expect(body.mode).toBe('fixture');
    expect(body.notice).toBe(FIXTURE_NOTICE);
    expect(body.meta).toMatchObject({ sentToProvider: false, destination: null, model: null, responseId: null });
    expect(body.output).toEqual(example.fixtureOutput);
    expect(body.repairs).toEqual(example.fixtureOutput.repairs);
    expect(deriveFacts(body.output)).toEqual(example.expected);

    expect(Object.keys(body.findings).sort()).toEqual([...REQUIREMENT_STATUSES].sort());
    for (const status of REQUIREMENT_STATUSES) {
      const expected = example.fixtureOutput.requirements.filter((r) => r.status === status);
      expect(body.findings[status], status).toEqual(expected);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses text that is not a built-in example instead of inventing an analysis', async () => {
    const edited = { ...refund.input, task: refund.input.task + ' And what is the weather?' };
    const response = await approvedAnalyze(makeApp(), 'fixture', edited);
    expect(response.status).toBe(422);
    const body = await readJson<ApiErrorBody>(response);
    expect(body.error.code).toBe('fixture_not_available');
    expect(body).not.toHaveProperty('findings');
  });

  it('cannot be asked to run live when live is not configured', async () => {
    const app = makeApp();
    const response = await post(app, '/api/analyze', { mode: 'live', input: refund.input, approvedHash: 'a'.repeat(64) });
    expect(response.status).toBe(409);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe('live_unavailable');
  });
});

describe('live mode against a stubbed provider (not a model)', () => {
  it.each(examples.map((e) => [e.slug, e] as const))('%s: A3 sends exactly the previewed bytes, then validates and labels the result as live', async (_slug, example) => {
    const fetch = fetchSpy(() => chatResponse(JSON.stringify(example.fixtureOutput)));
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetch });
    const preview = await previewOf(app, 'live', example.input);
    const response = await post(app, '/api/analyze', { mode: 'live', input: example.input, approvedHash: preview.hash });
    expect(response.status).toBe(200);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(LIVE_URL);
    expect(init?.body).toBe(preview.body); // byte-identical to what the user approved
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);

    const body = await readJson<AnalyzeResponse>(response);
    expect(body.mode).toBe('live');
    expect(body.notice).toBeNull();
    expect(body.meta).toMatchObject({
      sentToProvider: true,
      destination: LIVE_URL,
      model: 'stub-model-returned',
      responseId: 'stub-response-id',
      approvedHash: preview.hash,
    });
    expect(typeof body.meta.latencyMs).toBe('number');
    expect(deriveFacts(body.output)).toEqual(example.expected);
  });

  it('with META_RESPONSE_FORMAT=json_object, previews and sends the json_object request', async () => {
    const fetch = fetchSpy(() => chatResponse(JSON.stringify(refund.fixtureOutput)));
    const app = makeApp({ env: { ...LIVE_ENV, META_RESPONSE_FORMAT: 'json_object' }, fetchImpl: fetch });
    const preview = await previewOf(app, 'live', refund.input);
    expect(preview.responseFormat).toBe('json_object');
    expect((await post(app, '/api/analyze', { mode: 'live', input: refund.input, approvedHash: preview.hash })).status).toBe(200);

    const sent = JSON.parse(fetch.mock.calls[0]![1]?.body as string) as {
      response_format: unknown;
      messages: { content: string }[];
    };
    expect(sent.response_format).toEqual({ type: 'json_object' });
    expect(sent.messages[0]!.content).toContain('The JSON object must match this JSON Schema:');
  });
});

describe('a model answer with no rationale', () => {
  /** The reply with every rationale removed (or blanked), as a provider that skips the field would send it. */
  function answerWithout(mode: 'omit' | 'blank'): string {
    const output = structuredClone(refund.fixtureOutput) as { requirements: Record<string, unknown>[] };
    for (const requirement of output.requirements) {
      if (mode === 'omit') delete requirement.rationale;
      else requirement.rationale = '';
    }
    return JSON.stringify(output);
  }

  it.each(['omit', 'blank'] as const)('is accepted when the rationale is %s, with the same findings and an empty rationale', async (mode) => {
    const fetch = fetchSpy(() => chatResponse(answerWithout(mode)));
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetch });
    const preview = await previewOf(app, 'live', refund.input);
    const response = await post(app, '/api/analyze', { mode: 'live', input: refund.input, approvedHash: preview.hash });
    expect(response.status).toBe(200);

    const body = await readJson<AnalyzeResponse>(response);
    expect(deriveFacts(body.output)).toEqual(refund.expected);
    expect(body.output.requirements.map((r) => r.rationale)).toEqual(refund.fixtureOutput.requirements.map(() => ''));
    for (const status of REQUIREMENT_STATUSES) {
      for (const requirement of body.findings[status]) expect(requirement.rationale).toBe('');
    }
  });

  it('does not let a missing rationale excuse a real error: a bad citation is still refused', async () => {
    const output = JSON.parse(answerWithout('omit')) as { requirements: { evidence: { passageId: string }[] }[] };
    output.requirements.find((r) => r.evidence.length > 0)!.evidence[0]!.passageId = 'refund-99';
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetchSpy(() => chatResponse(JSON.stringify(output))) });
    const preview = await previewOf(app, 'live', refund.input);
    const response = await post(app, '/api/analyze', { mode: 'live', input: refund.input, approvedHash: preview.hash });
    expect(response.status).toBe(422);
    const error = (await readJson<ApiErrorBody>(response)).error;
    expect(error.code).toBe('invalid_model_output');
    expect(error.issues?.map((issue) => issue.code)).toContain('unknown_passage_id');
  });
});

describe('a bad model answer is shown as an error, never as findings', () => {
  const bad: Array<[string, () => string, string]> = [
    ['plain prose', () => 'Sure! Here is my analysis of the refund policy.', 'invalid_json'],
    ['JSON in a Markdown fence', () => '```json\n' + JSON.stringify(refund.fixtureOutput) + '\n```', 'invalid_json'],
    ['truncated JSON', () => JSON.stringify(refund.fixtureOutput).slice(0, 120), 'invalid_json'],
    ['the wrong shape', () => JSON.stringify({ answer: 'yes' }), 'schema_violation'],
    [
      'an invented passage ID',
      () => {
        const output = structuredClone(refund.fixtureOutput);
        output.requirements[0]!.evidence[0]!.passageId = 'refund-99';
        return JSON.stringify(output);
      },
      'unknown_passage_id',
    ],
    [
      'a quote that is not in the passage',
      () => {
        const output = structuredClone(refund.fixtureOutput);
        output.requirements[0]!.evidence[0]!.quote = 'customers always get their money back';
        return JSON.stringify(output);
      },
      'quote_not_in_passage',
    ],
    [
      'a repair that carries text',
      () => {
        const output = structuredClone(refund.fixtureOutput) as unknown as { repairs: Record<string, unknown>[] };
        output.repairs[0]!.text = 'Invented policy text.';
        return JSON.stringify(output);
      },
      'schema_violation',
    ],
  ];

  it.each(bad)('%s: 422 with issues and the raw text, and no findings', async (_name, content, code) => {
    const fixture = countingFixtureClient();
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetchSpy(() => chatResponse(content())), clients: { fixture } });
    const response = await approvedAnalyze(app, 'live', refund.input);
    expect(response.status).toBe(422);
    const body = await readJson<ApiErrorBody>(response);
    expect(body.error.code).toBe('invalid_model_output');
    expect(body.error.issues?.map((issue) => issue.code)).toContain(code);
    expect(body.error.rawOutput).toBe(content());
    expect(body.error.retryable).toBe(true);
    expect(body).not.toHaveProperty('findings');
    expect(body).not.toHaveProperty('output');
    expect(fixture.calls).toBe(0);
  });

  it('truncates a very long raw answer', async () => {
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetchSpy(() => chatResponse('x'.repeat(50_000))) });
    const body = await readJson<ApiErrorBody>(await approvedAnalyze(app, 'live', refund.input));
    expect(body.error.rawOutput).toHaveLength(4_000);
  });
});

describe('provider failures are shown as errors, and live never falls back to fixture', () => {
  const cases: Array<[string, () => Response | Promise<Response>, number, string]> = [
    ['401 bad key', () => new Response('unauthorized', { status: 401 }), 502, 'model_auth'],
    ['403 forbidden', () => new Response('forbidden', { status: 403 }), 502, 'model_auth'],
    ['429 rate limit', () => new Response('slow down', { status: 429 }), 429, 'model_rate_limited'],
    ['400 bad request', () => new Response('unsupported response_format', { status: 400 }), 502, 'model_rejected'],
    ['404 unknown model', () => new Response('no such model', { status: 404 }), 502, 'model_rejected'],
    ['500 server error', () => new Response('oops', { status: 500 }), 502, 'model_upstream'],
    ['503 unavailable', () => new Response('busy', { status: 503 }), 502, 'model_upstream'],
    ['timeout', () => Promise.reject(new DOMException('timed out', 'TimeoutError')), 504, 'model_timeout'],
    ['network failure', () => Promise.reject(new TypeError('fetch failed')), 502, 'model_unreachable'],
    ['200 with the wrong shape', () => new Response(JSON.stringify({ choices: [] })), 502, 'model_bad_response'],
    ['200 with an HTML page', () => new Response('<html>captive portal</html>'), 502, 'model_bad_response'],
  ];

  it.each(cases)('%s', async (_name, respond, status, code) => {
    const fixture = countingFixtureClient();
    const app = makeApp({ env: LIVE_ENV, fetchImpl: fetchSpy(respond), clients: { fixture } });
    const response = await approvedAnalyze(app, 'live', refund.input);
    expect(response.status).toBe(status);
    const body = await readJson<ApiErrorBody>(response);
    expect(body.error.code).toBe(code);
    expect(typeof body.error.retryable).toBe('boolean');
    expect(body).not.toHaveProperty('findings');
    expect(body).not.toHaveProperty('output');
    expect(fixture.calls).toBe(0); // no silent fallback to hand-written output
  });
});

describe('the API key never leaves the server', () => {
  it('appears in no response, error or log line across success and failure paths, even when a provider echoes it', async () => {
    const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
    const replies: Array<() => Response | Promise<Response>> = [
      () => chatResponse(JSON.stringify(refund.fixtureOutput)),
      () => new Response(`invalid key ${KEY}`, { status: 401 }),
      () => new Response(`upstream echoed Authorization: Bearer ${KEY}`, { status: 500 }),
      () => Promise.reject(new TypeError(`connect failed using ${KEY}`)),
      () => chatResponse(`not json, but the key is ${KEY}`),
    ];

    const seen: string[] = [];
    for (const reply of replies) {
      const app = makeApp({ env: LIVE_ENV, fetchImpl: fetchSpy(reply) });
      seen.push(await (await app.request('/api/config')).text());
      const preview = await previewOf(app, 'live', refund.input);
      seen.push(JSON.stringify(preview));
      const response = await post(app, '/api/analyze', { mode: 'live', input: refund.input, approvedHash: preview.hash });
      seen.push(await response.text(), JSON.stringify([...response.headers.entries()]));
    }

    for (const text of seen) expect(text).not.toContain(KEY);
    // The echoes were scrubbed rather than dropped, so the user still sees that something was echoed.
    expect(seen.join('\n')).toContain('[redacted]');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    spies.forEach((spy) => spy.mockRestore());
  });
});
