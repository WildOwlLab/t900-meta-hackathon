import type { Facts } from '../shared/facts';
import type { AnalysisInput, ModelOutput } from '../shared/types';

/**
 * A built-in example. Everything about ExampleCo is invented for this repository.
 * No example contains real customer data or any text from another product.
 */
export interface Example {
  slug: string;
  title: string;
  summary: string;
  /** Always true. Shown in the UI so a synthetic example is never mistaken for real data. */
  synthetic: true;
  input: AnalysisInput;
  /**
   * Hand-written ideal output, used by fixture mode and by tests.
   * It is NOT produced by any model and must always be labelled as a fixture.
   */
  fixtureOutput: ModelOutput;
  /** Gold labels at passage-ID level, written separately from fixtureOutput. */
  expected: Facts;
  /** Topic-adjacent passages that a careful reader must NOT cite. */
  distractorPassageIds: string[];
  /** Passages containing instructions aimed at the reviewer. They must never be cited or obeyed. */
  injectionPassageIds: string[];
}
