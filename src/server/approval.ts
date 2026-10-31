/**
 * The outbound preview and the approval it produces.
 *
 * The user approves a block of text. That text, hashed, is the approval. /api/analyze rebuilds
 * the same text from the request it receives and refuses to continue unless the hashes match,
 * so a request cannot be changed, or pointed at a different mode or destination, after approval.
 */
import type { PreviewResponse } from '../shared/api';
import type { AnalysisInput, Mode } from '../shared/types';
import type { AppConfig } from './config';
import { buildChatRequest, serializeRequest } from './prompt';

/** Shown as the model in a fixture preview when no live model is configured. */
export const FIXTURE_MODEL_PLACEHOLDER = '<set META_MODEL for live mode>';

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * `text` is what the user reads and what is hashed: two header lines naming the mode and the
 * destination, a blank line, then the exact HTTP body. The header is inside the hash on purpose,
 * so an approval given for fixture mode can never authorise a live send.
 *
 * In fixture mode the body is the request that live mode WOULD send. It is shown so the demo is
 * honest about what live mode transmits, and it is never sent anywhere.
 */
export async function buildPreview(config: AppConfig, mode: Mode, input: AnalysisInput): Promise<PreviewResponse> {
  let destination: string | null = null;
  let model: string | null = config.model;

  if (mode === 'live') {
    if (!config.live.available) throw new Error('Live mode is not available.');
    destination = config.live.settings.destination;
    model = config.live.settings.model;
  }

  const body = serializeRequest(
    buildChatRequest(input, model ?? FIXTURE_MODEL_PLACEHOLDER, { responseFormat: config.responseFormat }),
  );
  const header =
    mode === 'live'
      ? ['mode: live', `destination: POST ${destination}`]
      : ['mode: fixture', 'destination: none (fixture mode sends nothing)'];
  const text = [...header, '', body].join('\n');

  return {
    mode,
    sentToProvider: mode === 'live',
    destination,
    model,
    responseFormat: config.responseFormat,
    text,
    body,
    hashAlgorithm: 'SHA-256',
    hash: await sha256Hex(text),
  };
}
