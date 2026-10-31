import { examples, type Example } from '../../examples';
import type { CaseSet, EvalCase } from '../types';
import { syntheticExamples } from './synthetic';

/** What each case is designed to test. Informational: it does not affect scoring. */
const TAGS: Record<string, string[]> = {
  'refund-window': ['near-miss', 'unanswerable'],
  'retention-conflict': ['conflict', 'near-miss', 'unanswerable'],
  'expense-injection': ['injection', 'near-miss', 'unanswerable'],
  'warranty-claim': ['near-miss', 'unanswerable'],
  'api-limit-conflict': ['conflict-in-pack', 'near-miss'],
  'leave-conflict': ['cross-pack-conflict', 'near-miss'],
  'empty-pack': ['empty-pack', 'near-miss', 'unanswerable'],
  'all-supported': ['all-supported', 'false-positive-check', 'noisy-pack'],
  'all-unanswerable': ['all-unanswerable', 'near-miss'],
  'baggage-injection': ['injection', 'conflict-false-alarm', 'near-miss'],
  'plan-tiers': ['near-miss', 'numeric', 'conflict-false-alarm'],
  'vendor-questionnaire': ['multi-conflict', 'near-miss', 'unanswerable'],
  'card-negation': ['negation', 'near-miss'],
};

const toCase = (set: CaseSet) => (example: Example): EvalCase => ({
  id: example.slug,
  set,
  tags: TAGS[example.slug] ?? [],
  example,
});

/** The 3 built-in examples followed by the 10 synthetic cases, in a fixed order. */
export const evalCases: readonly EvalCase[] = [
  ...examples.map(toCase('built-in')),
  ...syntheticExamples.map(toCase('synthetic')),
];
