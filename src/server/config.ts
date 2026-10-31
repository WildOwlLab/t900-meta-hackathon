/**
 * Server configuration, read from environment variables only. Nothing here is hard-coded
 * for a provider: the URL, model ID and key all come from the environment.
 *
 * Live mode is available only when META_API_KEY, META_API_URL and META_MODEL are all set
 * and valid. Otherwise the server runs in fixture mode alone and says why live is off.
 */
import { RESPONSE_FORMATS, type ResponseFormatMode } from '../shared/types';

export type Env = Record<string, string | undefined>;

export type ChatUrlResult = { ok: true; url: URL } | { ok: false; error: string };

/**
 * Turn META_API_URL into the chat completions URL.
 *
 * OpenAI-compatible providers publish a base URL (for example one ending in /v1) and expose
 * `<base>/chat/completions`. A URL that already ends in /chat/completions is used as given.
 * The `/chat/completions` suffix is the OpenAI-compatible convention and is unverified for the
 * specific host, which is what the first live smoke test is for.
 */
export function resolveChatUrl(raw: string): ChatUrlResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'META_API_URL is not a valid URL.' };
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return { ok: false, error: 'META_API_URL must use https (http is allowed only for localhost).' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'META_API_URL must not contain credentials.' };
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  url.hash = '';
  return { ok: true, url };
}

/** Origin and path only. Query strings can carry secrets, so they are never shown or logged. */
export const displayEndpoint = (url: URL): string => `${url.origin}${url.pathname}`;

export interface LiveSettings {
  endpoint: URL;
  /** `endpoint` without any query string. Safe to show. */
  destination: string;
  model: string;
  apiKey: string;
  responseFormat: ResponseFormatMode;
}

export type LiveStatus = { available: true; settings: LiveSettings } | { available: false; reason: string };

export interface AppConfig {
  /** Valid value, or the default when the setting is absent or invalid. */
  responseFormat: ResponseFormatMode;
  /** The configured model ID, shown in fixture previews so they match what live mode would send. */
  model: string | null;
  live: LiveStatus;
}

const LIVE_VARIABLES = ['META_API_KEY', 'META_API_URL', 'META_MODEL'] as const;

export function loadConfig(env: Env): AppConfig {
  const get = (name: string): string | undefined => env[name]?.trim() || undefined;

  const formatRaw = get('META_RESPONSE_FORMAT');
  const formatValid = formatRaw === undefined || (RESPONSE_FORMATS as readonly string[]).includes(formatRaw);
  const responseFormat: ResponseFormatMode =
    formatRaw !== undefined && formatValid ? (formatRaw as ResponseFormatMode) : 'json_schema';
  const model = get('META_MODEL') ?? null;

  const missing = LIVE_VARIABLES.filter((name) => !get(name));
  let live: LiveStatus;
  if (missing.length === LIVE_VARIABLES.length) {
    live = {
      available: false,
      reason: `Live mode is off. Set ${LIVE_VARIABLES.join(', ')} on the server to turn it on.`,
    };
  } else if (missing.length > 0) {
    live = { available: false, reason: `Live mode is off. Missing: ${missing.join(', ')}.` };
  } else if (!formatValid) {
    live = {
      available: false,
      reason: `Live mode is off. META_RESPONSE_FORMAT must be one of: ${RESPONSE_FORMATS.join(', ')}.`,
    };
  } else {
    const resolved = resolveChatUrl(get('META_API_URL')!);
    live = resolved.ok
      ? {
          available: true,
          settings: {
            endpoint: resolved.url,
            destination: displayEndpoint(resolved.url),
            model: get('META_MODEL')!,
            apiKey: get('META_API_KEY')!,
            responseFormat,
          },
        }
      : { available: false, reason: `Live mode is off. ${resolved.error}` };
  }

  return { responseFormat, model, live };
}
