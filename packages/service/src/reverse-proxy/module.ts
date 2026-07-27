import { defineModule, ProcessorRegistry } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from './context.js'
import { setProxyPipeline } from './run.js'
import { openaiTransportProcessors } from './lanes/openai.js'
import { anthropicTransportProcessors } from './lanes/anthropic.js'

/**
 * Reverse-proxy TRANSPORT module (Plan 4). Contributes ONLY the per-lane transport
 * processors (upstream call, candidate loop, egress writer). Routing decision, PII,
 * guardrails, budget, usage and logging are Plan 5 concern modules that contribute
 * INTO the same PROXY_PIPELINE registry. The pipeline is dark until Plan 5's flip.
 */
export const reverseProxyModule = defineModule({
  manifest: {
    id: 'reverse-proxy',
    version: '0.4.0',
    dependsOn: { config: '^0.4.0', provider: '^0.4.0' },
  },
  register(reg) {
    const pipeline = new ProcessorRegistry<ProxyContext>()
    for (const p of openaiTransportProcessors) pipeline.contribute(p)
    for (const p of anthropicTransportProcessors) pipeline.contribute(p)
    reg.container.register(PROXY_PIPELINE, pipeline)
    setProxyPipeline(pipeline)
  },
})
