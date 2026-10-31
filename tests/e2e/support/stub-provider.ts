/**
 * A stand-in for a model provider, for browser tests only. Listens on 127.0.0.1. Never contacts anything.
 *
 *   POST /v1/chat/completions   answers in chat completions shape, if the Bearer key is the stub key
 *   GET  /__requests            every request received, with its Authorization header and exact body
 *   DELETE /__requests          forget requests and any queued one-off reply
 *   POST /__next                queue one reply: { status, body?, content? }
 *
 * For a built-in example, or for the custom case in ./custom-case, it returns the hand-written output.
 * That is test plumbing. It is not a model, and nothing it returns says anything about model quality.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { examples } from '../../../src/examples';
import { extractPayload } from '../../../src/server/prompt';
import { STUB_KEY, STUB_MODEL_RETURNED, STUB_PORT } from './constants';
import { customInput, customOutput } from './custom-case';

interface Recorded {
  authorization: string | null;
  body: string;
}

const requests: Recorded[] = [];
let queued: { status: number; body?: string; content?: string } | null = null;

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const send = (res: ServerResponse, status: number, body: string, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
};

function cannedOutput(rawBody: string): unknown | null {
  const request = JSON.parse(rawBody) as { messages: { content: string }[] };
  const payload = extractPayload(request.messages[1]!.content);
  const input = {
    task: payload.task,
    sources: payload.passages.map(({ id, title, text }) => ({ id, title, text })),
    pack: payload.passages.filter((passage) => passage.inPack).map((passage) => passage.id),
  };
  const example = examples.find((candidate) => isDeepStrictEqual(candidate.input, input));
  if (example) return example.fixtureOutput;
  return isDeepStrictEqual(customInput, input) ? customOutput : null;
}

let counter = 0;
const completion = (content: string) =>
  JSON.stringify({
    id: `stub-response-${(counter += 1)}`,
    model: STUB_MODEL_RETURNED,
    choices: [{ index: 0, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && pathname === '/__health') return send(res, 200, 'ok', 'text/plain');
    if (pathname === '/__requests' && req.method === 'GET') return send(res, 200, JSON.stringify(requests));
    if (pathname === '/__requests' && req.method === 'DELETE') {
      requests.length = 0;
      queued = null;
      return send(res, 200, '{}');
    }
    if (pathname === '/__next' && req.method === 'POST') {
      queued = JSON.parse(await readBody(req)) as typeof queued;
      return send(res, 200, '{}');
    }

    if (pathname === '/v1/chat/completions' && req.method === 'POST') {
      const body = await readBody(req);
      requests.push({ authorization: req.headers.authorization ?? null, body });

      if (req.headers.authorization !== `Bearer ${STUB_KEY}`) return send(res, 401, '{"error":"invalid api key"}');

      if (queued) {
        const next = queued;
        queued = null;
        if (next.status !== 200) return send(res, next.status, next.body ?? 'stub error', 'text/plain');
        return send(res, 200, completion(next.content ?? ''));
      }

      const output = cannedOutput(body);
      if (output === null) return send(res, 400, '{"error":"the stub has no canned answer for this input"}');
      return send(res, 200, completion(JSON.stringify(output)));
    }

    return send(res, 404, '{"error":"not found"}');
  } catch {
    return send(res, 500, '{"error":"stub failure"}');
  }
});

server.listen(STUB_PORT, '127.0.0.1', () => console.log(`Stub provider on http://127.0.0.1:${STUB_PORT} (loopback only)`));
