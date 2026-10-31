import type { Example } from '../examples';
import type { Facts } from '../shared/facts';
import type { ValidationIssue } from '../shared/types';

export type CaseSet = 'built-in' | 'synthetic';

export interface EvalCase {
  /** Same as the example slug. */
  id: string;
  set: CaseSet;
  /** What the case is designed to test. Informational. */
  tags: string[];
  /** Input, hand-written ideal output, and gold labels (`expected`). */
  example: Example;
}

/** What an analyzer produced for one case. */
export interface AnalyzerResult {
  /** Passage-level facts, or null if the analyzer failed or its output did not validate. */
  facts: Facts | null;
  /** Why `facts` is null. Failures are counted and shown, never hidden. */
  failure: null | { kind: 'invalid_output' | 'error'; message: string; issues?: ValidationIssue[] };
  /** The model ID as returned by the provider. Null for analyzers that are not models. */
  model: string | null;
  usage: unknown;
  latencyMs: number | null;
}

export type AnalyzerKind = 'oracle' | 'baseline' | 'model';

export interface Analyzer {
  id: string;
  kind: AnalyzerKind;
  label: string;
  /** One sentence that says what this analyzer is, so a result can never be misread. */
  description: string;
  run(testCase: EvalCase): Promise<AnalyzerResult>;
}
