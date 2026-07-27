import { randomUUID } from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type {
  MessagesRequest, MessagesResponse, ChatCompletionRequest, ChatCompletionResponse, StreamChunk,
} from '@routerly/shared'
import type { Processor } from '../../core/index.js'
import type { ProxyContext } from '../context.js'
import { getProxyPipeline } from '../run.js'
import { readConfig } from '../../config/loader.js'
import { appendTrace } from '../../routing/traceStore.js'
import type { TraceEntry } from '../../routing/traceStore.js'
import { llmChat, llmStream, BudgetExceededError } from '../../llm/executor.js'
import type { LLMCallContext } from '../../llm/executor.js'
import { forwardAnthropicOAuth, forwardAnthropicApiKey } from '../../routes/oauthForward.js'

// ─── protocol translation (anthropic.ts L42-89, moved verbatim) ──────────────────
/** Convert a MessagesRequest to an OpenAI-compat ChatCompletionRequest for non-Anthropic providers. */
function toChat(body: MessagesRequest): ChatCompletionRequest {
  const msgs: Array<{ role: string; content: string }> = []
  if (body.system) {
    msgs.push({ role: 'system', content: typeof body.system === 'string' ? body.system : JSON.stringify(body.system) })
  }
  for (const m of body.messages) {
    msgs.push({
      role: m.role,
      content: typeof m.content === 'string' ? m.content :
        Array.isArray(m.content) ? (m.content as Array<{ type: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text ?? '').join('') : '',
    })
  }
  return { model: body.model, messages: msgs as ChatCompletionRequest['messages'], max_tokens: body.max_tokens, stream: body.stream ?? false, ...(body.temperature != null ? { temperature: body.temperature } : {}), ...(body.top_p != null ? { top_p: body.top_p } : {}) }
}

/** Convert an OpenAI ChatCompletionResponse to Anthropic MessagesResponse. */
function chatToMessages(chat: ChatCompletionResponse, id: string, requestedModel: string): MessagesResponse {
  const choice = chat.choices?.[0]
  const msgContent = choice?.message?.content
  return { id: chat.id || `msg_${id}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: typeof msgContent === 'string' ? msgContent : '' }], model: chat.model || requestedModel, stop_reason: choice?.finish_reason === 'stop' ? 'end_turn' : 'max_tokens', stop_sequence: null, usage: { input_tokens: chat.usage?.prompt_tokens ?? 0, output_tokens: chat.usage?.completion_tokens ?? 0 } }
}

/** Convert OpenAI StreamChunks to Anthropic SSE event lines. */
async function* chunksToAnthropicSSE(
  chunks: AsyncIterable<StreamChunk>,
  msgId: string,
  requestedModel: string,
): AsyncGenerator<string> {
  let started = false
  for await (const chunk of chunks) {
    if (!started) {
      started = true
      const chunkAny = chunk as any
      yield `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', content: [], stop_reason: null, stop_sequence: null, model: chunk.model || requestedModel, usage: { input_tokens: chunkAny.usage?.prompt_tokens ?? 0, output_tokens: 0 } } })}\n\n`
      yield `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`
      yield `event: ping\ndata: {"type":"ping"}\n\n`
    }
    const text = chunk.choices?.[0]?.delta?.content
    if (text) yield `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`
    const finish = chunk.choices?.[0]?.finish_reason
    if (finish) {
      const outTokens = (chunk as any).usage?.completion_tokens ?? 0
      yield `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`
      yield `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: finish === 'stop' ? 'end_turn' : 'max_tokens', stop_sequence: null }, usage: { output_tokens: outTokens } })}\n\n`
      yield `event: message_stop\ndata: {"type":"message_stop"}\n\n`
    }
  }
}

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
    traceEnabled: req.headers['x-routerly-trace'] === '1',
    traceSuppressed: req.headers['x-routerly-no-trace'] === '1',
    ...(conversationId ? { conversationId } : {}),
    original: body,
    request: body as unknown as ChatCompletionRequest, // canonical view built per-candidate via toChat
    stream: body.stream === true,
    passthrough: false,
  }
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
    const traceOptIn = ctx.traceEnabled
    const emit = (entry: TraceEntry) => { appendTrace(ctx.traceId, [entry]) }
    const endUserId = (body as any).user as string | undefined || undefined

    // ── OAuth models: verbatim pass-through with OAuth token (anthropic.ts L221-224). ──
    if (model.provider === 'anthropic-oauth') {
      ctx.passthrough = true
      if (traceOptIn) reply.header('x-routerly-trace-id', ctx.traceId)
      await forwardAnthropicOAuth(req, reply, model)
      ctx.result = { kind: 'passthrough' }
      return
    }

    // ── Anthropic API-key / web models: verbatim pass-through (anthropic.ts L229-232). ──
    if (model.provider === 'anthropic' || model.provider === 'anthropic-web') {
      ctx.passthrough = true
      if (traceOptIn) reply.header('x-routerly-trace-id', ctx.traceId)
      await forwardAnthropicApiKey(req, reply, model)
      ctx.result = { kind: 'passthrough' }
      return
    }

    // ── Non-Anthropic providers: convert format and call the executor. ──
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

    if (body.stream) {
      try {
        const streamResult = await llmStream(toChat(body), model, cctx)
        ctx.result = { kind: 'stream', body: streamResult.chunks }
      } catch (err) {
        if (!(err instanceof BudgetExceededError)) {
          log.warn({ err, modelId: model.id }, 'Anthropic messages stream failed, trying next candidate')
        }
        // leave ctx.result unset -> anthropic:attempt advances
      }
      return
    }

    try {
      const chatResp = await llmChat(toChat(body), model, cctx)
      ctx.result = { kind: 'json', body: chatToMessages(chatResp, ctx.traceId, body.model) }
    } catch (err: unknown) {
      if (!(err instanceof BudgetExceededError)) {
        log.warn({ err, modelId: model.id }, 'Anthropic messages call failed, trying next candidate')
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
    const allModels = await readConfig('models')
    const sorted = [...(ctx.candidates ?? [])].sort((a, b) => b.weight - a.weight)

    for (const candidate of sorted) {
      const model = allModels.find((m) => m.id === candidate.model)
      if (!model) continue
      ctx.attempt = { model, candidate }
      await pipeline.runPhase('upstream.prepare', ctx) // Plan 5 budget
      if (ctx.result) return
      await pipeline.runPhase('upstream.execute', ctx)
      if (ctx.result) return
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
    const traceOptIn = ctx.traceEnabled

    if (result.kind === 'passthrough') return // already piped by anthropic:upstream

    if (result.kind === 'json') {
      if (traceOptIn) reply.header('x-routerly-trace-id', ctx.traceId)
      if (result.status) reply.code(result.status)
      reply.send(result.body)
      return
    }

    if (result.kind === 'block') {
      if (result.body === undefined) return
      // No trace header here: the only block producer in this file (anthropic:attempt's 503)
      // does not set it in the live route today. A future block-producing processor (Plan 5
      // guardrail/budget) that needs the header must call
      // reply.header('x-routerly-trace-id', ctx.traceId) itself before assigning ctx.result,
      // same as routes/anthropic.ts does at its guardrail/refusal block sites, and the
      // identical fix already applied to openai.ts's egress.
      reply.status(result.status ?? 200).send(result.body)
      return
    }

    // result.kind === 'stream', raw SSE headers, NO hijack, NO CORS (anthropic.ts L261-265).
    const body = ctx.original as MessagesRequest
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    if (traceOptIn) reply.raw.setHeader('x-routerly-trace-id', ctx.traceId)
    reply.raw.flushHeaders()
    try {
      for await (const line of chunksToAnthropicSSE(result.body as AsyncIterable<StreamChunk>, `msg_${ctx.traceId}`, body.model)) {
        reply.raw.write(line)
      }
    } catch { /* mid-stream error, nothing to do */ }
    reply.raw.end()
  },
}

export const anthropicTransportProcessors: Processor<ProxyContext>[] = [anthropicUpstream, anthropicAttempt, anthropicEgress]
