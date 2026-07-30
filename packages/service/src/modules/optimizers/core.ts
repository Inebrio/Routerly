import { defineModule, type Processor, type RouterlyModule } from '../../core/index.js'
import { OPTIMIZER_REGISTRY, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ChatCompletionRequest, OptimizerResult } from '@routerly/shared'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { OptimizerRegistry } from './registry.js'
import { passesSafetyGate } from './gate.js'

/**
 * Restore a request's fields IN PLACE from a snapshot, preserving object
 * identity. This is load-bearing: `ctx.request` and `ctx.original` are the SAME
 * object (both lanes build the context with `original: body, request: body`), and
 * the Anthropic wire encode reads `ctx.original`. Reassigning `ctx.request` would
 * repoint only the `request` property and silently make optimizers OpenAI-only.
 * Every optimizer's `optimize`/`recover` must obey the same in-place rule.
 */
function restoreInPlace(req: ChatCompletionRequest, snapshot: ChatCompletionRequest): void {
  for (const key of Object.keys(req)) delete (req as Record<string, unknown>)[key]
  Object.assign(req, snapshot)
}

/**
 * request.preprocess processor. Runs after PII scrub and the guardrail judge so
 * optimizers never alter text those stages depend on. Fail-open: a throw, a
 * failed safety gate (lossy only), or `validate === false` rolls the pre-optimize
 * snapshot back in place and continues to the next step; it never short-circuits.
 */
function applyProcessor(registry: OptimizerRegistry): Processor<ProxyContext> {
  return {
    id: 'optimizer.apply',
    phase: 'request.preprocess',
    after: ['pii.input', 'guardrail.request'],
    async run(ctx) {
      if (ctx.result) return
      const steps = ctx.project.optimizers?.steps
      if (!steps?.length) return

      for (const step of steps) {
        if (!step.enabled) continue
        const optimizer = registry.get(step.id)
        if (!optimizer) continue
        if (!optimizer.supports(ctx)) continue

        const snapshot = structuredClone(ctx.request)
        const rollback = (result?: OptimizerResult): void => {
          restoreInPlace(ctx.request, snapshot)
          if (result && optimizer.recover) optimizer.recover(ctx, result)
        }

        let result: OptimizerResult
        try {
          result = await optimizer.optimize(ctx)
        } catch (err) {
          ctx.log.warn?.({ err, optimizer: optimizer.id }, 'optimizer threw, rolling back (fail-open)')
          rollback()
          continue
        }

        if (optimizer.klass === 'lossy' && !passesSafetyGate(result)) {
          rollback(result)
          continue
        }
        if (!optimizer.validate(ctx, result)) {
          rollback(result)
          continue
        }
      }
    },
  }
}

/**
 * optimizer-core module. On register it creates the OptimizerRegistry, binds it
 * to OPTIMIZER_REGISTRY (later optimizer submodules resolve it to self-register),
 * and contributes the optimizer.apply processor into the proxy pipeline.
 */
export const optimizerCoreModule: RouterlyModule = defineModule({
  manifest: { id: 'optimizer-core', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } },
  register({ container }) {
    const registry = new OptimizerRegistry()
    container.register(OPTIMIZER_REGISTRY, registry)
    const pipeline = container.resolve(PROXY_PIPELINE)
    pipeline.contribute(applyProcessor(registry))
  },
})
