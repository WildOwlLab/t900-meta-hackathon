/**
 * The eval command's core. Every test injects its own fetch stub, so nothing here reaches a network.
 * Where a stub answers with a case's hand-written ideal output, that is test plumbing, not a model.
 */
import { describe, expect, it, vi } from 'vitest';
import { liveRequestBody } from '../../src/eval/analyzers';
import { evalCases } from '../../src/eval/cases';
import { DOCS_BEGIN, DOCS_END, buildReport, renderDocsBlock } from '../../src/eval/report';
import { runAnalyzer } from '../../src/eval/runner';
import { oracleAnalyzer, keywordAnalyzer } from '../../src/eval/analyzers';
import { loadConfig } from '../../src/server/config';
import { extractPayload } from '../../src/server/prompt';
import { runEval, type EvalDeps } from '../../scripts/eval';

const KEY = 'TESTKEY-CLI-515151';
const LIVE_ENV = { META_API_KEY: KEY, META_API_URL: 'https://api.provider.test/v1?token=QSECRET', META_MODEL: 'stub-model' };
const settings = (() => {
  const config = loadConfig(LIVE_ENV);
  if (!config.live.available) throw new Error('test setup: live config should be available');
  return config.live.settings;
})();

/** Answers each case with its own ideal output. Test plumbing, not a model. */
const idealStub = () =>
  vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(init?.body as string) as { messages: { content: string }[] };
    const payload = extractPayload(request.messages[1]!.content);
    const match = evalCases.find((c) => c.example.input.task === payload.task);
    return new Response(
      JSON.stringify({ id: 'r1', model: 'stub-model-returned', choices: [{ message: { content: JSON.stringify(match!.example.fixtureOutput) } }], usage: { total_tokens: 5 } }),
    );
  });

function setup(argv: string[], options: { env?: Record<string, string>; fetchImpl?: typeof fetch; cases?: EvalDeps['cases']; docs?: string } = {}) {
  const lines: string[] = [];
  const files: Record<string, string> = {};
  const fetchImpl = options.fetchImpl ?? vi.fn<typeof fetch>(async () => { throw new Error('fetch must not be called in this test'); });
  const deps: EvalDeps = {
    argv,
    env: options.env ?? {},
    fetchImpl,
    out: (line) => lines.push(line),
    writeFile: (path, content) => {
      files[path] = content;
    },
    readFile: () => options.docs ?? '',
    now: () => 1_000,
    cases: options.cases,
  };
  return { run: () => runEval(deps), output: () => lines.join('\n'), files, fetchImpl: fetchImpl as ReturnType<typeof idealStub> };
}

describe('npm run eval, default', () => {
  it('runs the oracle and the keyword baseline on all 13 cases, makes no network call and writes no file', async () => {
    const t = setup([]);
    expect(await t.run()).toBe(0);
    expect(t.output()).toContain('13 cases (3 built-in, 10 synthetic)');
    expect(t.output()).toContain('Oracle (sanity check)');
    expect(t.output()).toContain('Keyword baseline (not a model)');
    expect(t.output()).not.toContain('Live model');
    expect(t.fetchImpl).not.toHaveBeenCalled();
    expect(t.files).toEqual({});
  });

  it('is reproducible: the same command prints the same bytes', async () => {
    const a = setup([]);
    const b = setup([]);
    await a.run();
    await b.run();
    expect(b.output()).toBe(a.output());
  });

  it('can run on part of the dataset', async () => {
    const synthetic = setup(['--set', 'synthetic']);
    await synthetic.run();
    expect(synthetic.output()).toContain('10 cases (0 built-in, 10 synthetic)');

    const one = setup(['--cases', 'refund-window,plan-tiers']);
    await one.run();
    expect(one.output()).toContain('2 cases');
  });

  it('writes machine-readable results with --json', async () => {
    const t = setup(['--json', 'out/results.json']);
    expect(await t.run()).toBe(0);
    const report = JSON.parse(t.files['out/results.json']!);
    expect(report.analyzers.map((a: { id: string }) => a.id)).toEqual(['oracle', 'keyword']);
    expect(report.dataset.cases).toBe(13);
    expect(report.analyzers[0].runs[0].cases).toHaveLength(13);
  });

  it('stops with a failure when the oracle is not perfect, because then no number can be trusted', async () => {
    const broken = structuredClone(evalCases);
    broken[0]!.example.expected.missing = [...broken[0]!.example.expected.missing, 'invented-id'];
    const t = setup([], { cases: broken });
    expect(await t.run()).toBe(1);
    expect(t.output()).toContain('SANITY CHECK FAILED');
  });

  it('rejects bad arguments before doing anything', async () => {
    const bad = [
      ['--nope'],
      ['--analyzer', 'gpt'],
      ['--analyzer'],
      ['--set', 'everything'],
      ['--repeat', '0'],
      ['--repeat', '9'],
      ['--json'],
      ['--cases', 'does-not-exist'],
    ];
    for (const argv of bad) {
      const t = setup(argv);
      expect(await t.run(), argv.join(' ')).toBe(2);
      expect(t.fetchImpl).not.toHaveBeenCalled();
    }
  });
});

describe('--write-docs', () => {
  const doc = `# Doc\n\nbefore\n\n${DOCS_BEGIN}\nold block\n${DOCS_END}\n\nafter\n`;

  it('replaces only the generated block, and keeps the text around it', async () => {
    const t = setup(['--write-docs'], { docs: doc });
    expect(await t.run()).toBe(0);
    const written = t.files['docs/EVALUATION.md']!;
    expect(written.startsWith('# Doc\n\nbefore\n\n')).toBe(true);
    expect(written.endsWith('\n\nafter\n')).toBe(true);
    expect(written).not.toContain('old block');

    const expected = renderDocsBlock(
      buildReport(evalCases, [
        { analyzer: oracleAnalyzer, runs: [await runAnalyzer(oracleAnalyzer, evalCases)] },
        { analyzer: keywordAnalyzer, runs: [await runAnalyzer(keywordAnalyzer, evalCases)] },
      ]),
    );
    expect(written).toBe(`# Doc\n\nbefore\n\n${expected}\n\nafter\n`);
  });

  it('refuses unless it is the full dataset with the default analyzers, so documented numbers stay reproducible', async () => {
    for (const extra of [['--set', 'synthetic'], ['--cases', 'refund-window'], ['--analyzer', 'oracle']]) {
      const t = setup(['--write-docs', ...extra], { docs: doc });
      expect(await t.run(), extra.join(' ')).toBe(2);
      expect(t.files['docs/EVALUATION.md']).toBeUndefined();
    }
    const custom = setup(['--write-docs'], { docs: doc, cases: evalCases });
    expect(await custom.run()).toBe(2);
  });

  it('refuses when the document has no block to update', async () => {
    const t = setup(['--write-docs'], { docs: '# No markers here\n' });
    expect(await t.run()).toBe(2);
    expect(t.files['docs/EVALUATION.md']).toBeUndefined();
  });
});

describe('the live analyzer: gated, never default', () => {
  it('is unavailable without credentials, and says why', async () => {
    const t = setup(['--analyzer', 'live']);
    expect(await t.run()).toBe(2);
    expect(t.output()).toContain('META_API_KEY');
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });

  it('without --yes, previews the plan, saves the exact request bodies, and sends nothing', async () => {
    const t = setup(['--analyzer', 'live'], { env: LIVE_ENV });
    expect(await t.run()).toBe(0);

    expect(t.fetchImpl).not.toHaveBeenCalled();
    expect(t.output()).toContain('LIVE ANALYZER PLAN');
    expect(t.output()).toContain('Destination: https://api.provider.test/v1/chat/completions');
    expect(t.output()).toContain('Model: stub-model');
    expect(t.output()).toContain('13 cases x 1 run(s) = 13');
    expect(t.output()).toContain('Live analyzer NOT run');
    expect(t.output()).not.toContain('# Evaluation report'); // nothing was run, so there is no report

    for (const c of evalCases) expect(t.files[`.eval/requests/${c.id}.json`], c.id).toBe(liveRequestBody(settings, c));
    expect(Object.keys(t.files).filter((f) => f.startsWith('.eval/responses/'))).toEqual([]);
  });

  it('runs the deterministic analyzers and skips the live one when --yes is missing', async () => {
    const t = setup(['--analyzer', 'oracle,keyword,live'], { env: LIVE_ENV });
    expect(await t.run()).toBe(0);
    expect(t.fetchImpl).not.toHaveBeenCalled();
    expect(t.output()).toContain('Oracle (sanity check)');
    expect(t.output()).toContain('Live analyzer NOT run');
    expect(t.output()).not.toContain('Live model (stub-model)');
  });

  it('never prints the key or the URL query', async () => {
    const t = setup(['--analyzer', 'live', '--print-requests'], { env: LIVE_ENV });
    await t.run();
    expect(t.output()).not.toContain(KEY);
    expect(t.output()).not.toContain('QSECRET');
    expect(Object.values(t.files).join('\n')).not.toContain(KEY);
    // --print-requests shows the exact bodies.
    expect(t.output()).toContain(liveRequestBody(settings, evalCases[0]!));
  });

  it('with --yes, sends each case once and scores the answers (stub provider)', async () => {
    const fetchImpl = idealStub();
    const t = setup(['--analyzer', 'live', '--yes'], { env: LIVE_ENV, fetchImpl });
    expect(await t.run()).toBe(0);

    expect(fetchImpl).toHaveBeenCalledTimes(13);
    fetchImpl.mock.calls.forEach(([, init], index) => {
      expect(init?.body, evalCases[index]!.id).toBe(t.files[`.eval/requests/${evalCases[index]!.id}.json`]); // sent == previewed
    });
    expect(t.output()).toContain('Live model (stub-model)');
    expect(t.output()).toContain('[13/13]');
    expect(t.output()).toContain('100.0% (13/13)'); // the stub returns ideal answers, so a perfect score is expected here
    for (const c of evalCases) expect(t.files[`.eval/responses/run1-${c.id}.txt`], c.id).toBe(JSON.stringify(c.example.fixtureOutput));
    expect(t.output() + Object.values(t.files).join('\n')).not.toContain(KEY);
  });

  it('with --repeat, runs the whole set again and reports each run on its own', async () => {
    const fetchImpl = idealStub();
    const t = setup(['--analyzer', 'live', '--yes', '--repeat', '2'], { env: LIVE_ENV, fetchImpl });
    expect(await t.run()).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(26);
    expect(t.output()).toContain('Live model (stub-model), run 1');
    expect(t.output()).toContain('Live model (stub-model), run 2');
    expect(t.files['.eval/responses/run1-refund-window.txt']).toBeDefined();
    expect(t.files['.eval/responses/run2-refund-window.txt']).toBeDefined();
  });

  it('shows provider failures as failed outputs and zero recall, rather than hiding them', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(`unauthorized ${KEY}`, { status: 401 }));
    const t = setup(['--analyzer', 'live', '--yes'], { env: LIVE_ENV, fetchImpl });
    expect(await t.run()).toBe(0);
    expect(t.output()).toContain('FAILED (error)');
    expect(t.output()).toContain('0.0% (0/13)'); // missing-evidence recall
    expect(t.output()).toContain('13/13'); // failed outputs
    expect(t.output() + Object.values(t.files).join('\n')).not.toContain(KEY);
  });

  it('shows an answer that fails validation as a failed output', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Sure! Here you go.' } }] })));
    const t = setup(['--analyzer', 'live', '--yes', '--set', 'built-in'], { env: LIVE_ENV, fetchImpl });
    expect(await t.run()).toBe(0);
    expect(t.output()).toContain('FAILED (invalid_output)');
    expect(t.output()).toContain('Output failed validation');
  });

  it('refuses a plain-http destination', async () => {
    const t = setup(['--analyzer', 'live', '--yes'], { env: { ...LIVE_ENV, META_API_URL: 'http://api.provider.test/v1' } });
    expect(await t.run()).toBe(2);
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });
});
