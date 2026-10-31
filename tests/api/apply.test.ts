import { describe, expect, it } from 'vitest';
import { examples, getExample } from '../../src/examples';
import type { AnalyzeResponse, ApiErrorBody, ApplyResponse } from '../../src/shared/api';
import { parseAnalysisInput } from '../../src/server/validator';
import { countingFixtureClient, fetchSpy, makeApp, approvedAnalyze, post, readJson } from './helpers';

const refund = getExample('refund-window')!;
const retention = getExample('retention-conflict')!;

/** Run the real approve-then-analyze flow in fixture mode and return the validated analysis. */
async function analysisOf(example: (typeof examples)[number]) {
  const app = makeApp();
  const body = await readJson<AnalyzeResponse>(await approvedAnalyze(app, 'fixture', example.input));
  return body;
}

const apply = (app: ReturnType<typeof makeApp>, body: unknown) => post(app, '/api/apply', body);

describe('POST /api/apply', () => {
  it('A4: with nothing approved, returns the pack unchanged', async () => {
    const analysis = await analysisOf(refund);
    const response = await apply(makeApp(), { input: refund.input, analysis: analysis.output, approvedRepairs: [] });
    expect(response.status).toBe(200);
    const body = await readJson<ApplyResponse>(response);
    expect(body.changed).toBe(false);
    expect(body.added).toEqual([]);
    expect(body.input).toEqual(refund.input);
    expect(body.revisedPackSize).toBe(body.originalPackSize);
  });

  it('A4: with a subset approved, applies only that subset', async () => {
    const analysis = await analysisOf(refund);
    const response = await apply(makeApp(), {
      input: refund.input,
      analysis: analysis.output,
      approvedRepairs: [{ requirementId: 'r4', passageId: 'refund-05' }],
    });
    const body = await readJson<ApplyResponse>(response);
    expect(body.input.pack).toEqual([...refund.input.pack, 'refund-05']);
    expect(body.added.map((a) => a.passageId)).toEqual(['refund-05']);
    expect(body.revisedPackSize).toBe(refund.input.pack.length + 1);
  });

  it.each(examples.map((e) => [e.slug, e] as const))('%s: A5 approving every proposed repair adds the original passages, byte for byte', async (_slug, example) => {
    const analysis = await analysisOf(example);
    const response = await apply(makeApp(), {
      input: example.input,
      analysis: analysis.output,
      approvedRepairs: analysis.repairs,
    });
    expect(response.status).toBe(200);
    const body = await readJson<ApplyResponse>(response);

    expect(body.input.pack).toEqual([...example.input.pack, ...example.expected.repairPassageIds]);
    expect(body.input.sources).toEqual(example.input.sources);
    expect(parseAnalysisInput(body.input).ok).toBe(true);
    for (const added of body.added) {
      const source = example.input.sources.find((p) => p.id === added.passageId)!;
      expect(added.text).toBe(source.text);
      expect(added.title).toBe(source.title);
    }
  });

  it('is deterministic', async () => {
    const analysis = await analysisOf(retention);
    const request = { input: retention.input, analysis: analysis.output, approvedRepairs: analysis.repairs };
    const a = await (await apply(makeApp(), request)).text();
    const b = await (await apply(makeApp(), request)).text();
    expect(b).toBe(a);
  });

  it('never calls a model or the network', async () => {
    const analysis = await analysisOf(refund);
    const fixture = countingFixtureClient();
    const fetch = fetchSpy();
    const app = makeApp({ clients: { fixture }, fetchImpl: fetch });
    await apply(app, { input: refund.input, analysis: analysis.output, approvedRepairs: analysis.repairs });
    expect(fixture.calls).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('POST /api/apply refuses anything that is not a proposed, approved repair', () => {
  it('rejects a repair the analysis did not propose, even for a real source passage', async () => {
    const analysis = await analysisOf(refund);
    const response = await apply(makeApp(), {
      input: refund.input,
      analysis: analysis.output,
      approvedRepairs: [{ requirementId: 'r3', passageId: 'refund-06' }],
    });
    expect(response.status).toBe(400);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe('repair_not_proposed');
  });

  it('rejects the same repair approved twice', async () => {
    const analysis = await analysisOf(refund);
    const one = analysis.repairs[0]!;
    const response = await apply(makeApp(), { input: refund.input, analysis: analysis.output, approvedRepairs: [one, one] });
    expect(response.status).toBe(400);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe('duplicate_repair_selection');
  });

  it('rejects an approved repair that carries text, so text cannot be smuggled into the pack', async () => {
    const analysis = await analysisOf(refund);
    const response = await apply(makeApp(), {
      input: refund.input,
      analysis: analysis.output,
      approvedRepairs: [{ ...analysis.repairs[0]!, text: 'Invented policy text.' }],
    });
    expect(response.status).toBe(400);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe('invalid_request');
  });

  it('re-validates the analysis: a repair that carries text is rejected there too', async () => {
    const analysis = await analysisOf(refund);
    const tampered = structuredClone(analysis.output) as unknown as { repairs: Record<string, unknown>[] };
    tampered.repairs[0]!.text = 'Invented policy text.';
    const response = await apply(makeApp(), {
      input: refund.input,
      analysis: tampered,
      approvedRepairs: [{ requirementId: tampered.repairs[0]!.requirementId, passageId: tampered.repairs[0]!.passageId }],
    });
    expect(response.status).toBe(422);
    expect((await readJson<ApiErrorBody>(response)).error.code).toBe('invalid_analysis');
  });

  it('re-validates the analysis: an invented passage ID, a changed quote, or a mismatched source set is rejected', async () => {
    const analysis = await analysisOf(refund);

    const invented = structuredClone(analysis.output);
    invented.repairs[0]!.passageId = 'refund-99';

    const requote = structuredClone(analysis.output);
    requote.requirements[0]!.evidence[0]!.quote = 'a quote that is not in the passage';

    const cases = [
      ['invented ID', refund.input, invented],
      ['changed quote', refund.input, requote],
      ['analysis of a different example', refund.input, (await analysisOf(retention)).output],
      ['null analysis', refund.input, null],
    ] as const;
    for (const [name, input, output] of cases) {
      const response = await apply(makeApp(), { input, analysis: output, approvedRepairs: [] });
      expect(response.status, name).toBe(422);
      expect((await readJson<ApiErrorBody>(response)).error.code, name).toBe('invalid_analysis');
    }
  });

  it('rejects invalid input and unknown fields', async () => {
    const analysis = await analysisOf(refund);
    const cases = [
      { input: { ...refund.input, pack: ['nope'] }, analysis: analysis.output, approvedRepairs: [] },
      { input: refund.input, approvedRepairs: [] }, // no analysis field at all: malformed request (400), unlike a bad analysis (422)
      { input: refund.input, analysis: analysis.output },
      { input: refund.input, analysis: analysis.output, approvedRepairs: [], extra: true },
      { input: refund.input, analysis: analysis.output, approvedRepairs: 'all' },
    ];
    for (const body of cases) {
      const response = await apply(makeApp(), body);
      expect(response.status, JSON.stringify(body).slice(-60)).toBe(400);
    }
  });
});
