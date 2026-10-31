import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keywordAnalyzer, oracleAnalyzer } from '../../src/eval/analyzers';
import { evalCases } from '../../src/eval/cases';
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
  const doc = readFileSync(join(process.cwd(), 'docs/EVALUATION.md'), 'utf8');

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

  it('does not claim a model result anywhere outside the generated block', () => {
    const outside = doc.slice(0, doc.indexOf(DOCS_BEGIN)) + doc.slice(doc.indexOf(DOCS_END));
    expect(outside).toContain('**Status: no model has been evaluated.**');
    expect(outside).not.toMatch(/\d+(\.\d+)?% \(\d+\/\d+\)/); // no rate with counts outside the generated block
  });
});
