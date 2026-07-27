# Reverse-Proxy Pipeline - Transport Layer (Plan 4, DARK)

> **Re-authored 2026-07-26 under roadmap decision #13 (full granular extraction).** The previous version of this file made `openai:chat-core` / `openai:stream-core` monolithic processors that inlined routing, PII, guardrails, budget, usage and egress. That design is SUPERSEDED. Plan 4 now owns **transport only**: the phase runner, the per-lane upstream call, the candidate fallback loop, the egress writer, the verbatim-passthrough forward, and the shared wire-faithful helpers that Plan 5 imports. Everything else (PII, guardrails, routing decision, budget, usage, logging) is a granular concern processor owned by Plan 5.

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` task-by-task. Read `2026-07-26-refactory-roadmap.md` FIRST - it freezes the phase list, the `ProxyContext`/`ProxyResult` shape, the DI tokens, the canonical `buildKernel` wiring, and the "Full-granular reconciliation" section that binds this plan. Where the roadmap and this file disagree, the roadmap wins.

**Goal:** Build the reverse-proxy transport scaffold and the per-lane transport processors, register them under the `PROXY_PIPELINE` token, and publish the pipeline via `setProxyPipeline` - WITHOUT touching `routes/openai.ts` / `routes/anthropic.ts` request handlers. The pipeline is **DARK**: it is fully constructed and unit-tested in isolation, but no live request flows through it. The old inline route handlers keep serving all traffic. The atomic route flip + delete-old-handlers is the FINAL task of Plan 5, gated by the streaming/non-streaming/passthrough curl byte-diff vs `main`. Consequence: Plan 4 has NO route-edit step and NO live curl byte-diff - those moved to Plan 5.

**What Plan 4 builds (and ONLY this):**
- `reverse-proxy/context.ts` - the frozen `ProxyContext` / `ProxyResult` types, including `blockedBy?: string`, `guardrailTriggered?: string`, and `piiRedacted?: string[]` from the start; `ProxyResult.body` documented as an `AsyncIterable` for `kind:'stream'`.
- `reverse-proxy/run.ts` - the closed `PROXY_PHASES` list, the `runProxy` walker, and the set-once `setProxyPipeline` / `getProxyPipeline` accessors the Fastify route layer reads.
- `reverse-proxy/helpers.ts` - the wire-faithful helpers Plan 5's concern processors import (`buildContentFilterBlock`, `primaryText`, `conversationText`, `assembledResponseText`, `applyResponseScrub`, `wrapWithStreamingScrubber`, `wrapWithResponseGuardrail`). Each lifts the corresponding current inline code verbatim; the two `wrap*` helpers reshape the current per-chunk `StreamingScrubber` + guardrail-buffering loops into async generators (the per-chunk logic is copied, not rewritten).
- `reverse-proxy/lanes/openai.ts` - `buildOpenAIContext` + the three OpenAI transport processors: `openai:upstream` (upstream.execute), `openai:attempt` (routing.execute), `openai:egress` (egress).
- `reverse-proxy/lanes/anthropic.ts` - `buildAnthropicContext` + `anthropic:upstream`, `anthropic:attempt`, `anthropic:egress`, plus the file-local protocol-translation helpers moved verbatim (`toChat`, `chatToMessages`, `chunksToAnthropicSSE`).
- `reverse-proxy/module.ts` - `reverseProxyModule = defineModule(...)`; builds a `ProcessorRegistry<ProxyContext>`, contributes ONLY the transport processors, registers it under `PROXY_PIPELINE`, publishes it via `setProxyPipeline`.
- `reverse-proxy/index.ts` - barrel.
- `server.ts` - append `reverseProxyModule` to the `buildKernel([...])` array. NO route-handler change.

**What Plan 4 does NOT build:**
- No `ingress` / `protocol.decode` / `request.preprocess` / `routing.prepare` / `upstream.prepare` / `response.postprocess` / `protocol.encode` / `finalize` processors. Those are Plan 5 concern modules (pii, guardrails, routing, budget, usage, logging).
- No route flip. `routes/openai.ts` and `routes/anthropic.ts` keep their current inline bodies verbatim. The pipeline is dark.
- No live curl byte-diff. Plan 4 is verified by unit tests + a direct `runProxy` harness test (decision #1: no coverage gate). The heavy byte-diff gate is the Plan 5 flip.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` import specifiers, `node:` builtins), Node ≥20, Fastify 5, Vitest.

---

## Architecture - how transport is split across phases

Full-granular means the current inline route body is atomized. Plan 4 owns three phases; Plan 5 fills the rest. A request (after the Plan 5 flip) flows:

```
ingress(P5) → protocol.decode(P5) → request.preprocess(P5 pii+guardrail)
  → routing.prepare(P5: routeRequest → ctx.candidates, ctx.routeTrace)
  → routing.execute(P4 openai:attempt / anthropic:attempt)   ← the candidate fallback loop
       └─ per attempt: upstream.prepare(P5 budget) + upstream.execute(P4 openai:upstream / anthropic:upstream)
  → response.postprocess(P5 pii.output / guardrail.response WRAP ctx.result.body)
  → protocol.encode(P5, currently inline in the anthropic transport)
  → egress(P4 openai:egress / anthropic:egress)              ← the byte-sensitive writer
  → finalize(P5 usage / logging flush)
```

- **`upstream.execute`** (`openai:upstream`, `anthropic:upstream`): the upstream call ONLY. Non-stream → `llmChat` (+ `chatToMessages` on the Anthropic lane) → `ctx.result = { kind:'json', body }`. Stream → `llmStream` → `ctx.result = { kind:'stream', body: <raw provider async-iterable> }` (NOT consumed here). Passthrough provider → `forward*` piped directly → `ctx.result = { kind:'passthrough' }`. No PII, no guardrail, no routing decision, no budget, no usage.
- **`routing.execute`** (`openai:attempt`, `anthropic:attempt`): the candidate fallback loop. Sorts `ctx.candidates` by weight, resolves each candidate to its `ModelConfig`, sets `ctx.attempt`, drives `upstream.prepare` + `upstream.execute` per attempt, breaks on the first that sets `ctx.result`. On the OpenAI lane it emits `routing.fallback_used` (after a successful non-primary attempt) and `routing.no_candidates` (on exhaustion). The Anthropic lane emits NEITHER (decision #8). On exhaustion it sets the wire-faithful terminal result (503 block for JSON; a single-error-chunk stream for streaming).
- **`egress`** (`openai:egress`, `anthropic:egress`): the single byte-sensitive writer. Reads `ctx.result` (already wrapped by Plan 5's response.postprocess after the flip). `json`/`block`-with-body → `reply.send` / `reply.code().send`. `stream` → open the SSE stream (OpenAI: `reply.hijack()` + manual CORS + headers; Anthropic: `reply.raw.setHeader` only, NO hijack, NO CORS - asymmetry preserved), replay buffered trace frames, pump the iterator writing `data: <chunk>\n\n`, write `data: [DONE]\n\n`, end. `passthrough` and already-written streaming `block` → no-op.

**Two lanes, one registry, protocol-guarded.** Every processor self-guards `if (ctx.protocol !== 'openai') return` (resp. `'anthropic'`) so a request only runs its own lane. Ids are lane-prefixed (`openai:upstream`, `anthropic:upstream`) to stay unique in the shared registry. The lanes register DIFFERENT sets - that IS decision #8.

---

## Global Constraints

- **Wire transparency is ABSOLUTE.** Every terminal write in the egress + passthrough + exhaustion paths (`reply.send`, `reply.code().send`, `reply.hijack()`, CORS/SSE headers, `reply.raw.write`/`end`, `data:` frames, trace frames, `[DONE]`) is the current route code MOVED, not rewritten. Status codes and error payload types (`content_filter` / `insufficient_quota` / `server_error` / `invalid_request_error` / `rate_limit_error` / `overloaded_error` / `refusal`) are byte-for-byte `main`. The only way a byte changes is a transcription bug.
- **The pipeline is DARK.** No processor runs against a live request in this plan. Correctness in Plan 4 is proven by unit tests on each processor + a `runProxy` harness test. The live byte-diff is the Plan 5 flip.
- **`ProxyContext` is FROZEN.** Defined in `context.ts` EXACTLY as the roadmap gives it (incl. `blockedBy`, `guardrailTriggered`, `piiRedacted`). No field added, renamed, or reshaped. Internal object, never serialized to the wire.
- **`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`.** Optional context/result fields (`token`, `conversationId`, `candidates`, `routeTrace`, `attempt`, `piiInput`, `piiOutput`, `requestInjection`, `result`, `usage`, `error`, `blockedBy`, `guardrailTriggered`, `piiRedacted`, `status`, `body`) are OMITTED, never set to `undefined`. Build them with conditional spreads: `...(x ? { x } : {})`. Index access returns `T | undefined` - keep the moved code's `!` / `?.` exactly.
- **Passthrough stays verbatim (decision #7).** `openai-oauth` streaming (`forwardOpenAIOAuthSSE`) and `anthropic` / `anthropic-oauth` / `anthropic-web` (`forwardAnthropicApiKey` / `forwardAnthropicOAuth`) are called unchanged and pipe upstream bytes as today. `upstream.execute` sets `ctx.passthrough = true` and `ctx.result = { kind:'passthrough' }`; egress no-ops. No canonicalization touches a passthrough request.
- **Wrapper strategy.** Never reimplement `forwardOpenAIOAuthSSE`, `forwardAnthropic*`, `chunksToAnthropicSSE`, `toChat`, `StreamingScrubber`, `scrubText`, `checkGuardrails`, `llmChat`, `llmStream`. Import and call them. The moved code keeps its direct imports (`readConfig`, executor functions) per the strangler-fig strategy - Plan 4 does NOT resolve these from DI tokens at runtime, it only REGISTERS the pipeline under `PROXY_PIPELINE`.
- **Module system:** NodeNext ESM. Every relative import ends in `.js`. Builtins use `node:`.
- **Canonical wiring (roadmap):** module id `reverse-proxy`, version `'0.4.0'`, `dependsOn: { config: '^0.4.0', provider: '^0.4.0' }`. There is NO `createKernel()`; append `reverseProxyModule` to the `buildKernel([...])` array in `server.ts` (Plans 2/3 built it as `buildKernel([configModule, providerModule])`).
- **English only** for code, comments, identifiers, commits. No em dashes.

**All commands run from `packages/service/`** unless stated. Per-file test run: `npx vitest run <path>`.

---

### Task 1: `ProxyContext` / `ProxyResult` types + the block-aware phase runner

**Files:**
- Create: `packages/service/src/reverse-proxy/context.ts`
- Create: `packages/service/src/reverse-proxy/run.ts`
- Test: `packages/service/src/reverse-proxy/run.test.ts`

**Interfaces:**
- Consumes: `ProcessorRegistry`, `Processor` from `../core/index.js`; Fastify + `@routerly/shared` types.
- Produces:
  - `context.ts`: `interface ProxyResult`, `interface ProxyContext` - the EXACT frozen roadmap shapes, incl. `blockedBy?: string`, `guardrailTriggered?: string`, and `piiRedacted?: string[]`.
  - `run.ts`: `const PROXY_PHASES` (11 ordered names); `async function runProxy(pipeline, ctx): Promise<void>`; `setProxyPipeline` / `getProxyPipeline`.

> **Design note - the walker is NOT `if (ctx.result) return`.** In the old monolithic design a processor wrote the whole response and set `ctx.result`, so any `ctx.result` ended the walk. In full-granular, `upstream.execute` sets `ctx.result = { kind:'json'|'stream'|'passthrough' }` WITHOUT writing - `egress` (a LATER phase) writes it. So a normal result must NOT stop the walk. Only a terminal `block` (a payload a preprocess/budget/guardrail concern already wrote, or a to-be-written error body) short-circuits, and even then `finalize` still runs so usage is recorded (`usage.finalize` reads `ctx.blockedBy`). The roadmap freezes exactly this: "`shortCircuit` (from the kernel) or setting `ctx.result` with `kind:'block'` ends the pipeline early." Intra-phase `shortCircuit` is caught by the kernel's `runPhase` (Plan 1); `runProxy` only handles the cross-phase block skip.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/reverse-proxy/run.test.ts
import { describe, it, expect } from 'vitest'
import { ProcessorRegistry, type Processor } from '../core/index.js'
import { runProxy, PROXY_PHASES, setProxyPipeline, getProxyPipeline } from './run.js'
import type { ProxyContext } from './context.js'

function fakeCtx(): ProxyContext {
  return {} as unknown as ProxyContext
}

const mark = (id: string, phase: string, fn: (c: ProxyContext) => void): Processor<ProxyContext> => ({
  id, phase, run(c) { fn(c) },
})

describe('runProxy', () => {
  it('a kind:"block" result skips every phase except finalize', async () => {
    const reg = new ProcessorRegistry<ProxyContext>()
    const trail: string[] = []
    reg.contribute(mark('a', 'request.preprocess', (c) => {
      trail.push('preprocess')
      c.result = { kind: 'block', status: 200 }
    }))
    reg.contribute(mark('b', 'upstream.execute', () => { trail.push('upstream') }))
    reg.contribute(mark('c', 'finalize', () => { trail.push('finalize') }))
    await runProxy(reg, fakeCtx())
    expect(trail).toEqual(['preprocess', 'finalize']) // upstream skipped, finalize still runs
  })

  it('a kind:"json" result does NOT stop the walk (egress must still run)', async () => {
    const reg = new ProcessorRegistry<ProxyContext>()
    const trail: string[] = []
    reg.contribute(mark('u', 'upstream.execute', (c) => {
      trail.push('upstream')
      c.result = { kind: 'json', body: { ok: true } }
    }))
    reg.contribute(mark('e', 'egress', () => { trail.push('egress') }))
    reg.contribute(mark('f', 'finalize', () => { trail.push('finalize') }))
    await runProxy(reg, fakeCtx())
    expect(trail).toEqual(['upstream', 'egress', 'finalize'])
  })

  it('walks every phase when nothing sets a result', async () => {
    const reg = new ProcessorRegistry<ProxyContext>()
    const seen: string[] = []
    for (const phase of PROXY_PHASES) reg.contribute(mark(`p:${phase}`, phase, () => { seen.push(phase) }))
    await runProxy(reg, fakeCtx())
    expect(seen).toEqual([...PROXY_PHASES])
  })

  it('set/getProxyPipeline round-trips', () => {
    const reg = new ProcessorRegistry<ProxyContext>()
    setProxyPipeline(reg)
    expect(getProxyPipeline()).toBe(reg)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/reverse-proxy/run.test.ts`
Expected: FAIL - cannot find `./context.js` / `./run.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/service/src/reverse-proxy/context.ts
import type { FastifyRequest, FastifyReply, FastifyBaseLogger } from 'fastify'
import type {
  ChatCompletionRequest,
  ModelConfig,
  ProjectConfig,
  ProjectToken,
  RoutingCandidate,
  UsageInfo,
} from '@routerly/shared'
import type { EffectivePii } from '../middleware/piiScrubber.js'
import type { TraceEntry } from '../routing/traceStore.js'

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

  // auth (decorated by the existing auth plugin - unchanged)
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

  // outcome
  result?: ProxyResult
  usage?: UsageInfo
  error?: unknown
  blockedBy?: string          // guardrail rule id that HARD-BLOCKED; consumed by usage.finalize (Plan 5)
  guardrailTriggered?: string // log-only guardrail rule id; threaded into LLMCallContext by upstream.execute; internal usage attribution only
  piiRedacted?: string[]      // input-scrub redaction list; threaded into LLMCallContext for usage attribution
}
```

```ts
// packages/service/src/reverse-proxy/run.ts
import type { ProcessorRegistry } from '../core/index.js'
import type { ProxyContext } from './context.js'

/**
 * The closed, ordered reverse-proxy phase list (roadmap: Frozen phase list).
 * Contrib processors attach to these names; no new phases are introduced.
 * The `error` phase is cross-cutting: a thrown processor propagates to Fastify
 * exactly as an unhandled throw does in the current routes, so it is not walked.
 */
export const PROXY_PHASES = [
  'ingress',
  'protocol.decode',
  'request.preprocess',
  'routing.prepare',
  'routing.execute',
  'upstream.prepare',
  'upstream.execute',
  'response.postprocess',
  'protocol.encode',
  'egress',
  'finalize',
] as const

/**
 * Walk the phases in order. A normal result (json / stream / passthrough) does
 * NOT stop the walk - egress (a later phase) still writes it and finalize still
 * records usage. Only a terminal `kind:'block'` short-circuits the middle phases;
 * `finalize` always runs so usage.finalize can record a guardrail-blocked request
 * (roadmap: "shortCircuit or ctx.result with kind:'block' ends the pipeline early").
 * Intra-phase shortCircuit is caught by the kernel's runPhase (Plan 1).
 */
export async function runProxy(
  pipeline: ProcessorRegistry<ProxyContext>,
  ctx: ProxyContext,
): Promise<void> {
  for (const phase of PROXY_PHASES) {
    if (ctx.result?.kind === 'block' && phase !== 'finalize') continue
    await pipeline.runPhase(phase, ctx)
  }
}

// The Fastify route layer is not a DI consumer, so it cannot resolve the
// PROXY_PIPELINE token from the container. The reverse-proxy module publishes
// the registry here at register time; routes read it back (after the Plan 5 flip).
let current: ProcessorRegistry<ProxyContext> | undefined

export function setProxyPipeline(p: ProcessorRegistry<ProxyContext>): void {
  current = p
}

export function getProxyPipeline(): ProcessorRegistry<ProxyContext> {
  if (!current) throw new Error('reverse-proxy pipeline not initialized')
  return current
}
```

> Type-only imports: `RoutingCandidate`, `UsageInfo`, `ModelConfig`, `ChatCompletionRequest`, `ProjectConfig`, `ProjectToken` from `@routerly/shared`; `EffectivePii` from `../middleware/piiScrubber.js`; `TraceEntry` from `../routing/traceStore.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/reverse-proxy/run.test.ts`
Expected: PASS (4 cases green).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add packages/service/src/reverse-proxy/context.ts packages/service/src/reverse-proxy/run.ts packages/service/src/reverse-proxy/run.test.ts
git commit -m "feat(reverse-proxy): ProxyContext types and block-aware phase runner"
```

---

### Task 2: `helpers.ts` - the wire-faithful helpers Plan 5 imports

Create the shared helpers ONCE, here, so Plan 5's pii/guardrail processors import them (the old Plan 5 draft assumed they existed). Each lifts current inline code verbatim; the two `wrap*` helpers reshape the streaming per-chunk loops into async generators. These helpers are consumed by Plan 5 concern processors - NOT by Plan 4's transport processors - so Plan 4 tests them in isolation.

**Files:**
- Create: `packages/service/src/reverse-proxy/helpers.ts`
- Test: `packages/service/src/reverse-proxy/helpers.test.ts`

**Interfaces:**
- Consumes: `ProxyContext`, `ProxyResult` from `./context.js`; `StreamingScrubber`, `scrubText`, `EffectivePii` from `../middleware/piiScrubber.js`; `checkGuardrails` from `../middleware/guardrails.js`; `@routerly/shared` types.
- Produces:
  - `buildContentFilterBlock(ctx): ProxyResult`
  - `primaryText(request): string`
  - `conversationText(request): string`
  - `assembledResponseText(ctx): string`
  - `applyResponseScrub(ctx, effective): string[]`
  - `wrapWithStreamingScrubber(iter, effective, ctx): AsyncGenerator<unknown>`
  - `wrapWithResponseGuardrail(iter, project, guardrailPctx, log, ctx): AsyncGenerator<unknown>`

> **Signature deviations from the roadmap (flagged, not papered over):** the roadmap sketched `buildContentFilterBlock(protocol, blockMessage?)` and `wrapWithStreamingScrubber(iter, effective)`. The real inline code needs `traceId` + `model` to build the `content_filter` / `refusal` payload and the scrubber flush chunk, and `blockMessage` never reaches the wire (it goes into the trace only). So these take `ctx` (which carries `protocol`, `traceId`, and the request `model`). `wrapWithResponseGuardrail` takes `ctx` so it can set `ctx.blockedBy` on a block (consumed by `usage.finalize`) instead of calling `trackBlockedRequest` inline.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/reverse-proxy/helpers.test.ts
import { describe, it, expect } from 'vitest'
import {
  buildContentFilterBlock, primaryText, conversationText, wrapWithStreamingScrubber,
} from './helpers.js'
import type { ProxyContext } from './context.js'

function ctxOf(partial: Partial<ProxyContext>): ProxyContext {
  return { protocol: 'openai', traceId: 't1', request: { model: 'm', messages: [] }, ...partial } as unknown as ProxyContext
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}

describe('helpers', () => {
  it('buildContentFilterBlock (openai) is the 200 empty-choice content_filter shape', () => {
    const r = buildContentFilterBlock(ctxOf({ protocol: 'openai', request: { model: 'gpt', messages: [] } as any }))
    expect(r.kind).toBe('block')
    expect(r.status).toBe(200)
    const body = r.body as any
    expect(body.object).toBe('chat.completion')
    expect(body.choices[0].finish_reason).toBe('content_filter')
    expect(body.choices[0].message.content).toBe('')
  })

  it('buildContentFilterBlock (anthropic) is the refusal shape', () => {
    const r = buildContentFilterBlock(ctxOf({ protocol: 'anthropic', original: { model: 'claude', messages: [] } } as any))
    const body = r.body as any
    expect(body.type).toBe('message')
    expect(body.stop_reason).toBe('refusal')
    expect(body.stop_details).toEqual({ type: 'refusal' })
  })

  it('primaryText picks the last user message; conversationText joins roles', () => {
    const req = { messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'bye' }] } as any
    expect(primaryText(req)).toBe('bye')
    expect(conversationText(req)).toBe('user: hi\nassistant: yo\nuser: bye')
  })

  it('wrapWithStreamingScrubber passes chunks through unchanged when the scrubber finds nothing', async () => {
    const effective = { entities: [], customPatterns: [] } as any
    async function* src() {
      yield { choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }] }
    }
    const out = await collect(wrapWithStreamingScrubber(src(), effective, ctxOf({})))
    expect((out[0] as any).choices[0].delta.content).toBe('hello')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/reverse-proxy/helpers.test.ts`
Expected: FAIL - cannot find `./helpers.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/service/src/reverse-proxy/helpers.ts
import type { FastifyBaseLogger } from 'fastify'
import type {
  ChatCompletionRequest, ChatCompletionResponse, MessagesRequest, ProjectConfig,
} from '@routerly/shared'
import type { ProxyContext, ProxyResult } from './context.js'
import { StreamingScrubber, scrubText } from '../middleware/piiScrubber.js'
import type { EffectivePii } from '../middleware/piiScrubber.js'
import { checkGuardrails } from '../middleware/guardrails.js'

// ponytail: string|array content extraction - the exact inline helper from both routes.
function messageText(content: unknown): string {
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
  return {
    kind: 'block',
    status: 200,
    body: {
      id: `chatcmpl-${ctx.traceId}`, object: 'chat.completion', created, model: body.model ?? '',
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'content_filter' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    },
  }
}

/** Last user message text - the guardrail "request" primary text (openai.ts L151-152). */
export function primaryText(request: Pick<ChatCompletionRequest, 'messages'>): string {
  const msgs = request.messages ?? []
  const lastUserMsg = [...msgs].reverse().find((m: any) => m?.role === 'user')
  return messageText((lastUserMsg as any)?.content)
}

/**
 * Full conversation text for multi-turn guardrail scanning (openai.ts L153).
 * Uses `m?.role ?? 'user'` (the OpenAI form). Anthropic messages always carry a
 * role, so the `?? 'user'` fallback never fires and the bytes are identical.
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
 */
export function applyResponseScrub(ctx: ProxyContext, effective: EffectivePii): string[] {
  const response = ctx.result?.body as ChatCompletionResponse | undefined
  const content = response?.choices?.[0]?.message?.content
  if (typeof content !== 'string') return []
  const { text, found } = scrubText(content, effective)
  if (found.length > 0) response.choices![0]!.message.content = text
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
 * On block it sets ctx.blockedBy (usage.finalize records it - replaces the inline
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
```

> Transcription note: `wrapWithResponseGuardrail` intentionally omits the `guardrail:evaluated` / `guardrail:response-triggered` trace appends and the log-only `guardrailTriggered` reassignment (dead on the streaming path - the LLMCallContext was already built). Plan 5's `guardrail.response` processor owns the trace emission around this wrapper. The BYTE output (buffered flush vs content_filter chunk) is preserved exactly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/reverse-proxy/helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add packages/service/src/reverse-proxy/helpers.ts packages/service/src/reverse-proxy/helpers.test.ts
git commit -m "feat(reverse-proxy): wire-faithful helpers for Plan 5 concern processors"
```

---

### Task 3: OpenAI transport lane - context builder + `openai:upstream` + `openai:attempt` + `openai:egress`

Build the OpenAI lane's context builder and its three transport processors. No route change; unit-test ordering + a fake-reply egress write.

**Files:**
- Create: `packages/service/src/reverse-proxy/lanes/openai.ts`
- Test: `packages/service/src/reverse-proxy/lanes/openai.test.ts`

**Interfaces:**
- Consumes: `randomUUID`; `readConfig`; `appendTrace`, `TraceEntry`; `llmChat`, `llmStream`, `BudgetExceededError`, `LLMCallContext`; `emitEvent`; `forwardOpenAIOAuthSSE`; `getProxyPipeline`; `Processor`; `ProxyContext`.
- Produces:
  - `function buildOpenAIContext(req, reply): ProxyContext`
  - `const openaiUpstream: Processor<ProxyContext>` (phase `upstream.execute`)
  - `const openaiAttempt: Processor<ProxyContext>` (phase `routing.execute`)
  - `const openaiEgress: Processor<ProxyContext>` (phase `egress`)
  - `const openaiTransportProcessors: Processor<ProxyContext>[]`

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/reverse-proxy/lanes/openai.test.ts
import { describe, it, expect } from 'vitest'
import { ProcessorRegistry } from '../../core/index.js'
import { openaiTransportProcessors, openaiEgress } from './openai.js'
import type { ProxyContext } from '../context.js'

describe('openai transport lane', () => {
  it('contributes upstream.execute + routing.execute + egress, all lane-prefixed', () => {
    const reg = new ProcessorRegistry<ProxyContext>()
    for (const p of openaiTransportProcessors) reg.contribute(p)
    expect(reg.orderedFor('upstream.execute').map((p) => p.id)).toEqual(['openai:upstream'])
    expect(reg.orderedFor('routing.execute').map((p) => p.id)).toEqual(['openai:attempt'])
    expect(reg.orderedFor('egress').map((p) => p.id)).toEqual(['openai:egress'])
    for (const p of openaiTransportProcessors) expect(p.id.startsWith('openai:')).toBe(true)
  })

  it('egress writes a json result via reply.send and honors trace opt-in', async () => {
    const sent: unknown[] = []
    const headers: Record<string, string> = {}
    const reply: any = { send: (b: unknown) => sent.push(b), header: (k: string, v: string) => { headers[k] = v }, code: () => reply }
    const ctx = {
      protocol: 'openai', reply, traceEnabled: true, traceId: 't1',
      result: { kind: 'json', body: { object: 'chat.completion' } },
    } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(sent).toEqual([{ object: 'chat.completion' }])
    expect(headers['x-routerly-trace-id']).toBe('t1')
  })

  it('egress no-ops on passthrough', async () => {
    let called = false
    const reply: any = { send: () => { called = true }, header: () => {}, code: () => reply, hijack: () => { called = true } }
    const ctx = { protocol: 'openai', reply, result: { kind: 'passthrough' } } as unknown as ProxyContext
    await openaiEgress.run(ctx)
    expect(called).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/reverse-proxy/lanes/openai.test.ts`
Expected: FAIL - cannot find `./openai.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/service/src/reverse-proxy/lanes/openai.ts
import { randomUUID } from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { ChatCompletionRequest } from '@routerly/shared'
import type { Processor } from '../../core/index.js'
import type { ProxyContext } from '../context.js'
import { getProxyPipeline } from '../run.js'
import { readConfig } from '../../config/loader.js'
import { appendTrace } from '../../routing/traceStore.js'
import type { TraceEntry } from '../../routing/traceStore.js'
import { llmChat, llmStream, BudgetExceededError } from '../../llm/executor.js'
import type { LLMCallContext } from '../../llm/executor.js'
import { emitEvent } from '../../notifications/emitter.js'
import { forwardOpenAIOAuthSSE } from '../../routes/openaiOAuthForward.js'

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

// ─── upstream.execute: the provider call ONLY (openai.ts L286-314 stream / L456-490 non-stream) ───
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
      token: ctx.token,
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
      if (traceOptIn) reply.header('x-routerly-trace-id', ctx.traceId)
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

export const openaiTransportProcessors: Processor<ProxyContext>[] = [openaiUpstream, openaiAttempt, openaiEgress]
```

> Transcription notes. (1) `cctx.emit` is `appendTrace`-only for BOTH stream and non-stream: egress replays `ctx.routeTrace` for the wire, so mid-request trace does not write live here. The one residual difference vs `main` - executor `emit` calls interleaved live with data chunks mid-stream - is the roadmap's known streaming-interleave risk, reconciled at the Plan 5 flip byte-diff (Plan 4 is dark). (2) `guardrailTriggered` IS threaded into `cctx` via `...(ctx.guardrailTriggered ? { guardrailTriggered: ctx.guardrailTriggered } : {})` (roadmap updated 2026-07-26: the field is now part of the frozen `ProxyContext`; see resolved note below). (3) `openai:attempt` reads `readConfig('models')` to map candidate id → `ModelConfig`; `main` reads it once as `allModels`. This is byte-immaterial (same file, same list).

> **RESOLVED - frozen `ProxyContext` now carries the log-only `guardrailTriggered`.** `main` threads a NON-blocking, log-only guardrail trigger into `LLMCallContext.guardrailTriggered` for usage attribution (openai.ts L465, anthropic.ts L244). The roadmap was updated 2026-07-26 to freeze `guardrailTriggered?: string` on `ProxyContext` alongside `blockedBy` (block-only) and `piiRedacted`. Plan 4 defines it in `context.ts` from the start; Plan 5's `guardrail.request` / `guardrail.response` set it. Both `openai:upstream` and `anthropic:upstream` thread it into `cctx` via `...(ctx.guardrailTriggered ? { guardrailTriggered: ctx.guardrailTriggered } : {})` - the Anthropic non-stream path threads `guardrailTriggered` in `main` (anthropic.ts L244), so the spread applies on both lanes. Affects the internal usage record only, not the wire response (decision #11 already permits internal usage numbers to shift).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/reverse-proxy/lanes/openai.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add packages/service/src/reverse-proxy/lanes/openai.ts packages/service/src/reverse-proxy/lanes/openai.test.ts
git commit -m "feat(reverse-proxy): OpenAI transport lane (upstream + attempt + egress)"
```

---

### Task 4: Anthropic transport lane - context builder + `anthropic:upstream` + `anthropic:attempt` + `anthropic:egress`

Build the Anthropic lane. It does LESS: NO output PII, NO response guardrail, NO SSE buffering, NO fallback/no_candidates events, NO hijack, NO CORS on the streaming path (decision #8). The protocol translation (`toChat`, `chatToMessages`, `chunksToAnthropicSSE`) is done inline in the transport processors, moved verbatim from `anthropic.ts`.

**Files:**
- Create: `packages/service/src/reverse-proxy/lanes/anthropic.ts`
- Test: `packages/service/src/reverse-proxy/lanes/anthropic.test.ts`

**Interfaces:**
- Consumes: `randomUUID`; `readConfig`; `appendTrace`, `TraceEntry`; `llmChat`, `llmStream`, `BudgetExceededError`, `LLMCallContext`; `forwardAnthropicOAuth`, `forwardAnthropicApiKey`; `getProxyPipeline`; `Processor`; `ProxyContext`; `@routerly/shared` types.
- Produces:
  - `function buildAnthropicContext(req, reply): ProxyContext`
  - file-local `toChat` / `chatToMessages` / `chunksToAnthropicSSE` (moved verbatim)
  - `const anthropicUpstream: Processor<ProxyContext>` (phase `upstream.execute`)
  - `const anthropicAttempt: Processor<ProxyContext>` (phase `routing.execute`)
  - `const anthropicEgress: Processor<ProxyContext>` (phase `egress`)
  - `const anthropicTransportProcessors: Processor<ProxyContext>[]`

> **FLAG - `routes/anthropic.ts` imports `llmMessages` + `checkBudget` but never uses them.** The real Anthropic non-stream path is `toChat` → `llmChat` → `chatToMessages` (anthropic.ts L275-280), and streaming is `toChat` → `llmStream` → `chunksToAnthropicSSE`. `llmMessages` and `checkBudget` are dead imports in that file. The roadmap ownership table says "non-stream → `llmChat`/`llmMessages`", but reality uses `llmChat` only. `anthropic:upstream` therefore calls `llmChat`, NOT `llmMessages`, matching the live behavior.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/reverse-proxy/lanes/anthropic.test.ts
import { describe, it, expect } from 'vitest'
import { ProcessorRegistry } from '../../core/index.js'
import { anthropicTransportProcessors, anthropicEgress } from './anthropic.js'
import type { ProxyContext } from '../context.js'

describe('anthropic transport lane', () => {
  it('contributes upstream.execute + routing.execute + egress, all lane-prefixed', () => {
    const reg = new ProcessorRegistry<ProxyContext>()
    for (const p of anthropicTransportProcessors) reg.contribute(p)
    expect(reg.orderedFor('upstream.execute').map((p) => p.id)).toEqual(['anthropic:upstream'])
    expect(reg.orderedFor('routing.execute').map((p) => p.id)).toEqual(['anthropic:attempt'])
    expect(reg.orderedFor('egress').map((p) => p.id)).toEqual(['anthropic:egress'])
    for (const p of anthropicTransportProcessors) expect(p.id.startsWith('anthropic:')).toBe(true)
  })

  it('egress streaming sets raw SSE headers and never hijacks (asymmetry vs OpenAI)', async () => {
    const rawHeaders: Record<string, string> = {}
    const written: string[] = []
    let hijacked = false
    const reply: any = {
      hijack: () => { hijacked = true },
      raw: { setHeader: (k: string, v: string) => { rawHeaders[k] = v }, flushHeaders: () => {}, write: (s: string) => written.push(s), end: () => {} },
      header: () => {}, code: () => reply, send: () => {},
    }
    async function* body() { /* no chunks */ }
    const ctx = {
      protocol: 'anthropic', reply, traceEnabled: false, traceId: 't1',
      original: { model: 'claude', messages: [] },
      result: { kind: 'stream', body: body() },
    } as unknown as ProxyContext
    await anthropicEgress.run(ctx)
    expect(hijacked).toBe(false)
    expect(rawHeaders['Content-Type']).toBe('text/event-stream')
    expect(rawHeaders['Access-Control-Allow-Origin']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/reverse-proxy/lanes/anthropic.test.ts`
Expected: FAIL - cannot find `./anthropic.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/service/src/reverse-proxy/lanes/anthropic.ts
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
      token: ctx.token,
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

    // Exhausted - no events on the Anthropic lane (decision #8).
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
      if (traceOptIn) reply.header('x-routerly-trace-id', ctx.traceId)
      reply.status(result.status ?? 200).send(result.body)
      return
    }

    // result.kind === 'stream' - raw SSE headers, NO hijack, NO CORS (anthropic.ts L261-265).
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
```

> Transcription notes. (1) The Anthropic streaming egress serializes chunks through `chunksToAnthropicSSE` (the protocol.encode step, done inline here as `main` does) - it writes `event:`-prefixed frames, NOT the `data:`-only frames of the OpenAI lane. (2) NO `reply.hijack()` and NO CORS headers on the Anthropic stream - `main` writes to `reply.raw` directly after `flushHeaders()`. Preserve this asymmetry. (3) The `anthropic:attempt` loop emits no `fallback_used` / `no_candidates` events. (4) The routing-failure `503 overloaded_error` (anthropic.ts L208-212) is Plan 5's `routing.prepare` concern, not this loop - the loop only produces the all-candidates-exhausted `503`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/reverse-proxy/lanes/anthropic.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add packages/service/src/reverse-proxy/lanes/anthropic.ts packages/service/src/reverse-proxy/lanes/anthropic.test.ts
git commit -m "feat(reverse-proxy): Anthropic transport lane (upstream + attempt + egress)"
```

---

### Task 5: `module.ts` + `index.ts` barrel + `buildKernel` wiring (DARK) + `runProxy` harness test

Create the module, contribute ONLY the transport processors, register under `PROXY_PIPELINE`, publish via `setProxyPipeline`, and append `reverseProxyModule` to the `server.ts` `buildKernel([...])` array. NO route change. Add a `runProxy` harness test proving the transport phases interoperate end to end with a seeded context.

**Files:**
- Create: `packages/service/src/reverse-proxy/module.ts`
- Create: `packages/service/src/reverse-proxy/index.ts`
- Modify: `packages/service/src/server.ts` (append `reverseProxyModule` to the `buildKernel([...])` array - do NOT touch route registration)
- Test: `packages/service/src/reverse-proxy/pipeline.harness.test.ts`

**Interfaces:**
- Consumes: `defineModule`, `ProcessorRegistry` from `../core/index.js`; `PROXY_PIPELINE` from `../core/tokens.js`; `setProxyPipeline`, `getProxyPipeline`, `runProxy` from `./run.js`; `openaiTransportProcessors`, `anthropicTransportProcessors` from the lanes.
- Produces:
  - `module.ts`: `export const reverseProxyModule = defineModule({ manifest: { id: 'reverse-proxy', version: '0.4.0', dependsOn: { config: '^0.4.0', provider: '^0.4.0' } }, register(reg) { ... } })`
  - `index.ts`: barrel re-exporting the public surface.

- [ ] **Step 1: Write the failing harness test**

```ts
// packages/service/src/reverse-proxy/pipeline.harness.test.ts
import { describe, it, expect } from 'vitest'
import { ProcessorRegistry, type Processor } from '../core/index.js'
import { runProxy, setProxyPipeline } from './run.js'
import { openaiEgress, openaiAttempt } from './lanes/openai.js'
import type { ProxyContext } from './context.js'

// A fake upstream that stands in for openai:upstream, so the harness never hits a
// real provider. It sets a json result for the first candidate.
const fakeUpstream: Processor<ProxyContext> = {
  id: 'openai:upstream', phase: 'upstream.execute',
  run(ctx) {
    if (ctx.protocol !== 'openai' || ctx.result) return
    if (ctx.attempt) ctx.result = { kind: 'json', body: { object: 'chat.completion', model: ctx.attempt.model.id } }
  },
}

describe('runProxy transport harness (dark pipeline, no live route)', () => {
  it('attempt -> upstream -> egress writes the json result', async () => {
    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(openaiAttempt)
    reg.contribute(fakeUpstream)
    reg.contribute(openaiEgress)
    setProxyPipeline(reg)

    const sent: unknown[] = []
    const reply: any = { send: (b: unknown) => sent.push(b), header: () => {}, code: () => reply }
    const ctx = {
      protocol: 'openai', reply, log: { info() {}, warn() {}, error() {} },
      project: { id: 'p1', models: [] }, projectId: 'p1',
      traceId: 't1', traceEnabled: false, traceSuppressed: false,
      request: { model: 'm', messages: [] }, original: {}, stream: false, passthrough: false,
      candidates: [{ model: 'model-a', weight: 1 }],
    } as unknown as ProxyContext

    // openai:attempt reads readConfig('models'); provide model-a via a temp config or
    // stub. Here we assert egress ran given a seeded result by short-circuiting attempt:
    ctx.result = undefined
    await runProxy(reg, ctx)
    // If model-a is not in models.json, attempt exhausts -> 503 block; either way egress runs.
    expect(sent.length).toBe(1)
  })
})
```

> Harness note: `openai:attempt` calls `readConfig('models')`. In the unit harness either (a) seed a temporary `models.json` entry for `model-a` so the fake upstream fires a json result, or (b) accept the exhaustion path (503 block) - both prove `attempt → upstream.execute → egress` walk correctly and egress writes exactly one response. Keep the test hermetic (no provider network). This is the dark-pipeline verification that replaces Plan 4's removed live curl byte-diff.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/reverse-proxy/pipeline.harness.test.ts`
Expected: FAIL - cannot import the lanes / `setProxyPipeline` wiring not yet complete (or the module not built).

- [ ] **Step 3: Write the implementation**

```ts
// packages/service/src/reverse-proxy/module.ts
import { defineModule, ProcessorRegistry } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from './context.js'
import { setProxyPipeline } from './run.js'
import { openaiTransportProcessors } from './lanes/openai.js'
import { anthropicTransportProcessors } from './lanes/anthropic.js'

/**
 * Reverse-proxy TRANSPORT module (Plan 4). Contributes ONLY the per-lane transport
 * processors (upstream call, candidate loop, egress writer). Routing decision, PII,
 * guardrails, budget, usage and logging are Plan 5 concern modules that contribute
 * INTO the same PROXY_PIPELINE registry. The pipeline is dark until Plan 5's flip.
 */
export const reverseProxyModule = defineModule({
  manifest: {
    id: 'reverse-proxy',
    version: '0.4.0',
    dependsOn: { config: '^0.4.0', provider: '^0.4.0' },
  },
  register(reg) {
    const pipeline = new ProcessorRegistry<ProxyContext>()
    for (const p of openaiTransportProcessors) pipeline.contribute(p)
    for (const p of anthropicTransportProcessors) pipeline.contribute(p)
    reg.container.register(PROXY_PIPELINE, pipeline)
    setProxyPipeline(pipeline)
  },
})
```

```ts
// packages/service/src/reverse-proxy/index.ts
export * from './context.js'
export { runProxy, getProxyPipeline, setProxyPipeline, PROXY_PHASES } from './run.js'
export { reverseProxyModule } from './module.js'
export { buildOpenAIContext } from './lanes/openai.js'
export { buildAnthropicContext } from './lanes/anthropic.js'
export {
  buildContentFilterBlock, primaryText, conversationText, assembledResponseText,
  applyResponseScrub, wrapWithStreamingScrubber, wrapWithResponseGuardrail,
} from './helpers.js'
```

Edit `server.ts` - append `reverseProxyModule` to the existing `buildKernel([...])` array (Plans 2/3 built it as `buildKernel([configModule, providerModule])`). Do NOT touch `fastify.register(openaiRoutes)` / `fastify.register(anthropicRoutes)` - the routes keep their current inline handlers:

```ts
// server.ts - import + array edit ONLY. No route-handler change.
import { reverseProxyModule } from './reverse-proxy/index.js'

// ... where the kernel is assembled (from Plans 2/3):
const kernel = await buildKernel([configModule, providerModule, reverseProxyModule])
```

> The `register()` runs when `buildKernel` starts the module lifecycle, so `PROXY_PIPELINE` is bound and `setProxyPipeline` is published at boot. Nothing reads the pipeline yet (dark). `grep -rn "new Kernel(" packages/service/src/` must still find exactly ONE match (inside `core/bootstrap.ts::buildKernel`).

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run typecheck` then `npx vitest run src/reverse-proxy`
Expected: PASS. All reverse-proxy unit tests green; the harness proves the transport walk.

- [ ] **Step 5: Confirm the pipeline is dark + commit**

Confirm no route delegates to `runProxy` yet:

```bash
grep -rn "runProxy\|getProxyPipeline" packages/service/src/routes/ && echo "UNEXPECTED: a route reads the pipeline" || echo "OK: routes untouched, pipeline dark"
```

Expected: `OK: routes untouched, pipeline dark` (the grep finds nothing in `routes/`).

```bash
git add packages/service/src/reverse-proxy/module.ts packages/service/src/reverse-proxy/index.ts packages/service/src/reverse-proxy/pipeline.harness.test.ts packages/service/src/server.ts
git commit -m "feat(reverse-proxy): register transport pipeline in buildKernel (dark)"
```

---

### Task 6: Full verification (dark) + combined ordering test + KB update

Final gate for Plan 4. Prove both lanes order correctly in the combined registry, the whole service suite is still green (the old inline routes are untouched, so every existing route/executor/guardrail/PII test must still pass), the server boots with the module wired, and update the KB.

**Files:**
- Test: `packages/service/src/reverse-proxy/pipeline.order.test.ts`
- No source changes expected. If a test surfaces a gap, loop back to the owning task.

- [ ] **Step 1: Write the combined ordering test**

```ts
// packages/service/src/reverse-proxy/pipeline.order.test.ts
import { describe, it, expect } from 'vitest'
import { ProcessorRegistry } from '../core/index.js'
import { openaiTransportProcessors } from './lanes/openai.js'
import { anthropicTransportProcessors } from './lanes/anthropic.js'
import { PROXY_PHASES } from './run.js'
import type { ProxyContext } from './context.js'

function combined(): ProcessorRegistry<ProxyContext> {
  const reg = new ProcessorRegistry<ProxyContext>()
  for (const p of [...openaiTransportProcessors, ...anthropicTransportProcessors]) reg.contribute(p)
  return reg
}

describe('combined transport pipeline', () => {
  it('both lanes share upstream.execute / routing.execute / egress', () => {
    const reg = combined()
    expect(reg.orderedFor('upstream.execute').map((p) => p.id)).toEqual(expect.arrayContaining(['openai:upstream', 'anthropic:upstream']))
    expect(reg.orderedFor('routing.execute').map((p) => p.id)).toEqual(expect.arrayContaining(['openai:attempt', 'anthropic:attempt']))
    expect(reg.orderedFor('egress').map((p) => p.id)).toEqual(expect.arrayContaining(['openai:egress', 'anthropic:egress']))
  })

  it('transport owns NO other phase (ingress/preprocess/routing.prepare/postprocess/finalize are Plan 5)', () => {
    const reg = combined()
    for (const phase of ['ingress', 'protocol.decode', 'request.preprocess', 'routing.prepare', 'upstream.prepare', 'response.postprocess', 'protocol.encode', 'finalize']) {
      expect(reg.orderedFor(phase)).toEqual([])
    }
  })

  it('the closed phase list is exactly the 11 frozen phases', () => {
    expect([...PROXY_PHASES]).toEqual([
      'ingress', 'protocol.decode', 'request.preprocess', 'routing.prepare',
      'routing.execute', 'upstream.prepare', 'upstream.execute',
      'response.postprocess', 'protocol.encode', 'egress', 'finalize',
    ])
  })
})
```

- [ ] **Step 2: Run the ordering test**

Run: `npx vitest run src/reverse-proxy/pipeline.order.test.ts`
Expected: PASS.

- [ ] **Step 3: Typecheck + full suite (routes untouched must stay green)**

Run: `npm run typecheck` then `npm test`
Expected: exit 0. This plan ADDS files and appends one module to `buildKernel`; it changes NO route handler, so every existing suite (`routes/openai.test.ts`, `routes/anthropic.test.ts`, `*-budget.test.ts`, executor/guardrail/PII) must still be green. If a suite fails, the module wiring broke server boot - fix in Task 5, do not patch here.

- [ ] **Step 4: Server-boot smoke (module wiring only)**

Start the service locally and confirm it boots with the module registered and the pipeline published (dark). A `GET /v1/models` still works via the untouched inline route - this catches a broken boot from the module wiring without exercising the pipeline:

```bash
# from repo root, with a local Routerly on :3000 and the test project token:
curl -s localhost:3000/v1/models -H "Authorization: Bearer $ROUTERLY_TEST_TOKEN" | head -c 200
```

Expected: the normal `{"object":"list","data":[...]}` payload (served by the inline route - unchanged). A boot failure means the module graph rejected `reverse-proxy` (check `dependsOn: { config: '^0.4.0', provider: '^0.4.0' }` against the Plan 2/3 module ids/versions).

- [ ] **Step 5: Update the KB (obsidian-personal) + commit**

Update the KB note `Hobby e nerd/Progetti tech/Routerly/refactory/Pipeline del reverse proxy` (obsidian-personal vault): record that Plan 4 built the transport layer (context/run/helpers + per-lane upstream/attempt/egress), that the pipeline is DARK (routes untouched, flip deferred to Plan 5's final task), resolve the matching "Questioni aperte" about transport-vs-concern ownership by pointing to decision #13 and this plan, and link back to `docs/superpowers/plans/2026-07-26-reverse-proxy-pipeline.md`. Note the resolved item (the roadmap now freezes `guardrailTriggered` on `ProxyContext`; Plan 4 defines it and threads it into `cctx` on both lanes) and the one still-open flag for the owner: the dead `llmMessages`/`checkBudget` imports in `routes/anthropic.ts`.

```bash
git add packages/service/src/reverse-proxy/pipeline.order.test.ts
git commit -m "test(reverse-proxy): combined transport ordering + dark-pipeline verification gate"
```

---

## Self-review

### Coverage vs roadmap decision #13 + the reconciliation table

| Roadmap requirement | Where in this plan |
|---|---|
| Plan 4 owns TRANSPORT only | Tasks 3-4 contribute exactly `upstream.execute` / `routing.execute` / `egress`; Task 6 asserts NO other phase is owned |
| `context.ts` with `blockedBy` + `guardrailTriggered` + `piiRedacted` from the start; `body` = AsyncIterable for stream | Task 1 `context.ts` |
| `run.ts` walker + set/get accessors | Task 1 (block-aware walker; corrected from the old `if (ctx.result) return`) |
| `helpers.ts` created here, imported by Plan 5 | Task 2 (all 7 helpers, lifted verbatim / reshaped to generators) |
| `upstream.execute` = call only (json / stream-raw-iterable / passthrough); no PII/guardrail/routing/budget | Task 3 `openai:upstream`, Task 4 `anthropic:upstream` |
| `routing.execute` = fallback loop; OpenAI emits fallback_used/no_candidates, Anthropic emits neither | Task 3 `openai:attempt` (events), Task 4 `anthropic:attempt` (no events) |
| `egress` = byte writer; hijack+CORS+SSE (OpenAI), raw headers no-hijack (Anthropic); passthrough no-op | Task 3 `openai:egress`, Task 4 `anthropic:egress` |
| `module.ts` id `reverse-proxy` v `0.4.0`, dependsOn config/provider `^0.4.0`; register PROXY_PIPELINE + setProxyPipeline | Task 5 |
| DARK pipeline; NO route flip; wire into `buildKernel([...])` array | Task 5 (append only; Task 5 Step 5 greps routes to confirm dark) |
| Minimal tests, no coverage gate; verified in isolation not against live routes | Tasks 1-6 unit + harness tests; live byte-diff explicitly deferred to Plan 5 flip |
| KB update (Plan 4 → `Pipeline del reverse proxy`) | Task 6 Step 5 |

### Confirmations

- **Transport / concern split honored.** Plan 4 contributes 6 processors across exactly 3 phases. `ingress`, `protocol.decode`, `request.preprocess`, `routing.prepare`, `upstream.prepare`, `response.postprocess`, `protocol.encode`, `finalize` have ZERO Plan 4 processors (Task 6 Step 1 asserts this).
- **Passthrough verbatim (decision #7).** `openai-oauth` streaming and `anthropic`/`anthropic-oauth`/`anthropic-web` set `ctx.passthrough` + `kind:'passthrough'` in `upstream.execute` via the unchanged `forward*` functions; egress no-ops.
- **Asymmetry preserved (decision #8).** Anthropic lane: no fallback/no_candidates events, no hijack, no CORS on the stream, `llmChat` (not `llmMessages`). OpenAI lane carries the events + hijack + CORS.
- **Frozen contracts.** `ProxyContext`/`ProxyResult` defined exactly per roadmap (+ `blockedBy`/`guardrailTriggered`/`piiRedacted`); pipeline registered under `PROXY_PIPELINE`; 11-phase list verbatim; `core/` primitives consumed, not redefined; canonical `buildKernel` array wiring.

### Flags raised for the roadmap owner (not silently papered over)

1. **`routes/anthropic.ts` imports `llmMessages` + `checkBudget` but never calls them.** The real non-stream path is `llmChat` (via `toChat`) + `chatToMessages`. The roadmap ownership table said "non-stream → `llmChat`/`llmMessages`"; `anthropic:upstream` uses `llmChat` to match reality. `llmMessages`/`checkBudget` are dead imports in that route.
2. **`buildContentFilterBlock` signature.** Roadmap sketched `(protocol, blockMessage?)`; the real payload needs `traceId` + `model` and `blockMessage` never reaches the wire. Adapted to `buildContentFilterBlock(ctx)`.
3. **`wrapWithStreamingScrubber` signature.** Roadmap sketched `(iter, effective)`; the scrubber flush chunk needs `traceId` + `model`. Adapted to `(iter, effective, ctx)`.
4. **RESOLVED - `guardrailTriggered?: string` added to the frozen `ProxyContext`** (roadmap updated 2026-07-26) for the log-only (non-blocking) guardrail trigger that `main` threads into `LLMCallContext.guardrailTriggered`. `blockedBy` stays block-only. Plan 4 defines the field in `context.ts`; both `openai:upstream` and `anthropic:upstream` thread it into `cctx` (Anthropic non-stream threads it in `main` at anthropic.ts L244). Affects the internal usage record only (decision #11 permits internal-number shift).
5. **`runProxy` semantics changed** from the old `if (ctx.result) return` to block-aware skip-to-finalize, because full-granular needs egress to run AFTER `upstream.execute` sets a `json`/`stream` result. The change still satisfies the roadmap's frozen rule ("shortCircuit or `ctx.result` with `kind:'block'` ends the pipeline early").
6. **Streaming trace-frame interleave** (the roadmap's "honest risk note"): routing-phase trace frames are buffered into `ctx.routeTrace` and replayed by egress before the body (order-preserving, since routing completes first). Residual live mid-body executor `emit` frames are NOT reproduced live in Plan 4; this is the one place verified at the Plan 5 flip byte-diff, not here (Plan 4 is dark).

**Plan complete and saved to `docs/superpowers/plans/2026-07-26-reverse-proxy-pipeline.md`.**
