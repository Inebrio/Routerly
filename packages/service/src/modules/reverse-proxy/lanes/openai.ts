import { randomUUID } from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { ChatCompletionRequest, ChatCompletionResponse, StreamChunk } from '@routerly/shared'
import type { Processor } from '../../../core/index.js'
import type { ProxyContext } from '../context.js'
import { getProxyPipeline } from '../run.js'
import { listEffectiveModels } from '../../provider/list-effective.js'
import type { TraceEntry } from '@routerly/shared'
import { llmChat, llmStream, BudgetExceededError, upstreamResponseFromError } from '../execute.js'
import type { LLMCallContext } from '../execute.js'
import { emitEvent } from '../../notifications/emitter.js'
import { traceEgress } from '../helpers.js'
import { forwardOpenAIOAuthSSE, streamOpenAIOAuthChunks, chunksToChatResponse, primeStream } from './openaiOAuthForward.js'
import { responsesToChatRequest, chatToResponsesObject, openAIChunksToResponsesSSE } from '../../provider/responses-compat.js'
import type { ResponsesRequest } from '../../provider/responses-compat.js'

/** Build the initial ProxyContext for an OpenAI request. protocol.decode is identity: request === original. */
export function buildOpenAIContext(req: FastifyRequest, reply: FastifyReply): ProxyContext {
  const body = req.body as ChatCompletionRequest
  const conversationId = (req.headers['x-routerly-conversation-id'] as string | undefined) || undefined
  return {
    protocol: 'openai',
    req,
    reply,
    log: req.log,
    router: req.router,
    routerId: req.router.id,
    ...(req.token ? { token: req.token } : {}),
    traceId: randomUUID(),
    ...(conversationId ? { conversationId } : {}),
    original: body,
    request: body,
    stream: body.stream === true,
    passthrough: false,
  }
}

/**
 * Build the ProxyContext for a `/v1/responses` request. Same lane, same routing,
 * same processors: the Responses body is decoded to the canonical chat view here,
 * and `responsesApi` tells egress to encode the answer back.
 */
export function buildResponsesContext(req: FastifyRequest, reply: FastifyReply): ProxyContext {
  const body = req.body as ResponsesRequest
  const chat = responsesToChatRequest(body)
  const ctx = buildOpenAIContext(req, reply)
  ctx.original = body
  ctx.request = chat
  ctx.stream = chat.stream === true
  ctx.responsesApi = true
  return ctx
}

// ─── upstream.prepare: merge guardrail request-injection (steering text) into the outgoing
// system message, reproducing the pre-refactor merge from routes/openai.ts verbatim ───
export const openaiInject: Processor<ProxyContext> = {
  id: 'openai:inject',
  phase: 'upstream.prepare',
  async run(ctx) {
    if (ctx.protocol !== 'openai') return
    if (ctx.result) return
    if (ctx.requestInjectionApplied) return // one-shot: don't re-merge on fallback candidate retries
    const injection = ctx.requestInjection
    if (!injection) return
    const body = ctx.request as { messages?: Array<{ role?: string; content?: unknown }> }
    const messages = body.messages
    if (!Array.isArray(messages)) return
    const sys = messages.find((m) => m?.role === 'system')
    if (sys) {
      if (typeof sys.content === 'string' && sys.content.trim()) sys.content = `${sys.content}\n\n${injection}`
      else if (Array.isArray(sys.content)) sys.content.push({ type: 'text', text: injection })
      else sys.content = injection
    } else {
      messages.unshift({ role: 'system', content: injection })
    }
    ctx.requestInjectionApplied = true
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
    const router = ctx.router
    const endUserId = (body as any).user as string | undefined || undefined

    const cctx: LLMCallContext = {
      routerId: router.id,
      router,
      ...(ctx.token ? { token: ctx.token } : {}),
      callType: 'completion',
      traceId: ctx.traceId,
      ...(ctx.emit ? { emit: ctx.emit } : {}),
      log,
      ...(endUserId ? { endUserId } : {}),
      ...(ctx.guardrailTriggered ? { guardrailTriggered: ctx.guardrailTriggered } : {}),
      ...(ctx.piiRedacted ? { piiRedacted: ctx.piiRedacted } : {}),
      ...(ctx.optimizerStats ? { optimizerStats: ctx.optimizerStats } : {}),
      ...(ctx.req?.experiment ? { experiment: ctx.req.experiment } : {}),
      ...(ctx.conversationId ? { sessionId: ctx.conversationId } : {}),
      ...(ctx.token?.tags ? { tags: ctx.token.tags } : {}),
    }

    // ── openai-oauth: Codex Responses backend, mapped back to OpenAI chunks. ──
    if (model.provider === 'openai-oauth') {
      if (!ctx.stream) {
        // The backend only streams; collapse it so a non-streaming client still works.
        try {
          const chunks = streamOpenAIOAuthChunks(body as Record<string, unknown>, model, log, {
            traceId: ctx.traceId,
            routerId: router.id,
            ...(router.pii ? { pii: router.pii } : {}),
            ...(ctx.token ? { tokenId: ctx.token.id } : {}),
          })
          ctx.result = { kind: 'json', body: await chunksToChatResponse(chunks, model.id) }
        } catch (err) {
          log.warn({ err, modelId: model.id }, 'openai-oauth call failed, trying next candidate')
          ctx.attemptError = err
        }
        return
      }
      if (ctx.responsesApi) {
        // Responses clients need the typed event stream, which egress builds from the
        // chunks: hand them over instead of writing OpenAI SSE bytes here.
        try {
          const chunks = streamOpenAIOAuthChunks(body as Record<string, unknown>, model, log, {
            traceId: ctx.traceId,
            routerId: router.id,
            ...(router.pii ? { pii: router.pii } : {}),
            ...(ctx.token ? { tokenId: ctx.token.id } : {}),
          })
          ctx.result = { kind: 'stream', body: await primeStream(chunks) }
        } catch (err) {
          log.warn({ err, modelId: model.id }, 'openai-oauth call failed, trying next candidate')
          ctx.attemptError = err
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
      }
      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.flushHeaders()
      await forwardOpenAIOAuthSSE(reply.raw, body as Record<string, unknown>, model, log, ctx.traceId, router.id, router.pii, ctx.token?.id)
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
          // Task 7: stash for the routing.execute attempt loop to classify + record at the
          // connection-level resilience key (never for BudgetExceededError, a local skip).
          ctx.attemptError = err
          const attemptResponse = upstreamResponseFromError(err)
          if (attemptResponse !== undefined) ctx.attemptResponse = attemptResponse
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
        ctx.attemptError = err
        const attemptResponse = upstreamResponseFromError(err)
        if (attemptResponse !== undefined) ctx.attemptResponse = attemptResponse
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
    const router = ctx.router
    const log = ctx.log
    // execution: only route to models on enabled connections
    const allModels = await listEffectiveModels()
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
          void emitEvent('routing.fallback_used', 'info', { routerId: router.id, primaryModelId, fallbackModelId: model.id, traceId: ctx.traceId }, { routerId: router.id, log })
        }
        return
      }
      // The fault (if any) was already recorded once by handleProviderResult inside
      // llmChat/llmStream — the single authoritative recorder. The loop only advances to the next
      // candidate here; clearing the stash keeps it from leaking into the next iteration.
      if (ctx.attemptError !== undefined) {
        ctx.attemptError = undefined
        delete ctx.attemptResponse
      }
      if (model.id === primaryModelId) primaryFailed = true
    }

    // All candidates exhausted.
    void emitEvent('routing.no_candidates', 'critical', { routerId: router.id, requestedModel: ctx.request.model ?? null, traceId: ctx.traceId }, { routerId: router.id, log })
    if (ctx.stream) {
      const errorEntry: TraceEntry = { panel: 'response', message: 'model:error', details: { error: 'All candidates unavailable or budget-exhausted' } }
      ctx.emit?.(errorEntry)
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

    if (result.kind === 'passthrough') {
      traceEgress(ctx, { kind: 'passthrough' }) // bytes piped upstream-to-client by openai:upstream
      return
    }

    if (result.kind === 'json') {
      if (result.status) reply.code(result.status)
      reply.send(ctx.responsesApi
        ? chatToResponsesObject(result.body as ChatCompletionResponse, ctx.request.model ?? '', ctx.traceId, ctx.original as ResponsesRequest)
        : result.body)
      traceEgress(ctx, { kind: 'json', status: result.status ?? 200, ...(ctx.responsesApi ? { encoding: 'responses' } : {}) })
      return
    }

    if (result.kind === 'block') {
      if (result.body === undefined) {
        traceEgress(ctx, { kind: 'block', encoding: 'sse', status: 200 }) // a streaming block already wrote its own bytes
        return
      }
      reply.code(result.status ?? 200).send(result.body)
      traceEgress(ctx, { kind: 'block', status: result.status ?? 200 })
      return
    }

    // result.kind === 'stream'
    reply.hijack()
    const origin = ctx.req.headers.origin
    if (origin) {
      reply.raw.setHeader('Access-Control-Allow-Origin', origin)
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true')
    }
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.flushHeaders()

    // The stream carries provider bytes only. Trace entries reach the caller on the
    // management side channel (GET /api/traces/stream), never in this stream.

    // Counted as written, not as produced: a stream that dies mid-flight reports
    // how much of it the client actually got.
    let frames = 0
    let bytes = 0
    let failure: string | undefined

    if (ctx.responsesApi) {
      // Typed event stream: every frame is `event:`-named and the sequence ends on
      // response.completed, with no `[DONE]` sentinel.
      try {
        const events = openAIChunksToResponsesSSE(
          result.body as AsyncIterable<StreamChunk>, ctx.traceId, ctx.request.model ?? '', ctx.original as ResponsesRequest,
        )
        for await (const line of events) {
          reply.raw.write(line)
          frames++
          bytes += line.length
        }
      } catch (err: unknown) {
        ctx.log.error({ err }, 'Streaming error mid-stream')
        failure = err instanceof Error ? err.message : String(err)
      }
      reply.raw.end()
      traceEgress(ctx, { kind: 'stream', encoding: 'responses', frames, bytes, ...(failure ? { error: failure } : {}) })
      return
    }

    try {
      for await (const chunk of result.body as AsyncIterable<unknown>) {
        const line = `data: ${JSON.stringify(chunk)}\n\n`
        reply.raw.write(line)
        frames++
        bytes += line.length
      }
    } catch (err: unknown) {
      ctx.log.error({ err }, 'Streaming error mid-stream')
      failure = err instanceof Error ? err.message : String(err)
    }
    reply.raw.write('data: [DONE]\n\n')
    reply.raw.end()
    traceEgress(ctx, { kind: 'stream', encoding: 'sse', frames, bytes, ...(failure ? { error: failure } : {}) })
  },
}

export const openaiTransportProcessors: Processor<ProxyContext>[] = [openaiInject, openaiUpstream, openaiAttempt, openaiEgress]
