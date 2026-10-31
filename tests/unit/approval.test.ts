import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { examples, getExample } from '../../src/examples';
import { FIXTURE_MODEL_PLACEHOLDER, buildPreview, sha256Hex } from '../../src/server/approval';
import { loadConfig } from '../../src/server/config';
import { buildChatRequest, serializeRequest } from '../../src/server/prompt';

const refund = getExample('refund-window')!;
const nodeSha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const liveEnv = { META_API_KEY: 'SECRETKEY-1', META_API_URL: 'https://api.provider.test/v1?token=Q', META_MODEL: 'stub-model' };
const fixtureOnly = loadConfig({});
const liveConfigured = loadConfig(liveEnv);

describe('sha256Hex', () => {
  it('matches known SHA-256 test vectors', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('agrees with Node crypto on arbitrary text, including non-ASCII', async () => {
    for (const text of ['plain', 'line\nbreak', 'ünïcödé — ✓ 日本語', JSON.stringify({ a: [1, 2, 3] })]) {
      expect(await sha256Hex(text)).toBe(nodeSha256(text));
    }
  });
});

describe('buildPreview in fixture mode', () => {
  it('shows a header, then the exact request live mode would send, and says nothing is sent', async () => {
    const preview = await buildPreview(fixtureOnly, 'fixture', refund.input);
    expect(preview.mode).toBe('fixture');
    expect(preview.sentToProvider).toBe(false);
    expect(preview.destination).toBeNull();
    expect(preview.model).toBeNull();
    expect(preview.text.startsWith('mode: fixture\ndestination: none (fixture mode sends nothing)\n\n')).toBe(true);
    expect(preview.text.endsWith(preview.body)).toBe(true);
    expect(preview.body).toBe(serializeRequest(buildChatRequest(refund.input, FIXTURE_MODEL_PLACEHOLDER)));
  });

  it('the hash is the SHA-256 of the displayed text, so anyone can recompute it', async () => {
    const preview = await buildPreview(fixtureOnly, 'fixture', refund.input);
    expect(preview.hashAlgorithm).toBe('SHA-256');
    expect(preview.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.hash).toBe(nodeSha256(preview.text));
  });

  it('uses the configured model name when one exists, so the fixture preview matches live', async () => {
    const preview = await buildPreview(loadConfig({ META_MODEL: 'some/model' }), 'fixture', refund.input);
    expect(preview.model).toBe('some/model');
    expect(preview.body).toContain('"model": "some/model"');
  });
});

describe('buildPreview in live mode', () => {
  it('names the destination without the query string, and the configured model', async () => {
    const preview = await buildPreview(liveConfigured, 'live', refund.input);
    expect(preview.sentToProvider).toBe(true);
    expect(preview.destination).toBe('https://api.provider.test/v1/chat/completions');
    expect(preview.model).toBe('stub-model');
    expect(preview.text.startsWith('mode: live\ndestination: POST https://api.provider.test/v1/chat/completions\n\n')).toBe(true);
    expect(preview.text).not.toContain('token=Q');
    expect(preview.text).not.toContain('SECRETKEY-1');
    expect(preview.hash).toBe(nodeSha256(preview.text));
  });

  it('reports the configured response format', async () => {
    const preview = await buildPreview(loadConfig({ ...liveEnv, META_RESPONSE_FORMAT: 'json_object' }), 'live', refund.input);
    expect(preview.responseFormat).toBe('json_object');
    expect(preview.body).toContain('"type": "json_object"');
  });

  it('refuses to build a live preview when live is not available', async () => {
    await expect(buildPreview(fixtureOnly, 'live', refund.input)).rejects.toThrow(/not available/);
  });
});

describe('what the hash binds', () => {
  it('is deterministic for the same request', async () => {
    const a = await buildPreview(liveConfigured, 'live', refund.input);
    const b = await buildPreview(liveConfigured, 'live', structuredClone(refund.input));
    expect(a.hash).toBe(b.hash);
    expect(a.text).toBe(b.text);
  });

  it('changes when the task, a passage, the pack, or the source order changes', async () => {
    const base = (await buildPreview(fixtureOnly, 'fixture', refund.input)).hash;
    const variants = [
      { ...refund.input, task: refund.input.task + ' ' },
      { ...refund.input, pack: refund.input.pack.slice(1) },
      { ...refund.input, pack: [] },
      {
        ...refund.input,
        sources: refund.input.sources.map((p, i) => (i === 0 ? { ...p, text: p.text + '.' } : p)),
      },
      { ...refund.input, sources: [...refund.input.sources].reverse() },
    ];
    for (const variant of variants) {
      expect((await buildPreview(fixtureOnly, 'fixture', variant)).hash).not.toBe(base);
    }
  });

  it('does not change when only the order of the pack IDs changes, because the outbound text does not', async () => {
    const reordered = { ...refund.input, pack: [...refund.input.pack].reverse() };
    const a = await buildPreview(fixtureOnly, 'fixture', refund.input);
    const b = await buildPreview(fixtureOnly, 'fixture', reordered);
    expect(b.text).toBe(a.text);
    expect(b.hash).toBe(a.hash);
  });

  it('differs for every built-in example', async () => {
    const hashes = await Promise.all(examples.map(async (e) => (await buildPreview(fixtureOnly, 'fixture', e.input)).hash));
    expect(new Set(hashes).size).toBe(examples.length);
  });

  it('is different in fixture and live mode even when the request body is identical, so one approval cannot authorise the other', async () => {
    // Same configured model in both previews, so the HTTP bodies are byte-identical.
    const fixture = await buildPreview(liveConfigured, 'fixture', refund.input);
    const live = await buildPreview(liveConfigured, 'live', refund.input);
    expect(fixture.body).toBe(live.body);
    expect(fixture.hash).not.toBe(live.hash);
  });

  it('is different for a different destination', async () => {
    const other = loadConfig({ ...liveEnv, META_API_URL: 'https://other.provider.test/v1' });
    const a = await buildPreview(liveConfigured, 'live', refund.input);
    const b = await buildPreview(other, 'live', refund.input);
    expect(a.hash).not.toBe(b.hash);
  });

  it('is different for a different response format', async () => {
    const a = await buildPreview(fixtureOnly, 'fixture', refund.input);
    const b = await buildPreview(loadConfig({ META_RESPONSE_FORMAT: 'json_object' }), 'fixture', refund.input);
    expect(a.hash).not.toBe(b.hash);
  });
});
