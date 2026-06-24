import { cosineSimilarity } from '../routing/intent/similarity.js';

interface ResponseEntry {
  vector: number[];
  response: string;
  promptTokens: number;
  completionTokens: number;
  expiresAt: number;
}

// Per-project store: projectId → list of entries (pruned lazily)
const store = new Map<string, ResponseEntry[]>();

export interface ResponseCacheHit {
  response: string;
  promptTokens: number;
  completionTokens: number;
  similarity: number;
}

/**
 * Look up the best matching cached LLM response for a given text vector.
 * Prunes expired entries lazily on each lookup.
 * Returns null on cache miss.
 */
export function lookupResponseCache(
  projectId: string,
  vector: number[],
  threshold: number,
): ResponseCacheHit | null {
  const now = Date.now();
  const entries = store.get(projectId);
  if (!entries || entries.length === 0) return null;

  // Lazy expiry pruning
  const live = entries.filter(e => e.expiresAt > now);
  if (live.length !== entries.length) store.set(projectId, live);
  if (live.length === 0) return null;

  let bestScore = -1;
  let bestEntry: ResponseEntry | null = null;

  for (const entry of live) {
    const score = cosineSimilarity(vector, entry.vector);
    if (score >= threshold && score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  return bestEntry
    ? { response: bestEntry.response, promptTokens: bestEntry.promptTokens, completionTokens: bestEntry.completionTokens, similarity: bestScore }
    : null;
}

/**
 * Store a response in the project's response cache.
 * Prunes expired entries and trims to maxEntries on store.
 */
export function storeResponseCache(
  projectId: string,
  vector: number[],
  response: string,
  promptTokens: number,
  completionTokens: number,
  ttlMs: number,
  maxEntries: number,
): void {
  const now = Date.now();
  const entry: ResponseEntry = { vector, response, promptTokens, completionTokens, expiresAt: now + ttlMs };

  const existing = store.get(projectId) ?? [];
  // Prune expired
  let live = existing.filter(e => e.expiresAt > now);
  live.push(entry);
  // Trim to maxEntries (drop oldest by expiresAt)
  if (live.length > maxEntries) {
    live = live.sort((a, b) => a.expiresAt - b.expiresAt).slice(live.length - maxEntries);
  }
  store.set(projectId, live);
}
