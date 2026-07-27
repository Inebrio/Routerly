import type { ProcessorRegistry } from '../../core/index.js'
import type { ProxyContext } from './context.js'

/**
 * The closed, ordered reverse-proxy phase list (roadmap: Frozen phase list).
 * Contrib processors attach to these names; no new phases are introduced.
 * The `error` phase is cross-cutting: a thrown processor propagates to Fastify
 * exactly as an unhandled throw does in the current routes, so it is not walked.
 */
export const PROXY_PHASES = [
  'ingress',
  'protocol.decode',
  'request.preprocess',
  'routing.prepare',
  'routing.execute',
  'upstream.prepare',
  'upstream.execute',
  'response.postprocess',
  'protocol.encode',
  'egress',
  'finalize',
] as const

/**
 * Walk the phases in order. A normal result (json / stream / passthrough) does
 * NOT stop the walk, egress (a later phase) still writes it and finalize still
 * records usage. A terminal `kind:'block'` short-circuits every phase BETWEEN
 * where it was set and egress (no further routing/upstream/postprocess work),
 * but `egress` itself must still run: block producers never write to the reply
 * themselves, they rely on egress's block branch to send the status/body.
 * `finalize` always runs so usage.finalize can record a guardrail-blocked request
 * (roadmap: "shortCircuit or ctx.result with kind:'block' ends the pipeline early").
 * Intra-phase shortCircuit is caught by the kernel's runPhase (Plan 1).
 */
export async function runProxy(
  pipeline: ProcessorRegistry<ProxyContext>,
  ctx: ProxyContext,
): Promise<void> {
  for (const phase of PROXY_PHASES) {
    if (ctx.result?.kind === 'block' && phase !== 'finalize' && phase !== 'egress') continue
    await pipeline.runPhase(phase, ctx)
  }
}

// The Fastify route layer is not a DI consumer, so it cannot resolve the
// PROXY_PIPELINE token from the container. The reverse-proxy module publishes
// the registry here at register time; routes read it back (after the Plan 5 flip).
let current: ProcessorRegistry<ProxyContext> | undefined

export function setProxyPipeline(p: ProcessorRegistry<ProxyContext>): void {
  current = p
}

export function getProxyPipeline(): ProcessorRegistry<ProxyContext> {
  if (!current) throw new Error('reverse-proxy pipeline not initialized')
  return current
}
