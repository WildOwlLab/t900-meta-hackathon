import { examples } from '../examples';
import { FIXTURE_NOTICE } from '../shared/types';

/** Milestone 1 shell: lists the built-in examples. Analysis and approval screens come next. */
export default function App() {
  return (
    <main>
      <header>
        <h1>T900 Evidence Check</h1>
        <p className="banner" role="status" data-mode="fixture">
          <strong>Fixture mode.</strong> {FIXTURE_NOTICE} No model is called.
        </p>
        <p>
          Milestone 1 scaffold: schema, validator, prompt builder and examples. The analysis and approval
          screens are not built yet.
        </p>
      </header>

      <section aria-labelledby="examples-heading">
        <h2 id="examples-heading">Built-in synthetic examples</h2>
        <ul className="examples">
          {examples.map((example) => (
            <li key={example.slug} data-testid="example-card">
              <h3>{example.title}</h3>
              <p>{example.summary}</p>
              <p className="meta">
                <span className="tag">Synthetic example</span> {example.input.sources.length} passages,{' '}
                {example.input.pack.length} in the pack
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
