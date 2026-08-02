import type { FastifyBaseLogger } from 'fastify'
import type {
  ChatCompletionRequest, ChatCompletionResponse, MessagesRequest, ProjectConfig, StreamChunk,
} from '@routerly/shared'
import type { ProxyContext, ProxyResult } from './context.js'
import { StreamingScrubber, scrubText } from '../pii/piiScrubber.js'
import type { EffectivePii } from '../pii/piiScrubber.js'
import { checkGuardrails } from '../guardrails/guardrails.js'
import { chatToResponsesObject, openAIChunksToResponsesSSE } from '../provider/responses-compat.js'
import type { ResponsesRequest } from '../provider/responses-compat.js'

// ponytail: string|array content extraction, the exact inline helper from both routes.
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text as string)
      .join('\n')
  }
  return ''
}

/**
 * Wire-faithful content_filter / refusal block payload.
 * OpenAI: 200 chat.completion with one empty-content choice, finish_reason content_filter
 * (openai.ts L200-201). Anthropic: 200 message with empty content + stop_reason refusal
 * (anthropic.ts L162-163). blockMessage is intentionally NOT on the wire (trace only).
 */
export function buildContentFilterBlock(ctx: ProxyContext): ProxyResult {
  const created = Math.floor(Date.now() / 1000)
  if (ctx.protocol === 'anthropic') {
    const body = ctx.original as MessagesRequest
    return {
      kind: 'block',
      status: 200,
      body: {
        id: `msg_${ctx.traceId}`, type: 'message', role: 'assistant', content: [],
        model: body.model ?? 'unknown', stop_reason: 'refusal', stop_details: { type: 'refusal' },
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }
  }
  const body = ctx.request
  const chat: ChatCompletionResponse = {
    id: `chatcmpl-${ctx.traceId}`, object: 'chat.completion', created, model: body.model ?? '',
    choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'content_filter' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
  // /v1/responses reports the same block as a `response` object: same status, same
  // empty answer, the shape its clients can parse.
  return {
    kind: 'block',
    status: 200,
    body: ctx.responsesApi
      ? chatToResponsesObject(chat, body.model ?? '', ctx.traceId, ctx.original as ResponsesRequest)
      : chat,
  }
}

/**
 * Streaming request-block wire form (routes/openai.ts L178-197, moved verbatim).
 * buildContentFilterBlock is JSON-only; a hard-blocked streaming request needs a
 * hijack + SSE content_filter chunk + [DONE] instead. Leaves ProxyResult.body
 * undefined so egress treats it as already-written (ProxyResult.kind 'block' doc:
 * "if body is omitted the block already wrote its own bytes").
 */
export async function writeOpenAIStreamingBlock(ctx: ProxyContext): Promise<void> {
  const reply = ctx.reply
  reply.hijack()
  const origin = ctx.req.headers.origin as string | undefined
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
  const body = ctx.request
  const blocked: StreamChunk = {
    id: `chatcmpl-${ctx.traceId}`, object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000), model: body.model ?? '',
    choices: [{ index: 0, delta: {}, finish_reason: 'content_filter' }],
  }
  if (ctx.responsesApi) {
    // Same block, encoded as the typed event sequence: an empty response that ends
    // `incomplete` with reason content_filter, and no `[DONE]`.
    const events = openAIChunksToResponsesSSE(
      (async function* () { yield blocked })(), ctx.traceId, body.model ?? '', ctx.original as ResponsesRequest,
    )
    for await (const line of events) {
      reply.raw.write(line)
    }
    reply.raw.end()
    ctx.result = { kind: 'block' }
    return
  }
  reply.raw.write(`data: ${JSON.stringify(blocked)}\n\n`)
  reply.raw.write('data: [DONE]\n\n')
  reply.raw.end()
  ctx.result = { kind: 'block' }
}

/** Last user message text, the guardrail "request" primary text (openai.ts L151-152). */
export function primaryText(request: Pick<ChatCompletionRequest, 'messages'>): string {
  const msgs = request.messages ?? []
  const lastUserMsg = [...msgs].reverse().find((m: any) => m?.role === 'user')
  return messageText((lastUserMsg as any)?.content)
}

/**
 * Full conversation text for multi-turn guardrail scanning (openai.ts L153).
 * Uses `m?.role ?? 'user'` (the OpenAI form). Assumes well-formed, Zod-validated
 * messages (Anthropic always carries a role); on that assumption the `?? 'user'`
 * fallback never fires and the bytes are identical to anthropic.ts's inline code.
 */
export function conversationText(request: Pick<ChatCompletionRequest, 'messages'>): string {
  const msgs = request.messages ?? []
  return msgs.map((m: any) => `${m?.role ?? 'user'}: ${messageText(m?.content)}`).join('\n')
}

/** Assembled non-streaming response text for the response guardrail (openai.ts L511). */
export function assembledResponseText(ctx: ProxyContext): string {
  const body = ctx.result?.body as ChatCompletionResponse | undefined
  const content = body?.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : ''
}

/**
 * Non-streaming output PII scrub, in place, per first choice (openai.ts L493-506).
 * Returns the found entity list; the caller (Plan 5 pii.output) emits the trace.
 * Callers MUST gate this behind a "should scrub" check (entities/patterns configured)
 * themselves: scrubText defaults to ALL_ENTITIES when effective.entities is undefined,
 * and this function does not gate that on its own.
 */
export function applyResponseScrub(ctx: ProxyContext, effective: EffectivePii): string[] {
  const response = ctx.result?.body as ChatCompletionResponse | undefined
  const content = response?.choices?.[0]?.message?.content
  if (typeof content !== 'string') return []
  const { text, found } = scrubText(content, effective)
  if (found.length > 0 && response) response.choices![0]!.message.content = text
  return found
}

/**
 * Streaming output PII scrub as an async generator (openai.ts L338-372, reshaped).
 * Per-chunk StreamingScrubber.push, then a trailing flush chunk if the scrubber
 * held a partial match. The scrubber's `found` set is exposed on the last chunk's
 * generator return; Plan 5 pii.output reads it via the shared scrubber ref if it
 * needs the trace. Flush chunk id/model come from ctx (roadmap sig lacked them).
 */
export async function* wrapWithStreamingScrubber(
  iter: AsyncIterable<any>,
  effective: EffectivePii,
  ctx: ProxyContext,
): AsyncGenerator<unknown> {
  const scrubber = new StreamingScrubber(effective)
  for await (const chunk of iter) {
    let outChunk = chunk
    const delta = chunk.choices?.[0]?.delta?.content
    if (typeof delta === 'string' && delta.length > 0) {
      const scrubbed = scrubber.push(delta)
      const c0 = chunk.choices![0]!
      outChunk = { ...chunk, choices: [{ index: c0.index, finish_reason: c0.finish_reason, delta: { ...c0.delta, content: scrubbed } }] }
    }
    yield outChunk
  }
  const remaining = scrubber.flush()
  if (remaining) {
    yield {
      id: `chatcmpl-${ctx.traceId}`, object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000), model: ctx.request.model ?? '',
      choices: [{ index: 0, delta: { content: remaining }, finish_reason: null }],
    }
  }
}

/**
 * Streaming response-guardrail as an async generator (openai.ts L327-402, reshaped).
 * When a response-target block rule is active it BUFFERS chunks, accumulates the
 * full content, runs checkGuardrails('response') after the stream ends, and either
 * drops the buffer + emits a content_filter chunk (block) or flushes the buffer.
 * On block it sets ctx.blockedBy (usage.finalize records it, replaces the inline
 * trackBlockedRequest). Receives already-PII-scrubbed chunks (pii.output wraps first).
 */
export async function* wrapWithResponseGuardrail(
  iter: AsyncIterable<any>,
  project: ProjectConfig,
  guardrailPctx: unknown,
  log: FastifyBaseLogger,
  ctx: ProxyContext,
): AsyncGenerator<unknown> {
  const bufferForGuardrail = project.guardrails?.rules.some(
    (r: any) => r.enabled !== false && r.block === true && (r.target === 'response' || r.target === 'both'),
  ) ?? false
  const buffered: unknown[] = []
  let fullContent = ''

  for await (const chunk of iter) {
    const d = chunk.choices?.[0]?.delta?.content
    if (typeof d === 'string' && d) fullContent += d
    if (bufferForGuardrail) buffered.push(chunk)
    else yield chunk
  }

  if (project.guardrails && fullContent) {
    const result = await checkGuardrails('response', fullContent, project.guardrails, guardrailPctx as any, log)
    const hit = result.triggered ? { triggered: result.triggered } : null
    if (hit && result.block) {
      ctx.blockedBy = hit.triggered
      yield {
        id: `chatcmpl-${ctx.traceId}`, object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000), model: ctx.request.model ?? '',
        choices: [{ index: 0, delta: {}, finish_reason: 'content_filter' }],
      }
      return // buffered chunks dropped
    }
    for (const c of buffered) yield c
  } else {
    for (const c of buffered) yield c
  }
}
