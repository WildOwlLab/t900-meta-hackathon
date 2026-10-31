/**
 * Token counts here are ESTIMATES: ceil(characters / 4), a common rule of thumb for English text.
 * They are not the target model's tokenizer. For live runs the provider's own usage figures are
 * recorded separately, and these estimates are only used to compare packs with each other.
 */
export const TOKEN_ESTIMATE_NOTE = 'Tokens are estimated as ceil(characters / 4). This is a rough heuristic, not the provider tokenizer.';

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
