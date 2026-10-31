import type { PreviewResponse } from '../../shared/api';
import type { Load } from '../load';
import { ErrorCard } from './ErrorCard';

interface Props {
  preview: Load<PreviewResponse>;
  busy: boolean;
  /** When set, Approve is disabled and this says why. The preview itself is still shown. */
  blockedReason: string | null;
  onApprove: () => void;
}

export function PreviewCard({ preview, busy, blockedReason, onApprove }: Props) {
  if (preview.status === 'loading' || preview.status === 'idle') {
    return <p className="note">Preparing the outbound text…</p>;
  }
  if (preview.status === 'error') return <ErrorCard error={preview.error} title="Could not prepare the preview" />;

  const p = preview.value;
  return (
    <section className="card" data-testid="preview-card" aria-labelledby="preview-heading">
      <h2 id="preview-heading">Outbound text preview</h2>
      {p.sentToProvider ? (
        <p className="warn">
          Approving sends exactly the text below to <code>{p.destination}</code> using model <code>{p.model}</code>.
        </p>
      ) : (
        <p>Fixture mode: nothing is sent anywhere. This is the request that live mode would send.</p>
      )}
      <dl>
        <dt>Mode</dt>
        <dd>{p.mode}</dd>
        <dt>Sent to a provider</dt>
        <dd>{p.sentToProvider ? 'Yes, once you approve' : 'No'}</dd>
        <dt>Response format</dt>
        <dd>{p.responseFormat}</dd>
        <dt>{p.hashAlgorithm} of the text below</dt>
        <dd>
          <code data-testid="preview-hash">{p.hash}</code>
        </dd>
      </dl>
      <pre data-testid="preview-text" tabIndex={0} aria-label="Exact outbound text">
        {p.text}
      </pre>
      <button type="button" className="primary" onClick={onApprove} disabled={busy || blockedReason !== null}>
        {busy ? 'Analyzing…' : 'Approve & Analyze'}
      </button>
      {blockedReason && (
        <p className="note" data-testid="approve-blocked">
          {blockedReason}
        </p>
      )}
    </section>
  );
}
