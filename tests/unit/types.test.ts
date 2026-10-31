import { describe, expect, it } from 'vitest';
import { examples } from '../../src/examples';
import { parseAnalysisInput } from '../../src/server/validator';
import { LIMITS, REQUIREMENT_STATUSES } from '../../src/shared/types';

const base = () => ({
  task: 'Answer the question.',
  sources: [
    { id: 'a-1', title: 'First', text: 'Alpha text.' },
    { id: 'a-2', title: 'Second', text: 'Beta text.' },
  ],
  pack: ['a-1'],
});

const codesAndPaths = (raw: unknown) => {
  const result = parseAnalysisInput(raw);
  return result.ok ? [] : result.issues.map((issue) => issue.path);
};

describe('analysis input schema', () => {
  it('accepts a well-formed request, including an empty pack', () => {
    expect(parseAnalysisInput(base()).ok).toBe(true);
    expect(parseAnalysisInput({ ...base(), pack: [] }).ok).toBe(true);
  });

  it('E2: rejects duplicate source passage IDs', () => {
    const input = base();
    input.sources[1]!.id = 'a-1';
    const result = parseAnalysisInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.message).toContain('Duplicate source passage ID "a-1"');
  });

  it('rejects a pack that references an unknown passage or repeats an entry', () => {
    expect(codesAndPaths({ ...base(), pack: ['zz-9'] })).toEqual(['pack[0]']);
    expect(codesAndPaths({ ...base(), pack: ['a-1', 'a-1'] })).toEqual(['pack[1]']);
  });

  it('rejects passage IDs that could break prompt structure or paths', () => {
    for (const id of ['has space', 'quote"id', '../escape', '', '-leading-dash', 'x'.repeat(65)]) {
      const input = base();
      input.sources[0]!.id = id;
      input.pack = [];
      expect(parseAnalysisInput(input).ok, `ID ${JSON.stringify(id)}`).toBe(false);
    }
  });

  it('rejects unknown fields and missing parts', () => {
    expect(parseAnalysisInput({ ...base(), extra: true }).ok).toBe(false);
    expect(parseAnalysisInput({ task: 'x', sources: [], pack: [] }).ok).toBe(false);
    expect(parseAnalysisInput({ ...base(), task: '' }).ok).toBe(false);
    expect(parseAnalysisInput(null).ok).toBe(false);
  });

  it('enforces size limits', () => {
    expect(parseAnalysisInput({ ...base(), task: 'x'.repeat(LIMITS.maxTaskChars + 1) }).ok).toBe(false);

    const longPassage = base();
    longPassage.sources[0]!.text = 'x'.repeat(LIMITS.maxPassageChars + 1);
    expect(parseAnalysisInput(longPassage).ok).toBe(false);

    const many = Array.from({ length: LIMITS.maxPassages + 1 }, (_, i) => ({
      id: `p-${i}`,
      title: 'T',
      text: 'x',
    }));
    expect(parseAnalysisInput({ task: 'x', sources: many, pack: [] }).ok).toBe(false);

    // Every passage is within the per-passage cap, so only the total cap can fail here.
    const count = Math.ceil(LIMITS.maxTotalPassageChars / LIMITS.maxPassageChars) + 1;
    expect(count).toBeLessThanOrEqual(LIMITS.maxPassages);
    const bulky = Array.from({ length: count }, (_, i) => ({
      id: `b-${i}`,
      title: 'T',
      text: 'x'.repeat(LIMITS.maxPassageChars),
    }));
    const total = parseAnalysisInput({ task: 'x', sources: bulky, pack: [] });
    expect(total.ok).toBe(false);
    if (!total.ok) {
      expect(total.issues).toHaveLength(1);
      expect(total.issues[0]!.message).toContain('Sources total');
    }
  });
});

describe('four-bucket contract', () => {
  it('keeps exactly the four agreed statuses', () => {
    expect([...REQUIREMENT_STATUSES]).toEqual(['supported', 'missing_evidence', 'conflicting', 'unanswerable']);
  });

  it('every built-in example is a valid analysis request', () => {
    for (const example of examples) {
      expect(parseAnalysisInput(example.input).ok, example.slug).toBe(true);
    }
  });
});
