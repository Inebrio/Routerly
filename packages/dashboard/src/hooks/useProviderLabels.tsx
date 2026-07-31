import { useEffect, useState } from 'react';
import { getProviderDescriptors, type ProviderDescriptor } from '../api';

// Module-level cache so every page shares a single descriptors fetch.
let cache: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;

async function loadLabels(): Promise<Record<string, string>> {
  if (cache) return cache;
  if (!inflight) {
    // Promise.resolve().then wraps the call so a synchronous throw (e.g. an unmocked
    // getProviderDescriptors in a test) becomes a caught rejection, never an unhandled one.
    inflight = Promise.resolve()
      .then(() => getProviderDescriptors())
      .then((ds: ProviderDescriptor[]) => {
        cache = Object.fromEntries(ds.map((d) => [d.id, d.label]));
        return cache;
      })
      .catch(() => ({}) as Record<string, string>);
  }
  return inflight;
}

/**
 * Returns `labelFor(providerId)` mapping a raw provider id to its human display
 * label (e.g. 'anthropic' -> 'Anthropic'), falling back to the id until loaded
 * or when unknown. Source of truth is the service provider descriptors.
 */
export function useProviderLabels(): (id: string) => string {
  const [labels, setLabels] = useState<Record<string, string>>(cache ?? {});
  useEffect(() => {
    let alive = true;
    void loadLabels().then((l) => { if (alive) setLabels(l); });
    return () => { alive = false; };
  }, []);
  return (id: string) => labels[id] ?? id;
}
