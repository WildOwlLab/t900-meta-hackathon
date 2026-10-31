import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  AnalyzeRequestSchema,
  ApplyRequestSchema,
  PreviewRequestSchema,
  type AnalyzeResponse,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApplyResponse,
  type ConfigResponse,
} from '../shared/api';
import { groupFindings } from '../shared/facts';
import { FIXTURE_NOTICE, type Mode } from '../shared/types';
import { buildPreview } from './approval';
import { loadConfig, type Env } from './config';
import { ModelError, type ModelClient, type ModelErrorCode } from './model/client';
import { createFixtureClient } from './model/fixture';
import { createLiveClient, redact } from './model/meta';
import { applyRepairs } from './repair';
import { issuesFromZod, validateModelOutput } from './validator';

export interface AppDeps {
  env: Env;
  /** Injected in tests. Defaults to the global fetch, looked up at call time. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Replace a model client. Used by tests to count calls. */
  clients?: Partial<Record<Mode, ModelClient>>;
}

const MAX_BODY_BYTES = 512 * 1024;
const RAW_OUTPUT_LIMIT = 4_000;
const INVALID_JSON = Symbol('invalid json');

const MODEL_ERROR_RESPONSES: Record<ModelErrorCode, { status: 422 | 429 | 502 | 504; code: ApiErrorCode }> = {
  fixture_not_available: { status: 422, code: 'fixture_not_available' },
  auth: { status: 502, code: 'model_auth' },
  rate_limited: { status: 429, code: 'model_rate_limited' },
  timeout: { status: 504, code: 'model_timeout' },
  unreachable: { status: 502, code: 'model_unreachable' },
  rejected: { status: 502, code: 'model_rejected' },
  upstream: { status: 502, code: 'model_upstream' },
  bad_response: { status: 502, code: 'model_bad_response' },
};

function failure(code: ApiErrorCode, message: string, extra: Partial<ApiErrorBody['error']> = {}): ApiErrorBody {
  return { error: { code, message, ...extra } };
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return INVALID_JSON;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The API. Stateless: no database, no sessions. Every request carries what it needs.
 *
 * There is no authentication. The server therefore binds to loopback (see main.ts) and must
 * not be exposed publicly while a provider key is configured.
 */
export function createApp(deps: AppDeps): Hono {
  const config = loadConfig(deps.env);
  const now = deps.now ?? (() => Date.now());
  const fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));

  const clients: Record<Mode, ModelClient | null> = {
    fixture: deps.clients?.fixture ?? createFixtureClient(),
    live: deps.clients?.live ?? (config.live.available ? createLiveClient(config.live.settings, { fetchImpl, now }) : null),
  };

  const app = new Hono();

  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json(failure('payload_too_large', 'The request body is too large.'), 413),
    }),
  );

  // Requiring application/json means a cross-site page cannot send this request without a CORS
  // preflight, which this server never grants.
  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'POST' && !(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return c.json(failure('unsupported_media_type', 'Send requests as application/json.'), 415);
    }
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/config', (c) => {
    const body: ConfigResponse = {
      defaultMode: 'fixture',
      fixture: { available: true },
      live: config.live.available
        ? {
            available: true,
            destination: config.live.settings.destination,
            model: config.live.settings.model,
            responseFormat: config.live.settings.responseFormat,
          }
        : { available: false, reason: config.live.reason },
    };
    return c.json(body);
  });

  app.post('/api/preview', async (c) => {
    const raw = await readJson(c);
    if (raw === INVALID_JSON) return c.json(failure('invalid_request', 'The request body is not valid JSON.'), 400);
    const parsed = PreviewRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(failure('invalid_request', 'The request is not valid.', { issues: issuesFromZod(parsed.error) }), 400);
    }
    const { mode, input } = parsed.data;
    if (mode === 'live' && !config.live.available) {
      return c.json(failure('live_unavailable', config.live.reason), 409);
    }
    return c.json(await buildPreview(config, mode, input));
  });

  app.post('/api/analyze', async (c) => {
    const raw = await readJson(c);
    if (raw === INVALID_JSON) return c.json(failure('invalid_request', 'The request body is not valid JSON.'), 400);

    // No approval, no model call. Checked before anything else about the request.
    if (isRecord(raw) && (raw.approvedHash === undefined || raw.approvedHash === null || raw.approvedHash === '')) {
      return c.json(failure('approval_required', 'Approve the outbound text first. No approval hash was sent.'), 400);
    }

    const parsed = AnalyzeRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(failure('invalid_request', 'The request is not valid.', { issues: issuesFromZod(parsed.error) }), 400);
    }
    const { mode, input, approvedHash } = parsed.data;

    const client = clients[mode];
    if (mode === 'live' && (!config.live.available || !client)) {
      return c.json(failure('live_unavailable', config.live.available ? 'Live mode is not available.' : config.live.reason), 409);
    }
    if (!client) return c.json(failure('internal_error', 'No model client is configured.'), 500);

    // Rebuild the exact text from the request actually received, then compare with what was approved.
    const preview = await buildPreview(config, mode, input);
    if (preview.hash !== approvedHash) {
      return c.json(
        failure('approval_mismatch', 'The text changed after you approved it. Review the new preview and approve it again.'),
        409,
      );
    }

    let result;
    try {
      result = await client.complete({ body: preview.body, input });
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      const mapped = MODEL_ERROR_RESPONSES[error.code];
      return c.json(failure(mapped.code, error.message, { retryable: error.retryable }), mapped.status);
    }

    const checked = validateModelOutput(result.text, input);
    if (!checked.ok) {
      // The model never sees the key (it travels in a header), but this text goes straight to the
      // browser, so it is scrubbed anyway.
      const secret = config.live.available ? config.live.settings.apiKey : '';
      return c.json(
        failure('invalid_model_output', 'The model answered, but the answer failed validation, so no findings are shown.', {
          issues: checked.issues.map((issue) => ({ ...issue, message: redact(issue.message, secret) })),
          omitted: checked.omitted,
          rawOutput: redact(result.text, secret).slice(0, RAW_OUTPUT_LIMIT),
          retryable: true,
        }),
        422,
      );
    }

    const body: AnalyzeResponse = {
      mode,
      notice: mode === 'fixture' ? FIXTURE_NOTICE : null,
      findings: groupFindings(checked.value),
      repairs: checked.value.repairs,
      output: checked.value,
      meta: {
        sentToProvider: preview.sentToProvider,
        destination: preview.destination,
        model: result.model,
        responseId: result.responseId,
        usage: result.usage,
        latencyMs: result.latencyMs,
        approvedHash,
      },
    };
    return c.json(body);
  });

  app.post('/api/apply', async (c) => {
    const raw = await readJson(c);
    if (raw === INVALID_JSON) return c.json(failure('invalid_request', 'The request body is not valid JSON.'), 400);
    const parsed = ApplyRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(failure('invalid_request', 'The request is not valid.', { issues: issuesFromZod(parsed.error) }), 400);
    }
    const { input, analysis, approvedRepairs } = parsed.data;

    // The analysis is checked again, against the sources it claims to be about.
    const checked = validateModelOutput(analysis, input);
    if (!checked.ok) {
      return c.json(
        failure('invalid_analysis', 'The analysis does not match these sources, so nothing was applied.', {
          issues: checked.issues,
          omitted: checked.omitted,
        }),
        422,
      );
    }

    const applied = applyRepairs(input, checked.value, approvedRepairs);
    if (!applied.ok) return c.json(failure(applied.code, applied.message), 400);

    const body: ApplyResponse = {
      input: applied.input,
      changed: applied.changed,
      added: applied.added,
      originalPackSize: input.pack.length,
      revisedPackSize: applied.input.pack.length,
    };
    return c.json(body);
  });

  app.notFound((c) => c.json(failure('not_found', 'No such route.'), 404));

  // Deliberately logs nothing: error messages can contain user text.
  app.onError((_error, c) => c.json(failure('internal_error', 'Unexpected server error.'), 500));

  return app;
}
