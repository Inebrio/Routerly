import { defineModule, type Processor, type RouterlyModule } from '../../core/index.js'
import { BUDGET, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { isAllowed, getViolatedLimits, getLimitUsageSnapshot } from './budget.js'

const upstream: Processor<ProxyContext> = {
  id: 'budget.upstream',
  phase: 'upstream.prepare',
  async run(ctx) {
    if (ctx.result) return
    const attempt = ctx.attempt
    if (!attempt) return
    // Per-candidate eligibility. The executor's checkBudget (inside upstream.execute)
    // stays the authoritative recorder of budget-exceeded events + usage; this guard only
    // decides whether the candidate is attempted, mirroring routeRequest's existing pre-filter.
    const startedAt = Date.now()
    const allowed = await isAllowed(attempt.model, ctx.router, ctx.token)
    // A candidate silently dropped here looks, from the trace, like a routing
    // decision nobody made. Say which limit dropped it and by how much.
    const violated = allowed ? [] : await getViolatedLimits(attempt.model, ctx.router, ctx.token)
    ctx.emit?.({
      panel: 'request',
      message: 'budget:checked',
      details: {
        model: attempt.model.id,
        allowed,
        ms: Date.now() - startedAt,
        ...(violated.length > 0
          ? { violated: violated.map((v) => ({ metric: v.metric, window: v.window, limit: v.value, current: v.current })) }
          : {}),
      },
    })
    if (!allowed) {
      // ponytail: drop the candidate; routing.execute picks the next one, or the
      // no_candidates path fires in finalize when the loop exhausts.
      delete (ctx as { attempt?: unknown }).attempt
    }
  },
}

export const budgetModule: RouterlyModule = defineModule({
  manifest: {
    id: 'budget',
    version: '0.4.0',
    dependsOn: { 'reverse-proxy': '^0.4.0', 'provider': '^0.4.0' },
  },
  register({ container }) {
    container.register(BUDGET, { isAllowed, getViolatedLimits, getLimitUsageSnapshot })
    container.resolve(PROXY_PIPELINE).contribute(upstream)
  },
})
