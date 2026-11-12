import type { ModelConfig } from '@routerly/shared'
import { classifyUpstreamError } from '../resilience/classifier.js'
import { logAudit } from '../audit/logger.js'
import { upstreamErrorBody } from '../../lib/protocol-errors.js'
import type { ProxyContext } from './context.js'

/** Substitutes tried after a moderation refusal, per request. */
export const MAX_MODERATION_SUBSTITUTES = 2
/** How long a refusing model is skipped as a substitute in the same router. */
export const RECENT_REFUSAL_TTL_MS = 10 * 60_000

// ponytail: in-process memory, lost on restart; bounded by routers x models in config.
const recentRefusals = new Map<string, number>()

function refusedRecently(routerId: string, modelId: string): boolean {
  const until = recentRefusals.get(`${routerId}\0${modelId}`)
  return until !== undefined && until > Date.now()
}

/** Test hook. */
export function resetModerationMemory(): void {
  recentRefusals.clear()
}

type Outcome = { status: number; body: unknown }

/**
 * Per-request moderation fallback state, shared by the OpenAI and Anthropic candidate loops.
 * A refusal returned as a non-2xx policy error (classifier category `content-safety`) either
 * stops the loop with the original error (router setting off) or moves to another candidate
 * on a different provider, at most MAX_MODERATION_SUBSTITUTES times (setting on).
 */
export function createModerationFallback(ctx: ProxyContext, protocol: 'openai' | 'anthropic') {
  const router = ctx.router
  const enabled = router.moderationFallback === true
  let refused: { model: ModelConfig; outcome: Outcome; reason: string } | undefined
  const refusedProviders = new Set<string>()
  let substitutes = 0

  function record(to: string | null): void {
    if (!refused) return
    const details = { routerId: router.id, from: refused.model.id, to, reason: refused.reason, substitutes }
    ctx.emit?.({ panel: 'response', message: 'router:moderation_fallback', details })
    void logAudit({
      userId: ctx.token?.id ?? 'proxy',
      email: 'proxy',
      endpoint: ctx.responsesApi ? 'POST /v1/responses' : protocol === 'anthropic' ? 'POST /v1/messages' : 'POST /v1/chat/completions',
      action: 'proxy:moderation_fallback',
      result: to ? 'success' : 'error',
      details: { ...details, ...(ctx.traceId ? { traceId: ctx.traceId } : {}) },
    })
  }

  return {
    /** True when this candidate must not be tried because a refusal already happened. */
    skip(model: ModelConfig): boolean {
      if (!refused) return false
      if (substitutes >= MAX_MODERATION_SUBSTITUTES) return true
      if (refusedProviders.has(model.provider) || refusedRecently(router.id, model.id)) return true
      substitutes++
      return false
    },

    /**
     * Call after a failed attempt, before the stash is cleared. Returns true when the loop must
     * stop (setting off: the client gets the original refusal as the result).
     */
    onFailure(model: ModelConfig): boolean {
      const ar = ctx.attemptResponse
      if (ctx.attemptError === undefined || ar?.status === undefined) return false
      if (classifyUpstreamError(ctx.attemptError, ar).category !== 'content-safety') return false
      recentRefusals.set(`${router.id}\0${model.id}`, Date.now() + RECENT_REFUSAL_TTL_MS)
      refusedProviders.add(model.provider)
      if (refused) return false
      const msg = ctx.attemptError instanceof Error ? ctx.attemptError.message : String(ctx.attemptError)
      refused = { model, outcome: { status: ar.status, body: upstreamErrorBody(protocol, ar.status, ar.body) }, reason: msg.slice(0, 300) }
      if (enabled) return false
      ctx.result = { kind: 'block', ...refused.outcome }
      return true
    },

    /** Call when a candidate produced the result. */
    onSuccess(model: ModelConfig): void {
      if (refused) record(model.id)
    },

    /** The original refusal to return when no substitute answered, if there was one. */
    exhausted(): Outcome | undefined {
      if (!refused) return undefined
      record(null)
      return refused.outcome
    },
  }
}
