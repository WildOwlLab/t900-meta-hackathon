/**
 * Scoring. Everything is compared at the level of passage IDs, because requirement text is written
 * by the model and cannot be matched to a gold label, while passage IDs are stable.
 *
 * Every "detection rate" (recall) is reported next to its precision. A recall number alone can be
 * gamed by flagging everything, so neither is shown without the other.
 *
 * What is counted:
 *  - missing evidence:  passages cited by "missing_evidence" requirements, against the gold set.
 *  - contradictions:    each gold conflict is detected if some predicted conflicting requirement
 *                       cites ALL of its passages (extra passages allowed, matched one to one).
 *                       A predicted conflict that matches no gold conflict is a false positive.
 *  - unanswerable:      COUNT of unanswerable requirements, matched by number only. This cannot
 *                       tell WHICH requirement was flagged, so it is the weakest of the four.
 *  - supported:         reported for completeness, not part of the headline.
 */
import type { Facts } from '../shared/facts';
import { estimateTokens } from './tokens';
import type { AnalyzerResult, CaseSet, EvalCase } from './types';

export interface Counts {
  tp: number;
  fp: number;
  fn: number;
}

export const zeroCounts = (): Counts => ({ tp: 0, fp: 0, fn: 0 });
export const addCounts = (a: Counts, b: Counts): Counts => ({ tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn });

/** Share of gold items found. Null when there were none to find. */
export const recall = (c: Counts): number | null => (c.tp + c.fn === 0 ? null : c.tp / (c.tp + c.fn));
/** Share of predicted items that were right. Null when nothing was predicted. */
export const precision = (c: Counts): number | null => (c.tp + c.fp === 0 ? null : c.tp / (c.tp + c.fp));

export function scoreSets(predicted: readonly string[], gold: readonly string[]): Counts {
  const predictedSet = new Set(predicted);
  const goldSet = new Set(gold);
  let tp = 0;
  for (const id of goldSet) if (predictedSet.has(id)) tp += 1;
  return { tp, fp: predictedSet.size - tp, fn: goldSet.size - tp };
}

export function scoreConflicts(predicted: readonly string[][], gold: readonly string[][]): Counts {
  const used = new Set<number>();
  let tp = 0;
  for (const goldSet of gold) {
    const index = predicted.findIndex((candidate, i) => !used.has(i) && goldSet.every((id) => candidate.includes(id)));
    if (index >= 0) {
      used.add(index);
      tp += 1;
    }
  }
  return { tp, fp: predicted.length - used.size, fn: gold.length - tp };
}

export function scoreCount(predicted: number, gold: number): Counts {
  return { tp: Math.min(predicted, gold), fp: Math.max(0, predicted - gold), fn: Math.max(0, gold - predicted) };
}

// ---------------------------------------------------------------------------
// Tokens and preservation
// ---------------------------------------------------------------------------

export interface TokenMetrics {
  /** Estimated tokens in every source passage. What sending everything would cost. */
  allSources: number;
  initialPack: number;
  /** The pack after every repair the analyzer proposed is applied. */
  revisedPack: number;
  /** Tokens in the revised pack that are irrelevant to the task (not required and not part of a conflict). */
  deadWeight: number;
  /** Passages a correct answer cites: the supported and missing ones. */
  required: number;
  /** Share of the required passages already in the initial pack. 1 when none are required. */
  preservedInitial: number;
  /** Share of the required passages in the revised pack. */
  preservedRevised: number;
  /** 1 - revised / all sources. How much smaller the revised pack is than sending everything. */
  reductionVsAll: number;
  /** revised / initial - 1. Repairs only add passages, so this is never negative. Null for an empty initial pack. */
  growthVsInitial: number | null;
}

/**
 * The passages a correct answer cites: supported and missing evidence. Conflict passages are NOT
 * counted as required. A conflict needs a person's decision and add-only repairs cannot resolve it,
 * so penalising a pack for not holding both sides would punish the ideal answer.
 */
export function requiredIds(gold: Facts): Set<string> {
  return new Set([...gold.supported, ...gold.missing]);
}

/** Required passages plus every passage involved in a conflict. Anything else in a pack is dead weight. */
export function relevantIds(gold: Facts): Set<string> {
  return new Set([...requiredIds(gold), ...gold.conflicts.flat()]);
}

export function tokenMetrics(testCase: EvalCase, predicted: Facts | null): TokenMetrics {
  const { input, expected } = testCase.example;
  const byId = new Map(input.sources.map((passage) => [passage.id, passage]));
  const tokens = (ids: Iterable<string>) => [...ids].reduce((sum, id) => sum + estimateTokens(byId.get(id)?.text ?? ''), 0);

  const required = requiredIds(expected);
  const relevant = relevantIds(expected);
  const initial = new Set(input.pack);
  const revised = new Set([...input.pack, ...(predicted?.repairPassageIds ?? []).filter((id) => byId.has(id))]);
  const share = (pack: Set<string>) => (required.size === 0 ? 1 : [...required].filter((id) => pack.has(id)).length / required.size);

  const allSources = tokens(byId.keys());
  const initialPack = tokens(initial);
  const revisedPack = tokens(revised);

  return {
    allSources,
    initialPack,
    revisedPack,
    deadWeight: tokens([...revised].filter((id) => !relevant.has(id))),
    required: required.size,
    preservedInitial: share(initial),
    preservedRevised: share(revised),
    reductionVsAll: allSources === 0 ? 0 : 1 - revisedPack / allSources,
    growthVsInitial: initialPack === 0 ? null : revisedPack / initialPack - 1,
  };
}

// ---------------------------------------------------------------------------
// One case, then everything
// ---------------------------------------------------------------------------

export interface CaseScore {
  id: string;
  set: CaseSet;
  tags: string[];
  failure: AnalyzerResult['failure'];
  predicted: Facts | null;
  supported: Counts;
  missing: Counts;
  conflicts: Counts;
  unanswerable: Counts;
  /** For cases with no gold conflict: did the analyzer report one anyway? Null when the case has a gold conflict. */
  conflictFalseAlarm: boolean | null;
  tokens: TokenMetrics;
}

export function scoreCase(testCase: EvalCase, result: AnalyzerResult): CaseScore {
  const gold = testCase.example.expected;
  const predicted = result.facts;

  // An analyzer that failed to produce valid output gets no credit: every gold item counts as missed.
  const score = (): Pick<CaseScore, 'supported' | 'missing' | 'conflicts' | 'unanswerable'> =>
    predicted
      ? {
          supported: scoreSets(predicted.supported, gold.supported),
          missing: scoreSets(predicted.missing, gold.missing),
          conflicts: scoreConflicts(predicted.conflicts, gold.conflicts),
          unanswerable: scoreCount(predicted.unanswerable, gold.unanswerable),
        }
      : {
          supported: { tp: 0, fp: 0, fn: new Set(gold.supported).size },
          missing: { tp: 0, fp: 0, fn: new Set(gold.missing).size },
          conflicts: { tp: 0, fp: 0, fn: gold.conflicts.length },
          unanswerable: { tp: 0, fp: 0, fn: gold.unanswerable },
        };

  return {
    id: testCase.id,
    set: testCase.set,
    tags: testCase.tags,
    failure: result.failure,
    predicted,
    ...score(),
    conflictFalseAlarm: gold.conflicts.length === 0 ? (predicted?.conflicts.length ?? 0) > 0 : null,
    tokens: tokenMetrics(testCase, predicted),
  };
}

export interface Aggregate {
  cases: number;
  /** Cases where the analyzer produced no valid output. */
  failures: number;
  supported: Counts;
  missing: Counts;
  conflicts: Counts;
  unanswerable: Counts;
  /** Cases with no gold conflict, and how many of them got a conflict reported anyway. */
  conflictFalseAlarms: { eligible: number; raised: number };
  tokens: {
    meanPreservedInitial: number;
    meanPreservedRevised: number;
    totalAllSources: number;
    totalInitialPack: number;
    totalRevisedPack: number;
    totalDeadWeight: number;
    /** 1 - total revised / total all sources. */
    reductionVsAll: number;
    /** total revised / total initial - 1. */
    growthVsInitial: number | null;
    /** Dead weight as a share of the revised packs. */
    deadWeightShare: number | null;
  };
}

export function aggregate(scores: readonly CaseScore[]): Aggregate {
  const sum = (pick: (s: CaseScore) => Counts) => scores.reduce((total, s) => addCounts(total, pick(s)), zeroCounts());
  const total = (pick: (t: TokenMetrics) => number) => scores.reduce((n, s) => n + pick(s.tokens), 0);
  const mean = (pick: (t: TokenMetrics) => number) => (scores.length === 0 ? 0 : total(pick) / scores.length);

  const all = total((t) => t.allSources);
  const initial = total((t) => t.initialPack);
  const revised = total((t) => t.revisedPack);
  const dead = total((t) => t.deadWeight);
  const eligible = scores.filter((s) => s.conflictFalseAlarm !== null);

  return {
    cases: scores.length,
    failures: scores.filter((s) => s.failure !== null).length,
    supported: sum((s) => s.supported),
    missing: sum((s) => s.missing),
    conflicts: sum((s) => s.conflicts),
    unanswerable: sum((s) => s.unanswerable),
    conflictFalseAlarms: { eligible: eligible.length, raised: eligible.filter((s) => s.conflictFalseAlarm).length },
    tokens: {
      meanPreservedInitial: mean((t) => t.preservedInitial),
      meanPreservedRevised: mean((t) => t.preservedRevised),
      totalAllSources: all,
      totalInitialPack: initial,
      totalRevisedPack: revised,
      totalDeadWeight: dead,
      reductionVsAll: all === 0 ? 0 : 1 - revised / all,
      growthVsInitial: initial === 0 ? null : revised / initial - 1,
      deadWeightShare: revised === 0 ? null : dead / revised,
    },
  };
}
