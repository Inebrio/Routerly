import { randomUUID } from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { ChatCompletionRequest } from '@routerly/shared'
import type { Processor } from '../../../core/index.js'
import type { ProxyContext } from '../context.js'
import { getProxyPipeline } from '../run.js'
import { readConfig } from '../../config/loader.js'
import { appendTrace } from '../../logging/traceStore.js'
import type { TraceEntry } from '../../logging/traceStore.js'
import { llmChat, llmStream, BudgetExceededError } from '../execute.js'
import type { LLMCallContext } from '../execute.js'
import { emitEvent } from '../../notifications/emitter.js'
import { forwardOpenAIOAuthSSE } from './openaiOAuthForward.js'

/** Build the initial ProxyContext for an OpenAI request. protocol.decode is identity: request === original. */
export function buildOpenAIContext(req: FastifyRequest, reply: FastifyReply): ProxyContext {
  const body = req.body as ChatCompletionRequest
  const conversationId = (req.headers['x-routerly-conversation-id'] as string | undefined) || undefined
  return {
    protocol: 'openai',
    req,
    reply,
    log: req.log,
    project: req.project,
    projectId: req.project.id,
    ...(req.token ? { token: req.token } : {}),
    traceId: randomUUID(),
    traceEnabled: req.headers['x-routerly-trace'] === '1',
    traceSuppressed: req.headers['x-routerly-no-trace'] === '1',
    ...(conversationId ? { conversationId } : {}),
    original: body,
    request: body,
    stream: body.stream === true,
    passthrough: false,
  }
}

// ─── upstream.prepare: merge guardrail request-injection (steering text) into the outgoing
// system message, reproducing the pre-refactor merge from routes/openai.ts verbatim ───
export const openaiInject: Processor<ProxyContext> = {
  id: 'openai:inject',
  phase: 'upstream.prepare',
  async run(ctx) {
    if (ctx.protocol !== 'openai') return
    if (ctx.result) return
    const injection = ctx.requestInjection
    if (!injection) return
    const body = ctx.request as { messages?: Array<{ role?: string; content?: unknown }> }
    const messages = body.messages
    if (!Array.isArray(messages)) return
    const sys = messages.find((m) => m?.role === 'system')
    if (sys) {
      if (typeof sys.content === 'string') sys.content = `${sys.content}\n\n${injection}`
      else if (Array.isArray(sys.content)) sys.content.push({ type: 'text', text: injection })
      else sys.content = injection
    } else {
      messages.unshift({ role: 'system', content: injection })
    }
  },
}

// ─── upstream.execute: the provider call ONLY (mirrors the stream/non-stream provider-call
// blocks in routes/openai.ts; no fixed line numbers here, that file is being replaced by this
// pipeline and its lines keep moving) ───
export const openaiUpstream: Processor<ProxyContext> = {
  id: 'openai:upstream',
  phase: 'upstream.execute',
  async run(ctx) {
    if (ctx.protocol !== 'openai') return
    if (ctx.result) return
    const attempt = ctx.attempt
    if (!attempt) return
    const model = attempt.model
    const body = ctx.request
    const log = ctx.log
    const project = ctx.project
    const emit = (entry: TraceEntry) => { appendTrace(ctx.traceId, [entry]) }
    const endUserId = (body as any).user as string | undefined || undefined

    const cctx: LLMCallContext = {
      projectId: project.id,
      project,
      ...(ctx.token ? { token: ctx.token } : {}),
      callType: 'completion',
      traceId: ctx.traceId,
      emit,
      log,
      ...(endUserId ? { endUserId } : {}),
      ...(ctx.guardrailTriggered ? { guardrailTriggered: ctx.guardrailTriggered } : {}),
      ...(ctx.piiRedacted ? { piiRedacted: ctx.piiRedacted } : {}),
      ...(ctx.conversationId ? { sessionId: ctx.conversationId } : {}),
      ...(ctx.token?.tags ? { tags: ctx.token.tags } : {}),
    }

    // ── openai-oauth: streaming passthrough (verbatim), non-stream is unsupported. ──
    if (model.provider === 'openai-oauth') {
      if (!ctx.stream) {
        ctx.result = {
          kind: 'block', status: 422,
          body: { error: { message: 'openai-oauth requires streaming. Use /v1/responses with stream: true.', type: 'invalid_request_error' } },
        }
        return
      }
      // Verbatim SSE passthrough. main hijacks + sets SSE/CORS headers before the
      // candidate loop (openai.ts L229-240); reproduce that here, then forward.
      ctx.passthrough = true
      const reply = ctx.reply
      reply.hijack()
      const origin = ctx.req.headers.origin
      if (origin) {
        reply.raw.setHeader('Access-Control-Allow-Origin', origin)
        reply.raw.setHeader('Access-Control-Allow-Credentials', 'true')
        if (ctx.traceEnabled) reply.raw.setHeader('Access-Control-Expose-Headers', 'x-routerly-trace-id')
      }
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      if (ctx.traceEnabled) reply.raw.setHeader('x-routerly-trace-id', ctx.traceId)
      reply.raw.flushHeaders()
      await forwardOpenAIOAuthSSE(reply.raw, body as Record<string, unknown>, model, log, ctx.traceId, project.id, project.pii)
      reply.raw.end()
      ctx.result = { kind: 'passthrough' }
      return
    }

    if (ctx.stream) {
      try {
        const streamResult = await llmStream(body, model, cctx)
        ctx.result = { kind: 'stream', body: streamResult.chunks }
      } catch (err: unknown) {
        if (!(err instanceof BudgetExceededError)) {
          log.warn({ err, modelId: model.id }, 'Stream failed before first chunk, trying next candidate')
        }
        // leave ctx.result unset -> openai:attempt advances to the next candidate
      }
      return
    }

    try {
      const response = await llmChat(body, model, cctx)
      log.info(
        {
          modelId: model.id,
          inputTokens: response.usage?.prompt_tokens,
          outputTokens: response.usage?.completion_tokens,
          finishReason: response.choices?.[0]?.finish_reason,
        },
        'completion: response',
      )
      ctx.result = { kind: 'json', body: response }
    } catch (err: unknown) {
      if (!(err instanceof BudgetExceededError)) {
        log.warn({ err, modelId: model.id }, 'Model failed, trying next candidate')
      }
      // leave ctx.result unset -> openai:attempt advances
    }
  },
}

// ─── routing.execute: candidate fallback loop + fallback/no_candidates events ─────
// (openai.ts L278-284/316-319/415-422 streaming; L448-454/535-536/548-549 non-stream)
export const openaiAttempt: Processor<ProxyContext> = {
  id: 'openai:attempt',
  phase: 'routing.execute',
  async run(ctx) {
    if (ctx.protocol !== 'openai') return
    if (ctx.result) return // request already blocked upstream (guardrail / budget, Plan 5)
    const pipeline = getProxyPipeline()
    const project = ctx.project
    const log = ctx.log
    const allModels = await readConfig('models')
    const sorted = [...(ctx.candidates ?? [])].sort((a, b) => b.weight - a.weight)

    let primaryModelId: string | undefined
    let primaryFailed = false
    for (const candidate of sorted) {
      const model = allModels.find((m) => m.id === candidate.model)
      if (!model) continue
      if (!primaryModelId) primaryModelId = model.id
      ctx.attempt = { model, candidate }

      await pipeline.runPhase('upstream.prepare', ctx) // Plan 5 budget: per-candidate isAllowed
      if (ctx.result) return                            // budget block short-circuits
      await pipeline.runPhase('upstream.execute', ctx)  // openai:upstream sets ctx.result on success

      if (ctx.result) {
        if (primaryFailed && model.id !== primaryModelId) {
          void emitEvent('routing.fallback_used', 'info', { projectId: project.id, primaryModelId, fallbackModelId: model.id, traceId: ctx.traceId }, { projectId: project.id, log })
        }
        return
      }
      if (model.id === primaryModelId) primaryFailed = true
    }

    // All candidates exhausted.
    void emitEvent('routing.no_candidates', 'critical', { projectId: project.id, requestedModel: ctx.request.model ?? null, traceId: ctx.traceId }, { projectId: project.id, log })
    if (ctx.stream) {
      const errorEntry: TraceEntry = { panel: 'response', message: 'model:error', details: { error: 'All candidates unavailable or budget-exhausted' } }
      appendTrace(ctx.traceId, [errorEntry])
      ctx.routeTrace = [...(ctx.routeTrace ?? []), errorEntry]
      const errChunk = { id: `chatcmpl-${ctx.traceId}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: ctx.request.model ?? '', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
      ctx.result = { kind: 'stream', body: (async function* () { yield errChunk })() }
    } else {
      ctx.result = { kind: 'block', status: 503, body: { error: { message: 'All candidate models failed or are budget-exhausted.', type: 'server_error' } } }
    }
  },
}

// ─── egress: the byte-sensitive writer (openai.ts L229-249 headers, L338-412 pump, L539/549 send) ──
export const openaiEgress: Processor<ProxyContext> = {
  id: 'openai:egress',
  phase: 'egress',
  async run(ctx) {
    if (ctx.protocol !== 'openai') return
    const result = ctx.result
    if (!result) return
    const reply = ctx.reply
    const traceOptIn = ctx.traceEnabled

    if (result.kind === 'passthrough') return // already piped by openai:upstream

    if (result.kind === 'json') {
      if (traceOptIn) reply.header('x-routerly-trace-id', ctx.traceId)
      if (result.status) reply.code(result.status)
      reply.send(result.body)
      return
    }

    if (result.kind === 'block') {
      if (result.body === undefined) return // a streaming block already wrote its own bytes
      // No trace header here: neither block producer in this file (openai-oauth's 422,
      // openai:attempt's 503) sets it in the live route today. A future block-producing
      // processor (Plan 5 guardrail/budget) that needs the header must call
      // reply.header('x-routerly-trace-id', ctx.traceId) itself before assigning ctx.result,
      // same as routes/openai.ts does at its guardrail/content-filter block sites.
      reply.code(result.status ?? 200).send(result.body)
      return
    }

    // result.kind === 'stream'
    reply.hijack()
    const origin = ctx.req.headers.origin
    if (origin) {
      reply.raw.setHeader('Access-Control-Allow-Origin', origin)
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true')
      if (traceOptIn) reply.raw.setHeader('Access-Control-Expose-Headers', 'x-routerly-trace-id')
    }
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    if (traceOptIn) reply.raw.setHeader('x-routerly-trace-id', ctx.traceId)
    reply.raw.flushHeaders()

    // Trace frames: main writes them live during routing (all before the first data
    // chunk, since routing completes first). Plan 5 buffers routing trace into
    // ctx.routeTrace; egress replays it here to reproduce the ordering.
    if (!ctx.traceSuppressed) {
      for (const entry of ctx.routeTrace ?? []) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'trace', entry })}\n\n`)
      }
    }

    try {
      for await (const chunk of result.body as AsyncIterable<unknown>) {
        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)
      }
    } catch (err: unknown) {
      ctx.log.error({ err }, 'Streaming error mid-stream')
    }
    reply.raw.write('data: [DONE]\n\n')
    reply.raw.end()
  },
}

export const openaiTransportProcessors: Processor<ProxyContext>[] = [openaiInject, openaiUpstream, openaiAttempt, openaiEgress]
