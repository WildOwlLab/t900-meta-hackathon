/**
 * Live client for an OpenAI-compatible chat completions endpoint.
 *
 * Every assumption about the provider here (Bearer auth, the response shape, the status codes)
 * is the usual OpenAI-compatible convention and is UNVERIFIED for the configured host.
 * See docs/PROVIDER.md. This client has only been exercised against stubbed responses.
 */
import type { LiveSettings } from '../config';
import { ModelError, type ModelClient, type ModelResult } from './client';

export interface ChatBody {
  content?: string;
  model?: unknown;
  id?: unknown;
  usage?: unknown;
  shapeError?: string;
}

/** Read choices[0].message.content and the top-level model, id and usage from a response body. */
export function readChatBody(text: string): ChatBody {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { shapeError: 'Response body is not JSON.' };
  }
  if (body === null || typeof body !== 'object') return { shapeError: 'Response body is not a JSON object.' };
  const record = body as Record<string, unknown>;
  const choices = record.choices;
  const first = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  const common = { model: record.model, id: record.id, usage: record.usage };
  if (typeof content !== 'string') {
    return { ...common, shapeError: 'Expected choices[0].message.content to be a string.' };
  }
  return { ...common, content };
}

export const redact = (text: string, secret: string): string => (secret ? text.split(secret).join('[redacted]') : text);

const DETAIL_LIMIT = 300;

function describeFailure(status: number, bodyText: string, apiKey: string): ModelError {
  const clipped = redact(bodyText, apiKey).trim().slice(0, DETAIL_LIMIT);
  const detail = clipped ? ` The provider said: ${clipped}` : '';
  if (status === 401 || status === 403) {
    return new ModelError('auth', `The provider rejected the API key (HTTP ${status}).${detail}`, false, status);
  }
  if (status === 429) {
    return new ModelError('rate_limited', `The provider is rate limiting requests (HTTP 429).${detail}`, true, status);
  }
  if (status >= 500) {
    return new ModelError('upstream', `The provider had a server error (HTTP ${status}).${detail}`, true, status);
  }
  return new ModelError(
    'rejected',
    `The provider rejected the request (HTTP ${status}). Check the model ID, URL and response format.${detail}`,
    false,
    status,
  );
}

export interface LiveClientDeps {
  fetchImpl: typeof fetch;
  now: () => number;
  timeoutMs?: number;
}

export function createLiveClient(settings: LiveSettings, deps: LiveClientDeps): ModelClient {
  const timeoutMs = deps.timeoutMs ?? 60_000;
  return {
    mode: 'live',
    async complete({ body }): Promise<ModelResult> {
      const started = deps.now();
      let status: number;
      let text: string;
      try {
        const response = await deps.fetchImpl(settings.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}` },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        status = response.status;
        text = await response.text();
      } catch (error) {
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
          throw new ModelError('timeout', `The provider did not answer within ${Math.round(timeoutMs / 1000)} seconds.`, true);
        }
        const reason = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
        throw new ModelError('unreachable', `Could not reach the provider (${redact(reason, settings.apiKey)}).`, true);
      }

      if (status < 200 || status >= 300) throw describeFailure(status, text, settings.apiKey);

      const parsed = readChatBody(text);
      if (parsed.content === undefined) {
        throw new ModelError(
          'bad_response',
          `The provider answered, but not in the expected chat completions shape. ${parsed.shapeError ?? ''}`.trim(),
          false,
          status,
        );
      }
      return {
        text: parsed.content,
        model: typeof parsed.model === 'string' ? parsed.model : null,
        responseId: typeof parsed.id === 'string' ? parsed.id : null,
        usage: parsed.usage ?? null,
        latencyMs: deps.now() - started,
      };
    },
  };
}
