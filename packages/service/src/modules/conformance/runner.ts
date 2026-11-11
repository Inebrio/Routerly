import type { ConformanceCaseResult, ConformanceResult, ModelCapabilities } from '@routerly/shared';
import { CORPUS, type ConformanceCase, type Invoker } from './corpus.js';

const CASE_TIMEOUT_MS = 60_000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms); })]);
  } finally { clearTimeout(t); }
}

/**
 * Run the corpus against one model. A capability is proven by its passing cases;
 * it is reported `false` only when a case for it ran and failed. Any failure makes the model `limited`.
 */
export async function runConformance(
  invoker: Invoker,
  declared: ModelCapabilities | undefined,
  opts: { corpus?: ConformanceCase[]; timeoutMs?: number; now?: () => Date } = {},
): Promise<ConformanceResult> {
  const cases: ConformanceCaseResult[] = [];
  const verified: ConformanceResult['verified'] = {};
  const failedCaps = new Set<string>();
  const passedCaps = new Set<string>();

  for (const c of opts.corpus ?? CORPUS) {
    const t0 = Date.now();
    if (c.requires && !c.requires(declared)) {
      cases.push({ id: c.id, status: 'skip', detail: `capability "${c.capability}" not declared`, durationMs: 0 });
      continue;
    }
    try {
      await withTimeout(c.run(invoker), opts.timeoutMs ?? CASE_TIMEOUT_MS);
      cases.push({ id: c.id, status: 'pass', durationMs: Date.now() - t0 });
      passedCaps.add(c.capability);
    } catch (err) {
      cases.push({ id: c.id, status: 'fail', detail: (err instanceof Error ? err.message : String(err)).slice(0, 300), durationMs: Date.now() - t0 });
      failedCaps.add(c.capability);
    }
  }

  for (const cap of new Set([...passedCaps, ...failedCaps])) {
    if (cap === 'base') continue;
    (verified as Record<string, boolean>)[cap] = !failedCaps.has(cap);
  }
  return {
    verifiedAt: (opts.now?.() ?? new Date()).toISOString(),
    status: cases.some(c => c.status === 'fail') ? 'limited' : 'conformant',
    verified,
    cases,
  };
}
