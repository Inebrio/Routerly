import type { ResilienceStore } from '@routerly/shared'
import { defineModule, type Processor, type RouterlyModule } from '../../core/index.js'
import { ROUTER, PROXY_PIPELINE, RESILIENCE_STORE } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { routeRequest } from './router.js'
import { migrateProfiles } from './profiles/migrate.js'
import { addRoutingDecision } from './routingMemoryStore.js'

// Store resolution is optional-safe: if the resilience module isn't registered in a given
// kernel/test composition, resilienceStore is undefined and routeRequest skips the filter
// entirely, unchanged from before this wiring.
function makePrepare(resilienceStore: ResilienceStore | undefined): Processor<ProxyContext> {
  return {
    id: 'routing.prepare',
    phase: 'routing.prepare',
    async run(ctx) {
      if (ctx.result) return
      // The trace routeRequest returns is for callers without an event bus (the MCP
      // read tool): here every entry already went out through ctx.emit.
      const { models } = await routeRequest(
        ctx.request,
        ctx.project,
        ctx.log,
        ctx.emit,
        ctx.token,
        ctx.traceId,
        ctx.conversationId,
        resilienceStore,
      )
      ctx.candidates = models
    },
  }
}

const memory: Processor<ProxyContext> = {
  id: 'routing.memory',
  phase: 'routing.prepare',
  after: ['routing.prepare'],
  run(ctx) {
    // Asymmetry: routing memory is an OpenAI-lane concern only (routes/anthropic.ts has none).
    if (ctx.protocol !== 'openai') return
    if (!ctx.conversationId) return
    const top = ctx.candidates?.[0]
    if (!top) return
    const memoryEnabled = (ctx.project.policies ?? []).some(
      (p) => p.type === 'llm' && p.enabled && (p.config as { memory?: unknown } | undefined)?.memory === true,
    )
    if (!memoryEnabled) return
    addRoutingDecision(ctx.project.id, ctx.conversationId, top.model)
  },
}

export const routingModule: RouterlyModule = defineModule({
  manifest: { id: 'routing', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0', resilience: '^0.4.0' } },
  async migrate() {
    const migrated = await migrateProfiles()
    if (migrated > 0) {
      // eslint-disable-next-line no-console
      console.log(`[startup] migrated ${migrated} record(s) to the multi-kind profile shape`)
    }
  },
  register({ container }) {
    container.register(ROUTER, { routeRequest })
    const resilienceStore = container.tryResolve(RESILIENCE_STORE)
    const pipeline = container.resolve(PROXY_PIPELINE)
    pipeline.contribute(makePrepare(resilienceStore))
    pipeline.contribute(memory)
  },
})
