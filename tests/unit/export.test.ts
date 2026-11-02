import { describe, expect, it } from 'vitest';
import { examples, type Example } from '../../src/examples';
import { applyRepairs } from '../../src/server/repair';
import { validateModelOutput } from '../../src/server/validator';
import type { AnalyzeResponse, ApplyResponse } from '../../src/shared/api';
import {
  EvidenceReportSchema,
  REPORT_JSON_FILENAME,
  REPORT_SUMMARY_FILENAME,
  buildEvidenceReport,
  evidenceReportJson,
  evidenceReportSummary,
  packFilename,
  revisedPackMarkdown,
  revisedPackText,
  type ExportContext,
} from '../../src/shared/export';
import { groupFindings } from '../../src/shared/facts';
import { FIXTURE_NOTICE, type Mode } from '../../src/shared/types';

const HASH = 'b'.repeat(64);
const WHEN = '2026-11-01T10:00:00.000Z';

function analysisFor(example: Example, mode: Mode): AnalyzeResponse {
  const live = mode === 'live';
  const output = example.fixtureOutput;
  return {
    mode,
    notice: live ? null : FIXTURE_NOTICE,
    findings: groupFindings(output),
    repairs: output.repairs,
    output,
    meta: {
      sentToProvider: live,
      destination: live ? 'https://api.provider.test/v1/chat/completions' : null,
      model: live ? 'model-returned-1' : null,
      responseId: live ? 'resp-9' : null,
      usage: live ? { total_tokens: 7 } : null,
      latencyMs: live ? 123 : 0,
      approvedHash: HASH,
    },
  };
}

function appliedFor(example: Example): ApplyResponse {
  const result = applyRepairs(example.input, example.fixtureOutput, example.fixtureOutput.repairs);
  if (!result.ok) throw new Error(result.message);
  return {
    input: result.input,
    changed: result.changed,
    added: result.added,
    originalPackSize: example.input.pack.length,
    revisedPackSize: result.input.pack.length,
  };
}

function context(example: Example, options: { mode?: Mode; apply?: boolean } = {}): ExportContext {
  return {
    input: example.input,
    analysis: analysisFor(example, options.mode ?? 'fixture'),
    applied: options.apply === false ? null : appliedFor(example),
    source: { kind: 'example', slug: example.slug, title: example.title },
    generatedAt: WHEN,
  };
}

const forEachExample = examples.map((e) => [e.slug, e] as const);

describe('revised context pack', () => {
  it.each(forEachExample)('%s: Markdown holds every revised-pack passage verbatim, in order, and nothing else', (_slug, example) => {
    const markdown = revisedPackMarkdown(context(example));
    const revised = appliedFor(example).input.pack;

    let cursor = 0;
    for (const id of revised) {
      const passage = example.input.sources.find((p) => p.id === id)!;
      const heading = `## [${passage.id}] ${passage.title}`;
      const at = markdown.indexOf(heading, cursor);
      expect(at, heading).toBeGreaterThanOrEqual(cursor);
      expect(markdown.indexOf(passage.text, at)).toBeGreaterThan(at); // text copied unchanged
      cursor = at;
    }
    for (const passage of example.input.sources.filter((p) => !revised.includes(p.id))) {
      expect(markdown).not.toContain(passage.text);
      expect(markdown).not.toContain(`[${passage.id}]`);
    }
  });

  it.each(forEachExample)('%s: plain text holds the same passages verbatim and no Markdown headings', (_slug, example) => {
    const text = revisedPackText(context(example));
    for (const id of appliedFor(example).input.pack) {
      const passage = example.input.sources.find((p) => p.id === id)!;
      expect(text).toContain(`[${passage.id}] ${passage.title}`);
      expect(text).toContain(passage.text);
    }
    expect(text).not.toMatch(/^#+ /m);
    expect(text.startsWith('REVISED CONTEXT PACK')).toBe(true);
  });

  it.each(forEachExample)('%s: marks exactly the added passages, naming the requirement each was added for', (_slug, example) => {
    const ctx = context(example);
    const markdown = revisedPackMarkdown(ctx);
    const text = revisedPackText(ctx);
    expect(markdown.match(/Added by an approved repair/g) ?? []).toHaveLength(ctx.applied!.added.length);
    expect(text.match(/Added by an approved repair/g) ?? []).toHaveLength(ctx.applied!.added.length);
    for (const added of ctx.applied!.added) {
      expect(markdown).toContain(`Added by an approved repair for ${added.forRequirementIds.join(', ')}.`);
    }
  });

  it('says plainly when no repairs were applied, and does not call the pack "revised"', () => {
    const ctx = context(examples[0]!, { apply: false });
    const markdown = revisedPackMarkdown(ctx);
    expect(markdown.startsWith('# Context pack (unchanged)')).toBe(true);
    expect(markdown).toContain('no repairs were applied (this is the original pack)');
    expect(markdown).not.toContain('Added by an approved repair');
    expect(revisedPackText(ctx).startsWith('CONTEXT PACK (UNCHANGED)')).toBe(true);
    expect(packFilename(ctx, 'md')).toBe('context-pack.md');
    expect(packFilename(context(examples[0]!), 'md')).toBe('revised-context-pack.md');
    expect(packFilename(context(examples[0]!), 'txt')).toBe('revised-context-pack.txt');
  });

  it('handles an empty original pack', () => {
    const ctx = context(examples[0]!, { apply: false });
    const empty = { ...ctx, input: { ...ctx.input, pack: [] } };
    expect(revisedPackMarkdown(empty)).toContain('0 passages');
    expect(revisedPackText(empty)).toContain('Passages: 0 passages');
  });
});

describe('every export says where the analysis came from', () => {
  const all = (ctx: ExportContext) => [
    revisedPackMarkdown(ctx),
    revisedPackText(ctx),
    evidenceReportJson(ctx),
    evidenceReportSummary(ctx),
  ];

  it.each(forEachExample)('%s: a fixture export always says it is not a model result', (_slug, example) => {
    for (const content of all(context(example))) {
      expect(content).toContain(FIXTURE_NOTICE);
    }
  });

  it('a live export names the provider-returned model and does not carry the fixture notice', () => {
    const ctx = context(examples[0]!, { mode: 'live' });
    for (const content of [revisedPackMarkdown(ctx), revisedPackText(ctx), evidenceReportSummary(ctx)]) {
      expect(content).toContain('Live model result');
      expect(content).toContain('model-returned-1');
      expect(content).not.toContain(FIXTURE_NOTICE);
    }
    expect(evidenceReportSummary(ctx)).toContain('Yes, to https://api.provider.test/v1/chat/completions');
  });

  it('is deterministic for the same input', () => {
    const ctx = context(examples[1]!);
    expect(all(ctx)).toEqual(all(structuredClone(ctx)));
  });

  it('labels a custom input as custom', () => {
    const ctx: ExportContext = { ...context(examples[0]!), source: { kind: 'custom' } };
    expect(revisedPackMarkdown(ctx)).toContain('**Source:** Custom input');
    expect(evidenceReportSummary(ctx)).toContain('Custom input');
    expect(buildEvidenceReport(ctx).source).toEqual({ kind: 'custom' });
  });
});

describe('evidence report (JSON)', () => {
  it.each(forEachExample)('%s: parses, matches the schema, and can be re-validated against its own sources', (_slug, example) => {
    const report = EvidenceReportSchema.parse(JSON.parse(evidenceReportJson(context(example))));
    // The report is self-verifying: the validator accepts its analysis against the sources it carries.
    const checked = validateModelOutput(report.analysis, report.input);
    expect(checked.ok).toBe(true);
  });

  it.each(forEachExample)('%s: records the approval, the counts, the applied repairs and the revised pack', (_slug, example) => {
    const ctx = context(example);
    const report = buildEvidenceReport(ctx);
    expect(report.approval).toEqual({ hashAlgorithm: 'SHA-256', approvedHash: HASH, sentToProvider: false, destination: null });
    expect(report.mode).toBe('fixture');
    expect(report.notice).toBe(FIXTURE_NOTICE);
    expect(report.generatedAt).toBe(WHEN);
    expect(report.repairs.proposed).toEqual(example.fixtureOutput.repairs);
    expect(report.repairs.applied.map((a) => a.passageId)).toEqual(example.expected.repairPassageIds);
    expect(report.repairs.revisedPack).toEqual([...example.input.pack, ...example.expected.repairPassageIds]);
    const counts = report.summary;
    expect(counts.supported + counts.missing_evidence + counts.conflicting + counts.unanswerable).toBe(example.fixtureOutput.requirements.length);
  });

  it('has a null revised pack when nothing was applied', () => {
    const report = buildEvidenceReport(context(examples[0]!, { apply: false }));
    expect(report.repairs.revisedPack).toBeNull();
    expect(report.repairs.applied).toEqual([]);
  });

  it('carries the live provider details as returned, and never invents any for a fixture', () => {
    const live = buildEvidenceReport(context(examples[0]!, { mode: 'live' }));
    expect(live.provider).toEqual({ model: 'model-returned-1', responseId: 'resp-9', usage: { total_tokens: 7 }, latencyMs: 123 });
    expect(live.notice).toBeNull();
    expect(live.approval.sentToProvider).toBe(true);
    const fixture = buildEvidenceReport(context(examples[0]!));
    expect(fixture.provider.model).toBeNull();
    expect(fixture.provider.responseId).toBeNull();
  });

  it('rejects a report that has been changed in a way the schema forbids', () => {
    const report = JSON.parse(evidenceReportJson(context(examples[0]!))) as Record<string, unknown>;
    expect(EvidenceReportSchema.safeParse({ ...report, extra: 1 }).success).toBe(false);
    expect(EvidenceReportSchema.safeParse({ ...report, mode: 'turbo' }).success).toBe(false);
    expect(EvidenceReportSchema.safeParse({ ...report, reportVersion: 2 }).success).toBe(false);
  });

  it('contains nothing that looks like a credential', () => {
    for (const example of examples) {
      const json = evidenceReportJson(context(example, { mode: 'live' }));
      expect(json).not.toMatch(/api[_-]?key|authorization|bearer/i);
    }
  });

  it('uses fixed file names', () => {
    expect(REPORT_JSON_FILENAME).toBe('evidence-report.json');
    expect(REPORT_SUMMARY_FILENAME).toBe('evidence-report-summary.md');
  });
});

describe('evidence report (summary)', () => {
  it.each(forEachExample)('%s: has all four buckets with counts, every requirement, and every quote', (_slug, example) => {
    const summary = evidenceReportSummary(context(example));
    for (const [status, title] of [
      ['supported', 'Supported'],
      ['missing_evidence', 'Missing Evidence'],
      ['conflicting', 'Conflicting'],
      ['unanswerable', 'Unanswerable'],
    ] as const) {
      const count = example.fixtureOutput.requirements.filter((r) => r.status === status).length;
      expect(summary).toContain(`## ${title} (${count})`);
    }
    for (const requirement of example.fixtureOutput.requirements) {
      expect(summary).toContain(`**${requirement.id}** ${requirement.text}`);
      expect(summary).toContain(`Why: ${requirement.rationale}`);
      for (const evidence of requirement.evidence) expect(summary).toContain(`"${evidence.quote}"`);
    }
    expect(summary).toContain(`SHA-256:** ${HASH}`);
    expect(summary).toContain('Sent to a provider:** No');
  });

  it('says whether each cited passage was in the original pack', () => {
    const example = examples.find((e) => e.slug === 'refund-window')!;
    const summary = evidenceReportSummary(context(example));
    expect(summary).toMatch(/\[refund-01\].*\(in pack\)/);
    expect(summary).toMatch(/\[refund-04\].*\(not in pack\)/);
  });

  it('lists proposed and applied repairs, and the original and revised packs', () => {
    const example = examples.find((e) => e.slug === 'refund-window')!;
    const applied = evidenceReportSummary(context(example));
    expect(applied).toContain('add [refund-04] for r3');
    expect(applied).toContain('- [refund-04] for r3');
    expect(applied).toContain('Revised: refund-01, refund-02, refund-03, refund-07, refund-04, refund-05');

    const unapplied = evidenceReportSummary(context(example, { apply: false }));
    expect(unapplied).toContain('Applied: none');
    expect(unapplied).toContain('Revised: not produced (no repairs applied)');
  });

  it('prints "None." for an empty bucket', () => {
    const example = examples.find((e) => e.slug === 'refund-window')!;
    expect(evidenceReportSummary(context(example))).toMatch(/## Conflicting \(0\)\n\nNone\./);
  });
});

describe('a requirement with no rationale', () => {
  const refundExample = examples.find((e) => e.slug === 'refund-window')!;

  /** The same example with the first requirement's rationale blanked, the way the validator now stores a missing one. */
  function withBlankRationale(rationale: string): { example: Example; blanked: string; kept: string } {
    const example = structuredClone(refundExample);
    const [first, second] = example.fixtureOutput.requirements;
    first!.rationale = rationale;
    return { example, blanked: first!.id, kept: second!.id };
  }

  it('leaves the "Why:" line out of the summary instead of printing a bare one', () => {
    for (const blank of ['', '   ', '\n']) {
      const { example, blanked, kept } = withBlankRationale(blank);
      const summary = evidenceReportSummary(context(example));
      const block = (id: string) => {
        const start = summary.indexOf(`**${id}**`);
        const next = summary.indexOf('\n- **', start + 1);
        return summary.slice(start, next === -1 ? undefined : next);
      };
      expect(block(blanked), JSON.stringify(blank)).not.toContain('Why:');
      expect(block(kept)).toContain('Why: ');
      expect(summary).not.toMatch(/Why:\s*$/m);
    }
  });

  it('still lists the requirement and every quote it cites', () => {
    const { example, blanked } = withBlankRationale('');
    const summary = evidenceReportSummary(context(example));
    const requirement = example.fixtureOutput.requirements.find((r) => r.id === blanked)!;
    expect(summary).toContain(`**${requirement.id}** ${requirement.text}`);
    for (const evidence of requirement.evidence) expect(summary).toContain(`"${evidence.quote}"`);
  });

  it('keeps a non-blank rationale exactly as written', () => {
    const { example, blanked } = withBlankRationale('  Padded on purpose.  ');
    expect(evidenceReportSummary(context(example))).toContain('Why:   Padded on purpose.  ');
    expect(blanked).toBeTruthy();
  });

  it('produces a JSON report that still parses against its own schema and re-validates', () => {
    const { example } = withBlankRationale('');
    const json = JSON.parse(evidenceReportJson(context(example)));
    expect(json.analysis.requirements[0].rationale).toBe('');
    const report = EvidenceReportSchema.parse(json);
    expect(validateModelOutput(JSON.stringify(report.analysis), report.input).ok).toBe(true);
  });

  it('accepts a report whose requirement has no rationale key at all, storing it as ""', () => {
    const { example } = withBlankRationale('x');
    const json = JSON.parse(evidenceReportJson(context(example)));
    delete json.analysis.requirements[0].rationale;
    const report = EvidenceReportSchema.parse(json);
    expect(report.analysis.requirements[0]!.rationale).toBe('');
  });
});
