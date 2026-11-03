import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keywordAnalyzer, oracleAnalyzer } from '../../src/eval/analyzers';
import { evalCases } from '../../src/eval/cases';
import { tokenMetrics } from '../../src/eval/metrics';
import {
  DOCS_BEGIN,
  DOCS_END,
  buildReport,
  datasetInfo,
  headlineTable,
  renderDocsBlock,
  renderMarkdown,
  tokenTable,
} from '../../src/eval/report';
import { runAnalyzer } from '../../src/eval/runner';
import type { Analyzer } from '../../src/eval/types';

async function deterministicReport() {
  const results = [];
  for (const analyzer of [oracleAnalyzer, keywordAnalyzer]) {
    results.push({ analyzer, runs: [await runAnalyzer(analyzer, evalCases)] });
  }
  return buildReport(evalCases, results);
}

describe('dataset info', () => {
  it('counts the cases and the gold items', () => {
    const info = datasetInfo(evalCases);
    expect(info).toMatchObject({ cases: 13, builtIn: 3, synthetic: 10 });
    expect(info.gold).toEqual({ supportedPassages: 12, missingPassages: 13, conflicts: 5, unanswerable: 8 });
    expect(info.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('hashes the inputs and gold labels, so any change to the data changes the hash', () => {
    const base = datasetInfo(evalCases).sha256;
    expect(datasetInfo(structuredClone(evalCases)).sha256).toBe(base);

    const editedGold = structuredClone(evalCases);
    editedGold[3]!.example.expected.unanswerable += 1;
    expect(datasetInfo(editedGold).sha256).not.toBe(base);

    const editedPassage = structuredClone(evalCases);
    editedPassage[5]!.example.input.sources[0]!.text += ' ';
    expect(datasetInfo(editedPassage).sha256).not.toBe(base);

    const editedPack = structuredClone(evalCases);
    editedPack[4]!.example.input.pack = [];
    expect(datasetInfo(editedPack).sha256).not.toBe(base);

    expect(datasetInfo(evalCases.slice(1)).sha256).not.toBe(base);
  });

  it('ignores things that do not affect scoring, such as tags', () => {
    const retagged = structuredClone(evalCases);
    retagged[0]!.tags = ['something else'];
    expect(datasetInfo(retagged).sha256).toBe(datasetInfo(evalCases).sha256);
  });
});

describe('rendering', () => {
  it('shows a row per analyzer in both tables, each labelled by what it is', async () => {
    const report = await deterministicReport();
    for (const table of [headlineTable(report), tokenTable(report)]) {
      expect(table).toHaveLength(2 + 2); // header, rule, two analyzers
      expect(table.join('\n')).toContain('Oracle (sanity check)');
      expect(table.join('\n')).toContain('Keyword baseline (not a model)');
    }
  });

  it('is deterministic, with no timestamps', async () => {
    const a = renderMarkdown(await deterministicReport(), { perCase: true });
    const b = renderMarkdown(await deterministicReport(), { perCase: true });
    expect(b).toBe(a);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('formats rates with the counts behind them, and "n/a" when there is nothing to divide', async () => {
    const lossy: Analyzer = {
      ...oracleAnalyzer,
      id: 'lossy',
      label: 'Lossy',
      kind: 'baseline',
      async run(testCase) {
        const result = await oracleAnalyzer.run(testCase);
        // Drop one missing passage in the first case that has one, and report nothing else wrong.
        if (testCase.id === 'refund-window') return { ...result, facts: { ...result.facts!, missing: result.facts!.missing.slice(1) } };
        return result;
      },
    };
    const report = buildReport(evalCases, [{ analyzer: lossy, runs: [await runAnalyzer(lossy, evalCases)] }]);
    const row = headlineTable(report)[2]!;
    expect(row).toContain('92.3% (12/13)'); // missing recall: 12 of 13 found
    expect(row).toContain('100.0% (12/12)'); // and every one it reported was right

    const keyword = headlineTable(await deterministicReport())[3]!;
    expect(keyword).toContain('| n/a |'); // unanswerable precision: it never predicts one
  });

  it('puts per-case tables in the console report, one per analyzer, covering every case', async () => {
    const markdown = renderMarkdown(await deterministicReport(), { perCase: true });
    expect(markdown).toContain('## Per-case: Oracle (sanity check)');
    expect(markdown).toContain('## Per-case: Keyword baseline (not a model)');
    for (const c of evalCases) expect(markdown.split(`| ${c.id} |`).length - 1).toBe(2);
    expect(renderMarkdown(await deterministicReport())).not.toContain('## Per-case');
  });

  it('labels repeated runs so none is hidden', async () => {
    const run = await runAnalyzer(keywordAnalyzer, evalCases);
    const report = buildReport(evalCases, [{ analyzer: keywordAnalyzer, runs: [run, run] }]);
    const table = headlineTable(report).join('\n');
    expect(table).toContain('Keyword baseline (not a model), run 1');
    expect(table).toContain('Keyword baseline (not a model), run 2');
  });

  it('shows failed outputs in the per-case table', async () => {
    const failing: Analyzer = {
      id: 'failing',
      kind: 'model',
      label: 'Failing',
      description: 'Always fails.',
      async run() {
        return { facts: null, failure: { kind: 'invalid_output', message: 'Output failed validation (2 issues).' }, model: 'm', usage: null, latencyMs: 5 };
      },
    };
    const report = buildReport(evalCases, [{ analyzer: failing, runs: [await runAnalyzer(failing, evalCases)] }]);
    expect(headlineTable(report).join('\n')).toContain('13/13');
    expect(renderMarkdown(report, { perCase: true })).toContain('FAILED: Output failed validation (2 issues).');
    expect(report.analyzers[0]!.runs[0]!.models).toEqual(['m']);
    expect(report.analyzers[0]!.runs[0]!.latencyMs).toBe(65);
  });
});

describe('docs/EVALUATION.md', () => {
  // A Windows checkout may have CRLF line endings. The generated block is LF, so compare as LF.
  const doc = readFileSync(join(process.cwd(), 'docs/EVALUATION.md'), 'utf8').replace(/\r\n/g, '\n');

  it('has exactly one results block', () => {
    expect(doc.split(DOCS_BEGIN)).toHaveLength(2);
    expect(doc.split(DOCS_END)).toHaveLength(2);
    expect(doc.indexOf(DOCS_BEGIN)).toBeLessThan(doc.indexOf(DOCS_END));
  });

  it('is not stale: the documented numbers are exactly what the harness produces now', async () => {
    const block = doc.slice(doc.indexOf(DOCS_BEGIN), doc.indexOf(DOCS_END) + DOCS_END.length);
    expect(block).toBe(renderDocsBlock(await deterministicReport()));
  });

  it('documents only the deterministic analyzers, and says the live model was not run', () => {
    const block = doc.slice(doc.indexOf(DOCS_BEGIN), doc.indexOf(DOCS_END));
    expect(block).toContain('Oracle (sanity check)');
    expect(block).toContain('Keyword baseline (not a model)');
    expect(block).toContain('**Live model**: not run');
    expect(block).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('does not claim a model result anywhere outside the generated block and the one marked live-run block', () => {
    const cut = (text: string, begin: string, end: string) => text.slice(0, text.indexOf(begin)) + text.slice(text.indexOf(end) + end.length);
    const outside = cut(cut(doc, DOCS_BEGIN, DOCS_END), LIVE_BEGIN, LIVE_END);
    expect(outside).toContain('**Status: the generated tables have no model results.**');
    expect(outside).not.toMatch(/\d+(\.\d+)?% \(\d+\/\d+\)/); // no rate with counts anywhere else
  });
});

// ---------------------------------------------------------------------------
// The live run is reported by the project owner and typed in by hand. Nothing here can reproduce it, so these
// tests only check what CAN be checked: the table is the same everywhere it appears, it is labelled for what it
// is, and every number in it is consistent with the benchmark it claims to come from.
// ---------------------------------------------------------------------------

const LIVE_BEGIN = '<!-- live-run:begin -->';
const LIVE_END = '<!-- live-run:end -->';

describe('the reported live run', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n');
  const doc = read('docs/EVALUATION.md');
  const readme = read('README.md');

  const blockOf = (text: string): string => {
    expect(text.split(LIVE_BEGIN), 'one live-run start marker').toHaveLength(2);
    expect(text.split(LIVE_END), 'one live-run end marker').toHaveLength(2);
    return text.slice(text.indexOf(LIVE_BEGIN) + LIVE_BEGIN.length, text.indexOf(LIVE_END)).trim();
  };
  const rowsOf = (block: string): Map<string, string> =>
    new Map(
      block
        .split('\n')
        .filter((line) => line.startsWith('|'))
        .slice(2) // header and separator
        .map((line) => {
          const [label, value] = line.split('|').slice(1, -1).map((cell) => cell.trim());
          return [label!, value!] as [string, string];
        }),
    );

  it('is the same table in the README and in the evaluation doc', () => {
    expect(blockOf(readme)).toBe(blockOf(doc));
  });

  it('is labelled as reported by the project owner, names the model, and says what it cannot show', () => {
    const start = doc.indexOf('## Live run (reported by the project owner)');
    expect(start).toBeGreaterThan(-1);
    const section = doc.slice(start, doc.indexOf('\n## ', start + 1));
    expect(section).toContain('`muse-wonder-1.0`');
    expect(section).toMatch(/typed in by hand/);
    expect(section).toMatch(/does not prove the run happened/);
    expect(section).toMatch(/development set/);
  });

  it('agrees with the dataset it claims to come from: gold totals, case counts, token total and initial pack', () => {
    const info = datasetInfo(evalCases);
    const perCase = evalCases.map((c) => tokenMetrics(c, null)); // no repairs: the initial pack as it stands
    const sum = (pick: (t: (typeof perCase)[number]) => number) => perCase.reduce((n, t) => n + pick(t), 0);
    const casesWithoutConflict = evalCases.filter((c) => c.example.expected.conflicts.length === 0).length;
    const percent = (part: number, whole: number) => `${((part / whole) * 100).toFixed(1)}%`;

    const table = rowsOf(blockOf(doc));
    expect([...table.keys()]).toEqual([
      'Missing evidence: recall',
      'Missing evidence: precision',
      'Contradictions: recall',
      'Contradictions: precision',
      'Conflict false alarms',
      'Unanswerable: recall',
      'Unanswerable: precision',
      'Failed outputs',
      'Required evidence in initial pack',
      'Required evidence in revised pack',
      'Revised pack vs all sources',
    ]);
    const cell = (label: string, pattern: RegExp): RegExpExecArray => {
      const match = pattern.exec(table.get(label)!);
      expect(match, `${label}: "${table.get(label)}" is not in the expected format`).not.toBeNull();
      return match!;
    };

    // "92.3% (12/13)": the percentage must be what the fraction gives.
    const rate = (label: string) => {
      const [, shown, found, total] = cell(label, /^(\d+\.\d)% \((\d+)\/(\d+)\)$/);
      expect(`${shown}%`, `${label}: percentage and fraction disagree`).toBe(percent(Number(found), Number(total)));
      expect(Number(found)).toBeLessThanOrEqual(Number(total));
      return { found: Number(found), total: Number(total) };
    };

    for (const [name, gold] of [
      ['Missing evidence', info.gold.missingPassages],
      ['Contradictions', info.gold.conflicts],
      ['Unanswerable', info.gold.unanswerable],
    ] as const) {
      const recall = rate(`${name}: recall`);
      const precision = rate(`${name}: precision`);
      expect(recall.total, `${name}: recall is out of the gold total`).toBe(gold);
      expect(precision.found, `${name}: precision and recall count the same correct items`).toBe(recall.found);
    }

    const alarms = cell('Conflict false alarms', /^(\d+)\/(\d+) cases$/);
    expect(Number(alarms[2])).toBe(casesWithoutConflict);
    expect(Number(alarms[1])).toBeLessThanOrEqual(casesWithoutConflict);
    const failed = cell('Failed outputs', /^(\d+)\/(\d+)$/);
    expect(Number(failed[2])).toBe(info.cases);
    expect(Number(failed[1])).toBeLessThanOrEqual(info.cases);

    // The initial pack is the same whatever the model does, so this one has to match exactly.
    const initialShare = sum((t) => t.preservedInitial) / perCase.length;
    expect(table.get('Required evidence in initial pack')).toBe(`${(initialShare * 100).toFixed(1)}%`);
    const revisedShare = Number(cell('Required evidence in revised pack', /^(\d+\.\d)%$/)[1]);
    expect(revisedShare).toBeGreaterThanOrEqual(Number((initialShare * 100).toFixed(1))); // repairs only add
    expect(revisedShare).toBeLessThanOrEqual(100);

    const tokens = cell('Revised pack vs all sources', /^-(\d+\.\d)% \((\d+)\/(\d+) tokens\)$/);
    const allTokens = sum((t) => t.allSources);
    expect(Number(tokens[3]), 'the all-sources token total').toBe(allTokens);
    expect(Number(tokens[2])).toBeGreaterThanOrEqual(sum((t) => t.initialPack)); // repairs only add
    expect(Number(tokens[2])).toBeLessThanOrEqual(allTokens);
    expect(`${tokens[1]}%`).toBe(`${((1 - Number(tokens[2]) / allTokens) * 100).toFixed(1)}%`);
  });
});
