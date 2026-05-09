import { cosineSimilarity } from '../routing/intent/similarity.js';

interface CacheEntry {
  vector: number[];
  modelId: string;
  expiresAt: number;
}

// Per-project store: projectId → list of entries (append-only, pruned lazily)
const store = new Map<string, CacheEntry[]>();

export interface CacheHit {
  modelId: string;
  similarity: number;
}

/**
 * Look up the best matching cached response for a given embedding vector.
 * Prunes expired entries lazily on each lookup.
 * If `extendTtlMs` is provided and a hit is found, the entry's expiry is reset.
 * Returns null on cache miss.
 */
export function lookupCache(
  projectId: string,
  vector: number[],
  threshold: number,
  extendTtlMs?: number,
): CacheHit | null {
  const now = Date.now();
  const entries = store.get(projectId);
  if (!entries || entries.length === 0) return null;

  // Lazy expiry pruning
  const live = entries.filter(e => e.expiresAt > now);
  if (live.length !== entries.length) store.set(projectId, live);
  if (live.length === 0) return null;

  let bestScore = -1;
  let bestEntry: CacheEntry | null = null;

  for (const entry of live) {
    const score = cosineSimilarity(vector, entry.vector);
    if (score >= threshold && score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  if (bestEntry && extendTtlMs !== undefined) {
    bestEntry.expiresAt = Date.now() + extendTtlMs;
  }

  return bestEntry ? { modelId: bestEntry.modelId, similarity: bestScore } : null;
}

/**
 * Store a (vector, modelId) pair in the project's cache with the given TTL.
 */
export function storeCache(
  projectId: string,
  vector: number[],
  modelId: string,
  ttlMs: number,
): void {
  const entry: CacheEntry = { vector, modelId, expiresAt: Date.now() + ttlMs };
  const existing = store.get(projectId);
  if (existing) {
    existing.push(entry);
  } else {
    store.set(projectId, [entry]);
  }
}
