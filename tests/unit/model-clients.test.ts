/**
 * Tests for the fixture client and the live client.
 *
 * The live client is exercised ONLY against stubbed responses written by these tests. Nothing
 * here contacts a provider, and the stubs say nothing about how a real endpoint behaves.
 */
import { describe, expect, it, vi } from 'vitest';
import { examples, getExample } from '../../src/examples';
import { loadConfig } from '../../src/server/config';
import { ModelError } from '../../src/server/model/client';
import { createFixtureClient } from '../../src/server/model/fixture';
import { createLiveClient, readChatBody } from '../../src/server/model/meta';

const refund = getExample('refund-window')!;
const KEY = 'TESTKEY-CLIENT-777';

const config = loadConfig({ META_API_KEY: KEY, META_API_URL: 'https://api.provider.test/v1?token=Q', META_MODEL: 'stub-model' });
if (!config.live.available) throw new Error('test setup: live config should be available');
const settings = config.live.settings;

function body(content: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ id: 'resp-1', model: 'stub-model-returned', choices: [{ message: { content } }], usage: { total_tokens: 3 }, ...extra });
}

function liveWith(respond: () => Response | Promise<Response>, timeoutMs?: number) {
  let clock = 1_000;
  const fetchSpy = vi.fn<typeof fetch>(async () => respond());
  const client = createLiveClient(settings, { fetchImpl: fetchSpy, now: () => (clock += 10), timeoutMs });
  return { client, fetchSpy };
}

const call = { body: '{"approved":"body"}', input: refund.input };

async function failureOf(respond: () => Response | Promise<Response>, timeoutMs?: number): Promise<ModelError> {
  const { client } = liveWith(respond, timeoutMs);
  const error = await client.complete(call).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ModelError);
  return error as ModelError;
}

describe('fixture client', () => {
  it.each(examples.map((e) => [e.slug, e] as const))('%s: returns the hand-written output as text, with no model metadata', async (_slug, example) => {
    const result = await createFixtureClient().complete({ body: 'ignored', input: example.input });
    expect(JSON.parse(result.text)).toEqual(example.fixtureOutput);
    expect(result.model).toBeNull();
    expect(result.responseId).toBeNull();
  });

  it('refuses input that is not one of the built-in examples, rather than inventing an analysis', async () => {
    const edited = { ...refund.input, task: refund.input.task + ' Also tell me the weather.' };
    const error = await createFixtureClient()
      .complete({ body: '', input: edited })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).code).toBe('fixture_not_available');
    expect((error as ModelError).message).toContain('built-in examples');
  });

  it('is exact: a one-character change to a passage is not a match', async () => {
    const edited = {
      ...refund.input,
      sources: refund.input.sources.map((p, i) => (i === 0 ? { ...p, text: p.text + '.' } : p)),
    };
    await expect(createFixtureClient().complete({ body: '', input: edited })).rejects.toBeInstanceOf(ModelError);
  });
});

describe('live client: a successful reply', () => {
  it('posts the approved body unchanged, with Bearer auth, to the resolved URL', async () => {
    const { client, fetchSpy } = liveWith(() => new Response(body('hello')));
    await client.complete(call);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('https://api.provider.test/v1/chat/completions?token=Q');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(call.body);
    expect(init?.headers).toEqual({ 'content-type': 'application/json', authorization: `Bearer ${KEY}` });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns the text and the provider-reported details, never invented ones', async () => {
    const { client } = liveWith(() => new Response(body('the answer')));
    const result = await client.complete(call);
    expect(result.text).toBe('the answer');
    expect(result.model).toBe('stub-model-returned');
    expect(result.responseId).toBe('resp-1');
    expect(result.usage).toEqual({ total_tokens: 3 });
    expect(result.latencyMs).toBe(10);
  });

  it('reports null, not a guess, for details the provider did not return', async () => {
    const { client } = liveWith(() => new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] })));
    const result = await client.complete(call);
    expect(result.model).toBeNull();
    expect(result.responseId).toBeNull();
    expect(result.usage).toBeNull();
  });
});

describe('live client: failures become typed errors', () => {
  const status = (code: number, text = 'nope') => () => new Response(text, { status: code });

  it.each([
    [401, 'auth', false],
    [403, 'auth', false],
    [429, 'rate_limited', true],
    [400, 'rejected', false],
    [404, 'rejected', false],
    [422, 'rejected', false],
    [500, 'upstream', true],
    [502, 'upstream', true],
    [503, 'upstream', true],
  ] as const)('HTTP %i is %s (retryable: %s)', async (code, expected, retryable) => {
    const error = await failureOf(status(code));
    expect(error.code).toBe(expected);
    expect(error.retryable).toBe(retryable);
    expect(error.status).toBe(code);
    expect(error.message).toContain(String(code));
  });

  it('treats a 200 with the wrong shape as a bad response', async () => {
    for (const text of ['<html>gateway</html>', '[]', 'null', JSON.stringify({ choices: [] }), body(42), body(null)]) {
      const error = await failureOf(() => new Response(text));
      expect(error.code, text).toBe('bad_response');
    }
  });

  it('reports a timeout as a timeout', async () => {
    const error = await failureOf(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    expect(error.code).toBe('timeout');
    expect(error.retryable).toBe(true);
  });

  it('really aborts a call that never answers, after the configured time', async () => {
    const neverAnswers = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const client = createLiveClient(settings, { fetchImpl: neverAnswers, now: () => 0, timeoutMs: 25 });
    const error = await client.complete(call).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((error as ModelError).code).toBe('timeout');
  });

  it('reports a network failure as unreachable', async () => {
    const error = await failureOf(() => Promise.reject(new TypeError('fetch failed')));
    expect(error.code).toBe('unreachable');
    expect(error.retryable).toBe(true);
  });

  it('never lets the API key into an error message, even if the provider or the network layer echoes it', async () => {
    const echoes = [
      failureOf(status(401, `invalid key ${KEY}`)),
      failureOf(status(500, `upstream saw ${KEY} in header`)),
      failureOf(() => Promise.reject(new TypeError(`connect failed for Bearer ${KEY}`))),
    ];
    for (const error of await Promise.all(echoes)) {
      expect(error.message).not.toContain(KEY);
      expect(error.message).toContain('[redacted]');
    }
  });

  it('includes a clipped excerpt of what the provider said, to help fix configuration', async () => {
    const error = await failureOf(status(400, 'unknown model "x". '.repeat(100)));
    expect(error.message).toContain('unknown model');
    expect(error.message.length).toBeLessThan(500);
  });
});

describe('readChatBody', () => {
  it('reads the content and the provider-reported fields', () => {
    const parsed = readChatBody(body('text'));
    expect(parsed).toMatchObject({ content: 'text', model: 'stub-model-returned', id: 'resp-1' });
    expect(parsed.shapeError).toBeUndefined();
  });

  it('describes what is wrong when the shape is unexpected', () => {
    expect(readChatBody('not json').shapeError).toMatch(/not JSON/);
    expect(readChatBody('[]').shapeError).toMatch(/choices/);
    expect(readChatBody('"str"').shapeError).toMatch(/not a JSON object/);
    expect(readChatBody(body(7)).shapeError).toMatch(/choices\[0\]\.message\.content/);
  });
});
