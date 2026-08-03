/**
 * Trace module.
 *
 * Owns the whole trace path: it opens a buffer per request, hands the phases an
 * `emit` that publishes on the kernel event bus, and is the bus subscriber that
 * records what they publish. Producers (routing, guardrails, pii, optimizers, the
 * transport lanes) know nothing but `ctx.emit` — no store, no transport, no
 * knowledge of who is listening. Disabling this module turns tracing off; nothing
 * else changes.
 */
import { defineModule, type EventBus, type Processor, type RouterlyModule } from '../../core/index.js'
import { PROXY_PIPELINE, API_ROUTES } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { publishTrace, TRACE_COMPLETED_TOPIC, type TraceCompletedEvent } from './publish.js'
import { makeTraceStreamHandler } from './routes.js'
import { readConfig } from '../config/loader.js'
import { printTrace } from './console.js'
import { buildRecap } from './recap.js'
import { closeTrace, getTrace, getTraceStartedAt, openTrace, recordTrace, type TraceEvent } from './store.js'

/**
 * The id a caller may put on the request to follow its own trace on the side
 * channel. `x-routerly-trace: 1` is the legacy opt-in to the (now removed)
 * response header and carries no id, so it reads as "no correlation".
 */
export function correlationIdFrom(headers: Record<string, unknown>): string | undefined {
  const raw = headers['x-routerly-trace']
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value && value !== '1' ? value.slice(0, 128) : undefined
}

function makeIngress(events: EventBus): Processor<ProxyContext> {
  return {
    id: 'trace.ingress',
    phase: 'ingress',
    weight: -100, // the buffer must exist before any other processor emits into it.
    run(ctx) {
      // The request header is this module's business, so the transport lanes stay
      // free of trace concerns: they only build the context.
      const correlationId = correlationIdFrom(ctx.req?.headers ?? {})
      if (correlationId) ctx.correlationId = correlationId
      // Prompts and answers are captured only where the project asked for it.
      ctx.captureContent = ctx.project?.traceContent === true
      openTrace(ctx.traceId, {
        projectId: ctx.projectId,
        ...(correlationId ? { correlationId } : {}),
      })
      ctx.emit = (entry) => publishTrace(events, ctx, entry)
    },
  }
}

function makeFinalize(events: EventBus): Processor<ProxyContext> {
  return {
    id: 'trace.finalize',
    phase: 'finalize',
    after: ['usage.finalize'],
    run(ctx) {
      // The buffer is the only source: it holds the entries as published — stamped
      // with phase, module and timestamp — which is what exporters need to rebuild
      // the shape of the request.
      const buffered = getTrace(ctx.traceId) ?? []
      if (buffered.length === 0) {
        closeTrace(ctx.traceId)
        return
      }
      // The recap is emitted, not appended: publishing it puts it through the same
      // stamping and the same bus as everything else, and the buffer is live, so it
      // is part of the snapshot read on the next line.
      ctx.emit?.(buildRecap(buffered, Date.now() - (getTraceStartedAt(ctx.traceId) ?? Date.now())))
      const entries = getTrace(ctx.traceId) ?? []
      // The finished trace, announced once. Exporters (integrations) subscribe here
      // instead of following every single entry.
      const completed: TraceCompletedEvent = {
        traceId: ctx.traceId,
        entries,
        ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
        ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {}),
      }
      // Closed only after the announcement: subscribers read the buffer, and
      // whoever stores it must see the recap that was just emitted into it.
      closeTrace(ctx.traceId)
      events.publish(TRACE_COMPLETED_TOPIC, completed)
    },
  }
}

export const traceModule: RouterlyModule = defineModule({
  manifest: { id: 'trace', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0', api: '^0.4.0' } },
  async register({ container, events }) {
    // The console gets the whole trace, live. Read once at boot: the level only
    // decides how much of it is printed, and re-reading it per entry would put a
    // config read on the hot path of every emit.
    const logLevel = await readConfig('settings').then((s) => s.logLevel).catch(() => 'info')
    events.subscribe('trace/**', (_topic, payload) => {
      const event = payload as TraceEvent
      recordTrace(event)
      printTrace(event, logLevel)
    })
    const pipeline = container.resolve(PROXY_PIPELINE)
    pipeline.contribute(makeIngress(events))
    pipeline.contribute(makeFinalize(events))

    // tryResolve, not resolve: the pipeline-only compositions used by the reverse-proxy
    // tests register no API registry, and tracing must work there too.
    const routes = container.tryResolve(API_ROUTES)
    routes?.contribute({
      id: 'trace.stream',
      value: { method: 'GET', url: '/api/traces/stream', handler: makeTraceStreamHandler(events) },
    })
  },
})
