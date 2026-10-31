/**
 * The custom-input draft: what the user is typing, and how it becomes an analysis request.
 * Pure functions, no React, so the rules can be tested directly.
 *
 * Nothing here is stored anywhere. A draft lives in memory until the page is closed.
 */
import { AnalysisInputSchema, LIMITS, type AnalysisInput } from '../shared/types';

export interface DraftPassage {
  /** Stable React key. Not sent anywhere. */
  key: number;
  id: string;
  title: string;
  text: string;
  inPack: boolean;
}

export interface Draft {
  task: string;
  passages: DraftPassage[];
  nextKey: number;
}

export const emptyDraft = (): Draft => ({ task: '', passages: [], nextKey: 1 });

export function draftFromInput(input: AnalysisInput): Draft {
  const pack = new Set(input.pack);
  return {
    task: input.task,
    passages: input.sources.map((passage, index) => ({
      key: index + 1,
      id: passage.id,
      title: passage.title,
      text: passage.text,
      inPack: pack.has(passage.id),
    })),
    nextKey: input.sources.length + 1,
  };
}

/** The first `p<number>` ID not already used. IDs are assigned for the user and can be edited. */
export function nextPassageId(draft: Draft): string {
  const used = new Set(draft.passages.map((passage) => passage.id.trim()));
  for (let n = 1; ; n += 1) if (!used.has(`p${n}`)) return `p${n}`;
}

export function addPassage(draft: Draft, patch: Partial<Omit<DraftPassage, 'key'>> = {}): Draft {
  const id = patch.id ?? nextPassageId(draft);
  const passage: DraftPassage = {
    key: draft.nextKey,
    id,
    title: patch.title ?? `Passage ${id}`,
    text: patch.text ?? '',
    inPack: patch.inPack ?? false,
  };
  return { ...draft, passages: [...draft.passages, passage], nextKey: draft.nextKey + 1 };
}

export function updatePassage(draft: Draft, key: number, patch: Partial<Omit<DraftPassage, 'key'>>): Draft {
  return { ...draft, passages: draft.passages.map((p) => (p.key === key ? { ...p, ...patch } : p)) };
}

export function removePassage(draft: Draft, key: number): Draft {
  return { ...draft, passages: draft.passages.filter((p) => p.key !== key) };
}

/** Split pasted text into passages on blank lines. Empty blocks are dropped. */
export function splitBulk(text: string): string[] {
  return text
    .split(/\r?\n[ \t]*\r?\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

/** Add one passage per pasted block, with auto-assigned IDs. */
export function addBulk(draft: Draft, text: string, inPack: boolean): Draft {
  return splitBulk(text).reduce((current, block) => addPassage(current, { text: block, inPack }), draft);
}

/** What would be sent for analysis. Outer whitespace is trimmed, everything else is left as typed. */
export function draftToCandidate(draft: Draft) {
  const trimmed = draft.passages.map((p) => ({ id: p.id.trim(), title: p.title.trim(), text: p.text.trim(), inPack: p.inPack }));
  return {
    task: draft.task.trim(),
    sources: trimmed.map(({ id, title, text }) => ({ id, title, text })),
    pack: trimmed.filter((p) => p.inPack).map((p) => p.id),
  };
}

export type DraftCheck = { ok: true; input: AnalysisInput } | { ok: false; messages: string[] };

/** Friendly messages first. The schema then enforces everything else, including the size limits. */
export function checkDraft(draft: Draft): DraftCheck {
  const candidate = draftToCandidate(draft);
  const messages: string[] = [];

  if (candidate.task === '') messages.push('Enter a task.');
  if (candidate.sources.length === 0) messages.push('Add at least one source passage.');
  candidate.sources.forEach((passage, index) => {
    const label = `Passage ${index + 1}`;
    if (passage.id === '') messages.push(`${label}: enter an ID.`);
    if (passage.title === '') messages.push(`${label}: enter a title.`);
    if (passage.text === '') messages.push(`${label}: paste the passage text.`);
  });
  if (messages.length > 0) return { ok: false, messages };

  const parsed = AnalysisInputSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, input: parsed.data };

  const seen = new Set<string>();
  for (const issue of parsed.error.issues) {
    const [root, index, field] = issue.path;
    const message =
      root === 'task'
        ? `Task: ${issue.message}`
        : root === 'sources' && typeof index === 'number'
          ? `Passage ${index + 1}${field === 'id' || field === 'title' || field === 'text' ? ` ${field}` : ''}: ${issue.message}`
          : issue.message;
    if (!seen.has(message)) {
      seen.add(message);
      messages.push(message);
    }
  }
  return { ok: false, messages };
}

/** A stable string for an analysis request. Equal requests give equal keys. */
export function inputKey(input: AnalysisInput): string {
  return JSON.stringify({
    task: input.task,
    sources: input.sources.map(({ id, title, text }) => ({ id, title, text })),
    pack: input.pack,
  });
}

export const DRAFT_LIMITS = {
  task: LIMITS.maxTaskChars,
  passages: LIMITS.maxPassages,
  passageChars: LIMITS.maxPassageChars,
  totalChars: LIMITS.maxTotalPassageChars,
} as const;
