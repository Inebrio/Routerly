import type { IntentDefinition } from '@routerly/shared';
import type { EmbeddingProvider } from '../../embeddings/types.js';
import { meanVector } from './similarity.js';

interface CacheEntry {
  centroid: number[];
  expiresAt: number;
}

// Key: `${model}::${intentName}::${stable hash of examples}`
const cache = new Map<string, CacheEntry>();

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashExamples(examples: string[]): string {
  // Simple deterministic hash: sort, join, use length+first-char sum as fingerprint.
  // Not cryptographic — just needs to detect config changes.
  const joined = [...examples].sort().join('|');
  let h = 0;
  for (let i = 0; i < joined.length; i++) {
    h = (Math.imul(31, h) + joined.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function buildKey(model: string, intentName: string, examples: string[]): string {
  return `${model}::${intentName}::${hashExamples(examples)}`;
}

/**
 * Returns the centroid embedding for an intent's examples.
 * Results are cached in-memory for TTL_MS to avoid re-embedding on every request.
 */
export async function getIntentCentroid(
  intentName: string,
  intent: IntentDefinition,
  provider: EmbeddingProvider,
  model: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<number[]> {
  const key = buildKey(model, intentName, intent.examples);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached !== undefined && cached.expiresAt > now) {
    return cached.centroid;
  }

  const { embeddings } = await provider.embed(intent.examples, model);
  const centroid = meanVector(embeddings);
  cache.set(key, { centroid, expiresAt: now + ttlMs });
  return centroid;
}

/** Clears the entire centroid cache (useful in tests). */
export function clearIntentCache(): void {
  cache.clear();
}
