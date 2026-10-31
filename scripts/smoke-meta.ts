/**
 * Smoke test for ONE real round trip to the model provider.
 *
 * Nothing is sent unless you pass --yes. Without it the script prints the exact request
 * body and exits. It has not been run against a live endpoint yet: the endpoint, auth
 * scheme and response shape below are assumptions to confirm against the official docs
 * (see docs/PROVIDER.md before the first live run).
 *
 * Usage:
 *   npm run smoke:meta -- [--example <slug>] [--yes] [--negative-control] [--repeat <1-5>]
 *
 * Environment (names only, see .env.example): META_API_KEY, META_API_URL, META_MODEL.
 *
 * What it does with --yes:
 *   1. POSTs the request once per repeat, with `Authorization: Bearer <key>`.
 *   2. Saves the raw request and response under .smoke/ (gitignored). The key is never saved.
 *   3. Prints status, the model ID AS RETURNED by the provider, response id, usage, latency.
 *   4. Parses choices[0].message.content and runs it through the real validator.
 *
 * --negative-control sends a deliberately invalid key and passes only if the provider
 * rejects it. That shows the call reaches a real service and is not a fixture.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { examples, getExample } from '../src/examples';
import { buildChatRequest } from '../src/server/prompt';
import { validateModelOutput } from '../src/server/validator';

export interface SmokeDeps {
  argv: string[];
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  out: (line: string) => void;
  save: (name: string, content: string) => void;
  now: () => number;
}

const USAGE = 'Usage: npm run smoke:meta -- [--example <slug>] [--yes] [--negative-control] [--repeat <1-5>]';
const NEGATIVE_CONTROL_KEY = 'invalid-key-for-negative-control';
const MAX_REPEAT = 5;
const TIMEOUT_MS = 60_000;

interface Options {
  yes: boolean;
  negativeControl: boolean;
  example: string;
  repeat: number;
}

function parseArgs(argv: string[]): Options | string {
  const options: Options = { yes: false, negativeControl: false, example: 'refund-window', repeat: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--yes') options.yes = true;
    else if (arg === '--negative-control') options.negativeControl = true;
    else if (arg === '--example') {
      const value = argv[(i += 1)];
      if (!value) return '--example needs a value.';
      options.example = value;
    } else if (arg === '--repeat') {
      const value = Number(argv[(i += 1)]);
      if (!Number.isInteger(value) || value < 1 || value > MAX_REPEAT) {
        return `--repeat must be a whole number from 1 to ${MAX_REPEAT}.`;
      }
      options.repeat = value;
    } else {
      return `Unknown argument "${arg}".`;
    }
  }
  return options;
}

function parseEndpoint(raw: string): URL | string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'META_API_URL is not a valid URL.';
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return 'META_API_URL must use https (http is allowed only for localhost).';
  }
  if (url.username || url.password) return 'META_API_URL must not contain credentials.';
  return url;
}

/** Origin and path only. Query strings can carry secrets, so they are never printed. */
const displayEndpoint = (url: URL): string => `${url.origin}${url.pathname}`;

interface ChatBody {
  content?: string;
  model?: unknown;
  id?: unknown;
  usage?: unknown;
  shapeError?: string;
}

function readChatBody(text: string): ChatBody {
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
    return { ...common, shapeError: 'Expected choices[0].message.content to be a string. Check the official docs.' };
  }
  return { ...common, content };
}

export async function runSmoke(deps: SmokeDeps): Promise<number> {
  const { env, out } = deps;

  const options = parseArgs(deps.argv);
  if (typeof options === 'string') {
    out(options);
    out(USAGE);
    return 2;
  }
  const example = getExample(options.example);
  if (!example) {
    out(`Unknown example "${options.example}". Available: ${examples.map((e) => e.slug).join(', ')}`);
    return 2;
  }

  const endpointRaw = env.META_API_URL?.trim();
  const endpoint = endpointRaw ? parseEndpoint(endpointRaw) : undefined;
  const model = env.META_MODEL?.trim() || '<META_MODEL not set>';
  const request = buildChatRequest(example.input, model);

  out('LIVE SMOKE TEST. If sent, the request below goes to an external model provider.');
  out(`Example: ${example.slug} (synthetic data)`);
  out(
    `Endpoint: ${endpoint instanceof URL ? displayEndpoint(endpoint) : (endpointRaw ? '<invalid META_API_URL>' : '<META_API_URL not set>')}`,
  );
  out(`Key: ${options.negativeControl ? 'deliberately invalid (negative control)' : 'META_API_KEY'}`);
  out(`Repeats: ${options.repeat}`);
  out('--- outbound request body (exactly what would be sent) ---');
  out(JSON.stringify(request, null, 2));
  out('--- end of request body ---');

  if (!options.yes) {
    out('Not sent. Re-run with --yes to send this exact request.');
    return 0;
  }

  const missing = ['META_API_URL', 'META_MODEL']
    .concat(options.negativeControl ? [] : ['META_API_KEY'])
    .filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    out(`Not sent. Missing environment variables: ${missing.join(', ')}`);
    return 2;
  }
  if (typeof endpoint === 'string') {
    out(`Not sent. ${endpoint}`);
    return 2;
  }
  if (!(endpoint instanceof URL)) return 2;

  const realKey = env.META_API_KEY?.trim() ?? '';
  const key = options.negativeControl ? NEGATIVE_CONTROL_KEY : realKey;
  const redact = (text: string): string => (realKey ? text.split(realKey).join('[redacted]') : text);

  const stamp = new Date(deps.now()).toISOString().replace(/[:.]/g, '-');
  deps.save(`${stamp}-request.json`, JSON.stringify(request, null, 2));

  let passed = 0;
  for (let i = 1; i <= options.repeat; i += 1) {
    out('');
    out(`=== call ${i} of ${options.repeat} ===`);
    const started = deps.now();
    let response: Response;
    let text: string;
    try {
      response = await deps.fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
      out(`FAIL  request did not complete (${redact(reason)})`);
      continue;
    }
    const latencyMs = deps.now() - started;
    deps.save(`${stamp}-${i}-response.json`, redact(text));
    out(`HTTP status: ${response.status}`);
    out(`Latency: ${latencyMs} ms`);

    if (options.negativeControl) {
      if (response.ok) {
        out('FAIL  negative control was ACCEPTED. The invalid key worked, so this result proves nothing.');
      } else {
        out('PASS  provider rejected the invalid key, as expected.');
        passed += 1;
      }
      continue;
    }

    if (!response.ok) {
      out(`FAIL  provider returned an error. Body (first 300 chars): ${redact(text).slice(0, 300)}`);
      continue;
    }

    const body = readChatBody(text);
    out(`Model (as returned by provider): ${typeof body.model === 'string' ? body.model : 'not returned'}`);
    out(`Response id: ${typeof body.id === 'string' ? body.id : 'not returned'}`);
    out(`Usage: ${body.usage === undefined ? 'not returned' : redact(JSON.stringify(body.usage))}`);
    if (body.content === undefined) {
      out(`FAIL  ${body.shapeError ?? 'Unexpected response shape.'} Raw response saved under .smoke/.`);
      continue;
    }

    const result = validateModelOutput(body.content, example.input);
    if (result.ok) {
      out('PASS  output parsed and passed the validator.');
      passed += 1;
    } else {
      out(`FAIL  output failed validation (${result.issues.length + result.omitted} issue(s)):`);
      for (const issue of result.issues.slice(0, 10)) out(`        ${issue.code} at ${issue.path}: ${issue.message}`);
    }
  }

  out('');
  out(
    options.negativeControl
      ? `Negative control: ${passed}/${options.repeat} calls were rejected as expected.`
      : `Summary: ${passed}/${options.repeat} responses passed the validator.`,
  );
  return passed === options.repeat ? 0 : 1;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const outDir = '.smoke';
  runSmoke({
    argv: process.argv.slice(2),
    env: process.env,
    fetchImpl: fetch,
    out: (line) => console.log(line),
    save: (name, content) => {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, name), content, { mode: 0o600 });
    },
    now: () => Date.now(),
  }).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
