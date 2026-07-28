import type { FastifyRequest, FastifyReply, FastifyBaseLogger } from 'fastify'
import type {
  ChatCompletionRequest,
  ModelConfig,
  ProjectConfig,
  ProjectToken,
  RoutingCandidate,
  UsageInfo,
} from '@routerly/shared'
import type { EffectivePii } from '../pii/piiScrubber.js'
import type { TraceEntry } from '../logging/traceStore.js'

export interface ProxyResult {
  kind: 'stream' | 'json' | 'block' | 'passthrough'
  // stream: body is an AsyncIterable<ChatCompletionChunk> (raw provider stream);
  //         pii.output / guardrail.response WRAP it in response.postprocess (Plan 5,
  //         decision #13 stream-transform-chain); egress pumps the final iterator.
  // json:   full response object for non-streaming.
  // block:  wire-faithful error/block payload + status. If body is present, egress
  //         writes it; if body is omitted the block already wrote its own bytes
  //         (streaming hijack) and egress is a no-op.
  // passthrough: verbatim upstream Response already piped by upstream.execute.
  status?: number
  body?: unknown            // stream: AsyncIterable; json/block: response object
}

export interface ProxyContext {
  // identity / io
  protocol: 'openai' | 'anthropic'
  req: FastifyRequest
  reply: FastifyReply
  log: FastifyBaseLogger

  // auth (decorated by the existing auth plugin, unchanged)
  project: ProjectConfig
  projectId: string
  token?: ProjectToken

  // trace
  traceId: string
  traceEnabled: boolean      // x-routerly-trace === '1'
  traceSuppressed: boolean   // x-routerly-no-trace === '1'
  conversationId?: string

  // request views
  original: unknown                 // raw parsed client body, verbatim
  request: ChatCompletionRequest    // canonical OpenAI view (=== original for the OpenAI lane)
  stream: boolean
  passthrough: boolean              // true = verbatim upstream lane

  // routing / attempt loop
  candidates?: RoutingCandidate[]
  routeTrace?: TraceEntry[]
  attempt?: { model: ModelConfig; candidate: RoutingCandidate }

  // middleware state (built in request.preprocess by Plan 5)
  piiInput?: EffectivePii
  piiOutput?: EffectivePii
  requestInjection?: string | null
  requestInjectionApplied?: boolean // one-shot guard: upstream.prepare re-runs per fallback candidate; merge must apply only once

  // outcome
  result?: ProxyResult
  usage?: UsageInfo
  error?: unknown
  blockedBy?: string          // guardrail rule id that HARD-BLOCKED; consumed by usage.finalize (Plan 5)
  guardrailTriggered?: string // log-only guardrail rule id; threaded into LLMCallContext by upstream.execute; internal usage attribution only
  piiRedacted?: string[]      // input-scrub redaction list; threaded into LLMCallContext for usage attribution
}
