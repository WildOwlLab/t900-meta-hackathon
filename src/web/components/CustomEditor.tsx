import { useState, type ReactNode } from 'react';
import { examples } from '../../examples';
import {
  DRAFT_LIMITS,
  addBulk,
  addPassage,
  draftFromInput,
  removePassage,
  updatePassage,
  type Draft,
  type DraftCheck,
} from '../draft';

interface Props {
  draft: Draft;
  check: DraftCheck;
  onChange: (draft: Draft) => void;
}

/**
 * A label tied to its control with htmlFor and id, so the control's accessible name is just the label
 * text and never includes what the user has typed into it.
 */
function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

export function CustomEditor({ draft, check, onChange }: Props) {
  const [bulk, setBulk] = useState('');
  const [bulkInPack, setBulkInPack] = useState(false);
  const [startFrom, setStartFrom] = useState(examples[0]!.slug);

  const packCount = draft.passages.filter((passage) => passage.inPack).length;

  return (
    <section id="panel-custom" role="tabpanel" aria-labelledby="tab-custom" data-testid="custom-editor">
      <h2>Custom input</h2>
      <p className="note">
        Paste your own task and source passages, assign each an ID, and tick the ones that are already in the context
        pack. Nothing is stored: the draft is lost when you close the page. Outer whitespace is trimmed. Limits:{' '}
        {DRAFT_LIMITS.task} characters for the task, {DRAFT_LIMITS.passages} passages, {DRAFT_LIMITS.passageChars} characters
        each, {DRAFT_LIMITS.totalChars} in total.
      </p>

      <div className="inline">
        <label htmlFor="custom-start-from">Start from an example</label>
        <select id="custom-start-from" value={startFrom} onChange={(event) => setStartFrom(event.target.value)} data-testid="custom-start-from">
          {examples.map((example) => (
            <option key={example.slug} value={example.slug}>
              {example.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="custom-load-example"
          onClick={() => {
            const example = examples.find((candidate) => candidate.slug === startFrom);
            if (example) onChange(draftFromInput(example.input));
          }}
        >
          Load into editor
        </button>
      </div>

      <Field id="custom-task" label="Task">
        <textarea
          id="custom-task"
          rows={3}
          value={draft.task}
          data-testid="custom-task"
          onChange={(event) => onChange({ ...draft, task: event.target.value })}
        />
        <span className="note">
          {draft.task.length} / {DRAFT_LIMITS.task}
        </span>
      </Field>

      <h3>Source passages ({draft.passages.length})</h3>
      {draft.passages.map((passage, index) => {
        const base = `passage-${passage.key}`;
        return (
          <fieldset key={passage.key} data-testid="custom-passage" className="passage-editor">
            <legend>Passage {index + 1}</legend>
            <Field id={`${base}-id`} label="ID">
              <input
                id={`${base}-id`}
                value={passage.id}
                onChange={(event) => onChange(updatePassage(draft, passage.key, { id: event.target.value }))}
              />
            </Field>
            <Field id={`${base}-title`} label="Title">
              <input
                id={`${base}-title`}
                value={passage.title}
                onChange={(event) => onChange(updatePassage(draft, passage.key, { title: event.target.value }))}
              />
            </Field>
            <Field id={`${base}-text`} label="Text">
              <textarea
                id={`${base}-text`}
                rows={4}
                value={passage.text}
                onChange={(event) => onChange(updatePassage(draft, passage.key, { text: event.target.value }))}
              />
            </Field>
            <div className="inline">
              <input
                id={`${base}-pack`}
                type="checkbox"
                checked={passage.inPack}
                onChange={(event) => onChange(updatePassage(draft, passage.key, { inPack: event.target.checked }))}
              />
              <label htmlFor={`${base}-pack`}>In the context pack</label>
              <button type="button" aria-label={`Remove passage ${index + 1}`} onClick={() => onChange(removePassage(draft, passage.key))}>
                Remove
              </button>
            </div>
          </fieldset>
        );
      })}

      <div className="inline">
        <button type="button" data-testid="custom-add-passage" onClick={() => onChange(addPassage(draft))}>
          Add passage
        </button>
      </div>

      <Field id="custom-bulk" label="Paste several passages at once">
        <textarea
          id="custom-bulk"
          rows={4}
          value={bulk}
          placeholder="Separate passages with a blank line. IDs p1, p2, ... are assigned for you."
          data-testid="custom-bulk"
          onChange={(event) => setBulk(event.target.value)}
        />
      </Field>
      <div className="inline">
        <input id="custom-bulk-in-pack" type="checkbox" checked={bulkInPack} onChange={(event) => setBulkInPack(event.target.checked)} />
        <label htmlFor="custom-bulk-in-pack">Put pasted passages in the pack</label>
        <button
          type="button"
          data-testid="custom-bulk-add"
          disabled={bulk.trim() === ''}
          onClick={() => {
            onChange(addBulk(draft, bulk, bulkInPack));
            setBulk('');
          }}
        >
          Add pasted passages
        </button>
      </div>

      {check.ok ? (
        <p className="note valid" data-testid="custom-valid">
          Input is valid: {draft.passages.length} passage{draft.passages.length === 1 ? '' : 's'}, {packCount} in the pack.
        </p>
      ) : (
        <div className="card" data-testid="custom-issues">
          <p>
            <strong>Fix these before you can continue:</strong>
          </p>
          <ul>
            {check.messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
