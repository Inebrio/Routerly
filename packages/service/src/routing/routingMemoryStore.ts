/**
 * In-memory store for per-conversation routing decisions.
 * Keyed by `${projectId}:${conversationId}` to avoid cross-project collisions.
 * Entries expire after MAX_AGE_MS.
 */

export interface RoutingMemoryEntry {
  model: string;
  ts: number;
}

const MAX_AGE_MS = 60 * 60 * 1_000; // 1 hour
const MAX_ENTRIES_PER_CONV = 50;

const store = new Map<string, RoutingMemoryEntry[]>();

function cleanup(): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [id, entries] of store) {
    const filtered = entries.filter(e => e.ts >= cutoff);
    if (filtered.length === 0) store.delete(id);
    else store.set(id, filtered);
  }
}

export function addRoutingDecision(projectId: string, conversationId: string, model: string): void {
  cleanup();
  const key = `${projectId}:${conversationId}`;
  const existing = store.get(key) ?? [];
  existing.push({ model, ts: Date.now() });
  if (existing.length > MAX_ENTRIES_PER_CONV) existing.splice(0, existing.length - MAX_ENTRIES_PER_CONV);
  store.set(key, existing);
}

export function getRoutingHistory(projectId: string, conversationId: string, count: number): RoutingMemoryEntry[] {
  const key = `${projectId}:${conversationId}`;
  return (store.get(key) ?? []).slice(-count);
}
