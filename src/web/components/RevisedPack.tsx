import type { Example } from '../../examples';
import type { ApplyResponse } from '../../shared/api';

export function RevisedPack({ applied, example }: { applied: ApplyResponse; example: Example }) {
  return (
    <section aria-labelledby="revised-heading" data-testid="revised-pack">
      <h2 id="revised-heading">Revised context pack ({applied.revisedPackSize} passages)</h2>
      <p className="note" data-testid="revised-summary">
        {applied.changed
          ? `Added ${applied.added.length} passage${applied.added.length === 1 ? '' : 's'} to the original ${applied.originalPackSize}. Added text is copied from the sources, not written by a model.`
          : 'No repairs were applied, so the pack is unchanged.'}
      </p>
      <ul className="passages">
        {applied.input.pack.map((id) => {
          const passage = example.input.sources.find((candidate) => candidate.id === id);
          const added = applied.added.find((candidate) => candidate.passageId === id);
          return (
            <li key={id} data-testid="revised-pack-item" data-passage-id={id}>
              <p>
                <code>{id}</code> {passage?.title}{' '}
                {added && (
                  <span className="tag added" data-testid="added-tag">
                    Added
                  </span>
                )}
              </p>
              {added && <blockquote data-testid="added-text">{added.text}</blockquote>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
