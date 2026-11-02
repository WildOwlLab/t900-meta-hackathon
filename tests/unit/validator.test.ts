import { describe, expect, it } from 'vitest';
import { getExample } from '../../src/examples';
import { MAX_REPORTED_ISSUES, normalizeForQuote, validateModelOutput } from '../../src/server/validator';
import { LIMITS, type AnalysisInput, type IssueCode, type ModelOutput } from '../../src/shared/types';

const refund = getExample('refund-window')!;
const retention = getExample('retention-conflict')!;

const clone = <T>(value: T): T => structuredClone(value);

function check(output: unknown, input: AnalysisInput = refund.input) {
  return validateModelOutput(output, input);
}

function codes(output: unknown, input: AnalysisInput = refund.input): IssueCode[] {
  const result = check(output, input);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

function failure(output: unknown, input: AnalysisInput = refund.input) {
  const result = check(output, input);
  if (result.ok) throw new Error('Expected validation to fail');
  return result;
}

/** A refund-window output with one field changed. Requirement indexes: r1=0 ... r5=4. */
function mutated(change: (output: ModelOutput) => void): ModelOutput {
  const output = clone(refund.fixtureOutput);
  change(output);
  return output;
}

describe('V2: malformed output is rejected', () => {
  it('rejects text that is not JSON', () => {
    expect(codes('Sure! Here is the analysis.')).toEqual(['invalid_json']);
    expect(codes('')).toEqual(['invalid_json']);
  });

  it('rejects truncated JSON', () => {
    const text = JSON.stringify(refund.fixtureOutput);
    expect(codes(text.slice(0, Math.floor(text.length / 2)))).toEqual(['invalid_json']);
  });

  it('rejects JSON wrapped in a Markdown code fence', () => {
    const fenced = '```json\n' + JSON.stringify(refund.fixtureOutput) + '\n```';
    const result = failure(fenced);
    expect(result.issues.map((issue) => issue.code)).toEqual(['invalid_json']);
    expect(result.issues[0]!.message).toContain('code fence');
  });

  it('rejects the wrong shape, including values that are not objects', () => {
    for (const value of [null, 42, [], 'null', '[]', { requirements: 'x', repairs: [] }, {}]) {
      expect(codes(value), JSON.stringify(value)).toContain('schema_violation');
    }
  });

  it('rejects an empty requirement list', () => {
    expect(codes({ requirements: [], repairs: [] })).toEqual(['schema_violation']);
  });

  it('accepts the same output as text or as an already-parsed object', () => {
    expect(check(JSON.stringify(refund.fixtureOutput)).ok).toBe(true);
    expect(check(refund.fixtureOutput).ok).toBe(true);
  });
});

describe('V3: every passage ID must exist', () => {
  it('rejects an unknown ID in evidence and names it', () => {
    const output = mutated((o) => {
      o.requirements[0]!.evidence[0]!.passageId = 'zz-404';
    });
    const result = failure(output);
    expect(result.issues.map((issue) => issue.code)).toContain('unknown_passage_id');
    const issue = result.issues.find((i) => i.code === 'unknown_passage_id')!;
    expect(issue.message).toContain('zz-404');
    expect(issue.path).toBe('requirements[0].evidence[0].passageId');
  });

  it('rejects an unknown ID in a repair and names it', () => {
    const output = mutated((o) => {
      o.repairs[0]!.passageId = 'zz-405';
    });
    const result = failure(output);
    const issue = result.issues.find((i) => i.code === 'unknown_passage_id')!;
    expect(issue.message).toContain('zz-405');
    expect(issue.path).toBe('repairs[0].passageId');
  });

  it('treats a hallucinated non-ID string as an unknown ID, not a pattern failure', () => {
    const output = mutated((o) => {
      o.requirements[0]!.evidence[0]!.passageId = 'Passage 3';
    });
    expect(codes(output)).toContain('unknown_passage_id');
  });
});

describe('V4: "supported" must cite only passages in the pack', () => {
  it('rejects a supported requirement that cites a passage outside the pack', () => {
    const output = mutated((o) => {
      o.requirements[0]!.evidence = [
        { passageId: 'refund-04', quote: 'prorated refund for the unused full months' },
      ];
    });
    expect(codes(output)).toEqual(['outside_pack']);
  });

  it('rejects a supported requirement with no evidence', () => {
    const output = mutated((o) => {
      o.requirements[0]!.evidence = [];
    });
    expect(codes(output)).toEqual(['evidence_required']);
  });
});

describe('V5: "missing_evidence" must cite passages outside the pack', () => {
  it('rejects a missing_evidence requirement that cites a passage already in the pack', () => {
    const output = mutated((o) => {
      o.requirements[2]!.evidence = [
        { passageId: 'refund-01', quote: 'a full refund within 30 days of the initial purchase date' },
      ];
    });
    const found = codes(output);
    expect(found).toContain('inside_pack');
    // The repair for r3 now points at a passage r3 no longer cites.
    expect(found).toContain('repair_not_cited');
  });

  it('rejects a missing_evidence requirement that cites nothing', () => {
    const output = mutated((o) => {
      o.requirements[2]!.evidence = [];
      o.repairs = o.repairs.filter((repair) => repair.requirementId !== 'r3');
    });
    expect(codes(output)).toEqual(['evidence_required']);
  });
});

describe('V6: "unanswerable" must cite nothing', () => {
  it('rejects an unanswerable requirement that cites a passage', () => {
    const output = mutated((o) => {
      o.requirements[4]!.evidence = [
        { passageId: 'refund-02', quote: 'returned to the original payment method' },
      ];
    });
    expect(codes(output)).toEqual(['evidence_forbidden']);
  });
});

describe('V7: "conflicting" must cite at least two distinct passages', () => {
  const conflictIndex = 0; // r1 in retention-conflict

  it('accepts two distinct passages', () => {
    expect(check(retention.fixtureOutput, retention.input).ok).toBe(true);
  });

  it('rejects a conflict with a single passage', () => {
    const output = clone(retention.fixtureOutput);
    output.requirements[conflictIndex]!.evidence = output.requirements[conflictIndex]!.evidence.slice(0, 1);
    expect(codes(output, retention.input)).toEqual(['conflict_needs_two_passages']);
  });

  it('rejects a conflict that cites the same passage twice', () => {
    const output = clone(retention.fixtureOutput);
    const first = output.requirements[conflictIndex]!.evidence[0]!;
    output.requirements[conflictIndex]!.evidence = [first, { ...first }];
    expect(codes(output, retention.input)).toEqual(['conflict_needs_two_passages']);
  });

  it('rejects a conflict with no evidence', () => {
    const output = clone(retention.fixtureOutput);
    output.requirements[conflictIndex]!.evidence = [];
    expect(codes(output, retention.input)).toEqual(['conflict_needs_two_passages']);
  });

  it('does not count an unknown ID as a second passage', () => {
    const output = clone(retention.fixtureOutput);
    output.requirements[conflictIndex]!.evidence[1]!.passageId = 'zz-1';
    expect(codes(output, retention.input)).toEqual(expect.arrayContaining(['unknown_passage_id', 'conflict_needs_two_passages']));
  });
});

describe('V8: quotes must be exact spans of the cited passage', () => {
  it('rejects a paraphrase', () => {
    const output = mutated((o) => {
      o.requirements[0]!.evidence[0]!.quote = 'customers can get their money back inside thirty days';
    });
    expect(codes(output)).toEqual(['quote_not_in_passage']);
  });

  it('rejects a real quote attributed to the wrong passage', () => {
    const output = mutated((o) => {
      o.requirements[0]!.evidence[0]!.passageId = 'refund-02';
    });
    expect(codes(output)).toContain('quote_not_in_passage');
  });

  it('rejects a quote built by joining two spans with an ellipsis', () => {
    const output = mutated((o) => {
      o.requirements[0]!.evidence[0]!.quote = 'a full refund within 30 days ... the standard refund window is closed';
    });
    expect(codes(output)).toEqual(['quote_not_in_passage']);
  });

  it('is case sensitive', () => {
    const output = mutated((o) => {
      o.requirements[0]!.evidence[0]!.quote = 'A FULL REFUND WITHIN 30 DAYS OF THE INITIAL PURCHASE DATE';
    });
    expect(codes(output)).toEqual(['quote_not_in_passage']);
  });

  it('rejects a quote too short to mean anything', () => {
    const output = mutated((o) => {
      o.requirements[0]!.evidence[0]!.quote = 'a refund'.slice(0, LIMITS.minQuoteChars - 1);
    });
    expect(codes(output)).toEqual(['quote_too_short']);
  });

  it('tolerates whitespace, typographic quotes and dashes, and nothing else', () => {
    const input: AnalysisInput = {
      task: 'Check the policy.',
      sources: [
        {
          id: 'p-1',
          title: 'Policy',
          text: 'The agent shouldn’t refund   orders\n placed – or changed – after the “cut-off” date.',
        },
      ],
      pack: ['p-1'],
    };
    const output: ModelOutput = {
      requirements: [
        {
          id: 'r1',
          text: 'Refund cut-off.',
          status: 'supported',
          evidence: [
            { passageId: 'p-1', quote: `shouldn't refund orders placed - or changed - after the "cut-off" date` },
          ],
          rationale: 'Stated directly.',
        },
      ],
      repairs: [],
    };
    expect(check(output, input).ok).toBe(true);
    expect(normalizeForQuote('  a “b”\tc ')).toBe('a "b" c');
  });
});

describe('V9: structural strictness', () => {
  it('rejects duplicate requirement IDs', () => {
    const output = mutated((o) => {
      o.requirements[1]!.id = 'r1';
    });
    expect(codes(output)).toContain('duplicate_requirement_id');
  });

  it('rejects unknown fields at every level', () => {
    const topLevel = { ...clone(refund.fixtureOutput), confidence: 0.9 };
    const onRequirement = mutated((o) => {
      (o.requirements[0] as Record<string, unknown>).confidence = 0.9;
    });
    const onEvidence = mutated((o) => {
      (o.requirements[0]!.evidence[0] as Record<string, unknown>).page = 3;
    });
    for (const output of [topLevel, onRequirement, onEvidence]) {
      expect(codes(output)).toEqual(['schema_violation']);
    }
  });

  it('rejects a status outside the four buckets', () => {
    const output = mutated((o) => {
      (o.requirements[0] as Record<string, unknown>).status = 'partially_supported';
    });
    expect(codes(output)).toEqual(['schema_violation']);
  });

  it('rejects the old separate conflicts array', () => {
    const output = { ...clone(refund.fixtureOutput), conflicts: [] };
    expect(codes(output)).toEqual(['schema_violation']);
  });

  it('reports every problem, not just the first, with paths', () => {
    const output = mutated((o) => {
      o.requirements[0]!.evidence[0]!.passageId = 'zz-1';
      o.requirements[4]!.evidence = [{ passageId: 'refund-02', quote: 'returned to the original payment method' }];
    });
    const result = failure(output);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['unknown_passage_id', 'evidence_forbidden']),
    );
    expect(result.issues.every((issue) => issue.path.length > 0)).toBe(true);
  });

  it('caps the number of reported issues and says how many were left out', () => {
    const output = mutated((o) => {
      const bad = { passageId: 'zz-1', quote: 'does not matter here' };
      o.requirements = Array.from({ length: 20 }, (_, i) => ({
        id: `r${i + 1}`,
        text: 'Requirement.',
        status: 'supported' as const,
        evidence: Array.from({ length: 5 }, () => ({ ...bad })),
        rationale: 'Because.',
      }));
      o.repairs = [];
    });
    const result = failure(output);
    expect(result.issues).toHaveLength(MAX_REPORTED_ISSUES);
    expect(result.omitted).toBe(20 * 5 - MAX_REPORTED_ISSUES);
  });
});

describe('repairs are strict passage ID selections', () => {
  it('rejects a repair that carries any text', () => {
    const output = mutated((o) => {
      (o.repairs[0] as Record<string, unknown>).text = 'Refunds are available for 90 days.';
    });
    expect(codes(output)).toEqual(['schema_violation']);
    const withReason = mutated((o) => {
      (o.repairs[0] as Record<string, unknown>).reason = 'Because.';
    });
    expect(codes(withReason)).toEqual(['schema_violation']);
  });

  it('rejects a repair for an unknown requirement', () => {
    const output = mutated((o) => {
      o.repairs[0]!.requirementId = 'r99';
    });
    expect(codes(output)).toEqual(['repair_unknown_requirement']);
  });

  it('rejects a repair for a supported or unanswerable requirement', () => {
    const forSupported = mutated((o) => {
      o.repairs.push({ requirementId: 'r1', passageId: 'refund-01' });
    });
    expect(codes(forSupported)).toContain('repair_wrong_status');
    const forUnanswerable = mutated((o) => {
      o.repairs.push({ requirementId: 'r5', passageId: 'refund-04' });
    });
    expect(codes(forUnanswerable)).toContain('repair_wrong_status');
  });

  it('rejects a repair for a passage already in the pack', () => {
    const output = mutated((o) => {
      o.repairs[0]!.passageId = 'refund-01';
    });
    expect(codes(output)).toContain('repair_already_in_pack');
  });

  it('rejects a repair for a passage the requirement did not cite', () => {
    const output = mutated((o) => {
      o.repairs[0]!.passageId = 'refund-06';
    });
    expect(codes(output)).toEqual(['repair_not_cited']);
  });

  it('rejects the same repair twice', () => {
    const output = mutated((o) => {
      o.repairs.push({ ...o.repairs[0]! });
    });
    expect(codes(output)).toEqual(['duplicate_repair']);
  });

  it('allows a repair for a conflicting requirement, but only for a cited passage outside the pack', () => {
    const output = clone(retention.fixtureOutput);
    output.repairs.push({ requirementId: 'r1', passageId: 'ret-03' });
    expect(check(output, retention.input).ok).toBe(true);

    const inPack = clone(retention.fixtureOutput);
    inPack.repairs.push({ requirementId: 'r1', passageId: 'ret-01' });
    expect(codes(inPack, retention.input)).toEqual(['repair_already_in_pack']);
  });

  it('accepts an output with no repairs', () => {
    const output = mutated((o) => {
      o.repairs = [];
    });
    expect(check(output).ok).toBe(true);
  });
});

describe('rationale is optional', () => {
  /** The refund-window answer with the rationale key removed from every requirement, as a model might send it. */
  const withoutRationale = () => {
    const output = clone(refund.fixtureOutput) as unknown as { requirements: Record<string, unknown>[] };
    for (const requirement of output.requirements) delete requirement.rationale;
    return output;
  };

  it('accepts requirements with no rationale at all, and stores an empty one', () => {
    const result = check(withoutRationale());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requirements.map((r) => r.rationale)).toEqual(refund.fixtureOutput.requirements.map(() => ''));
    // Nothing else about the answer changes.
    expect(result.value.requirements.map(({ rationale: _rationale, ...rest }) => rest)).toEqual(
      refund.fixtureOutput.requirements.map(({ rationale: _rationale, ...rest }) => rest),
    );
  });

  it('accepts an empty string, a whitespace-only string and a full-length one', () => {
    for (const rationale of ['', '   ', 'x'.repeat(LIMITS.maxRationaleChars)]) {
      const output = mutated((o) => {
        o.requirements[0]!.rationale = rationale;
      });
      const result = check(output);
      expect(result.ok, JSON.stringify(rationale.slice(0, 10))).toBe(true);
      if (result.ok) expect(result.value.requirements[0]!.rationale).toBe(rationale);
    }
  });

  it('accepts it as JSON text too, which is how a model sends it', () => {
    const result = check(JSON.stringify(withoutRationale()));
    expect(result.ok).toBe(true);
  });

  it('leaves a rationale that is present exactly as it was', () => {
    const result = check(refund.fixtureOutput);
    expect(result.ok && result.value.requirements.map((r) => r.rationale)).toEqual(refund.fixtureOutput.requirements.map((r) => r.rationale));
  });

  it('still rejects a rationale that is too long, or that is not text', () => {
    const bad: unknown[] = ['x'.repeat(LIMITS.maxRationaleChars + 1), null, 42, true, ['a'], { text: 'a' }];
    for (const rationale of bad) {
      const output = mutated((o) => {
        (o.requirements[0] as Record<string, unknown>).rationale = rationale;
      });
      const result = failure(output);
      expect(result.issues.map((i) => i.code), JSON.stringify(rationale)?.slice(0, 20)).toEqual(['schema_violation']);
      expect(result.issues[0]!.path).toBe('requirements[0].rationale');
    }
  });

  it('does not let a missing rationale hide a real problem: wrong citations are still rejected', () => {
    const output = withoutRationale();
    (output.requirements[0] as { evidence: { passageId: string }[] }).evidence[0]!.passageId = 'zz-404';
    const result = failure(output);
    expect(result.issues.map((i) => i.code)).toContain('unknown_passage_id');
  });

  it('still rejects unknown fields next to a missing rationale', () => {
    const output = withoutRationale();
    (output.requirements[0] as Record<string, unknown>).confidence = 0.9;
    expect(codes(output)).toEqual(['schema_violation']);
  });
});
