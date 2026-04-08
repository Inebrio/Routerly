import type { IntentClassification, SemanticIntentConfig } from '@routerly/shared';
import { getEmbeddingProvider } from '../../embeddings/index.js';
import { cosineSimilarity } from './similarity.js';
import { getIntentCentroid } from './cache.js';

const DEFAULT_ABSOLUTE_THRESHOLD = 0.60;
const DEFAULT_AMBIGUITY_THRESHOLD = 0.08;

/**
 * Classifies a text against the intent definitions in `config`.
 *
 * Returns an `IntentClassification` describing the top intent, scores,
 * margin, and a `status` of 'confident', 'ambiguous', or 'unknown'.
 *
 * Also returns the total `inputTokens` used by the embedding API call for
 * the request text, so callers can track usage accurately.
 */
export interface ClassifyIntentResult {
  classification: IntentClassification;
  /** Input tokens consumed by embedding the request text (0 for providers that don't report it). */
  inputTokens: number;
}

export async function classifyIntent(
  text: string,
  config: SemanticIntentConfig,
): Promise<ClassifyIntentResult> {
  const absoluteThreshold = config.absolute_threshold ?? DEFAULT_ABSOLUTE_THRESHOLD;
  const ambiguityThreshold = config.ambiguity_threshold ?? DEFAULT_AMBIGUITY_THRESHOLD;
  const intentNames = Object.keys(config.intents);

  const unknownResult: ClassifyIntentResult = {
    classification: {
      topIntent: null,
      topScore: 0,
      secondIntent: null,
      secondScore: 0,
      margin: 0,
      status: 'unknown',
    },
    inputTokens: 0,
  };

  if (intentNames.length === 0) return unknownResult;

  const provider = getEmbeddingProvider(
    config.embedding_provider,
    config.embedding_endpoint,
    config.embedding_api_key,
  );

  // Embed the request text and all intent centroids in parallel.
  // Only the request embedding reports token usage (centroids are cached).
  const [requestEmbedResult, ...centroids] = await Promise.all([
    provider.embed([text], config.embedding_model),
    ...intentNames.map(name =>
      getIntentCentroid(name, config.intents[name]!, provider, config.embedding_model),
    ),
  ]);

  const requestVec = requestEmbedResult.embeddings[0];
  if (requestVec === undefined || requestVec.length === 0) return unknownResult;

  // Score each intent against the request embedding.
  const scores = intentNames.map((name, i) => ({
    name,
    score: cosineSimilarity(requestVec, centroids[i] ?? []),
  }));

  // Sort descending by score.
  scores.sort((a, b) => b.score - a.score);

  const top = scores[0];
  const second = scores[1] ?? null;

  if (top === undefined) return unknownResult;

  const topScore = top.score;
  const secondScore = second?.score ?? 0;
  const margin = topScore - secondScore;

  let status: IntentClassification['status'];
  if (topScore < absoluteThreshold) {
    status = 'unknown';
  } else if (margin < ambiguityThreshold) {
    status = 'ambiguous';
  } else {
    status = 'confident';
  }

  return {
    classification: {
      topIntent: top.name,
      topScore,
      secondIntent: second?.name ?? null,
      secondScore,
      margin,
      status,
    },
    inputTokens: requestEmbedResult.inputTokens,
  };
}
