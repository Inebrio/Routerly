// packages/service/src/modules/guardrails.ts
import { defineModule, shortCircuit, type Processor, type RouterlyModule } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { checkGuardrails, buildRequestInjection } from './guardrails.js'
import { appendTrace } from '../logging/traceStore.js'
import { BudgetExceededError } from '../../llm/executor.js'
import {
  buildContentFilterBlock,
  writeOpenAIStreamingBlock,
  primaryText,
  conversationText,
  assembledResponseText,
  wrapWithResponseGuardrail,
} from '../../reverse-proxy/helpers.js'

const request: Processor<ProxyContext> = {
  id: 'guardrail.request',
  phase: 'request.preprocess',
  after: ['pii.input'],
  async run(ctx) {
    if (ctx.result) return
    const guardrails = ctx.project.guardrails
    if (!guardrails) return
    const pctx = { projectId: ctx.project.id, project: ctx.project, ...(ctx.token ? { token: ctx.token } : {}) }
    let result: Awaited<ReturnType<typeof checkGuardrails>>
    try {
      result = await checkGuardrails(
        'request',
        primaryText(ctx.request),
        guardrails,
        pctx,
        ctx.log,
        conversationText(ctx.request),
      )
    } catch (err: unknown) {
      if (!(err instanceof BudgetExceededError)) throw err
      // Over-limit guardrail judge call: fail like an over-limit completion (matches routes/*.ts today).
      if (ctx.traceEnabled) ctx.reply.header('x-routerly-trace-id', ctx.traceId)
      const message = 'Usage limit exceeded by content-guardrail check.'
      ctx.result = ctx.protocol === 'anthropic'
        ? { kind: 'block', status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message } } }
        : { kind: 'block', status: 429, body: { error: { message, type: 'insufficient_quota' } } }
      return shortCircuit(ctx.result)
    }
    if (result.evaluated.length > 0) {
      appendTrace(ctx.traceId, [{ panel: 'request', message: 'guardrail:evaluated', details: { target: 'request', rules: result.evaluated } }])
    }
    if (result.triggered) {
      const blockMessage = result.blockMessage ?? 'This request was blocked by content guardrails.'
      appendTrace(ctx.traceId, [{ panel: 'request', message: 'guardrail:triggered', details: { rule: result.triggered, target: 'request', block: result.block, log: result.log, blockMessage } }])
      if (result.block) {
        ctx.blockedBy = result.triggered
        if (ctx.protocol === 'openai' && ctx.stream) {
          // buildContentFilterBlock is JSON-only; the streaming request-block has its
          // own wire form (hijack + SSE content_filter chunk + [DONE]) and sets its
          // own trace header on the raw stream (routes/openai.ts L178-197 verbatim).
          writeOpenAIStreamingBlock(ctx)
        } else {
          if (ctx.traceEnabled) ctx.reply.header('x-routerly-trace-id', ctx.traceId)
          // Plan 4 owns the wire-faithful content_filter payload shape; this reuses it unchanged.
          ctx.result = buildContentFilterBlock(ctx)
        }
        return shortCircuit(ctx.result)
        // ponytail: driver stops the pipeline on shortCircuit; usage.finalize still runs (finalize is "always").
      }
      // Matched but non-blocking (log-only): record the trigger for internal usage attribution.
      if (result.log) ctx.guardrailTriggered = result.triggered
    }
    // No block: steer the serving model via the opt-in injection (wire-payload change allowed as a guardrail feature).
    const injection = buildRequestInjection(guardrails)
    if (injection) ctx.requestInjection = injection
  },
}

const response: Processor<ProxyContext> = {
  id: 'guardrail.response',
  phase: 'response.postprocess',
  after: ['pii.output'], // wraps SECOND, so it sees already-PII-scrubbed text (matches today's inline order).
  async run(ctx) {
    // Asymmetry: response guardrails are an OpenAI-lane concern only (routes/anthropic.ts has none).
    if (ctx.protocol !== 'openai') return
    if (ctx.result?.kind === 'block') return
    const guardrails = ctx.project.guardrails
    if (!guardrails) return
    const pctx = { projectId: ctx.project.id, project: ctx.project, ...(ctx.token ? { token: ctx.token } : {}) }
    if (ctx.result?.kind === 'stream') {
      // Streaming: header already set by egress when the stream opened (unconditional,
      // block-or-not), no header call needed here. WRAP the (already-PII-wrapped)
      // iterator with the SSE-buffering guardrail transform.
      ctx.result.body = wrapWithResponseGuardrail(
        ctx.result.body as AsyncIterable<unknown>,
        ctx.project,
        pctx,
        ctx.log,
        ctx,
      )
      return
    }
    if (ctx.result?.kind !== 'json') return
    // Non-streaming JSON: check the assembled content in place.
    const content = assembledResponseText(ctx)
    if (!content) return
    const result = await checkGuardrails('response', content, guardrails, pctx, ctx.log)
    if (result.evaluated.length > 0) {
      appendTrace(ctx.traceId, [{ panel: 'response', message: 'guardrail:evaluated', details: { target: 'response', rules: result.evaluated } }])
    }
    if (result.triggered) {
      const blockMessage = result.blockMessage ?? 'Response blocked by content guardrails.'
      appendTrace(ctx.traceId, [{ panel: 'response', message: 'guardrail:response-triggered', details: { rule: result.triggered, target: 'response', block: result.block, log: result.log, blockMessage } }])
      if (result.block) {
        ctx.blockedBy = result.triggered
        if (ctx.traceEnabled) ctx.reply.header('x-routerly-trace-id', ctx.traceId)
        ctx.result = buildContentFilterBlock(ctx)
      } else if (result.log) {
        ctx.guardrailTriggered = result.triggered
      }
    }
  },
}

export const guardrailsModule: RouterlyModule = defineModule({
  manifest: { id: 'guardrails', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } },
  register({ container }) {
    const pipeline = container.resolve(PROXY_PIPELINE)
    pipeline.contribute(request)
    pipeline.contribute(response)
  },
})
