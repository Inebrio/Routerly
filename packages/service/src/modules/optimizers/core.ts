import { defineModule, type Processor, type RouterlyModule } from '../../core/index.js'
import { OPTIMIZER_REGISTRY, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ChatCompletionRequest, OptimizerCallStat, OptimizerResult } from '@routerly/shared'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { OptimizerRegistry, setOptimizerRegistry } from './registry.js'
import { passesSafetyGate } from './gate.js'

/**
 * Restore a request's fields IN PLACE from a snapshot, preserving object
 * identity. This is load-bearing: `ctx.request` and `ctx.original` are the SAME
 * object (both lanes build the context with `original: body, request: body`), and
 * the Anthropic wire encode reads `ctx.original`. Reassigning `ctx.request` would
 * repoint only the `request` property and silently make optimizers OpenAI-only.
 * Every optimizer's `optimize`/`recover` must obey the same in-place rule.
 */
export function restoreInPlace(req: ChatCompletionRequest, snapshot: ChatCompletionRequest): void {
  for (const key of Object.keys(req)) delete (req as Record<string, unknown>)[key]
  Object.assign(req, snapshot)
}

/**
 * request.preprocess processor. Runs after PII scrub and the guardrail judge so
 * optimizers never alter text those stages depend on. Fail-open: a throw, a
 * failed safety gate (lossy only), or `validate === false` rolls the pre-optimize
 * snapshot back in place and continues to the next step; it never short-circuits.
 *
 * Steps that did something are recorded on `ctx.optimizerStats` so the saving can
 * be attributed on the usage record (T63). A step that ran and left the prompt
 * untouched is not recorded: it carries no information and every record it
 * appeared on would grow usage.json for nothing.
 */
function applyProcessor(registry: OptimizerRegistry): Processor<ProxyContext> {
  return {
    id: 'optimizer.apply',
    phase: 'request.preprocess',
    after: ['pii.input', 'guardrail.request'],
    async run(ctx) {
      if (ctx.result) return

      const steps = ctx.router.optimizers?.steps
      if (!steps?.length) return

      // Every configured step reports, whatever it did: a step that was skipped,
      // ran for nothing, or was rolled back is precisely what an operator looks
      // for when the pipeline "did nothing". Stats stay as they are: they are the
      // usage attribution, and only a step that changed the prompt belongs there.
      const trace = (
        id: string,
        outcome: 'applied' | 'unchanged' | 'skipped' | 'rolled-back',
        extra: Record<string, unknown> = {},
      ): void => {
        ctx.emit?.({ panel: 'request', message: 'optimizer:step', details: { id, outcome, ...extra } })
      }

      const stats: OptimizerCallStat[] = []
      const record = (result: OptimizerResult, id: OptimizerCallStat['id'], rolledBack: boolean): void => {
        if (!result.changed) return
        stats.push({
          id,
          tokensBefore: result.estimatedTokensBefore,
          // A rolled-back step left the prompt as it found it, whatever its
          // optimize() reported before the rollback.
          tokensAfter: rolledBack ? result.estimatedTokensBefore : result.estimatedTokensAfter,
          ...(rolledBack ? { rolledBack: true } : {}),
        })
      }

      for (const step of steps) {
        if (!step.enabled) {
          trace(step.id, 'skipped', { reason: 'disabled' })
          continue
        }
        const optimizer = registry.get(step.id)
        if (!optimizer) {
          trace(step.id, 'skipped', { reason: 'not-registered' })
          continue
        }
        if (!optimizer.supports(ctx)) {
          const detail = optimizer.explain?.(ctx)
          trace(optimizer.id, 'skipped', {
            reason: 'unsupported-request',
            klass: optimizer.klass,
            ...(detail ? { detail } : {}),
          })
          continue
        }

        const startedAt = Date.now()
        const tokens = (result: OptimizerResult, rolledBack: boolean): Record<string, unknown> => ({
          klass: optimizer.klass,
          tokensBefore: result.estimatedTokensBefore,
          tokensAfter: rolledBack ? result.estimatedTokensBefore : result.estimatedTokensAfter,
          saved: rolledBack ? 0 : result.estimatedTokensBefore - result.estimatedTokensAfter,
          ms: Date.now() - startedAt,
        })

        const snapshot = structuredClone(ctx.request)
        const rollback = (reason: string, result?: OptimizerResult): void => {
          restoreInPlace(ctx.request, snapshot)
          if (result && optimizer.recover) optimizer.recover(ctx, result)
          if (result) record(result, optimizer.id, true)
          trace(optimizer.id, 'rolled-back', {
            reason,
            klass: optimizer.klass,
            ...(result ? tokens(result, true) : { ms: Date.now() - startedAt }),
          })
        }

        let result: OptimizerResult
        try {
          result = await optimizer.optimize(ctx)
        } catch (err) {
          ctx.log.warn?.({ err, optimizer: optimizer.id }, 'optimizer threw, rolling back (fail-open)')
          rollback(`threw: ${err instanceof Error ? err.message : String(err)}`)
          continue
        }

        if (optimizer.klass === 'lossy' && !passesSafetyGate(result)) {
          rollback('safety-gate', result)
          continue
        }
        if (!optimizer.validate(ctx, result)) {
          rollback('invalid-result', result)
          continue
        }
        record(result, optimizer.id, false)
        trace(optimizer.id, result.changed ? 'applied' : 'unchanged', tokens(result, false))
      }

      if (stats.length > 0) ctx.optimizerStats = stats
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
    setOptimizerRegistry(registry)
    const pipeline = container.resolve(PROXY_PIPELINE)
    pipeline.contribute(applyProcessor(registry))
  },
})
