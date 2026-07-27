import { defineModule, type Processor, type RouterlyModule } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { setTrace, getTrace } from './traceStore.js'

const ingress: Processor<ProxyContext> = {
  id: 'logging.ingress',
  phase: 'ingress',
  weight: -100, // trace buffer must exist before any other processor appends to it.
  run(ctx) {
    setTrace(ctx.traceId, [])
  },
}

const finalize: Processor<ProxyContext> = {
  id: 'logging.finalize',
  phase: 'finalize',
  after: ['usage.finalize'],
  run(ctx) {
    // trackUsage already snapshots getTrace(traceId); expose the final buffer for any late consumer.
    if (!ctx.routeTrace) {
      const trace = getTrace(ctx.traceId)
      if (trace) ctx.routeTrace = trace
    }
  },
}

export const loggingModule: RouterlyModule = defineModule({
  manifest: { id: 'logging', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } },
  register({ container }) {
    const pipeline = container.resolve(PROXY_PIPELINE)
    pipeline.contribute(ingress)
    pipeline.contribute(finalize)
  },
})
