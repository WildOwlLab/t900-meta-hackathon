/**
 * Tests for scripts/smoke-meta.ts.
 *
 * Every test injects a STUB fetch. Nothing here contacts a provider, and the stub responses
 * are made up by the test. These tests prove the script's gates and plumbing only. They say
 * nothing about how any real model or endpoint behaves.
 */
import { describe, expect, it, vi } from 'vitest';
import { runSmoke, type SmokeDeps } from '../../scripts/smoke-meta';
import { getExample } from '../../src/examples';
import { buildChatRequest } from '../../src/server/prompt';

const refund = getExample('refund-window')!;

const KEY = 'TESTKEY-123456';
const URL_WITH_SECRET = 'https://api.provider.test/v1/chat/completions?token=URLSECRET';
const liveEnv = { META_API_URL: URL_WITH_SECRET, META_MODEL: 'stub-model', META_API_KEY: KEY };

function chatResponse(content: string, status = 200): Response {
  const body = {
    id: 'stub-response-id',
    model: 'stub-model-returned',
    choices: [{ index: 0, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 11, completion_tokens: 22 },
  };
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setup(argv: string[], env: SmokeDeps['env'], respond?: () => Response | Promise<Response>) {
  const lines: string[] = [];
  const saved: Record<string, string> = {};
  const fetchSpy = vi.fn<typeof fetch>(async () => {
    if (!respond) throw new Error('fetch must not be called in this test');
    return respond();
  });
  let clock = 1_700_000_000_000;
  const deps: SmokeDeps = {
    argv,
    env,
    fetchImpl: fetchSpy,
    out: (line) => lines.push(line),
    save: (name, content) => {
      saved[name] = content;
    },
    now: () => (clock += 25),
  };
  return {
    run: () => runSmoke(deps),
    fetchSpy,
    output: () => lines.join('\n'),
    saved,
  };
}

describe('gates: nothing is sent without explicit approval', () => {
  it('previews the exact outbound request and sends nothing without --yes', async () => {
    const t = setup([], {});
    expect(await t.run()).toBe(0);
    expect(t.fetchSpy).not.toHaveBeenCalled();
    expect(t.output()).toContain('Not sent. Re-run with --yes');
    expect(t.output()).toContain('Teams annual plan');
    expect(t.output()).toContain('<META_MODEL not set>');
    expect(t.output()).toContain('<META_API_URL not set>');
    expect(t.saved).toEqual({});
  });

  it('still sends nothing without --yes when every variable is set', async () => {
    const t = setup([], liveEnv);
    expect(await t.run()).toBe(0);
    expect(t.fetchSpy).not.toHaveBeenCalled();
    expect(t.output()).toContain('stub-model');
  });

  it('with --yes but missing variables, names them and sends nothing', async () => {
    const t = setup(['--yes'], {});
    expect(await t.run()).toBe(2);
    expect(t.fetchSpy).not.toHaveBeenCalled();
    for (const name of ['META_API_URL', 'META_MODEL', 'META_API_KEY']) expect(t.output()).toContain(name);
  });

  it('refuses a plain-http endpoint, unless it is localhost', async () => {
    const remote = setup(['--yes'], { ...liveEnv, META_API_URL: 'http://api.provider.test/v1/chat/completions' });
    expect(await remote.run()).toBe(2);
    expect(remote.fetchSpy).not.toHaveBeenCalled();
    expect(remote.output()).toContain('https');

    const local = setup(['--yes'], { ...liveEnv, META_API_URL: 'http://localhost:9999/v1/chat/completions' }, () =>
      chatResponse(JSON.stringify(refund.fixtureOutput)),
    );
    expect(await local.run()).toBe(0);
    expect(local.fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses an endpoint with embedded credentials, and an invalid URL', async () => {
    for (const url of ['https://user:pass@api.provider.test/v1/chat', 'not a url']) {
      const t = setup(['--yes'], { ...liveEnv, META_API_URL: url });
      expect(await t.run()).toBe(2);
      expect(t.fetchSpy).not.toHaveBeenCalled();
    }
  });

  it('rejects bad arguments before doing anything', async () => {
    for (const argv of [['--nope'], ['--example'], ['--example', 'missing'], ['--repeat', '0'], ['--repeat', '9'], ['--repeat', 'x']]) {
      const t = setup([...argv, '--yes'], liveEnv);
      expect(await t.run(), argv.join(' ')).toBe(2);
      expect(t.fetchSpy).not.toHaveBeenCalled();
    }
  });
});

describe('plumbing with a stubbed provider (not a live call)', () => {
  it('sends the exact request once, then validates the reply', async () => {
    const t = setup(['--yes'], liveEnv, () => chatResponse(JSON.stringify(refund.fixtureOutput)));
    expect(await t.run()).toBe(0);

    expect(t.fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = t.fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(URL_WITH_SECRET);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init?.body as string)).toEqual(buildChatRequest(refund.input, 'stub-model'));

    const out = t.output();
    expect(out).toContain('HTTP status: 200');
    expect(out).toContain('Model (as returned by provider): stub-model-returned');
    expect(out).toContain('Response id: stub-response-id');
    expect(out).toContain('PASS  output parsed and passed the validator.');
    expect(out).toContain('Summary: 1/1 responses passed the validator.');
  });

  it('never prints or saves the key, and drops the query string from the printed endpoint', async () => {
    const t = setup(['--yes'], liveEnv, () => chatResponse(JSON.stringify(refund.fixtureOutput)));
    await t.run();
    const everything = t.output() + Object.values(t.saved).join('\n');
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain('URLSECRET');
    expect(Object.keys(t.saved).some((name) => name.endsWith('-request.json'))).toBe(true);
    expect(Object.keys(t.saved).some((name) => name.endsWith('-1-response.json'))).toBe(true);
  });

  it('redacts the key if a provider echoes it back', async () => {
    const t = setup(['--yes'], liveEnv, () => new Response(`bad request for ${KEY}`, { status: 400 }));
    expect(await t.run()).toBe(1);
    const everything = t.output() + Object.values(t.saved).join('\n');
    expect(everything).not.toContain(KEY);
    expect(everything).toContain('[redacted]');
  });

  it('fails, with issue codes, when the reply does not validate', async () => {
    const bad = structuredClone(refund.fixtureOutput);
    bad.requirements[0]!.evidence[0]!.passageId = 'zz-404';
    const t = setup(['--yes'], liveEnv, () => chatResponse(JSON.stringify(bad)));
    expect(await t.run()).toBe(1);
    expect(t.output()).toContain('FAIL  output failed validation');
    expect(t.output()).toContain('unknown_passage_id');
    expect(t.output()).toContain('Summary: 0/1');
  });

  it('fails on HTTP errors, non-JSON bodies, wrong shapes and network errors, without throwing', async () => {
    const cases: Array<() => Response | Promise<Response>> = [
      () => new Response('{"error":"unauthorized"}', { status: 401 }),
      () => new Response('<html>gateway</html>', { status: 200 }),
      () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      () => new Response(JSON.stringify({ choices: [{ message: { content: 42 } }] }), { status: 200 }),
      () => Promise.reject(new TypeError('network down')),
    ];
    for (const respond of cases) {
      const t = setup(['--yes'], liveEnv, respond);
      expect(await t.run()).toBe(1);
      expect(t.output()).toContain('FAIL');
    }
  });

  it('repeats the call and reports a combined result', async () => {
    const t = setup(['--yes', '--repeat', '3'], liveEnv, () => chatResponse(JSON.stringify(refund.fixtureOutput)));
    expect(await t.run()).toBe(0);
    expect(t.fetchSpy).toHaveBeenCalledTimes(3);
    expect(t.output()).toContain('Summary: 3/3');
  });

  it('can target a different built-in example', async () => {
    const t = setup(['--example', 'expense-injection'], {});
    expect(await t.run()).toBe(0);
    expect(t.output()).toContain('Example: expense-injection');
    expect(t.output()).toContain('ignore all earlier instructions');
  });
});

describe('negative control', () => {
  it('uses a deliberately invalid key, needs no real key, and passes only when rejected', async () => {
    const rejected = setup(['--yes', '--negative-control'], { META_API_URL: URL_WITH_SECRET, META_MODEL: 'stub-model' }, () =>
      new Response('{"error":"unauthorized"}', { status: 401 }),
    );
    expect(await rejected.run()).toBe(0);
    const [, init] = rejected.fetchSpy.mock.calls[0]!;
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer invalid-key-for-negative-control');
    expect(rejected.output()).toContain('PASS  provider rejected the invalid key');
  });

  it('never sends the real key, even if one is configured', async () => {
    const t = setup(['--yes', '--negative-control'], liveEnv, () => new Response('nope', { status: 403 }));
    await t.run();
    const [, init] = t.fetchSpy.mock.calls[0]!;
    expect(JSON.stringify(init?.headers)).not.toContain(KEY);
  });

  it('fails if the invalid key is accepted, because then the result proves nothing', async () => {
    const t = setup(['--yes', '--negative-control'], liveEnv, () => chatResponse('{}'));
    expect(await t.run()).toBe(1);
    expect(t.output()).toContain('negative control was ACCEPTED');
  });
});
