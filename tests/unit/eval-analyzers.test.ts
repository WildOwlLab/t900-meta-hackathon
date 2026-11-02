/**
 * The analyzers. The live analyzer is exercised ONLY against stubbed provider responses written here.
 * Where a stub replies with a case's hand-written ideal output, that is test plumbing, not a model.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  KEYWORD_CONFLICT_MIN_SHARED,
  KEYWORD_MIN_SHARED,
  createLiveAnalyzer,
  keywordAnalyzer,
  keywordFacts,
  liveRequestBody,
  oracleAnalyzer,
} from '../../src/eval/analyzers';
import { evalCases } from '../../src/eval/cases';
import type { EvalCase } from '../../src/eval/types';
import { loadConfig } from '../../src/server/config';
import { extractPayload } from '../../src/server/prompt';

const KEY = 'TESTKEY-EVAL-424242';
const config = loadConfig({ META_API_KEY: KEY, META_API_URL: 'https://api.provider.test/v1', META_MODEL: 'stub-model' });
if (!config.live.available) throw new Error('test setup: live config should be available');
const settings = config.live.settings;

const refund = evalCases.find((c) => c.id === 'refund-window')!;

describe('oracle', () => {
  it.each(evalCases.map((c) => [c.id, c] as const))('%s: returns exactly the gold facts, through the validator', async (_id, testCase) => {
    const out = await oracleAnalyzer.run(testCase);
    expect(out.failure).toBeNull();
    expect(out.facts).toEqual(testCase.example.expected);
    expect(out.model).toBeNull();
  });

  it('fails visibly, rather than passing, if an ideal output stops validating', async () => {
    const broken: EvalCase = structuredClone(refund);
    broken.example.fixtureOutput.requirements[0]!.evidence[0]!.passageId = 'nope-1';
    const out = await oracleAnalyzer.run(broken);
    expect(out.facts).toBeNull();
    expect(out.failure?.kind).toBe('invalid_output');
    expect(out.failure?.issues?.length).toBeGreaterThan(0);
  });

  it('is labelled as a sanity check, not a result', () => {
    expect(oracleAnalyzer.kind).toBe('oracle');
    expect(oracleAnalyzer.description).toMatch(/100% by construction/);
    expect(oracleAnalyzer.description).toMatch(/nothing about any model/);
  });
});

describe('keyword baseline', () => {
  it('is deterministic', () => {
    for (const c of evalCases) expect(keywordFacts(c)).toEqual(keywordFacts(structuredClone(c)));
  });

  it('never looks at the gold labels, the ideal output, or the distractor lists', () => {
    for (const c of evalCases) {
      const scrambled = structuredClone(c);
      scrambled.example.expected = { supported: ['zz'], missing: ['zz'], conflicts: [['zz', 'yy']], unanswerable: 99, repairPassageIds: ['zz'] };
      scrambled.example.fixtureOutput = { requirements: [], repairs: [] };
      scrambled.example.distractorPassageIds = ['zz'];
      scrambled.example.injectionPassageIds = ['zz'];
      scrambled.tags = ['zz'];
      expect(keywordFacts(scrambled), c.id).toEqual(keywordFacts(c));
    }
  });

  it('depends on the task, the passages and the pack, and on nothing else', () => {
    const base = keywordFacts(refund);
    const emptyTask = structuredClone(refund);
    emptyTask.example.input.task = 'zebra';
    expect(keywordFacts(emptyTask)).not.toEqual(base);
    expect(keywordFacts(emptyTask).supported).toEqual([]);

    const allInPack = structuredClone(refund);
    allInPack.example.input.pack = allInPack.example.input.sources.map((p) => p.id);
    expect(keywordFacts(allInPack).missing).toEqual([]);
    const noPack = structuredClone(refund);
    noPack.example.input.pack = [];
    expect(keywordFacts(noPack).supported).toEqual([]);
  });

  it('never reports an unanswerable question, because it has no way to', async () => {
    for (const c of evalCases) expect(keywordFacts(c).unanswerable, c.id).toBe(0);
    expect(keywordAnalyzer.description).toMatch(/never reports an unanswerable/);
  });

  it('proposes exactly the passages it calls missing as repairs, and splits relevant passages by pack membership', () => {
    for (const c of evalCases) {
      const facts = keywordFacts(c);
      expect(facts.repairPassageIds, c.id).toEqual(facts.missing);
      const pack = new Set(c.example.input.pack);
      expect(facts.supported.every((id) => pack.has(id)), c.id).toBe(true);
      expect(facts.missing.every((id) => !pack.has(id)), c.id).toBe(true);
    }
  });

  it('flags a conflict only between passages that share a topic and carry different numbers', () => {
    const conflict = evalCases.find((c) => c.id === 'api-limit-conflict')!;
    expect(keywordFacts(conflict).conflicts).toContainEqual(['a-01', 'a-02']);

    const same = structuredClone(conflict);
    same.example.input.sources.find((p) => p.id === 'a-02')!.text = 'Starter plan includes 1,000 requests per day.';
    expect(keywordFacts(same).conflicts).not.toContainEqual(['a-01', 'a-02']);
  });

  it('keeps its constants fixed. Changing them is a deliberate act that changes every number in the docs', () => {
    expect(KEYWORD_MIN_SHARED).toBe(2);
    expect(KEYWORD_CONFLICT_MIN_SHARED).toBe(3);
  });

  it('is labelled as not a model', async () => {
    expect(keywordAnalyzer.kind).toBe('baseline');
    expect(keywordAnalyzer.label).toMatch(/not a model/);
    const out = await keywordAnalyzer.run(refund);
    expect(out.model).toBeNull();
    expect(out.failure).toBeNull();
  });
});

/** A stub provider that answers each case with its own ideal output. Test plumbing, not a model. */
function stubFor(testCases: readonly EvalCase[]) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(init?.body as string) as { messages: { content: string }[] };
    const payload = extractPayload(request.messages[1]!.content);
    const match = testCases.find((c) => c.example.input.task === payload.task);
    const content = match ? JSON.stringify(match.example.fixtureOutput) : 'no canned answer';
    return new Response(
      JSON.stringify({ id: 'resp-1', model: 'stub-model-returned', choices: [{ message: { content } }], usage: { total_tokens: 9 } }),
    );
  });
}

describe('live analyzer (against a stub provider)', () => {
  const live = (fetchImpl: typeof fetch, onRaw?: (id: string, text: string) => void) =>
    createLiveAnalyzer({ settings, fetchImpl, now: () => 1_000, onRaw });

  it('sends the exact request body the preview shows, and returns provider details as reported', async () => {
    const fetchImpl = stubFor(evalCases);
    const out = await live(fetchImpl).run(refund);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('https://api.provider.test/v1/chat/completions');
    expect(init?.body).toBe(liveRequestBody(settings, refund));
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);

    expect(out.facts).toEqual(refund.example.expected);
    expect(out.model).toBe('stub-model-returned');
    expect(out.usage).toEqual({ total_tokens: 9 });
  });

  it('is labelled as the one analyzer that measures a model, and names its destination', () => {
    const analyzer = live(stubFor(evalCases));
    expect(analyzer.kind).toBe('model');
    expect(analyzer.label).toContain('stub-model');
    expect(analyzer.description).toContain('https://api.provider.test/v1/chat/completions');
  });

  it('turns an answer that fails validation into a visible failure with the issues, not a score', async () => {
    const out = await live(vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Sure! Here is my analysis.' } }] })))).run(refund);
    expect(out.facts).toBeNull();
    expect(out.failure?.kind).toBe('invalid_output');
    expect(out.failure?.issues?.[0]?.code).toBe('invalid_json');
  });

  it('does not count an answer with no rationale as a failed output', async () => {
    const output = structuredClone(refund.example.fixtureOutput) as { requirements: Record<string, unknown>[] };
    for (const requirement of output.requirements) delete requirement.rationale;
    const reply = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] })));
    const out = await live(reply).run(refund);
    expect(out.failure).toBeNull();
    expect(out.facts).toEqual(refund.example.expected);
  });

  it('turns provider errors into failures, with the key redacted', async () => {
    for (const respond of [
      () => new Response(`bad key ${KEY}`, { status: 401 }),
      () => new Response('slow down', { status: 429 }),
      () => new Response('oops', { status: 500 }),
      () => Promise.reject(new TypeError(`network down for ${KEY}`)),
    ]) {
      const out = await live(vi.fn<typeof fetch>(async () => respond())).run(refund);
      expect(out.facts).toBeNull();
      expect(out.failure?.kind).toBe('error');
      expect(out.failure?.message).not.toContain(KEY);
    }
  });

  it('hands the raw model text to onRaw, with the key redacted', async () => {
    const seen: Array<[string, string]> = [];
    const echoing = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: `echo ${KEY}` } }] })));
    await live(echoing, (id, text) => seen.push([id, text])).run(refund);
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toBe('refund-window');
    expect(seen[0]![1]).toBe('echo [redacted]');
  });

  it('builds the same request for the same case every time', () => {
    for (const c of evalCases) expect(liveRequestBody(settings, c)).toBe(liveRequestBody(settings, structuredClone(c)));
  });
});
