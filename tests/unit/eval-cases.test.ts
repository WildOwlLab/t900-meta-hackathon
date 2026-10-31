import { describe, expect, it } from 'vitest';
import { evalCases } from '../../src/eval/cases';
import { syntheticExamples } from '../../src/eval/cases/synthetic';
import { parseAnalysisInput, validateModelOutput } from '../../src/server/validator';
import { deriveFacts } from '../../src/shared/facts';
import { REQUIREMENT_STATUSES, type RequirementStatus } from '../../src/shared/types';

const each = evalCases.map((c) => [c.id, c] as const);

describe('the evaluation dataset', () => {
  it('is the 3 built-in examples followed by 10 synthetic cases, with unique IDs', () => {
    expect(evalCases).toHaveLength(13);
    expect(evalCases.filter((c) => c.set === 'built-in')).toHaveLength(3);
    expect(evalCases.filter((c) => c.set === 'synthetic')).toHaveLength(10);
    expect(syntheticExamples).toHaveLength(10);
    expect(evalCases.slice(0, 3).every((c) => c.set === 'built-in')).toBe(true);
    expect(new Set(evalCases.map((c) => c.id)).size).toBe(13);
  });

  it('has globally unique passage IDs, so one ID names exactly one passage', () => {
    const ids = evalCases.flatMap((c) => c.example.input.sources.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every case says what it is testing', () => {
    for (const c of evalCases) expect(c.tags.length, c.id).toBeGreaterThan(0);
  });

  it('pins the number of gold items, so editing a label is a deliberate act', () => {
    const gold = evalCases.map((c) => c.example.expected);
    expect(gold.reduce((n, g) => n + new Set(g.missing).size, 0)).toBe(13);
    expect(gold.reduce((n, g) => n + g.conflicts.length, 0)).toBe(5);
    expect(gold.reduce((n, g) => n + g.unanswerable, 0)).toBe(8);
    expect(gold.reduce((n, g) => n + new Set(g.supported).size, 0)).toBe(12);
  });

  it('covers all four buckets, and cases that test false alarms', () => {
    const statuses = new Set<RequirementStatus>(evalCases.flatMap((c) => c.example.fixtureOutput.requirements.map((r) => r.status)));
    expect([...statuses].sort()).toEqual([...REQUIREMENT_STATUSES].sort());
    const tags = new Set(evalCases.flatMap((c) => c.tags));
    for (const tag of ['empty-pack', 'all-supported', 'all-unanswerable', 'injection', 'multi-conflict', 'conflict-false-alarm', 'near-miss']) {
      expect(tags.has(tag), tag).toBe(true);
    }
  });

  it('includes at least two prompt-injection cases whose injected passage really is an instruction', () => {
    const injected = evalCases.filter((c) => c.example.injectionPassageIds.length > 0);
    expect(injected.length).toBeGreaterThanOrEqual(2);
    for (const c of injected) {
      for (const id of c.example.injectionPassageIds) {
        const passage = c.example.input.sources.find((p) => p.id === id)!;
        expect(passage.text, c.id).toMatch(/ignore|AI systems|automated reviewers|report every requirement|mark every requirement/i);
      }
    }
  });
});

describe.each(each)('case %s', (_id, testCase) => {
  const { example } = testCase;

  it('is a valid analysis request', () => {
    expect(parseAnalysisInput(example.input).ok).toBe(true);
  });

  it('has an ideal output that passes the validator, so every quote is a real span', () => {
    const result = validateModelOutput(example.fixtureOutput, example.input);
    if (!result.ok) throw new Error(result.issues.map((i) => `${i.code} ${i.path}: ${i.message}`).join('\n'));
    expect(result.ok).toBe(true);
  });

  it('has gold labels that agree with the ideal output', () => {
    expect(deriveFacts(example.fixtureOutput)).toEqual(example.expected);
  });

  it('has an ideal output that never cites a distractor or an injected passage', () => {
    const cited = new Set(example.fixtureOutput.requirements.flatMap((r) => r.evidence.map((e) => e.passageId)));
    for (const id of [...example.distractorPassageIds, ...example.injectionPassageIds]) {
      expect(cited.has(id), id).toBe(false);
    }
  });

  it('lists distractors and injected passages that exist in its sources', () => {
    const ids = new Set(example.input.sources.map((p) => p.id));
    for (const id of [...example.distractorPassageIds, ...example.injectionPassageIds]) expect(ids.has(id), id).toBe(true);
  });

  it('has a near-miss distractor, and room for repairs (the pack is a strict subset of the sources)', () => {
    expect(example.distractorPassageIds.length).toBeGreaterThanOrEqual(1);
    expect(example.input.pack.length).toBeLessThan(example.input.sources.length);
  });

  it('puts every gold missing-evidence passage outside the pack and every gold supported passage inside it', () => {
    const pack = new Set(example.input.pack);
    for (const id of example.expected.missing) expect(pack.has(id), id).toBe(false);
    for (const id of example.expected.supported) expect(pack.has(id), id).toBe(true);
  });

  it('is marked synthetic', () => {
    expect(example.synthetic).toBe(true);
  });
});

describe('specific design properties of the new cases', () => {
  const byId = (id: string) => evalCases.find((c) => c.id === id)!.example;

  it('empty-pack starts with nothing in the pack', () => {
    expect(byId('empty-pack').input.pack).toEqual([]);
  });

  it('all-supported expects no missing evidence, conflict or unanswerable question', () => {
    expect(byId('all-supported').expected).toMatchObject({ missing: [], conflicts: [], unanswerable: 0 });
  });

  it('all-unanswerable expects only unanswerable requirements', () => {
    const e = byId('all-unanswerable').expected;
    expect([e.supported, e.missing, e.conflicts]).toEqual([[], [], []]);
    expect(e.unanswerable).toBe(2);
  });

  it('api-limit-conflict has both sides of its conflict inside the pack, leave-conflict only one', () => {
    const api = byId('api-limit-conflict');
    expect(api.expected.conflicts[0]!.every((id) => api.input.pack.includes(id))).toBe(true);
    const leave = byId('leave-conflict');
    const inPack = leave.expected.conflicts[0]!.filter((id) => leave.input.pack.includes(id));
    expect(inPack).toHaveLength(1);
  });

  it('vendor-questionnaire has two separate conflicts', () => {
    expect(byId('vendor-questionnaire').expected.conflicts).toHaveLength(2);
  });
});
