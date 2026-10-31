/**
 * Export builders: the revised context pack (Markdown or plain text) and the evidence report
 * (JSON or a readable summary).
 *
 * Pure functions with no browser or server dependency, so the browser and the tests run the
 * same code. Exports are built in the browser from data already on screen. Nothing is uploaded.
 *
 * Every export states where the analysis came from. A fixture export says it is not a model
 * result. Passage text is copied from the sources unchanged.
 */
import { z } from 'zod';
import type { AnalyzeResponse, ApplyResponse } from './api';
import {
  AnalysisInputSchema,
  FIXTURE_NOTICE,
  ModelOutputSchema,
  REQUIREMENT_STATUSES,
  RepairSchema,
  type AnalysisInput,
  type Requirement,
  type RequirementStatus,
} from './types';

export const REPORT_VERSION = 1;
export const GENERATED_BY = 'T900 Evidence Check';

export type ExportSource = { kind: 'example'; slug: string; title: string } | { kind: 'custom' };

export interface ExportContext {
  /** The request that was analysed. */
  input: AnalysisInput;
  analysis: AnalyzeResponse;
  /** The result of applying approved repairs, or null if none were applied. */
  applied: ApplyResponse | null;
  source: ExportSource;
  /** ISO timestamp. Passed in so tests can be deterministic. */
  generatedAt: string;
}

export const BUCKET_TITLES: Record<RequirementStatus, string> = {
  supported: 'Supported',
  missing_evidence: 'Missing Evidence',
  conflicting: 'Conflicting',
  unanswerable: 'Unanswerable',
};

// ---------------------------------------------------------------------------
// Evidence report (JSON)
// ---------------------------------------------------------------------------

export const EvidenceReportSchema = z
  .object({
    reportVersion: z.literal(REPORT_VERSION),
    generatedBy: z.literal(GENERATED_BY),
    generatedAt: z.string(),
    mode: z.enum(['fixture', 'live']),
    /** Set for fixture reports. A fixture report is never a model result. */
    notice: z.string().nullable(),
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('example'), slug: z.string(), title: z.string() }).strict(),
      z.object({ kind: z.literal('custom') }).strict(),
    ]),
    approval: z
      .object({
        hashAlgorithm: z.literal('SHA-256'),
        approvedHash: z.string(),
        sentToProvider: z.boolean(),
        destination: z.string().nullable(),
      })
      .strict(),
    provider: z
      .object({
        /** The model ID as returned by the provider. Null for fixtures. */
        model: z.string().nullable(),
        responseId: z.string().nullable(),
        usage: z.unknown(),
        latencyMs: z.number(),
      })
      .strict(),
    /** The task, every source passage and the original pack. With `analysis`, enough to re-validate the report. */
    input: AnalysisInputSchema,
    analysis: ModelOutputSchema,
    summary: z
      .object({
        supported: z.number(),
        missing_evidence: z.number(),
        conflicting: z.number(),
        unanswerable: z.number(),
      })
      .strict(),
    repairs: z
      .object({
        proposed: z.array(RepairSchema),
        applied: z.array(z.object({ passageId: z.string(), forRequirementIds: z.array(z.string()) }).strict()),
        /** Pack IDs after applying repairs, or null if no repairs were applied. */
        revisedPack: z.array(z.string()).nullable(),
      })
      .strict(),
  })
  .strict();
export type EvidenceReport = z.infer<typeof EvidenceReportSchema>;

export function buildEvidenceReport(ctx: ExportContext): EvidenceReport {
  const { analysis, applied, input } = ctx;
  const counts = { supported: 0, missing_evidence: 0, conflicting: 0, unanswerable: 0 };
  for (const requirement of analysis.output.requirements) counts[requirement.status] += 1;

  return {
    reportVersion: REPORT_VERSION,
    generatedBy: GENERATED_BY,
    generatedAt: ctx.generatedAt,
    mode: analysis.mode,
    notice: analysis.mode === 'fixture' ? FIXTURE_NOTICE : null,
    source: ctx.source,
    approval: {
      hashAlgorithm: 'SHA-256',
      approvedHash: analysis.meta.approvedHash,
      sentToProvider: analysis.meta.sentToProvider,
      destination: analysis.meta.destination,
    },
    provider: {
      model: analysis.meta.model,
      responseId: analysis.meta.responseId,
      usage: analysis.meta.usage ?? null,
      latencyMs: analysis.meta.latencyMs,
    },
    input,
    analysis: analysis.output,
    summary: counts,
    repairs: {
      proposed: analysis.output.repairs,
      applied: (applied?.added ?? []).map(({ passageId, forRequirementIds }) => ({ passageId, forRequirementIds })),
      revisedPack: applied ? applied.input.pack : null,
    },
  };
}

export const evidenceReportJson = (ctx: ExportContext): string => JSON.stringify(buildEvidenceReport(ctx), null, 2) + '\n';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function provenance(ctx: ExportContext): string {
  return ctx.analysis.mode === 'fixture'
    ? `${FIXTURE_NOTICE} No model was called.`
    : `Live model result. Provider-returned model: ${ctx.analysis.meta.model ?? 'not returned'}.`;
}

function sourceLabel(ctx: ExportContext): string {
  return ctx.source.kind === 'example' ? `Built-in synthetic example "${ctx.source.title}"` : 'Custom input';
}

const finalPack = (ctx: ExportContext): string[] => ctx.applied?.input.pack ?? ctx.input.pack;
const passageOf = (ctx: ExportContext, id: string) => ctx.input.sources.find((passage) => passage.id === id);
const addedBy = (ctx: ExportContext): Map<string, string[]> =>
  new Map((ctx.applied?.added ?? []).map((added) => [added.passageId, added.forRequirementIds]));

/** File names. A pack with no applied repairs is not called "revised". */
export function packFilename(ctx: ExportContext, extension: 'md' | 'txt'): string {
  return `${ctx.applied ? 'revised-context-pack' : 'context-pack'}.${extension}`;
}
export const REPORT_JSON_FILENAME = 'evidence-report.json';
export const REPORT_SUMMARY_FILENAME = 'evidence-report-summary.md';

function packHeadline(ctx: ExportContext): string {
  const total = finalPack(ctx).length;
  const added = ctx.applied?.added.length ?? 0;
  return ctx.applied
    ? `${total} passages, ${added} added by approved repairs`
    : `${total} passages, no repairs were applied (this is the original pack)`;
}

// ---------------------------------------------------------------------------
// Revised context pack
// ---------------------------------------------------------------------------

export function revisedPackMarkdown(ctx: ExportContext): string {
  const added = addedBy(ctx);
  const lines = [
    ctx.applied ? '# Revised context pack' : '# Context pack (unchanged)',
    '',
    `> ${provenance(ctx)}`,
    '',
    `**Source:** ${sourceLabel(ctx)}`,
    '',
    `**Task:** ${ctx.input.task}`,
    '',
    `**Passages:** ${packHeadline(ctx)}`,
    '',
  ];
  for (const id of finalPack(ctx)) {
    const passage = passageOf(ctx, id);
    if (!passage) continue;
    lines.push(`## [${passage.id}] ${passage.title}`, '', passage.text, '');
    const requirements = added.get(id);
    if (requirements) lines.push(`_Added by an approved repair for ${requirements.join(', ')}._`, '');
  }
  return lines.join('\n');
}

export function revisedPackText(ctx: ExportContext): string {
  const added = addedBy(ctx);
  const lines = [
    ctx.applied ? 'REVISED CONTEXT PACK' : 'CONTEXT PACK (UNCHANGED)',
    provenance(ctx),
    `Source: ${sourceLabel(ctx)}`,
    `Task: ${ctx.input.task}`,
    `Passages: ${packHeadline(ctx)}`,
    '',
  ];
  for (const id of finalPack(ctx)) {
    const passage = passageOf(ctx, id);
    if (!passage) continue;
    lines.push(`[${passage.id}] ${passage.title}`, passage.text);
    const requirements = added.get(id);
    if (requirements) lines.push(`(Added by an approved repair for ${requirements.join(', ')}.)`);
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Evidence report (summary)
// ---------------------------------------------------------------------------

function requirementLines(ctx: ExportContext, requirement: Requirement): string[] {
  const inPack = new Set(ctx.input.pack);
  const lines = [`- **${requirement.id}** ${requirement.text}`];
  for (const evidence of requirement.evidence) {
    const title = passageOf(ctx, evidence.passageId)?.title ?? '';
    lines.push(
      `  - Evidence: [${evidence.passageId}] ${title} (${inPack.has(evidence.passageId) ? 'in pack' : 'not in pack'}): "${evidence.quote}"`,
    );
  }
  lines.push(`  - Why: ${requirement.rationale}`);
  return lines;
}

export function evidenceReportSummary(ctx: ExportContext): string {
  const { analysis, applied } = ctx;
  const report = buildEvidenceReport(ctx);
  const lines = [
    '# Evidence report',
    '',
    `> ${provenance(ctx)}`,
    '',
    `- **Source:** ${sourceLabel(ctx)}`,
    `- **Mode:** ${analysis.mode}`,
    `- **Generated:** ${ctx.generatedAt}`,
    `- **Approved text, SHA-256:** ${analysis.meta.approvedHash}`,
    `- **Sent to a provider:** ${analysis.meta.sentToProvider ? `Yes, to ${analysis.meta.destination}` : 'No'}`,
    '',
    '## Task',
    '',
    ctx.input.task,
    '',
    '## Result',
    '',
    ...REQUIREMENT_STATUSES.map((status) => `- ${BUCKET_TITLES[status]}: ${report.summary[status]}`),
    '',
  ];

  for (const status of REQUIREMENT_STATUSES) {
    const requirements = analysis.findings[status];
    lines.push(`## ${BUCKET_TITLES[status]} (${requirements.length})`, '');
    if (requirements.length === 0) lines.push('None.');
    for (const requirement of requirements) lines.push(...requirementLines(ctx, requirement));
    lines.push('');
  }

  lines.push('## Repairs', '');
  if (analysis.repairs.length === 0) {
    lines.push('- Proposed: none');
  } else {
    lines.push('- Proposed:');
    for (const repair of analysis.repairs) lines.push(`  - add [${repair.passageId}] for ${repair.requirementId}`);
  }
  if (applied && applied.added.length > 0) {
    lines.push('- Applied (approved by the user):');
    for (const added of applied.added) lines.push(`  - [${added.passageId}] for ${added.forRequirementIds.join(', ')}`);
  } else {
    lines.push('- Applied: none');
  }
  lines.push(
    '',
    '## Context pack',
    '',
    `- Original: ${ctx.input.pack.length === 0 ? '(empty)' : ctx.input.pack.join(', ')}`,
    `- Revised: ${applied ? applied.input.pack.join(', ') : 'not produced (no repairs applied)'}`,
    '',
  );
  return lines.join('\n');
}
