import type { FastifyRequest, FastifyReply, FastifyBaseLogger } from 'fastify'
import type {
  ChatCompletionRequest,
  ModelConfig,
  OptimizerCallStat,
  RouterConfig,
  RouterToken,
  RoutingCandidate,
  UsageInfo,
} from '@routerly/shared'
import type { EffectivePii } from '../pii/piiScrubber.js'
import type { TraceEntry } from '@routerly/shared'
import type { UpstreamResponse } from '../resilience/classifier.js'

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
  router: RouterConfig
  routerId: string
  token?: RouterToken

  // trace
  traceId: string
  /**
   * Id the caller chose for this request (`x-routerly-trace`), so it can follow the
   * trace on the management side channel. Request-only: it is never forwarded
   * upstream and never appears on the response.
   */
  correlationId?: string
  /** Publishes a trace entry on the kernel event bus. Installed by trace.ingress. */
  emit?: (entry: TraceEntry) => void
  /** Mirror of `router.traceContent`, read once by trace.ingress. */
  captureContent?: boolean
  /** Phase currently being walked, stamped by runProxy so emitters need not repeat it. */
  phase?: string
  conversationId?: string

  // request views
  original: unknown                 // raw parsed client body, verbatim
  request: ChatCompletionRequest    // canonical OpenAI view (=== original for the OpenAI lane)
  stream: boolean
  passthrough: boolean              // true = verbatim upstream lane
  // /v1/responses: same lane, same routing, different wire shape on the way out. The
  // request is decoded to the chat view up front (responses-compat), so only egress
  // and the byte-writing block paths need to know.
  responsesApi?: boolean

  // routing / attempt loop
  candidates?: RoutingCandidate[]
  attempt?: { model: ModelConfig; candidate: RoutingCandidate }
  // Task 7 (resilience): the upstream.execute processor stashes a failed candidate's raw error
  // here (never for BudgetExceededError — that's a local skip, not an upstream fault) so the
  // routing.execute attempt loop can classify + record it at the connection-level resilience key
  // without re-catching the same error a second time. Cleared by the attempt loop after use.
  attemptError?: unknown
  attemptResponse?: UpstreamResponse

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
  optimizerStats?: OptimizerCallStat[] // what each optimizer step removed from this prompt; threaded into the usage record (T63)
}
