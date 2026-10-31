/**
 * Report building and rendering. Deterministic: no timestamps, fixed case order, and a hash of the
 * dataset, so identical inputs print identical bytes and a result can be tied to the data it used.
 */
import { createHash } from 'node:crypto';
import { precision, recall, type Counts } from './metrics';
import type { RunReport } from './runner';
import { TOKEN_ESTIMATE_NOTE } from './tokens';
import type { Analyzer, AnalyzerKind, EvalCase } from './types';

export const HARNESS_VERSION = 1;
export const DOCS_BEGIN = '<!-- eval:begin -->';
export const DOCS_END = '<!-- eval:end -->';

export interface DatasetInfo {
  cases: number;
  builtIn: number;
  synthetic: number;
  /** SHA-256 over every case's input and gold labels, in order. Changes if the data changes. */
  sha256: string;
  gold: { supportedPassages: number; missingPassages: number; conflicts: number; unanswerable: number };
}

export interface AnalyzerReport {
  id: string;
  kind: AnalyzerKind;
  label: string;
  description: string;
  runs: RunReport[];
}

export interface EvalReport {
  harnessVersion: number;
  tokenEstimate: string;
  dataset: DatasetInfo;
  analyzers: AnalyzerReport[];
}

export function datasetInfo(cases: readonly EvalCase[]): DatasetInfo {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(cases.map((c) => ({ id: c.id, input: c.example.input, expected: c.example.expected }))));
  const gold = cases.map((c) => c.example.expected);
  return {
    cases: cases.length,
    builtIn: cases.filter((c) => c.set === 'built-in').length,
    synthetic: cases.filter((c) => c.set === 'synthetic').length,
    sha256: hash.digest('hex'),
    gold: {
      supportedPassages: gold.reduce((n, g) => n + new Set(g.supported).size, 0),
      missingPassages: gold.reduce((n, g) => n + new Set(g.missing).size, 0),
      conflicts: gold.reduce((n, g) => n + g.conflicts.length, 0),
      unanswerable: gold.reduce((n, g) => n + g.unanswerable, 0),
    },
  };
}

export function buildReport(cases: readonly EvalCase[], results: ReadonlyArray<{ analyzer: Analyzer; runs: RunReport[] }>): EvalReport {
  return {
    harnessVersion: HARNESS_VERSION,
    tokenEstimate: TOKEN_ESTIMATE_NOTE,
    dataset: datasetInfo(cases),
    analyzers: results.map(({ analyzer, runs }) => ({
      id: analyzer.id,
      kind: analyzer.kind,
      label: analyzer.label,
      description: analyzer.description,
      runs,
    })),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const pct = (value: number | null): string => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const signedPct = (value: number | null): string => (value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`);

function rate(counts: Counts, which: 'recall' | 'precision'): string {
  const value = which === 'recall' ? recall(counts) : precision(counts);
  if (value === null) return 'n/a';
  const denominator = which === 'recall' ? counts.tp + counts.fn : counts.tp + counts.fp;
  return `${pct(value)} (${counts.tp}/${denominator})`;
}

function rowsOf(report: EvalReport): Array<{ label: string; run: RunReport }> {
  return report.analyzers.flatMap((analyzer) =>
    analyzer.runs.map((run, index) => ({
      label: analyzer.runs.length > 1 ? `${analyzer.label}, run ${index + 1}` : analyzer.label,
      run,
    })),
  );
}

const table = (header: string[], rows: string[][]): string[] => [
  `| ${header.join(' | ')} |`,
  `| ${header.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.join(' | ')} |`),
];

export function headlineTable(report: EvalReport): string[] {
  return table(
    [
      'Analyzer',
      'Missing evidence: recall',
      'Missing evidence: precision',
      'Contradictions: recall',
      'Contradictions: precision',
      'Conflict false alarms',
      'Unanswerable: recall',
      'Unanswerable: precision',
      'Failed outputs',
    ],
    rowsOf(report).map(({ label, run }) => {
      const a = run.aggregate;
      return [
        label,
        rate(a.missing, 'recall'),
        rate(a.missing, 'precision'),
        rate(a.conflicts, 'recall'),
        rate(a.conflicts, 'precision'),
        `${a.conflictFalseAlarms.raised}/${a.conflictFalseAlarms.eligible} cases`,
        rate(a.unanswerable, 'recall'),
        rate(a.unanswerable, 'precision'),
        `${a.failures}/${a.cases}`,
      ];
    }),
  );
}

export function tokenTable(report: EvalReport): string[] {
  return table(
    [
      'Analyzer',
      'Required evidence in initial pack',
      'Required evidence in revised pack',
      'Revised pack vs all sources',
      'Revised pack vs initial pack',
      'Dead weight in revised pack',
    ],
    rowsOf(report).map(({ label, run }) => {
      const t = run.aggregate.tokens;
      return [
        label,
        pct(t.meanPreservedInitial),
        pct(t.meanPreservedRevised),
        `${signedPct(-t.reductionVsAll)} (${t.totalRevisedPack}/${t.totalAllSources} tokens)`,
        signedPct(t.growthVsInitial),
        `${pct(t.deadWeightShare)} (${t.totalDeadWeight} tokens)`,
      ];
    }),
  );
}

function datasetLine(report: EvalReport): string {
  const d = report.dataset;
  return (
    `${d.cases} cases (${d.builtIn} built-in, ${d.synthetic} synthetic). Gold labels: ${d.gold.missingPassages} missing-evidence passages, ` +
    `${d.gold.conflicts} conflicts, ${d.gold.unanswerable} unanswerable requirements. Dataset SHA-256 ${d.sha256.slice(0, 16)}.`
  );
}

const kindNote = (kind: AnalyzerKind): string =>
  kind === 'oracle' ? 'sanity check, not a result' : kind === 'baseline' ? 'not a model' : 'measures a model';

function perCaseTable(analyzer: AnalyzerReport, run: RunReport): string[] {
  const part = (c: Counts) => `${c.tp}/${c.tp + c.fn}${c.fp > 0 ? ` +${c.fp} extra` : ''}`;
  return table(
    ['Case', 'Set', 'Missing found', 'Conflicts found', 'Unanswerable (found/gold)', 'Required evidence in revised pack', 'Note'],
    run.cases.map((s) => [
      s.id,
      s.set,
      part(s.missing),
      part(s.conflicts),
      `${s.predicted?.unanswerable ?? 0}/${s.predicted ? s.unanswerable.tp + s.unanswerable.fn : s.unanswerable.fn}`,
      pct(s.tokens.preservedRevised),
      s.failure ? `FAILED: ${s.failure.message}` : s.conflictFalseAlarm ? 'conflict false alarm' : '',
    ]),
  );
}

/** Full console report. */
export function renderMarkdown(report: EvalReport, options: { perCase?: boolean } = {}): string {
  const lines = [
    '# Evaluation report',
    '',
    `Dataset: ${datasetLine(report)}`,
    `${report.tokenEstimate}`,
    '',
    '## Headline metrics',
    '',
    ...headlineTable(report),
    '',
    '## Token and preservation metrics',
    '',
    ...tokenTable(report),
    '',
    '## Analyzers',
    '',
    ...report.analyzers.map((a) => `- **${a.label}** (${kindNote(a.kind)}): ${a.description}`),
    '',
  ];
  if (options.perCase) {
    for (const analyzer of report.analyzers) {
      analyzer.runs.forEach((run, index) => {
        lines.push(`## Per-case: ${analyzer.label}${analyzer.runs.length > 1 ? `, run ${index + 1}` : ''}`, '', ...perCaseTable(analyzer, run), '');
      });
    }
  }
  return lines.join('\n');
}

/** The block pasted into docs/EVALUATION.md. Deterministic analyzers only, so it can be checked for staleness. */
export function renderDocsBlock(report: EvalReport): string {
  return [
    DOCS_BEGIN,
    '<!-- Generated by `npm run eval -- --write-docs`. Do not edit by hand: a test fails if it goes stale. -->',
    '',
    `**Dataset.** ${datasetLine(report)}`,
    '',
    `**Tokens.** ${report.tokenEstimate}`,
    '',
    '### Headline metrics',
    '',
    ...headlineTable(report),
    '',
    '### Token and preservation metrics',
    '',
    ...tokenTable(report),
    '',
    '### What each row is',
    '',
    ...report.analyzers.map((a) => `- **${a.label}** (${kindNote(a.kind)}): ${a.description}`),
    '- **Live model**: not run. Run it with `npm run eval -- --analyzer live` and your own credentials (see "Running it" above).',
    DOCS_END,
  ].join('\n');
}
