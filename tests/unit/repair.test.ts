import { describe, expect, it } from 'vitest';
import { examples, getExample } from '../../src/examples';
import { applyRepairs } from '../../src/server/repair';
import { parseAnalysisInput, validateModelOutput } from '../../src/server/validator';
import type { ModelOutput } from '../../src/shared/types';

const refund = getExample('refund-window')!;
const retention = getExample('retention-conflict')!;

const allRepairs = (output: ModelOutput) => output.repairs.map(({ requirementId, passageId }) => ({ requirementId, passageId }));

function applied(input: typeof refund.input, output: ModelOutput, approved = allRepairs(output)) {
  const result = applyRepairs(input, output, approved);
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe('applyRepairs: selecting passages by ID', () => {
  it('with nothing approved, leaves the pack exactly as it was', () => {
    const result = applied(refund.input, refund.fixtureOutput, []);
    expect(result.changed).toBe(false);
    expect(result.added).toEqual([]);
    expect(result.input).toEqual(refund.input);
  });

  it('with everything approved, appends exactly the proposed passages', () => {
    const result = applied(refund.input, refund.fixtureOutput);
    expect(result.changed).toBe(true);
    expect(result.input.pack).toEqual([...refund.input.pack, 'refund-04', 'refund-05']);
    expect(result.added.map((a) => a.passageId)).toEqual(['refund-04', 'refund-05']);
  });

  it('with a subset approved, adds only that subset', () => {
    const result = applied(refund.input, refund.fixtureOutput, [{ requirementId: 'r4', passageId: 'refund-05' }]);
    expect(result.input.pack).toEqual([...refund.input.pack, 'refund-05']);
    expect(result.added).toHaveLength(1);
  });

  it('copies passage text from the source store byte for byte, and writes none of its own', () => {
    const result = applied(refund.input, refund.fixtureOutput);
    for (const added of result.added) {
      const source = refund.input.sources.find((p) => p.id === added.passageId)!;
      expect(added.text).toBe(source.text);
      expect(added.title).toBe(source.title);
    }
    // The engine's output carries no text other than copied passages and their IDs.
    expect(Object.keys(result.added[0]!).sort()).toEqual(['forRequirementIds', 'passageId', 'text', 'title']);
  });

  it('is deterministic, and does not depend on the order repairs were approved in', () => {
    const forward = applied(refund.input, refund.fixtureOutput, allRepairs(refund.fixtureOutput));
    const again = applied(refund.input, refund.fixtureOutput, allRepairs(refund.fixtureOutput));
    const reversed = applied(refund.input, refund.fixtureOutput, [...allRepairs(refund.fixtureOutput)].reverse());
    expect(again).toEqual(forward);
    expect(reversed).toEqual(forward);
  });

  it('keeps the original pack order, then adds new passages in source order', () => {
    const result = applied(retention.input, retention.fixtureOutput);
    expect(result.input.pack).toEqual([...retention.input.pack, 'ret-05']);
  });

  it('does not modify its inputs', () => {
    const input = structuredClone(refund.input);
    const output = structuredClone(refund.fixtureOutput);
    applied(input, output);
    expect(input).toEqual(refund.input);
    expect(output).toEqual(refund.fixtureOutput);
  });

  it('adds a passage once when two requirements both asked for it, and records both', () => {
    const output = structuredClone(refund.fixtureOutput);
    output.requirements.find((r) => r.id === 'r4')!.evidence.push({
      passageId: 'refund-04',
      quote: 'prorated refund for the unused full months',
    });
    output.repairs.push({ requirementId: 'r4', passageId: 'refund-04' });
    expect(validateModelOutput(output, refund.input).ok).toBe(true);

    const result = applied(refund.input, output);
    expect(result.input.pack.filter((id) => id === 'refund-04')).toHaveLength(1);
    expect(result.added.find((a) => a.passageId === 'refund-04')!.forRequirementIds).toEqual(['r3', 'r4']);
  });

  it('can add the outside-pack side of a conflict when that repair was proposed', () => {
    const output = structuredClone(retention.fixtureOutput);
    output.repairs.push({ requirementId: 'r1', passageId: 'ret-03' });
    expect(validateModelOutput(output, retention.input).ok).toBe(true);
    const result = applied(retention.input, output);
    expect(result.input.pack).toEqual([...retention.input.pack, 'ret-03', 'ret-05']);
  });
});

describe('applyRepairs: only approved, proposed repairs', () => {
  it('rejects a selection the analysis did not propose', () => {
    const cases = [
      { requirementId: 'r3', passageId: 'refund-06' }, // a real source passage, never proposed
      { requirementId: 'r4', passageId: 'refund-04' }, // right passage, wrong requirement
      { requirementId: 'r1', passageId: 'refund-04' },
      { requirementId: 'r99', passageId: 'refund-04' },
      { requirementId: 'r3', passageId: 'does-not-exist' },
    ];
    for (const selection of cases) {
      const result = applyRepairs(refund.input, refund.fixtureOutput, [selection]);
      expect(result.ok, JSON.stringify(selection)).toBe(false);
      if (!result.ok) expect(result.code).toBe('repair_not_proposed');
    }
  });

  it('rejects the same selection twice', () => {
    const one = { requirementId: 'r3', passageId: 'refund-04' };
    const result = applyRepairs(refund.input, refund.fixtureOutput, [one, one]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('duplicate_repair_selection');
  });

  it('applies nothing at all when any one selection is bad', () => {
    const result = applyRepairs(refund.input, refund.fixtureOutput, [
      { requirementId: 'r3', passageId: 'refund-04' },
      { requirementId: 'r3', passageId: 'refund-06' },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('every example', () => {
  it.each(examples.map((e) => [e.slug, e] as const))('%s: applying all repairs gives a valid pack of original passages', (_slug, example) => {
    const result = applied(example.input, example.fixtureOutput);
    expect(parseAnalysisInput(result.input).ok).toBe(true);
    expect(result.input.pack).toEqual([...example.input.pack, ...example.expected.repairPassageIds]);
    expect(result.input.sources).toEqual(example.input.sources);
    expect(result.input.task).toBe(example.input.task);
  });
});
