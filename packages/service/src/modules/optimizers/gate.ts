import type { OptimizerResult } from '@routerly/shared'

export interface SafetyGateOptions {
  /** Reject when estimatedTokensAfter / estimatedTokensBefore falls below this. Default 0.2. */
  floorRatio?: number
}

/**
 * Lossy safety/quality gate. Applied only to lossy-class optimizer results by
 * core.ts. Rejects over-compression (too much dropped) and empty output; passes
 * moderate reductions and no-op results.
 *
 * ponytail: ratio-floor heuristic, upgrade to a judge model only if false-rejects
 * show up.
 */
export function passesSafetyGate(result: OptimizerResult, opts: SafetyGateOptions = {}): boolean {
  if (!result.changed) return true
  const floor = opts.floorRatio ?? 0.2
  const { estimatedTokensBefore, estimatedTokensAfter } = result
  // Empty output after a change is always a failure, regardless of the "before" size.
  if (estimatedTokensAfter <= 0) return false
  // Over-compression: dropped below the floor ratio of the original size.
  if (estimatedTokensBefore > 0 && estimatedTokensAfter / estimatedTokensBefore < floor) return false
  return true
}
