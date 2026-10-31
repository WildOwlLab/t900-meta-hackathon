import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import type { PreviewResponse } from '../../src/shared/api';
import type { AnalysisInput, Mode } from '../../src/shared/types';
import { createApp, type AppDeps } from '../../src/server/app';
import type { ModelClient } from '../../src/server/model/client';
import { createFixtureClient } from '../../src/server/model/fixture';

export const KEY = 'TESTKEY-API-654321';

/** A live configuration that points at a made-up host. No test ever reaches it. */
export const LIVE_ENV = {
  META_API_KEY: KEY,
  META_API_URL: 'https://api.provider.test/v1',
  META_MODEL: 'stub-model',
};
export const LIVE_URL = 'https://api.provider.test/v1/chat/completions';

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export function makeApp(overrides: Partial<AppDeps> = {}) {
  let clock = 1_700_000_000_000;
  return createApp({ env: {}, now: () => (clock += 20), ...overrides });
}

export type TestApp = ReturnType<typeof makeApp>;

export function post(app: TestApp, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

export const readJson = async <T = Record<string, any>>(response: Response): Promise<T> => (await response.json()) as T;

export async function previewOf(app: TestApp, mode: Mode, input: AnalysisInput): Promise<PreviewResponse> {
  const response = await post(app, '/api/preview', { mode, input });
  if (response.status !== 200) throw new Error(`preview failed: ${response.status} ${await response.text()}`);
  return readJson<PreviewResponse>(response);
}

/** Preview, then approve that exact preview. */
export async function approvedAnalyze(app: TestApp, mode: Mode, input: AnalysisInput): Promise<Response> {
  const preview = await previewOf(app, mode, input);
  return post(app, '/api/analyze', { mode, input, approvedHash: preview.hash });
}

/** A provider reply in chat completions shape. The content is whatever the test says. */
export function chatResponse(content: string, init: { status?: number } = {}): Response {
  return new Response(
    JSON.stringify({
      id: 'stub-response-id',
      model: 'stub-model-returned',
      choices: [{ index: 0, message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 11, completion_tokens: 22 },
    }),
    { status: init.status ?? 200, headers: { 'content-type': 'application/json' } },
  );
}

export type CountingClient = ModelClient & { calls: number };

/** Wraps the real fixture client and counts how many times it is asked to do anything. */
export function countingFixtureClient(): CountingClient {
  const inner = createFixtureClient();
  const client: CountingClient = {
    mode: 'fixture',
    calls: 0,
    complete(call) {
      client.calls += 1;
      return inner.complete(call);
    },
  };
  return client;
}

export const fetchSpy = (respond?: () => Response | Promise<Response>) =>
  vi.fn<typeof fetch>(async () => {
    if (!respond) throw new Error('fetch must not be called in this test');
    return respond();
  });
