/**
 * In-memory trace store per le richieste di routing.
 * Ogni entry viene eliminata dopo MAX_AGE_MS.
 */

export interface TraceEntry {
  policy: string;
  message: string;
  details: Record<string, unknown>;
}

const MAX_AGE_MS = 5 * 60 * 1_000; // 5 minuti

interface TraceRecord {
  trace: TraceEntry[];
  ts: number;
}

const store = new Map<string, TraceRecord>();

function cleanup(): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [id, rec] of store) {
    if (rec.ts < cutoff) store.delete(id);
  }
}

export function setTrace(id: string, trace: TraceEntry[]): void {
  cleanup();
  store.set(id, { trace, ts: Date.now() });
}

export function getTrace(id: string): TraceEntry[] | null {
  const rec = store.get(id);
  return rec ? rec.trace : null;
}
