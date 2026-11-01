import { describe, expect, it } from 'vitest';
import { compareText, deriveFacts } from '../../src/shared/facts';
import type { ModelOutput } from '../../src/shared/types';

describe('compareText', () => {
  it('orders by code unit, the same on every machine', () => {
    expect(compareText('a', 'b')).toBe(-1);
    expect(compareText('b', 'a')).toBe(1);
    expect(compareText('a', 'a')).toBe(0);
    expect(['b-1', 'B-1', 'a-1', 'A-1', 'a-10', 'a-2'].sort(compareText)).toEqual(['A-1', 'B-1', 'a-1', 'a-10', 'a-2', 'b-1']);
  });

  it('does not follow the machine locale, which orders lower case before upper case', () => {
    // localeCompare puts "b" before "B" in most locales. A code-unit order puts "B" first. This pins the difference.
    expect(compareText('B', 'b')).toBe(-1);
    expect(['b', 'B'].sort(compareText)).toEqual(['B', 'b']);
  });
});

describe('deriveFacts conflict order', () => {
  const conflict = (id: string, ids: [string, string]) => ({
    id,
    text: 'Requirement.',
    status: 'conflicting' as const,
    evidence: ids.map((passageId) => ({ passageId, quote: 'Some quoted words' })),
    rationale: 'They disagree.',
  });

  it('sorts conflicts by code unit, whatever order the model gave them in', () => {
    const output: ModelOutput = {
      requirements: [conflict('r1', ['u-03', 'u-04']), conflict('r2', ['B-1', 'B-2']), conflict('r3', ['b-1', 'b-2']), conflict('r4', ['u-01', 'u-02'])],
      repairs: [],
    };
    expect(deriveFacts(output).conflicts).toEqual([
      ['B-1', 'B-2'],
      ['b-1', 'b-2'],
      ['u-01', 'u-02'],
      ['u-03', 'u-04'],
    ]);
  });
});
