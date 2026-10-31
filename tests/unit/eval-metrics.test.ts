import { describe, expect, it } from 'vitest';
import { evalCases } from '../../src/eval/cases';
import {
  aggregate,
  precision,
  recall,
  relevantIds,
  requiredIds,
  scoreCase,
  scoreConflicts,
  scoreCount,
  scoreSets,
  tokenMetrics,
} from '../../src/eval/metrics';
import { estimateTokens } from '../../src/eval/tokens';
import type { AnalyzerResult, EvalCase } from '../../src/eval/types';
import type { Facts } from '../../src/shared/facts';

const result = (facts: Facts | null, failure: AnalyzerResult['failure'] = null): AnalyzerResult => ({
  facts,
  failure,
  model: null,
  usage: null,
  latencyMs: null,
});

const goldOf = (id: string): Facts => evalCases.find((c) => c.id === id)!.example.expected;

describe('estimateTokens', () => {
  it('is ceil(characters / 4)', () => {
    expect([0, 1, 4, 5, 8, 9].map((n) => estimateTokens('x'.repeat(n)))).toEqual([0, 1, 1, 2, 2, 3]);
  });
});

describe('recall and precision', () => {
  it('are shares of gold items found and of predictions that were right', () => {
    expect(recall({ tp: 3, fp: 9, fn: 1 })).toBe(0.75);
    expect(precision({ tp: 3, fp: 1, fn: 9 })).toBe(0.75);
  });

  it('are null, not zero, when there is nothing to find or nothing was predicted', () => {
    expect(recall({ tp: 0, fp: 4, fn: 0 })).toBeNull();
    expect(precision({ tp: 0, fp: 0, fn: 4 })).toBeNull();
  });
});

describe('scoreSets', () => {
  it('counts true positives, extras and misses', () => {
    expect(scoreSets(['a', 'b', 'c'], ['a', 'd'])).toEqual({ tp: 1, fp: 2, fn: 1 });
  });

  it('ignores order and duplicates', () => {
    expect(scoreSets(['b', 'a', 'a', 'b'], ['a', 'b', 'b'])).toEqual({ tp: 2, fp: 0, fn: 0 });
  });

  it('handles empty sides', () => {
    expect(scoreSets([], ['a'])).toEqual({ tp: 0, fp: 0, fn: 1 });
    expect(scoreSets(['a'], [])).toEqual({ tp: 0, fp: 1, fn: 0 });
    expect(scoreSets([], [])).toEqual({ tp: 0, fp: 0, fn: 0 });
  });
});

describe('scoreConflicts', () => {
  it('detects a gold conflict when a predicted set contains all of its passages, extras allowed', () => {
    expect(scoreConflicts([['a', 'b']], [['a', 'b']])).toEqual({ tp: 1, fp: 0, fn: 0 });
    expect(scoreConflicts([['a', 'b', 'c']], [['a', 'b']])).toEqual({ tp: 1, fp: 0, fn: 0 });
  });

  it('does not credit a prediction that covers only part of a gold conflict', () => {
    expect(scoreConflicts([['a', 'c']], [['a', 'b']])).toEqual({ tp: 0, fp: 1, fn: 1 });
    expect(scoreConflicts([['a']], [['a', 'b']])).toEqual({ tp: 0, fp: 1, fn: 1 });
  });

  it('matches one prediction to one gold conflict, so a single set cannot claim two', () => {
    expect(scoreConflicts([['a', 'b', 'c', 'd']], [['a', 'b'], ['c', 'd']])).toEqual({ tp: 1, fp: 0, fn: 1 });
    expect(scoreConflicts([['a', 'b'], ['c', 'd']], [['a', 'b'], ['c', 'd']])).toEqual({ tp: 2, fp: 0, fn: 0 });
  });

  it('counts every unmatched prediction as a false positive, and ignores order', () => {
    expect(scoreConflicts([['x', 'y'], ['c', 'd'], ['a', 'b']], [['a', 'b'], ['c', 'd']])).toEqual({ tp: 2, fp: 1, fn: 0 });
  });

  it('treats any prediction as a false positive when there is no gold conflict', () => {
    expect(scoreConflicts([['a', 'b']], [])).toEqual({ tp: 0, fp: 1, fn: 0 });
    expect(scoreConflicts([], [['a', 'b']])).toEqual({ tp: 0, fp: 0, fn: 1 });
  });
});

describe('scoreCount (unanswerable)', () => {
  it('matches by number only, capped at the gold count', () => {
    expect(scoreCount(2, 2)).toEqual({ tp: 2, fp: 0, fn: 0 });
    expect(scoreCount(5, 2)).toEqual({ tp: 2, fp: 3, fn: 0 });
    expect(scoreCount(0, 2)).toEqual({ tp: 0, fp: 0, fn: 2 });
    expect(scoreCount(1, 0)).toEqual({ tp: 0, fp: 1, fn: 0 });
  });
});

describe('required and relevant passages', () => {
  it('required is supported plus missing. Conflict passages are relevant but not required', () => {
    const gold = goldOf('retention-conflict');
    expect([...requiredIds(gold)].sort()).toEqual(['ret-02', 'ret-05']);
    expect([...relevantIds(gold)].sort()).toEqual(['ret-01', 'ret-02', 'ret-03', 'ret-05']);
  });
});

// A hand-built case with known sizes: passages of 8, 12, 16, 20 and 4 characters = 2, 3, 4, 5, 1 tokens.
const tiny: EvalCase = {
  id: 'tiny',
  set: 'synthetic',
  tags: [],
  example: {
    slug: 'tiny',
    title: 'Tiny',
    summary: '',
    synthetic: true,
    input: {
      task: 'Task',
      sources: [
        { id: 's', title: 'T', text: 'x'.repeat(8) }, // supported, in pack
        { id: 'm', title: 'T', text: 'x'.repeat(12) }, // missing, not in pack
        { id: 'c', title: 'T', text: 'x'.repeat(16) }, // conflict side, in pack
        { id: 'n', title: 'T', text: 'x'.repeat(20) }, // dead weight, in pack
        { id: 'z', title: 'T', text: 'x'.repeat(4) }, // dead weight, not in pack
      ],
      pack: ['s', 'c', 'n'],
    },
    fixtureOutput: { requirements: [], repairs: [] },
    expected: { supported: ['s'], missing: ['m'], conflicts: [['c', 'm']], unanswerable: 0, repairPassageIds: ['m'] },
    distractorPassageIds: [],
    injectionPassageIds: [],
  },
};

describe('tokenMetrics', () => {
  const idealFacts: Facts = { supported: ['s'], missing: ['m'], conflicts: [['c', 'm']], unanswerable: 0, repairPassageIds: ['m'] };

  it('computes sizes, preservation, reduction, growth and dead weight by hand', () => {
    const t = tokenMetrics(tiny, idealFacts);
    expect(t.allSources).toBe(2 + 3 + 4 + 5 + 1); // 15
    expect(t.initialPack).toBe(2 + 4 + 5); // s, c, n = 11
    expect(t.revisedPack).toBe(2 + 4 + 5 + 3); // plus m = 14
    expect(t.required).toBe(2); // s and m
    expect(t.preservedInitial).toBe(0.5); // s is in the pack, m is not
    expect(t.preservedRevised).toBe(1);
    expect(t.reductionVsAll).toBeCloseTo(1 - 14 / 15, 10);
    expect(t.growthVsInitial).toBeCloseTo(14 / 11 - 1, 10);
    // Relevant = s, m, c. Only n is dead weight in the revised pack.
    expect(t.deadWeight).toBe(5);
  });

  it('adds nothing when the analyzer proposed no repairs, or failed', () => {
    const none = tokenMetrics(tiny, { ...idealFacts, repairPassageIds: [] });
    expect(none.revisedPack).toBe(none.initialPack);
    expect(none.preservedRevised).toBe(0.5);
    expect(none.growthVsInitial).toBe(0);
    expect(tokenMetrics(tiny, null).revisedPack).toBe(11);
  });

  it('charges an unneeded repair as growth and dead weight, and ignores IDs that do not exist', () => {
    const t = tokenMetrics(tiny, { ...idealFacts, repairPassageIds: ['m', 'z', 'ghost'] });
    expect(t.revisedPack).toBe(14 + 1);
    expect(t.deadWeight).toBe(5 + 1);
    expect(t.preservedRevised).toBe(1);
  });

  it('reports 100% preservation when nothing is required, and null growth for an empty pack', () => {
    const none = { ...tiny, example: { ...tiny.example, expected: { supported: [], missing: [], conflicts: [], unanswerable: 0, repairPassageIds: [] } } };
    expect(tokenMetrics(none, null).preservedInitial).toBe(1);
    const empty = { ...tiny, example: { ...tiny.example, input: { ...tiny.example.input, pack: [] } } };
    expect(tokenMetrics(empty, idealFacts).growthVsInitial).toBeNull();
  });
});

describe('scoreCase', () => {
  it('gives full marks for the ideal answer', () => {
    const score = scoreCase(tiny, result({ supported: ['s'], missing: ['m'], conflicts: [['c', 'm']], unanswerable: 0, repairPassageIds: ['m'] }));
    for (const counts of [score.supported, score.missing, score.conflicts, score.unanswerable]) expect(counts.fp + counts.fn).toBe(0);
    expect(score.conflictFalseAlarm).toBeNull(); // the case has a gold conflict
  });

  it('gives a failed analyzer no credit, and counts every gold item as missed', () => {
    const score = scoreCase(tiny, result(null, { kind: 'invalid_output', message: 'bad' }));
    expect(score.failure?.kind).toBe('invalid_output');
    expect(score.supported).toEqual({ tp: 0, fp: 0, fn: 1 });
    expect(score.missing).toEqual({ tp: 0, fp: 0, fn: 1 });
    expect(score.conflicts).toEqual({ tp: 0, fp: 0, fn: 1 });
    expect(score.tokens.revisedPack).toBe(score.tokens.initialPack);
  });

  it('flags a conflict reported in a case that has none', () => {
    const noConflict = evalCases.find((c) => c.id === 'refund-window')!;
    const gold = noConflict.example.expected;
    expect(scoreCase(noConflict, result({ ...gold, conflicts: [] })).conflictFalseAlarm).toBe(false);
    expect(scoreCase(noConflict, result({ ...gold, conflicts: [['refund-01', 'refund-04']] })).conflictFalseAlarm).toBe(true);
    expect(scoreCase(noConflict, result(null, { kind: 'error', message: 'x' })).conflictFalseAlarm).toBe(false);
  });
});

describe('aggregate', () => {
  it('sums counts and token totals, and counts failures', () => {
    const a = scoreCase(tiny, result({ supported: ['s'], missing: ['m'], conflicts: [['c', 'm']], unanswerable: 0, repairPassageIds: ['m'] }));
    const b = scoreCase(tiny, result(null, { kind: 'error', message: 'x' }));
    const total = aggregate([a, b]);
    expect(total.cases).toBe(2);
    expect(total.failures).toBe(1);
    expect(total.missing).toEqual({ tp: 1, fp: 0, fn: 1 });
    expect(total.conflicts).toEqual({ tp: 1, fp: 0, fn: 1 });
    expect(total.tokens.totalAllSources).toBe(30);
    expect(total.tokens.totalRevisedPack).toBe(14 + 11);
    expect(total.tokens.meanPreservedRevised).toBe((1 + 0.5) / 2);
    expect(total.tokens.reductionVsAll).toBeCloseTo(1 - 25 / 30, 10);
    expect(total.tokens.deadWeightShare).toBeCloseTo((5 + 5) / 25, 10);
  });

  it('counts false alarms only among cases with no gold conflict', () => {
    const quiet = evalCases.find((c) => c.id === 'refund-window')!;
    const gold = quiet.example.expected;
    const alarm = scoreCase(quiet, result({ ...gold, conflicts: [['refund-01', 'refund-04']] }));
    const fine = scoreCase(quiet, result(gold));
    const withConflict = scoreCase(tiny, result(null, { kind: 'error', message: 'x' }));
    expect(aggregate([alarm, fine, withConflict]).conflictFalseAlarms).toEqual({ eligible: 2, raised: 1 });
  });

  it('copes with no cases at all', () => {
    const empty = aggregate([]);
    expect(empty.cases).toBe(0);
    expect(empty.tokens.reductionVsAll).toBe(0);
    expect(empty.tokens.deadWeightShare).toBeNull();
  });
});

describe('the scorer reacts to specific mistakes (so a high score cannot be an accident)', () => {
  const ideal = (c: EvalCase): Facts => c.example.expected;
  const sum = (pick: (s: ReturnType<typeof scoreCase>) => { tp: number; fp: number; fn: number }, facts: (c: EvalCase) => Facts) => {
    const scores = evalCases.map((c) => scoreCase(c, result(facts(c))));
    return aggregate(scores);
  };

  it('the ideal answer scores perfectly everywhere', () => {
    const a = sum((s) => s.missing, ideal);
    for (const counts of [a.supported, a.missing, a.conflicts, a.unanswerable]) expect(counts.fp + counts.fn).toBe(0);
    expect(a.conflictFalseAlarms.raised).toBe(0);
  });

  it('dropping every missing-evidence passage costs recall, not precision', () => {
    const a = sum((s) => s.missing, (c) => ({ ...ideal(c), missing: [] }));
    expect(recall(a.missing)).toBe(0);
    expect(precision(a.missing)).toBeNull();
  });

  it('flagging every passage as missing keeps recall at 100% and destroys precision', () => {
    const a = sum(
      (s) => s.missing,
      (c) => ({ ...ideal(c), missing: c.example.input.sources.map((p) => p.id) }),
    );
    expect(recall(a.missing)).toBe(1);
    expect(precision(a.missing)!).toBeLessThan(0.5);
  });

  it('inventing a conflict in every case raises false alarms and lowers contradiction precision', () => {
    const a = sum(
      (s) => s.conflicts,
      (c) => ({ ...ideal(c), conflicts: [...ideal(c).conflicts, [c.example.input.sources[0]!.id, c.example.input.sources[1]!.id]] }),
    );
    expect(a.conflictFalseAlarms.raised).toBe(a.conflictFalseAlarms.eligible);
    expect(precision(a.conflicts)!).toBeLessThan(1);
  });

  it('reporting no unanswerable question costs unanswerable recall', () => {
    const a = sum((s) => s.unanswerable, (c) => ({ ...ideal(c), unanswerable: 0 }));
    expect(recall(a.unanswerable)).toBe(0);
  });

  it('flagging many unanswerable questions cannot buy recall for free: precision falls', () => {
    const a = sum((s) => s.unanswerable, (c) => ({ ...ideal(c), unanswerable: 10 }));
    expect(recall(a.unanswerable)).toBe(1);
    expect(precision(a.unanswerable)!).toBeLessThan(0.2);
  });
});
