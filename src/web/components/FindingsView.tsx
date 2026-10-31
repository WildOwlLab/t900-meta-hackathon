import type { Example } from '../../examples';
import type { AnalyzeResponse } from '../../shared/api';
import type { RequirementStatus } from '../../shared/types';

const BUCKETS: readonly { status: RequirementStatus; title: string; blurb: string }[] = [
  { status: 'supported', title: 'Supported', blurb: 'The context pack answers these.' },
  {
    status: 'missing_evidence',
    title: 'Missing Evidence',
    blurb: 'The sources answer these, but the passages are not in the pack.',
  },
  { status: 'conflicting', title: 'Conflicting', blurb: 'Passages disagree. A person has to decide which is right.' },
  { status: 'unanswerable', title: 'Unanswerable', blurb: 'No source answers these.' },
];

interface Props {
  analysis: AnalyzeResponse;
  example: Example;
}

export function FindingsView({ analysis, example }: Props) {
  const pack = new Set(example.input.pack);
  const passage = (id: string) => example.input.sources.find((candidate) => candidate.id === id);

  return (
    <section aria-labelledby="findings-heading" data-testid="findings">
      <h2 id="findings-heading">Findings</h2>

      {analysis.notice && (
        <p className="banner" data-testid="result-notice">
          {analysis.notice}
        </p>
      )}
      <p className="note" data-testid="result-source">
        {analysis.mode === 'fixture' ? (
          <>Source: hand-written fixture. No model was called.</>
        ) : (
          <>
            Source: live model. The provider returned model <code>{analysis.meta.model ?? 'not returned'}</code> in{' '}
            {analysis.meta.latencyMs} ms.
          </>
        )}
      </p>

      {BUCKETS.map(({ status, title, blurb }) => {
        const requirements = analysis.findings[status];
        return (
          <section key={status} data-testid={`bucket-${status}`} aria-labelledby={`bucket-${status}-heading`} className="bucket">
            <h3 id={`bucket-${status}-heading`}>
              {title} ({requirements.length})
            </h3>
            <p className="note">{blurb}</p>
            {requirements.length === 0 ? (
              <p className="empty">None.</p>
            ) : (
              <ul className="requirements">
                {requirements.map((requirement) => (
                  <li key={requirement.id} data-testid="requirement" data-requirement-id={requirement.id}>
                    <p>
                      <strong>{requirement.id}</strong> {requirement.text}
                    </p>
                    <p className="rationale">{requirement.rationale}</p>
                    {requirement.evidence.map((evidence, index) => (
                      <figure key={index}>
                        <blockquote>{evidence.quote}</blockquote>
                        <figcaption>
                          <code>{evidence.passageId}</code> {passage(evidence.passageId)?.title}{' '}
                          <span className={pack.has(evidence.passageId) ? 'tag in-pack' : 'tag'}>
                            {pack.has(evidence.passageId) ? 'In pack' : 'Not in pack'}
                          </span>
                        </figcaption>
                      </figure>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </section>
  );
}
