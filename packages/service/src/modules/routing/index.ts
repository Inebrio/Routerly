import { defineModule, type Processor, type RouterlyModule } from '../../core/index.js'
import { ROUTER, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { routeRequest } from './router.js'
import { addRoutingDecision } from './routingMemoryStore.js'
import { appendTrace } from '../logging/traceStore.js'
import type { TraceEntry } from '../logging/traceStore.js'

const prepare: Processor<ProxyContext> = {
  id: 'routing.prepare',
  phase: 'routing.prepare',
  async run(ctx) {
    if (ctx.result) return
    const emit = (entry: TraceEntry): void => appendTrace(ctx.traceId, [entry])
    const { models, trace } = await routeRequest(
      ctx.request,
      ctx.project,
      ctx.log,
      emit,
      ctx.token,
      ctx.traceId,
      ctx.conversationId,
    )
    ctx.candidates = models
    ctx.routeTrace = trace
  },
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
  manifest: { id: 'routing', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } },
  register({ container }) {
    container.register(ROUTER, { routeRequest })
    const pipeline = container.resolve(PROXY_PIPELINE)
    pipeline.contribute(prepare)
    pipeline.contribute(memory)
  },
})
