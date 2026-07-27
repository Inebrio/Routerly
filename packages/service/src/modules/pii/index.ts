import { defineModule, type Processor, type RouterlyModule } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import type { ChatCompletionRequest } from '@routerly/shared'
import { mergePolicies, scrubMessages } from './piiScrubber.js'
import { appendTrace } from '../logging/traceStore.js'
import { applyResponseScrub, wrapWithStreamingScrubber } from '../reverse-proxy/helpers.js'

const input: Processor<ProxyContext> = {
  id: 'pii.input',
  phase: 'request.preprocess',
  weight: -10, // runs first: the judge (guardrail.request) must never see raw PII.
  run(ctx) {
    if (ctx.result) return
    const policies = ctx.project.pii?.policies
    if (!policies?.length) return
    const effective = mergePolicies(policies, 'input')
    if (!(effective.entities?.length || effective.customPatterns?.length)) return
    if (!Array.isArray(ctx.request.messages)) return
    ctx.piiInput = effective
    const { messages, redacted } = scrubMessages(ctx.request.messages, effective)
    appendTrace(ctx.traceId, [{ panel: 'request', message: 'pii:evaluated', details: { redacted } }])
    if (redacted.length > 0) {
      ;(ctx.request as { messages?: unknown[] }).messages = messages as ChatCompletionRequest['messages']
      ctx.piiRedacted = redacted
      appendTrace(ctx.traceId, [{ panel: 'request', message: 'pii:scrubbed', details: { entities: redacted } }])
    }
  },
}

const output: Processor<ProxyContext> = {
  id: 'pii.output',
  phase: 'response.postprocess',
  weight: -10, // runs FIRST in the phase, so it wraps the stream BEFORE guardrail.response does.
  run(ctx) {
    // Asymmetry: output PII is an OpenAI-lane concern only (routes/anthropic.ts has none).
    if (ctx.protocol !== 'openai') return
    const policies = ctx.project.pii?.policies
    if (!policies?.length) return
    const effective = mergePolicies(policies, 'output')
    if (!(effective.entities?.length || effective.customPatterns?.length)) return
    ctx.piiOutput = effective
    // Non-streaming JSON: scrub the completed body in place.
    if (ctx.result?.kind === 'json') {
      applyResponseScrub(ctx, effective)
      return
    }
    // Streaming: WRAP the raw provider iterator with the per-chunk StreamingScrubber. This is the
    // innermost wrapper (pii.output runs first via weight -10); guardrail.response wraps around it
    // second, so the guardrail buffer sees already-scrubbed text, identical to today's inline order.
    // wrapWithStreamingScrubber lives in Plan 4's reverse-proxy/helpers.ts.
    if (ctx.result?.kind === 'stream') {
      ctx.result.body = wrapWithStreamingScrubber(ctx.result.body as AsyncIterable<unknown>, effective, ctx)
    }
  },
}

export const piiModule: RouterlyModule = defineModule({
  manifest: { id: 'pii', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } },
  register({ container }) {
    const pipeline = container.resolve(PROXY_PIPELINE)
    pipeline.contribute(input)
    pipeline.contribute(output)
  },
})
