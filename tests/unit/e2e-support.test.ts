/**
 * The browser tests type a custom input into the editor and rely on the stub provider returning a canned
 * answer for it. These checks keep that data honest: the canned answer has to pass the real validator.
 */
import { describe, expect, it } from 'vitest';
import { parseAnalysisInput, validateModelOutput } from '../../src/server/validator';
import { REQUIREMENT_STATUSES } from '../../src/shared/types';
import { addBulk, checkDraft, emptyDraft, updatePassage } from '../../src/web/draft';
import { customBlocks, customInput, customOutput, customPackNumbers, customTask } from '../e2e/support/custom-case';

describe('the e2e custom case', () => {
  it('is a valid request, and its canned answer passes the validator', () => {
    expect(parseAnalysisInput(customInput).ok).toBe(true);
    const result = validateModelOutput(customOutput, customInput);
    if (!result.ok) throw new Error(result.issues.map((i) => `${i.code} ${i.path}: ${i.message}`).join('\n'));
    expect(result.ok).toBe(true);
  });

  it('exercises all four buckets and a repair', () => {
    expect([...new Set(customOutput.requirements.map((r) => r.status))].sort()).toEqual([...REQUIREMENT_STATUSES].sort());
    expect(customOutput.repairs).toHaveLength(1);
  });

  it('is exactly what the editor produces from the pasted blocks, so the spec and the stub agree', () => {
    let draft = { ...emptyDraft(), task: customTask };
    draft = addBulk(draft, customBlocks.join('\n\n'), false);
    for (const n of customPackNumbers) draft = updatePassage(draft, draft.passages[n - 1]!.key, { inPack: true });
    const check = checkDraft(draft);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.input).toEqual(customInput);
  });
});
