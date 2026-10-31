/**
 * Shared by the Playwright config, the stub provider and the specs.
 *
 * The stub provider is a tiny HTTP server on 127.0.0.1. It stands in for a model provider so the live
 * path can be tested in a browser WITHOUT any external network call. The key below is a made-up value
 * that only this stub accepts.
 */
export const STUB_PORT = 9101;
export const STUB_KEY = 'E2E-STUB-KEY-000111';
export const STUB_ORIGIN = `http://127.0.0.1:${STUB_PORT}`;
/** What META_API_URL is set to for the live-stub API server. The server appends /chat/completions. */
export const STUB_BASE_URL = `${STUB_ORIGIN}/v1`;
export const STUB_CHAT_URL = `${STUB_BASE_URL}/chat/completions`;
export const STUB_MODEL_RETURNED = 'stub-model-returned';

export const FIXTURE_WEB_PORT = 5174;
export const FIXTURE_API_PORT = 8788;
export const LIVE_WEB_PORT = 5175;
export const LIVE_API_PORT = 8789;
