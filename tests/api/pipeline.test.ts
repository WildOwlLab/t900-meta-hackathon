/**
 * The whole product path, once per case: preview, approve, analyze, apply every repair, then every export.
 *
 * The provider is a STUB that answers each case with its hand-written ideal output. This proves the
 * parts fit together on every case, including the empty pack, the two-conflict case and the injection
 * cases. It says nothing about how a real model would do.
 */
import { describe, expect, it } from 'vitest';
import { evalCases } from '../../src/eval/cases';
import { validateModelOutput } from '../../src/server/validator';
import type { AnalyzeResponse, ApplyResponse } from '../../src/shared/api';
import {
  EvidenceReportSchema,
  buildEvidenceReport,
  evidenceReportJson,
  evidenceReportSummary,
  revisedPackMarkdown,
  revisedPackText,
  type ExportContext,
} from '../../src/shared/export';
import { deriveFacts } from '../../src/shared/facts';
import type { AnalysisInput, ModelOutput } from '../../src/shared/types';
import { customInput, customOutput } from '../e2e/support/custom-case';
import { LIVE_ENV, chatResponse, fetchSpy, makeApp, post, previewOf, readJson } from './helpers';
import { extractPayload } from '../../src/server/prompt';

interface Item {
  id: string;
  input: AnalysisInput;
  output: ModelOutput;
  expectedRepairs: string[];
}

const items: Item[] = [
  ...evalCases.map((c) => ({
    id: c.id,
    input: c.example.input,
    output: c.example.fixtureOutput,
    expectedRepairs: c.example.expected.repairPassageIds,
  })),
  { id: 'e2e-custom-case', input: customInput, output: customOutput, expectedRepairs: ['p2'] },
];

/** An app whose provider is a stub that always answers with this case's ideal output. */
function appFor(item: Item) {
  const fetch = fetchSpy(async () => chatResponse(JSON.stringify(item.output)));
  return { app: makeApp({ env: LIVE_ENV, fetchImpl: fetch }), fetch };
}

describe.each(items.map((i) => [i.id, i] as const))('%s: full pipeline', (_id, item) => {
  it('goes from preview to export, with every check passing', async () => {
    const { app, fetch } = appFor(item);

    // 1. Preview, then approve exactly that preview.
    const preview = await previewOf(app, 'live', item.input);

    // 2. Analyze.
    const analyzed = await post(app, '/api/analyze', { mode: 'live', input: item.input, approvedHash: preview.hash });
    expect(analyzed.status).toBe(200);
    const analysis = await readJson<AnalyzeResponse>(analyzed);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]?.body).toBe(preview.body);
    expect(analysis.mode).toBe('live');
    expect(deriveFacts(analysis.output).repairPassageIds).toEqual(deriveFacts(item.output).repairPassageIds);

    // 3. Apply every proposed repair.
    const applied = await post(app, '/api/apply', { input: item.input, analysis: analysis.output, approvedRepairs: analysis.repairs });
    expect(applied.status).toBe(200);
    const revised = await readJson<ApplyResponse>(applied);
    expect(revised.input.pack).toEqual([...item.input.pack, ...item.expectedRepairs]);
    for (const added of revised.added) {
      expect(added.text).toBe(item.input.sources.find((p) => p.id === added.passageId)!.text);
    }

    // 4. Every export, from the real responses.
    const context: ExportContext = {
      input: item.input,
      analysis,
      applied: revised,
      source: { kind: 'custom' },
      generatedAt: '2026-11-01T10:00:00.000Z',
    };
    const report = EvidenceReportSchema.parse(JSON.parse(evidenceReportJson(context)));
    expect(validateModelOutput(report.analysis, report.input).ok).toBe(true);
    expect(report.repairs.revisedPack).toEqual(revised.input.pack);
    expect(report.approval.approvedHash).toBe(preview.hash);
    expect(report.provider.model).toBe('stub-model-returned');
    expect(buildEvidenceReport(context)).toEqual(report);

    const markdown = revisedPackMarkdown(context);
    const text = revisedPackText(context);
    for (const id of revised.input.pack) {
      const passage = item.input.sources.find((p) => p.id === id)!;
      expect(markdown).toContain(passage.text);
      expect(text).toContain(passage.text);
    }
    expect(evidenceReportSummary(context)).toContain(preview.hash);
  });

  it('exports the original pack honestly when nothing is applied', async () => {
    const { app } = appFor(item);
    const preview = await previewOf(app, 'live', item.input);
    const analysis = await readJson<AnalyzeResponse>(
      await post(app, '/api/analyze', { mode: 'live', input: item.input, approvedHash: preview.hash }),
    );
    const context: ExportContext = { input: item.input, analysis, applied: null, source: { kind: 'custom' }, generatedAt: 'x' };
    expect(revisedPackMarkdown(context)).toContain('no repairs were applied');
    expect(buildEvidenceReport(context).repairs.revisedPack).toBeNull();
  });
});

describe('the request can be recovered from what was sent', () => {
  it('extracts the task and the pack from the outbound body, which is how the browser-test stub finds its canned answer', async () => {
    const item = items[0]!;
    const { app, fetch } = appFor(item);
    const preview = await previewOf(app, 'live', item.input);
    await post(app, '/api/analyze', { mode: 'live', input: item.input, approvedHash: preview.hash });
    const sent = JSON.parse(fetch.mock.calls[0]![1]?.body as string) as { messages: { content: string }[] };
    const payload = extractPayload(sent.messages[1]!.content);
    expect(payload.task).toBe(item.input.task);
    expect(payload.passages.filter((p) => p.inPack).map((p) => p.id)).toEqual(item.input.pack);
  });
});
