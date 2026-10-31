import { aggregate, scoreCase, type Aggregate, type CaseScore } from './metrics';
import type { Analyzer, EvalCase } from './types';

export interface RunReport {
  aggregate: Aggregate;
  cases: CaseScore[];
  /** Distinct model IDs the provider reported, in order of first appearance. Empty for non-models. */
  models: string[];
  /** Total provider latency over the cases that reported one. Null if none did. */
  latencyMs: number | null;
}

/** Run one analyzer over the cases, one at a time and in order. Failures are scored, not skipped. */
export async function runAnalyzer(
  analyzer: Analyzer,
  cases: readonly EvalCase[],
  onProgress?: (done: number, total: number, score: CaseScore) => void,
): Promise<RunReport> {
  const scores: CaseScore[] = [];
  const models: string[] = [];
  let latency = 0;
  let sawLatency = false;

  for (const testCase of cases) {
    const result = await analyzer.run(testCase);
    const score = scoreCase(testCase, result);
    scores.push(score);
    if (result.model && !models.includes(result.model)) models.push(result.model);
    if (result.latencyMs !== null && analyzer.kind === 'model') {
      latency += result.latencyMs;
      sawLatency = true;
    }
    onProgress?.(scores.length, cases.length, score);
  }

  return { aggregate: aggregate(scores), cases: scores, models, latencyMs: sawLatency ? latency : null };
}
