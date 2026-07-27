/**
 * In-memory trace store per le richieste di routing.
 * Ogni entry viene eliminata dopo MAX_AGE_MS.
 *
 * panel mapping:
 *   'router-request'  → Router Request panel  (intake + policy configs)
 *   'router-response' → Router Response panel (policy results + final score)
 *   'request'         → Request panel          (payload adattato per ogni modello)
 *   'response'        → Response panel         (risposta / errore di ogni modello)
 */

export type TracePanel = 'router-request' | 'router-response' | 'request' | 'response';

export interface TraceEntry {
  panel: TracePanel;
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

export function appendTrace(id: string, entries: TraceEntry[]): void {
  const rec = store.get(id);
  if (!rec) return;
  rec.trace.push(...entries);
}

export function getTrace(id: string): TraceEntry[] | null {
  const rec = store.get(id);
  return rec ? rec.trace : null;
}
