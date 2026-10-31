import { describe, expect, it } from 'vitest';
import { examples } from '../../src/examples';
import { LIMITS } from '../../src/shared/types';
import {
  addBulk,
  addPassage,
  checkDraft,
  draftFromInput,
  draftToCandidate,
  emptyDraft,
  inputKey,
  nextPassageId,
  removePassage,
  splitBulk,
  updatePassage,
} from '../../src/web/draft';

const filled = () => {
  let draft = { ...emptyDraft(), task: 'What is the limit?' };
  draft = addPassage(draft, { text: 'The limit is 5.', inPack: true });
  draft = addPassage(draft, { text: 'Limits reset daily.' });
  return draft;
};

const messagesOf = (draft: ReturnType<typeof emptyDraft>) => {
  const check = checkDraft(draft);
  return check.ok ? [] : check.messages;
};

describe('assigning passage IDs', () => {
  it('assigns p1, p2, ... in order', () => {
    expect(filled().passages.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('reuses the lowest free number and never repeats a used ID', () => {
    let draft = filled();
    draft = updatePassage(draft, draft.passages[0]!.key, { id: 'custom' });
    expect(nextPassageId(draft)).toBe('p1');
    draft = addPassage(draft);
    expect(draft.passages.map((p) => p.id)).toEqual(['custom', 'p2', 'p1']);
    expect(new Set(draft.passages.map((p) => p.id)).size).toBe(3);
  });

  it('ignores surrounding spaces when looking for a free ID', () => {
    const draft = addPassage(emptyDraft(), { id: '  p1  ' });
    expect(nextPassageId(draft)).toBe('p2');
  });

  it('gives each passage a unique key even after removals', () => {
    let draft = filled();
    draft = removePassage(draft, draft.passages[0]!.key);
    draft = addPassage(draft);
    expect(new Set(draft.passages.map((p) => p.key)).size).toBe(draft.passages.length);
  });
});

describe('pasting several passages at once', () => {
  it('splits on blank lines, trims, and drops empty blocks', () => {
    expect(splitBulk('one\n\ntwo\n  \n\n\nthree  \n')).toEqual(['one', 'two', 'three']);
    expect(splitBulk('')).toEqual([]);
    expect(splitBulk('   \n\n  ')).toEqual([]);
  });

  it('keeps single line breaks inside a passage', () => {
    expect(splitBulk('line one\nline two\n\nsecond')).toEqual(['line one\nline two', 'second']);
  });

  it('handles Windows line endings', () => {
    expect(splitBulk('a\r\n\r\nb\r\n \r\nc')).toEqual(['a', 'b', 'c']);
  });

  it('adds one passage per block with assigned IDs, continuing from what exists', () => {
    const draft = addBulk(filled(), 'third\n\nfourth', true);
    expect(draft.passages.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(draft.passages.slice(2).every((p) => p.inPack)).toBe(true);
    expect(draft.passages[2]!.text).toBe('third');
  });

  it('adds nothing for blank input', () => {
    expect(addBulk(filled(), '  \n\n ', false).passages).toHaveLength(2);
  });
});

describe('turning a draft into a request', () => {
  it('trims outer whitespace only, and derives the pack from the ticked passages in order', () => {
    let draft = { ...emptyDraft(), task: '  Task text  ' };
    draft = addPassage(draft, { id: ' a ', title: ' T1 ', text: '\n  Inner  spaces stay.  \n', inPack: true });
    draft = addPassage(draft, { id: 'b', title: 'T2', text: 'Second', inPack: false });
    draft = addPassage(draft, { id: 'c', title: 'T3', text: 'Third', inPack: true });
    expect(draftToCandidate(draft)).toEqual({
      task: 'Task text',
      sources: [
        { id: 'a', title: 'T1', text: 'Inner  spaces stay.' },
        { id: 'b', title: 'T2', text: 'Second' },
        { id: 'c', title: 'T3', text: 'Third' },
      ],
      pack: ['a', 'c'],
    });
  });

  it('accepts a complete draft, including an empty pack', () => {
    const check = checkDraft(filled());
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.input.pack).toEqual(['p1']);
    expect(checkDraft(updatePassage(filled(), 1, { inPack: false })).ok).toBe(true);
  });

  it.each(examples.map((e) => [e.slug, e] as const))('%s: an example loaded into the editor round-trips to the identical request', (_slug, example) => {
    const check = checkDraft(draftFromInput(example.input));
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.input).toEqual(example.input);
      expect(inputKey(check.input)).toBe(inputKey(example.input));
    }
  });
});

describe('checking a draft', () => {
  it('asks for the missing basics in plain words', () => {
    expect(messagesOf(emptyDraft())).toEqual(['Enter a task.', 'Add at least one source passage.']);
    expect(messagesOf({ ...emptyDraft(), task: '   ' })).toContain('Enter a task.');
  });

  it('names the passage and the missing field', () => {
    let draft = { ...emptyDraft(), task: 'Task' };
    draft = addPassage(draft, { id: '', title: '', text: '' });
    draft = addPassage(draft, { id: 'ok', title: 'Fine', text: '   ' });
    expect(messagesOf(draft)).toEqual([
      'Passage 1: enter an ID.',
      'Passage 1: enter a title.',
      'Passage 1: paste the passage text.',
      'Passage 2: paste the passage text.',
    ]);
  });

  it('reports a duplicate ID against the second passage, with the ID', () => {
    const draft = updatePassage(filled(), 2, { id: 'p1' });
    const messages = messagesOf(draft);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe('Passage 2 id: Duplicate source passage ID "p1".');
  });

  it('rejects IDs that are not allowed, saying so', () => {
    for (const id of ['has space', 'bad"quote', '-leading']) {
      const messages = messagesOf(updatePassage(filled(), 1, { id }));
      expect(messages[0], id).toMatch(/^Passage 1 id: /);
    }
  });

  it('enforces the size limits and says which part is too long', () => {
    expect(messagesOf({ ...filled(), task: 'x'.repeat(LIMITS.maxTaskChars + 1) })[0]).toMatch(/^Task: /);
    const long = updatePassage(filled(), 1, { text: 'x'.repeat(LIMITS.maxPassageChars + 1) });
    expect(messagesOf(long)[0]).toMatch(/^Passage 1 text: /);

    let many = { ...emptyDraft(), task: 'Task' };
    for (let i = 0; i < LIMITS.maxPassages + 1; i += 1) many = addPassage(many, { text: 'x' });
    expect(messagesOf(many).length).toBeGreaterThan(0);

    let bulky = { ...emptyDraft(), task: 'Task' };
    const count = Math.ceil(LIMITS.maxTotalPassageChars / LIMITS.maxPassageChars) + 1;
    for (let i = 0; i < count; i += 1) bulky = addPassage(bulky, { text: 'x'.repeat(LIMITS.maxPassageChars) });
    expect(messagesOf(bulky).join(' ')).toContain('Sources total');
  });

  it('does not repeat the same message', () => {
    const draft = updatePassage(updatePassage(filled(), 1, { id: 'bad id' }), 2, { id: 'bad id' });
    const messages = messagesOf(draft);
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe('editing helpers do not mutate their input', () => {
  it('update and remove return new drafts', () => {
    const draft = filled();
    const snapshot = structuredClone(draft);
    updatePassage(draft, draft.passages[0]!.key, { text: 'changed' });
    removePassage(draft, draft.passages[0]!.key);
    addBulk(draft, 'x', true);
    expect(draft).toEqual(snapshot);
  });
});

describe('inputKey', () => {
  it('is equal for equal requests and different when anything changes', () => {
    const a = examples[0]!.input;
    expect(inputKey(a)).toBe(inputKey(structuredClone(a)));
    expect(inputKey({ ...a, task: a.task + ' ' })).not.toBe(inputKey(a));
    expect(inputKey({ ...a, pack: a.pack.slice(1) })).not.toBe(inputKey(a));
    expect(inputKey({ ...a, sources: [...a.sources].reverse() })).not.toBe(inputKey(a));
  });

  it('distinguishes every built-in example', () => {
    expect(new Set(examples.map((e) => inputKey(e.input))).size).toBe(examples.length);
  });
});
