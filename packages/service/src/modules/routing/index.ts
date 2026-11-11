import { PASSTHROUGH_MODEL_ID, type ResilienceStore } from '@routerly/shared'
import { defineModule, shortCircuit, type Processor, type RouterlyModule } from '../../core/index.js'
import { ROUTER, PROXY_PIPELINE, RESILIENCE_STORE } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { recallUpstreamError } from '../reverse-proxy/last-upstream-error.js'
import { upstreamErrorBody } from '../../lib/protocol-errors.js'
import { routeRequest } from './router.js'
import type { CallDecision } from './call-config.js'
import { migrateProfiles } from './profiles/migrate.js'
import { addRoutingDecision } from './routingMemoryStore.js'
import { forwardPassthroughRaw } from '../api-reverse-proxy/router-passthrough.js'
import { matchException } from './passthrough-exceptions.js'
import { extractRouterToken } from '../auth/auth.js'

// Message prefixes router.ts's scoreCandidates throws when a passthrough-kind
// router's real models are all ineligible (no resolvable model, limits exceeded,
// or every candidate excluded by policies) — matched by exact prefix so the
// fallback below fires instead of letting the request 5xx. Keep in sync with
// router.ts:121,177,317 — a reworded throw message silently breaks this match.
const NO_ELIGIBLE_CANDIDATE_PREFIXES = [
  'no_models_available',
  'all_models_limits_exceeded',
  'all_models_excluded_by_policies',
]

// The Routerly token authenticates the client to Routerly only: it must never reach the
// upstream. Drop the one header extractRouterToken read it from; the other header (a
// client's own upstream key) is forwarded unchanged.
function withoutRouterlyToken(headers: Record<string, unknown>): Record<string, unknown> {
  const token = extractRouterToken(headers as Record<string, string | string[] | undefined>)
  if (!token) return headers
  const auth = headers['authorization']
  const out = { ...headers }
  if (typeof auth === 'string' && auth.startsWith('Bearer ') && auth.slice(7).trim() === token) delete out['authorization']
  else delete out['x-api-key']
  return out
}

async function forwardPassthroughFallback(ctx: ProxyContext): Promise<void> {
  const path = ctx.req.url.split('?')[0] ?? ctx.req.url
  await forwardPassthroughRaw(
    ctx.router,
    path,
    ctx.req.method,
    withoutRouterlyToken(ctx.req.headers),
    Buffer.from(JSON.stringify(ctx.original)),
    ctx.reply,
    ctx.log,
  )
  ctx.result = { kind: 'block' }
}

// Store resolution is optional-safe: if the resilience module isn't registered in a given
// kernel/test composition, resilienceStore is undefined and routeRequest skips the filter
// entirely, unchanged from before this wiring.
// prepare re-runs per candidate router under an Orchestrator: a stale decision must not leak.
function setCallDecision(ctx: ProxyContext, decision: CallDecision | undefined): void {
  if (decision) ctx.callDecision = decision
  else delete ctx.callDecision
}

function makePrepare(resilienceStore: ResilienceStore | undefined): Processor<ProxyContext> {
  return {
    id: 'routing.prepare',
    phase: 'routing.prepare',
    async run(ctx) {
      if (ctx.result) return
      // An Orchestrator has no models of its own (`scoreCandidates` would throw
      // no_models_available on its empty `models`) — its candidate Routers are scored
      // separately by `forwardToRouter` (RTR-02), never through this model-oriented path.
      if (ctx.router.kind === 'orchestrator') return
      if (ctx.router.kind === 'passthrough') {
        // Exceptions live only here, on the token-authenticated lanes: /passthrough/:slug/*
        // never enters this pipeline (see router-passthrough.ts), so it can never divert.
        const hit = matchException(ctx.router, ctx.request.model, (rule, index) =>
          ctx.log.warn({ routerId: ctx.router.id, index, targetModelId: rule.targetModelId }, 'routing: passthrough exception skipped — target is not a model of this router'))
        if (hit) {
          const ref = ctx.router.models.find((m) => m.modelId === hit.rule.targetModelId)
          // A single candidate through the standard pipeline: no scoring, no raw-forward
          // fallback, no callConfig (passthrough ignores it).
          ctx.candidates = [{ model: hit.rule.targetModelId, weight: 1, ...(ref?.prompt ? { prompt: ref.prompt } : {}) }]
          ctx.routedBy = 'exception'
          setCallDecision(ctx, undefined)
          ctx.emit?.({
            panel: 'router-response',
            message: 'router:exception',
            details: { rule: hit.index, match: hit.rule.match, requestedModel: ctx.request.model, targetModelId: hit.rule.targetModelId },
          })
          return
        }
        const sentinelIdx = ctx.router.models.findIndex((m) => m.modelId === PASSTHROUGH_MODEL_ID)
        if (sentinelIdx === 0) {
          // The pass-through entry is ahead of every real model (AC10): raw-forward is
          // the default outcome, real models are never scored regardless of how many
          // are configured.
          await forwardPassthroughFallback(ctx)
          return
        }
        // Sentinel elsewhere (or, defensively, absent — should not happen for a valid
        // passthrough router per validate-passthrough.ts) — score real models normally,
        // falling back to raw-forward only when none turn out eligible (AC9).
        try {
          const { models, callDecision } = await routeRequest(
            ctx.request,
            ctx.router,
            ctx.log,
            ctx.emit,
            ctx.token,
            ctx.traceId,
            ctx.conversationId,
            resilienceStore,
          )
          ctx.candidates = models
          setCallDecision(ctx, callDecision)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (NO_ELIGIBLE_CANDIDATE_PREFIXES.some((prefix) => message.startsWith(prefix))) {
            await forwardPassthroughFallback(ctx)
            return
          }
          throw err
        }
        return
      }
      // The trace routeRequest returns is for callers without an event bus (the MCP
      // read tool): here every entry already went out through ctx.emit.
      try {
        const { models, callDecision } = await routeRequest(
          ctx.request,
          ctx.router,
          ctx.log,
          ctx.emit,
          ctx.token,
          ctx.traceId,
          ctx.conversationId,
          resilienceStore,
        )
        ctx.candidates = models
        setCallDecision(ctx, callDecision)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const noModels = message.startsWith('no_models_available')
        if (noModels || message.startsWith('all_models_excluded_by_policies')) {
          // Every model is out (e.g. circuit open after an upstream auth failure) or the router has none: a provider-shaped 503, not a bare 500.
          const lastErr = noModels ? undefined : recallUpstreamError(ctx.router.id)
          if (lastErr) {
            const protocol = ctx.protocol === 'anthropic' ? 'anthropic' : 'openai'
            ctx.result = { kind: 'block', status: lastErr.status, body: upstreamErrorBody(protocol, lastErr.status, lastErr.body) }
            return shortCircuit(ctx.result)
          }
          const text = 'No model of this router is currently available.'
          ctx.result = ctx.protocol === 'anthropic'
            ? { kind: 'block', status: 503, body: { type: 'error', error: { type: 'overloaded_error', message: text } } }
            : { kind: 'block', status: 503, body: { error: { message: text, type: 'server_error' } } }
          return shortCircuit(ctx.result)
        }
        if (!message.startsWith('all_models_limits_exceeded')) throw err
        // Same 429 shapes as the guardrails over-limit block (guardrails/index.ts).
        const text = 'Usage limit exceeded for every model of this router.'
        ctx.result = ctx.protocol === 'anthropic'
          ? { kind: 'block', status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: text } } }
          : { kind: 'block', status: 429, body: { error: { message: text, type: 'insufficient_quota' } } }
        return shortCircuit(ctx.result)
      }
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
    const memoryEnabled = (ctx.router.policies ?? []).some(
      (p) => p.type === 'llm' && p.enabled && (p.config as { memory?: unknown } | undefined)?.memory === true,
    )
    if (!memoryEnabled) return
    addRoutingDecision(ctx.router.id, ctx.conversationId, top.model)
  },
}

export const routingModule: RouterlyModule = defineModule({
  manifest: { id: 'routing', version: '0.6.0', dependsOn: { 'reverse-proxy': '^0.6.0', resilience: '^0.6.0' } },
  async migrate() {
    const migrated = await migrateProfiles()
    if (migrated > 0) {
       
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
