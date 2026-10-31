import { describe, expect, it } from 'vitest';
import { examples } from '../../src/examples';
import { validateModelOutput } from '../../src/server/validator';
import { deriveFacts } from '../../src/shared/facts';
import { FIXTURE_NOTICE, REQUIREMENT_STATUSES, type RequirementStatus } from '../../src/shared/types';

describe('E1: synthetic examples', () => {
  it('ships at least three, with unique slugs, all marked synthetic', () => {
    expect(examples.length).toBeGreaterThanOrEqual(3);
    expect(new Set(examples.map((e) => e.slug)).size).toBe(examples.length);
    for (const example of examples) expect(example.synthetic).toBe(true);
  });

  it('together cover all four buckets, and one example covers all four on its own', () => {
    const perExample = examples.map((e) => new Set<RequirementStatus>(e.fixtureOutput.requirements.map((r) => r.status)));
    const union = new Set(perExample.flatMap((s) => [...s]));
    expect([...union].sort()).toEqual([...REQUIREMENT_STATUSES].sort());
    expect(perExample.some((s) => s.size === REQUIREMENT_STATUSES.length)).toBe(true);
  });

  it('every example has near-miss distractors that exist in its sources', () => {
    for (const example of examples) {
      const ids = new Set(example.input.sources.map((p) => p.id));
      expect(example.distractorPassageIds.length, example.slug).toBeGreaterThanOrEqual(1);
      for (const id of [...example.distractorPassageIds, ...example.injectionPassageIds]) {
        expect(ids.has(id), `${example.slug}: ${id}`).toBe(true);
      }
    }
  });

  it('at least one example contains a real prompt-injection passage', () => {
    const withInjection = examples.filter((e) => e.injectionPassageIds.length > 0);
    expect(withInjection.length).toBeGreaterThanOrEqual(1);
    for (const example of withInjection) {
      for (const id of example.injectionPassageIds) {
        const passage = example.input.sources.find((p) => p.id === id)!;
        expect(passage.text).toMatch(/ignore all earlier instructions/i);
      }
    }
  });

  it('leaves room for repairs: each pack is a strict subset of its sources', () => {
    for (const example of examples) {
      expect(example.input.pack.length, example.slug).toBeLessThan(example.input.sources.length);
    }
  });
});

describe('E2: stable, unique passage IDs', () => {
  it('are unique within an example and across all examples', () => {
    const all = examples.flatMap((e) => e.input.sources.map((p) => p.id));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('V1: fixtures', () => {
  it.each(examples.map((e) => [e.slug, e] as const))('%s: hand-written fixture passes the validator', (_slug, example) => {
    const result = validateModelOutput(example.fixtureOutput, example.input);
    if (!result.ok) throw new Error(result.issues.map((i) => `${i.code} ${i.path}: ${i.message}`).join('\n'));
    expect(result.ok).toBe(true);
  });

  it.each(examples.map((e) => [e.slug, e] as const))('%s: round-trips through JSON text unchanged', (_slug, example) => {
    const result = validateModelOutput(JSON.stringify(example.fixtureOutput), example.input);
    expect(result.ok && result.value).toEqual(example.fixtureOutput);
  });

  it.each(examples.map((e) => [e.slug, e] as const))('%s: gold labels agree with the fixture', (_slug, example) => {
    expect(deriveFacts(example.fixtureOutput)).toEqual(example.expected);
  });

  it.each(examples.map((e) => [e.slug, e] as const))('%s: fixture never cites a distractor or injection passage', (_slug, example) => {
    const cited = new Set(example.fixtureOutput.requirements.flatMap((r) => r.evidence.map((e) => e.passageId)));
    for (const id of [...example.distractorPassageIds, ...example.injectionPassageIds]) {
      expect(cited.has(id), `${example.slug} cites ${id}`).toBe(false);
    }
  });

  it.each(examples.map((e) => [e.slug, e] as const))('%s: breaking any one quote makes the fixture fail', (_slug, example) => {
    const broken = structuredClone(example.fixtureOutput);
    const target = broken.requirements.find((r) => r.evidence.length > 0)!;
    target.evidence[0]!.quote = 'zzzzzzzzzz not in any passage';
    const result = validateModelOutput(broken, example.input);
    expect(result.ok).toBe(false);
  });

  it('fixtures are labelled as hand-written, not model results', () => {
    expect(FIXTURE_NOTICE).toMatch(/Hand-written fixture/);
    expect(FIXTURE_NOTICE).toMatch(/Not a model result/);
  });
});
