import { examples, type Example } from '../../examples';

interface PickerProps {
  slug: string;
  onSelect: (slug: string) => void;
}

export function ExamplePicker({ slug, onSelect }: PickerProps) {
  return (
    <section aria-labelledby="example-heading">
      <h2 id="example-heading">Example</h2>
      <div role="radiogroup" aria-labelledby="example-heading" className="choices">
        {examples.map((example) => (
          <label key={example.slug} className="choice">
            <input
              type="radio"
              name="example"
              value={example.slug}
              data-testid={`example-${example.slug}`}
              checked={slug === example.slug}
              onChange={() => onSelect(example.slug)}
            />
            <span>
              <strong>{example.title}</strong> <span className="tag">Synthetic example</span>
              <br />
              {example.summary}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

export function SourceList({ example }: { example: Example }) {
  const pack = new Set(example.input.pack);
  return (
    <section aria-labelledby="sources-heading" data-testid="sources">
      <h2 id="sources-heading">Task and sources</h2>
      <p>
        <strong>Task:</strong> {example.input.task}
      </p>
      <p className="note">
        {example.input.sources.length} source passages. {example.input.pack.length} are in the context pack.
      </p>
      <ul className="passages">
        {example.input.sources.map((passage) => (
          <li key={passage.id} data-passage-id={passage.id}>
            <p>
              <code>{passage.id}</code> {passage.title}{' '}
              <span className={pack.has(passage.id) ? 'tag in-pack' : 'tag'}>
                {pack.has(passage.id) ? 'In pack' : 'Not in pack'}
              </span>
            </p>
            <blockquote>{passage.text}</blockquote>
          </li>
        ))}
      </ul>
    </section>
  );
}
