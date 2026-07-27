import { defineModule, type Processor, type RouterlyModule } from '../../core/index.js'
import { USAGE_TRACKER, CONFIG_STORE, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { trackUsage } from './tracker.js'

export const usageModule: RouterlyModule = defineModule({
  manifest: { id: 'usage', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0', config: '^0.4.0' } },
  register({ container }) {
    container.register(USAGE_TRACKER, { trackUsage })
    const store = container.resolve(CONFIG_STORE)

    const finalize: Processor<ProxyContext> = {
      id: 'usage.finalize',
      phase: 'finalize',
      async run(ctx) {
        // Only the guardrail-blocked usage event lives here (today: trackBlockedRequest in routes/*.ts).
        // Completion / stream / messages / passthrough usage is self-tracked upstream, do not re-record.
        const blockedBy = ctx.blockedBy
        if (!blockedBy) return
        const models = await store.readConfig('models')
        const firstModelId = ctx.project.models?.[0]?.modelId
        const model = firstModelId ? models.find((m) => m.id === firstModelId) : undefined
        if (!model) return // ponytail: no project model to attribute to -> nothing to record
        await trackUsage({
          projectId: ctx.project.id,
          model,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          outcome: 'blocked',
          callType: 'guardrail',
          traceId: ctx.traceId,
          guardrailTriggered: blockedBy,
          blockedBy,
        }).catch(() => {})
      },
    }

    container.resolve(PROXY_PIPELINE).contribute(finalize)
  },
})
