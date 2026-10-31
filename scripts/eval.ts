/**
 * Reproducible benchmark runner: `npm run eval`.
 *
 *   npm run eval                                  oracle + keyword baseline, no network, deterministic
 *   npm run eval -- --analyzer live               PREVIEW of the live run. Sends nothing.
 *   npm run eval -- --analyzer live --yes         run the real model (needs META_* variables)
 *   npm run eval -- --analyzer oracle,keyword,live --yes --repeat 3
 *
 * Other flags: --set all|built-in|synthetic, --cases id,id, --json <path>, --print-requests,
 * and --write-docs (refreshes the results block in docs/EVALUATION.md, deterministic analyzers only).
 *
 * The live analyzer is never run by default. Without --yes it prints what it would send, how much, and
 * where, and writes each request body under .eval/requests/ for review. It has NOT been run against a
 * real endpoint yet. See docs/EVALUATION.md for what these numbers do and do not mean.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLiveAnalyzer, keywordAnalyzer, liveRequestBody, oracleAnalyzer } from '../src/eval/analyzers';
import { evalCases } from '../src/eval/cases';
import { DOCS_BEGIN, DOCS_END, buildReport, renderDocsBlock, renderMarkdown } from '../src/eval/report';
import { runAnalyzer, type RunReport } from '../src/eval/runner';
import { estimateTokens } from '../src/eval/tokens';
import type { Analyzer, EvalCase } from '../src/eval/types';
import { loadConfig } from '../src/server/config';

export interface EvalDeps {
  argv: string[];
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  out: (line: string) => void;
  writeFile: (path: string, content: string) => void;
  readFile: (path: string) => string;
  now: () => number;
  /** Replace the case list. Used by tests. */
  cases?: readonly EvalCase[];
}

const USAGE =
  'Usage: npm run eval -- [--analyzer oracle,keyword,live] [--set all|built-in|synthetic] [--cases id,id] [--repeat 1-5] [--yes] [--print-requests] [--json <path>] [--write-docs]';
const ANALYZER_IDS = ['oracle', 'keyword', 'live'] as const;
const SETS = ['all', 'built-in', 'synthetic'] as const;
const MAX_REPEAT = 5;
const DOCS_PATH = 'docs/EVALUATION.md';

interface Options {
  analyzers: string[];
  set: (typeof SETS)[number];
  cases: string[] | null;
  repeat: number;
  yes: boolean;
  json: string | null;
  writeDocs: boolean;
  printRequests: boolean;
}

function parseArgs(argv: string[]): Options | string {
  const options: Options = {
    analyzers: ['oracle', 'keyword'],
    set: 'all',
    cases: null,
    repeat: 1,
    yes: false,
    json: null,
    writeDocs: false,
    printRequests: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => argv[(i += 1)];
    if (arg === '--yes') options.yes = true;
    else if (arg === '--write-docs') options.writeDocs = true;
    else if (arg === '--print-requests') options.printRequests = true;
    else if (arg === '--analyzer') {
      const list = (value() ?? '').split(',').filter(Boolean);
      const unknown = list.filter((id) => !(ANALYZER_IDS as readonly string[]).includes(id));
      if (list.length === 0 || unknown.length > 0) return `--analyzer must be a comma list of: ${ANALYZER_IDS.join(', ')}.`;
      options.analyzers = [...new Set(list)];
    } else if (arg === '--set') {
      const set = value();
      if (!set || !(SETS as readonly string[]).includes(set)) return `--set must be one of: ${SETS.join(', ')}.`;
      options.set = set as Options['set'];
    } else if (arg === '--cases') {
      const list = (value() ?? '').split(',').filter(Boolean);
      if (list.length === 0) return '--cases needs a comma list of case IDs.';
      options.cases = list;
    } else if (arg === '--repeat') {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1 || n > MAX_REPEAT) return `--repeat must be a whole number from 1 to ${MAX_REPEAT}.`;
      options.repeat = n;
    } else if (arg === '--json') {
      const path = value();
      if (!path) return '--json needs a file path.';
      options.json = path;
    } else {
      return `Unknown argument "${arg}".`;
    }
  }
  return options;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export async function runEval(deps: EvalDeps): Promise<number> {
  const { out } = deps;

  const options = parseArgs(deps.argv);
  if (typeof options === 'string') {
    out(options);
    out(USAGE);
    return 2;
  }

  let cases = [...(deps.cases ?? evalCases)];
  if (options.set !== 'all') cases = cases.filter((c) => c.set === options.set);
  if (options.cases) {
    const unknown = options.cases.filter((id) => !cases.some((c) => c.id === id));
    if (unknown.length > 0) {
      out(`Unknown case ID(s): ${unknown.join(', ')}. Available: ${cases.map((c) => c.id).join(', ')}`);
      return 2;
    }
    cases = cases.filter((c) => options.cases!.includes(c.id));
  }
  if (cases.length === 0) {
    out('No cases selected.');
    return 2;
  }

  if (options.writeDocs) {
    const deterministicOnly = options.analyzers.length === 2 && options.analyzers.includes('oracle') && options.analyzers.includes('keyword');
    if (!deterministicOnly || options.set !== 'all' || options.cases !== null || deps.cases !== undefined) {
      out('--write-docs only works with the default analyzers (oracle,keyword) on the full dataset, so the documented numbers stay reproducible.');
      return 2;
    }
  }

  const analyzers: Analyzer[] = [];
  let currentRun = 0;

  for (const id of options.analyzers) {
    if (id === 'oracle') analyzers.push(oracleAnalyzer);
    else if (id === 'keyword') analyzers.push(keywordAnalyzer);
    else {
      const config = loadConfig(deps.env);
      if (!config.live.available) {
        out(`The live analyzer is unavailable. ${config.live.reason}`);
        return 2;
      }
      const settings = config.live.settings;
      const plan = cases.map((c) => {
        const body = liveRequestBody(settings, c);
        return { id: c.id, body, hash: sha256(body), tokens: estimateTokens(body) };
      });
      const sends = plan.length * options.repeat;

      out('LIVE ANALYZER PLAN. If run, this sends case text to an external model provider.');
      out(`Destination: ${settings.destination}`);
      out(`Model: ${settings.model}`);
      out(`Response format: ${settings.responseFormat}`);
      out(`Requests: ${plan.length} cases x ${options.repeat} run(s) = ${sends}, about ${plan.reduce((n, p) => n + p.tokens, 0) * options.repeat} input tokens (estimated).`);
      for (const p of plan) {
        deps.writeFile(`.eval/requests/${p.id}.json`, p.body);
        out(`  ${p.id.padEnd(22)} ~${String(p.tokens).padStart(5)} tokens  sha256 ${p.hash.slice(0, 16)}`);
        if (options.printRequests) out(p.body);
      }
      out('Exact request bodies are saved under .eval/requests/ for review.');

      if (!options.yes) {
        out('Live analyzer NOT run. Re-run with --yes to send these requests.');
        continue;
      }
      analyzers.push(
        createLiveAnalyzer({
          settings,
          fetchImpl: deps.fetchImpl,
          now: deps.now,
          onRaw: (caseId, text) => deps.writeFile(`.eval/responses/run${currentRun}-${caseId}.txt`, text),
        }),
      );
    }
  }

  if (analyzers.length === 0) return 0;

  const results: Array<{ analyzer: Analyzer; runs: RunReport[] }> = [];
  for (const analyzer of analyzers) {
    const repeats = analyzer.kind === 'model' ? options.repeat : 1;
    const runs: RunReport[] = [];
    for (let run = 1; run <= repeats; run += 1) {
      currentRun = run;
      out(`Running ${analyzer.label}${repeats > 1 ? ` (run ${run} of ${repeats})` : ''} on ${cases.length} cases...`);
      runs.push(
        await runAnalyzer(analyzer, cases, (done, total, score) => {
          if (analyzer.kind === 'model') out(`  [${done}/${total}] ${score.id}: ${score.failure ? `FAILED (${score.failure.kind})` : 'ok'}`);
        }),
      );
    }
    results.push({ analyzer, runs });
  }

  const report = buildReport(cases, results);
  out('');
  out(renderMarkdown(report, { perCase: true }));

  const oracle = report.analyzers.find((a) => a.id === 'oracle')?.runs[0]?.aggregate;
  if (oracle) {
    const exact = [oracle.supported, oracle.missing, oracle.conflicts, oracle.unanswerable].every((c) => c.fp === 0 && c.fn === 0);
    if (oracle.failures > 0 || !exact || oracle.conflictFalseAlarms.raised > 0) {
      out('SANITY CHECK FAILED: the oracle did not score perfectly. The gold labels or the scorer are wrong, so no other number here can be trusted.');
      return 1;
    }
  }

  if (options.json) {
    deps.writeFile(options.json, JSON.stringify(report, null, 2) + '\n');
    out(`Wrote ${options.json}`);
  }

  if (options.writeDocs) {
    const doc = deps.readFile(DOCS_PATH);
    const start = doc.indexOf(DOCS_BEGIN);
    const end = doc.indexOf(DOCS_END);
    if (start < 0 || end < start) {
      out(`${DOCS_PATH} has no ${DOCS_BEGIN} ... ${DOCS_END} block to update.`);
      return 2;
    }
    deps.writeFile(DOCS_PATH, doc.slice(0, start) + renderDocsBlock(report) + doc.slice(end + DOCS_END.length));
    out(`Updated ${DOCS_PATH}`);
  }
  return 0;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  runEval({
    argv: process.argv.slice(2),
    env: process.env,
    fetchImpl: fetch,
    out: (line) => console.log(line),
    writeFile: (path, content) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, path.startsWith('.eval/') ? { mode: 0o600 } : undefined);
    },
    readFile: (path) => readFileSync(path, 'utf8'),
    now: () => Date.now(),
  }).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
