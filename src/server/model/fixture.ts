import { isDeepStrictEqual } from 'node:util';
import { examples } from '../../examples';
import { ModelError, type ModelClient } from './client';

/**
 * Serves the hand-written output of a built-in example. No network, no model.
 * It only answers for an input that matches a built-in example exactly. For anything else it
 * refuses, rather than inventing an analysis it has no basis for.
 */
export function createFixtureClient(): ModelClient {
  return {
    mode: 'fixture',
    async complete({ input }) {
      const example = examples.find((candidate) => isDeepStrictEqual(candidate.input, input));
      if (!example) {
        throw new ModelError(
          'fixture_not_available',
          'Fixture mode only has hand-written outputs for the built-in examples. Switch to live mode to analyze other text.',
          false,
        );
      }
      return {
        text: JSON.stringify(example.fixtureOutput),
        model: null,
        responseId: null,
        usage: null,
        latencyMs: 0,
      };
    },
  };
}
