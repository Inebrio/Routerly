/**
 * In-memory store for per-conversation routing decisions.
 * Keyed by `${routerId}:${conversationId}` to avoid cross-router collisions.
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

export function addRoutingDecision(routerId: string, conversationId: string, model: string): void {
  cleanup();
  const key = `${routerId}:${conversationId}`;
  const existing = store.get(key) ?? [];
  existing.push({ model, ts: Date.now() });
  if (existing.length > MAX_ENTRIES_PER_CONV) existing.splice(0, existing.length - MAX_ENTRIES_PER_CONV);
  store.set(key, existing);
}

export function getRoutingHistory(routerId: string, conversationId: string, count: number): RoutingMemoryEntry[] {
  const key = `${routerId}:${conversationId}`;
  return (store.get(key) ?? []).slice(-count);
}
