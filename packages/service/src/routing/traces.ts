import type { RoutingTraceLog } from '@localrouter/shared';
import fs from 'node:fs';

export function debugLog(...args: any[]) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  console.log(msg);
  try { fs.appendFileSync('/tmp/localrouter-debug.log', msg + '\n'); } catch (e) { }
}

// Simple in-memory LRU-like store for traces
// Keeps the last 100 traces available for the dashboard to fetch
const MAX_TRACES = 100;
const traceStore = new Map<string, RoutingTraceLog[]>();

export function saveTrace(id: string, trace: RoutingTraceLog[]): void {
  traceStore.set(id, trace);
  if (traceStore.size > MAX_TRACES) {
    // Remove the oldest entry (Map iterates in insertion order)
    const firstKey = traceStore.keys().next().value;
    if (firstKey) traceStore.delete(firstKey);
  }
}

export function getTrace(id: string): RoutingTraceLog[] | undefined {
  return traceStore.get(id);
}
