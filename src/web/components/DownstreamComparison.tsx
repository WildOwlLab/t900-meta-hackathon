import { useRef, useState, type ReactNode } from 'react';
import { getDownstreamIllustration } from '../../examples/downstream';
import type { ApplyResponse } from '../../shared/api';
import type { DownstreamCompareResponse, DownstreamPreviewResponse } from '../../shared/downstream';
import { FIXTURE_NOTICE, type AnalysisInput, type Mode } from '../../shared/types';
import { api, toApiError } from '../api';
import type { Load } from '../load';
import { ErrorCard } from './ErrorCard';

const idle = { status: 'idle' } as const;

/** A request's state, tagged with the pack it belongs to. State for any other pack is never shown. */
interface Stamped<T> {
  stamp: string | null;
  load: Load<T>;
}
const unstamped = <T,>(): Stamped<T> => ({ stamp: null, load: idle });

interface Props {
  applied: ApplyResponse;
  input: AnalysisInput;
  /** The mode the analysis ran in. Fixture shows hand-written text. Live asks the model, after approval. */
  mode: Mode;
  /** The built-in example this input is, or null for custom text. */
  slug: string | null;
}

interface ColumnProps {
  testId: string;
  title: string;
  packIds: readonly string[];
  children: ReactNode;
}

function Column({ testId, title, packIds, children }: ColumnProps) {
  return (
    <section className="compare-col" aria-labelledby={`${testId}-heading`} data-testid={testId}>
      <h4 id={`${testId}-heading`}>{title}</h4>
      <p className="note" data-testid={`${testId}-context`}>
        Context: {packIds.length} passage{packIds.length === 1 ? '' : 's'} (
        {packIds.map((id, index) => (
          <span key={id}>
            {index > 0 && ', '}
            <code>{id}</code>
          </span>
        ))}
        )
      </p>
      {children}
    </section>
  );
}

function Notes({ label, items, testId }: { label: string; items: readonly string[]; testId: string }) {
  if (items.length === 0) return null;
  return (
    <div data-testid={testId}>
      <p className="note">
        <strong>{label}</strong>
      </p>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function DownstreamComparison({ applied, input, mode, slug }: Props) {
  const stamp = JSON.stringify([mode, input.task, input.pack, applied.input.pack]);
  const revisedPack = applied.input.pack;

  const [shownFor, setShownFor] = useState<string | null>(null); // fixture: the comparison is open
  const [previewState, setPreview] = useState<Stamped<DownstreamPreviewResponse>>(unstamped);
  const [compareState, setCompare] = useState<Stamped<DownstreamCompareResponse>>(unstamped);
  const latest = useRef(0); // only the newest request may update the screen

  const current = <T,>(held: Stamped<T>): Load<T> => (held.stamp === stamp ? held.load : idle);
  const preview = current(previewState);
  const compare = current(compareState);
  const fixtureOpen = shownFor === stamp;

  async function open() {
    if (mode === 'fixture') {
      setShownFor(stamp);
      return;
    }
    const id = ++latest.current;
    setCompare(unstamped);
    setPreview({ stamp, load: { status: 'loading' } });
    try {
      const value = await api.downstreamPreview(input, revisedPack);
      if (latest.current === id) setPreview({ stamp, load: { status: 'ready', value } });
    } catch (error) {
      if (latest.current === id) setPreview({ stamp, load: { status: 'error', error: toApiError(error) } });
    }
  }

  async function approve() {
    if (preview.status !== 'ready' || compare.status === 'loading') return;
    const id = ++latest.current;
    setCompare({ stamp, load: { status: 'loading' } });
    try {
      const value = await api.downstreamCompare(input, revisedPack, preview.value.hash);
      if (latest.current === id) setCompare({ stamp, load: { status: 'ready', value } });
    } catch (error) {
      if (latest.current === id) setCompare({ stamp, load: { status: 'error', error: toApiError(error) } });
    }
  }

  const busy = preview.status === 'loading' || compare.status === 'loading';

  return (
    <section className="downstream" aria-labelledby="downstream-heading" data-testid="downstream">
      <h3 id="downstream-heading">Downstream Comparison</h3>
      <p className="note">
        Does the repaired pack change what a model writes for the task? Both sides get the same task and the same
        instructions. Only the context differs.
      </p>
      <button type="button" onClick={() => void open()} disabled={busy}>
        Compare Downstream Task
      </button>
      {mode === 'live' && (
        <p className="note">Live mode first shows you the exact text for both requests. Nothing is sent until you approve it.</p>
      )}

      {mode === 'fixture' && fixtureOpen && <FixtureComparison slug={slug} revisedPack={revisedPack} initialPack={input.pack} />}

      {mode === 'live' && preview.status === 'loading' && <p className="note">Preparing the outbound text…</p>}
      {mode === 'live' && preview.status === 'error' && <ErrorCard error={preview.error} title="Could not prepare the comparison" />}
      {mode === 'live' && preview.status === 'ready' && compare.status !== 'ready' && (
        <section className="card" data-testid="downstream-preview" aria-labelledby="downstream-preview-heading">
          <h4 id="downstream-preview-heading">Outbound text preview: downstream comparison</h4>
          <p className="warn">
            Approving sends exactly the text below to <code>{preview.value.destination}</code> using model{' '}
            <code>{preview.value.model}</code>. That is two requests: one with the initial pack and one with the repaired
            pack.
          </p>
          <dl>
            <dt>{preview.value.hashAlgorithm} of the text below</dt>
            <dd>
              <code data-testid="downstream-preview-hash">{preview.value.hash}</code>
            </dd>
          </dl>
          <pre data-testid="downstream-preview-text" tabIndex={0} aria-label="Exact outbound text for the downstream comparison">
            {preview.value.text}
          </pre>
          <button type="button" className="primary" onClick={() => void approve()} disabled={compare.status === 'loading'}>
            {compare.status === 'loading' ? 'Comparing…' : 'Approve & Compare'}
          </button>
        </section>
      )}
      {mode === 'live' && compare.status === 'error' && <ErrorCard error={compare.error} title="Comparison failed" />}
      {mode === 'live' && compare.status === 'ready' && <LiveComparison result={compare.value} />}
    </section>
  );
}

function FixtureComparison({ slug, initialPack, revisedPack }: { slug: string | null; initialPack: string[]; revisedPack: string[] }) {
  const illustration = slug ? getDownstreamIllustration(slug) : undefined;
  if (!illustration) {
    return (
      <p className="note" data-testid="downstream-unavailable">
        There is no hand-written comparison for this input. Switch to Live mode to compare your own text.
      </p>
    );
  }
  const missing = illustration.needs.filter((id) => !revisedPack.includes(id));

  return (
    <div data-testid="downstream-result" data-source="fixture">
      <p className="banner" data-testid="downstream-notice">
        {FIXTURE_NOTICE} No model was called. These two answers were written by hand to show what missing evidence can do
        to a finished answer. They are an illustration, not a measurement.
      </p>
      <div className="compare">
        <Column testId="downstream-initial" title="Initial Pack Response" packIds={initialPack}>
          <div className="answer" data-testid="downstream-initial-answer">
            {illustration.initial.answer}
          </div>
          <Notes label="What goes wrong" items={illustration.initial.problems} testId="downstream-problems" />
        </Column>
        <Column testId="downstream-repaired" title="T900 Repaired Pack Response" packIds={revisedPack}>
          {missing.length === 0 ? (
            <>
              <div className="answer" data-testid="downstream-repaired-answer">
                {illustration.repaired.answer}
              </div>
              <Notes label="Still not settled by the sources" items={illustration.repaired.limits} testId="downstream-limits" />
            </>
          ) : (
            <p className="note" data-testid="downstream-needs-more">
              This hand-written answer was written for a pack that also has {illustration.needs.join(', ')}. Your revised
              pack is missing {missing.join(', ')}. Apply every proposed repair to see it.
            </p>
          )}
        </Column>
      </div>
    </div>
  );
}

function LiveComparison({ result }: { result: DownstreamCompareResponse }) {
  const cut = result.initial.truncated || result.repaired.truncated;
  const details = (answer: DownstreamCompareResponse['initial']) =>
    `Model returned: ${answer.model ?? 'not returned'}, ${answer.latencyMs} ms.${answer.truncated ? ' This answer was cut to fit.' : ''}`;

  return (
    <div data-testid="downstream-result" data-source="live">
      <p className="banner live" data-testid="downstream-notice">
        Live model output. Same task and instructions on both sides, only the context differs. T900 has not checked either
        answer against the sources, so read both yourself.
        {cut ? ' At least one answer was cut to fit.' : ''}
      </p>
      <div className="compare">
        <Column testId="downstream-initial" title="Initial Pack Response" packIds={result.initial.packIds}>
          <div className="answer" data-testid="downstream-initial-answer">
            {result.initial.answer}
          </div>
          <p className="note">{details(result.initial)}</p>
        </Column>
        <Column testId="downstream-repaired" title="T900 Repaired Pack Response" packIds={result.repaired.packIds}>
          <div className="answer" data-testid="downstream-repaired-answer">
            {result.repaired.answer}
          </div>
          <p className="note">{details(result.repaired)}</p>
        </Column>
      </div>
    </div>
  );
}
