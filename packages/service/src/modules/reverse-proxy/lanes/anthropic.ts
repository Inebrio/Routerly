import { randomUUID } from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { MessagesRequest, ChatCompletionRequest, StreamChunk } from '@routerly/shared'
import type { Processor } from '../../../core/index.js'
import type { ProxyContext } from '../context.js'
import { getProxyPipeline } from '../run.js'
import { listEffectiveModels } from '../../provider/list-effective.js'
import { llmChat, llmStream, BudgetExceededError, upstreamResponseFromError } from '../execute.js'
import type { LLMCallContext } from '../execute.js'
import { traceEgress } from '../helpers.js'
import { forwardAnthropicOAuth, forwardAnthropicApiKey } from './oauthForward.js'
import { streamOpenAIOAuthChunks, chunksToChatResponse, primeStream } from './openaiOAuthForward.js'
import {
  anthropicToChatRequest, openAIToAnthropicResponse, openAIChunksToAnthropicSSE,
} from '../../provider/messages-compat.js'

/** Convert a MessagesRequest to an OpenAI-compat ChatCompletionRequest for non-Anthropic providers. */
const toChat = (body: MessagesRequest): ChatCompletionRequest => anthropicToChatRequest(body)

export function buildAnthropicContext(req: FastifyRequest, reply: FastifyReply): ProxyContext {
  const body = req.body as MessagesRequest
  const conversationId = (req.headers['x-routerly-conversation-id'] as string | undefined) || undefined
  return {
    protocol: 'anthropic',
    req,
    reply,
    log: req.log,
    project: req.project,
    projectId: req.project.id,
    ...(req.token ? { token: req.token } : {}),
    traceId: randomUUID(),
    ...(conversationId ? { conversationId } : {}),
    original: body,
    request: body as unknown as ChatCompletionRequest, // canonical view built per-candidate via toChat
    stream: body.stream === true,
    passthrough: false,
  }
}

// ─── upstream.prepare: merge guardrail request-injection (steering text) into the outgoing
// system field, reproducing the pre-refactor merge from routes/anthropic.ts verbatim ───
export const anthropicInject: Processor<ProxyContext> = {
  id: 'anthropic:inject',
  phase: 'upstream.prepare',
  async run(ctx) {
    if (ctx.protocol !== 'anthropic') return
    if (ctx.result) return
    if (ctx.requestInjectionApplied) return // one-shot: don't re-merge on fallback candidate retries
    const injection = ctx.requestInjection
    if (!injection) return
    const body = ctx.original as MessagesRequest
    if (typeof body.system === 'string' && body.system.trim()) body.system = `${body.system}\n\n${injection}`
    else if (Array.isArray(body.system)) body.system.push({ type: 'text', text: injection })
    else body.system = injection
    ctx.requestInjectionApplied = true
  },
}

// ─── upstream.execute: passthrough forward OR toChat+llmChat/llmStream (anthropic.ts L220-286) ──
export const anthropicUpstream: Processor<ProxyContext> = {
  id: 'anthropic:upstream',
  phase: 'upstream.execute',
  async run(ctx) {
    if (ctx.protocol !== 'anthropic') return
    if (ctx.result) return
    const attempt = ctx.attempt
    if (!attempt) return
    const model = attempt.model
    const body = ctx.original as MessagesRequest
    const req = ctx.req
    const reply = ctx.reply
    const log = ctx.log
    const project = ctx.project
    const endUserId = (body as any).user as string | undefined || undefined

    // ── OAuth models: verbatim pass-through with OAuth token (anthropic.ts L221-224). ──
    if (model.provider === 'anthropic-oauth') {
      ctx.passthrough = true
      await forwardAnthropicOAuth(req, reply, model)
      ctx.result = { kind: 'passthrough' }
      return
    }

    // ── Anthropic API-key / web models: verbatim pass-through (anthropic.ts L229-232). ──
    if (model.provider === 'anthropic' || model.provider === 'anthropic-web') {
      ctx.passthrough = true
      await forwardAnthropicApiKey(req, reply, model)
      ctx.result = { kind: 'passthrough' }
      return
    }

    // ── openai-oauth speaks the Responses API only. streamOpenAIOAuthChunks maps it
    //    back to OpenAI chunks, so tool calls and text render through the same egress
    //    converter as every other non-Anthropic provider. ──
    if (model.provider === 'openai-oauth') {
      try {
        const chunks = streamOpenAIOAuthChunks(toChat(body), model, log, {
          traceId: ctx.traceId,
          projectId: project.id,
          ...(project.pii ? { pii: project.pii } : {}),
          ...(ctx.token ? { tokenId: ctx.token.id } : {}),
        })
        if (!body.stream) {
          const chatResp = await chunksToChatResponse(chunks, model.id)
          ctx.result = { kind: 'json', body: openAIToAnthropicResponse(chatResp, body.model, `msg_${ctx.traceId}`) }
          return
        }
        // Primed so an auth or upstream failure advances to the next candidate
        // instead of opening a stream that turns out to be empty.
        ctx.result = { kind: 'stream', body: await primeStream(chunks) }
      } catch (err) {
        log.warn({ err, modelId: model.id }, 'openai-oauth call failed, trying next candidate')
        ctx.attemptError = err
      }
      return
    }

    // ── Non-Anthropic providers: convert format and call the executor. ──
    const cctx: LLMCallContext = {
      projectId: project.id,
      project,
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

    if (body.stream) {
      try {
        const streamResult = await llmStream(toChat(body), model, cctx)
        ctx.result = { kind: 'stream', body: streamResult.chunks }
      } catch (err) {
        if (!(err instanceof BudgetExceededError)) {
          log.warn({ err, modelId: model.id }, 'Anthropic messages stream failed, trying next candidate')
          // Task 7: stash for the routing.execute attempt loop to classify + record at the
          // connection-level resilience key (never for BudgetExceededError, a local skip).
          ctx.attemptError = err
          const attemptResponse = upstreamResponseFromError(err)
          if (attemptResponse !== undefined) ctx.attemptResponse = attemptResponse
        }
        // leave ctx.result unset -> anthropic:attempt advances
      }
      return
    }

    try {
      const chatResp = await llmChat(toChat(body), model, cctx)
      ctx.result = { kind: 'json', body: openAIToAnthropicResponse(chatResp, body.model, `msg_${ctx.traceId}`) }
    } catch (err: unknown) {
      if (!(err instanceof BudgetExceededError)) {
        log.warn({ err, modelId: model.id }, 'Anthropic messages call failed, trying next candidate')
        ctx.attemptError = err
        const attemptResponse = upstreamResponseFromError(err)
        if (attemptResponse !== undefined) ctx.attemptResponse = attemptResponse
      }
      // leave ctx.result unset -> anthropic:attempt advances
    }
  },
}

// ─── routing.execute: candidate fallback loop, NO events (anthropic.ts L216-292). ─────
export const anthropicAttempt: Processor<ProxyContext> = {
  id: 'anthropic:attempt',
  phase: 'routing.execute',
  async run(ctx) {
    if (ctx.protocol !== 'anthropic') return
    if (ctx.result) return
    const pipeline = getProxyPipeline()
    // execution: only route to models on enabled connections
    const allModels = await listEffectiveModels()
    const sorted = [...(ctx.candidates ?? [])].sort((a, b) => b.weight - a.weight)

    for (const candidate of sorted) {
      const model = allModels.find((m) => m.id === candidate.model)
      if (!model) continue
      ctx.attempt = { model, candidate }
      await pipeline.runPhase('upstream.prepare', ctx) // Plan 5 budget
      if (ctx.result) return
      await pipeline.runPhase('upstream.execute', ctx)
      if (ctx.result) return
      // The fault (if any) was already recorded once by handleProviderResult inside
      // llmChat/llmStream — the single authoritative recorder. The loop only advances to the next
      // candidate here; clearing the stash keeps it from leaking into the next iteration.
      if (ctx.attemptError !== undefined) {
        ctx.attemptError = undefined
        delete ctx.attemptResponse
      }
    }

    // Exhausted, no events on the Anthropic lane (decision #8).
    ctx.result = { kind: 'block', status: 503, body: { type: 'error', error: { type: 'overloaded_error', message: 'All candidate models are budget-exhausted or unavailable.' } } }
  },
}

// ─── egress: writer. NO hijack, NO CORS on the streaming path (anthropic.ts L261-272). ──
export const anthropicEgress: Processor<ProxyContext> = {
  id: 'anthropic:egress',
  phase: 'egress',
  async run(ctx) {
    if (ctx.protocol !== 'anthropic') return
    const result = ctx.result
    if (!result) return
    const reply = ctx.reply

    if (result.kind === 'passthrough') {
      traceEgress(ctx, { kind: 'passthrough' }) // bytes piped upstream-to-client by anthropic:upstream
      return
    }

    if (result.kind === 'json') {
      if (result.status) reply.status(result.status)
      reply.send(result.body)
      traceEgress(ctx, { kind: 'json', status: result.status ?? 200 })
      return
    }

    if (result.kind === 'block') {
      if (result.body === undefined) {
        traceEgress(ctx, { kind: 'block', encoding: 'sse', status: 200 })
        return
      }
      reply.status(result.status ?? 200).send(result.body)
      traceEgress(ctx, { kind: 'block', status: result.status ?? 200 })
      return
    }

    // result.kind === 'stream', raw SSE headers, NO hijack, NO CORS (anthropic.ts L261-265).
    const body = ctx.original as MessagesRequest
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.flushHeaders()
    let frames = 0
    let bytes = 0
    let failure: string | undefined
    try {
      for await (const line of openAIChunksToAnthropicSSE(result.body as AsyncIterable<StreamChunk>, `msg_${ctx.traceId}`, body.model)) {
        reply.raw.write(line)
        frames++
        bytes += line.length
      }
    } catch (err: unknown) {
      // mid-stream error: nothing to write to the client, but the trace says so.
      failure = err instanceof Error ? err.message : String(err)
    }
    reply.raw.end()
    traceEgress(ctx, { kind: 'stream', encoding: 'anthropic-sse', frames, bytes, ...(failure ? { error: failure } : {}) })
  },
}

export const anthropicTransportProcessors: Processor<ProxyContext>[] = [anthropicInject, anthropicUpstream, anthropicAttempt, anthropicEgress]
