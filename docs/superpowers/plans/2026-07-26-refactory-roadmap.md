# Routerly 0.4.0 Service Refactory - Roadmap & Frozen Contracts

> **For agentic workers:** This is the integrating document for the 6-plan refactory. Read it before executing ANY plan. It defines the locked decisions and the cross-plan contracts (kernel API, phase list, `ProxyContext`, DI tokens) that every plan depends on. Individual plans use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.

**Goal:** Refactor `packages/service/src` from imperative route handlers + a monolithic executor into a modular kernel (Drupal-like) where every capability is a module contributing processors (hooks) to named reverse-proxy pipeline phases - with ZERO externally observable behavior change.

**Architecture:** A dependency-free `core/` kernel (DI container, module lifecycle, dependency graph, event bus, processor DAG). Capabilities register as modules; the reverse-proxy request flow becomes an ordered pipeline of phases; each current concern (auth, PII, guardrails, routing, budget, upstream call, usage) becomes a processor on a phase. Modules are **thin wrappers over the existing, already-tested functions** - the orchestration moves, the logic does not.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` specifiers), Node ≥20, Fastify 5, Vitest.

---

## The one strategy that makes this safe: strangler-fig + thin wrappers

The refactory does **not** rewrite provider adapters, the router, the executor, guardrails, or PII. Those functions stay exactly as they are. What changes is **who calls them and in what structure**:

- A **module** is a registration shell. Its `register()` puts existing functions behind a DI token and contributes processors. Example: the routing module's processor body is `ctx.candidates = (await routeRequest(...)).models` - it calls the unchanged `routing/router.ts`.
- A **processor** is a thin adapter that lifts one block of the current route handler into a phase. The guardrail processor calls the unchanged `checkGuardrails`. The upstream processor calls the unchanged `llmStream`/`llmChat`/adapters.
- Because the underlying functions are byte-for-byte the same, wire output is byte-for-byte the same. The pipeline only re-expresses the existing imperative sequence as ordered processors.

**Consequence for verification:** correctness is proven by comparing live responses (curl + browser UAT) against the pre-refactory service on the same inputs, NOT by unit coverage. If the CLI or dashboard notices any difference, the task failed.

---

## Locked decisions (owner, 2026-07-26)

These resolve every open question the refactory notes left dangling. They are FINAL for this phase; do not re-litigate them inside a plan.

1. **No coverage gate.** The 98% repo threshold is waived for the whole refactory. Minimal behavioral tests only (one happy path per exported unit + the error branches a consumer relies on). Verification is browser UAT + curl at integration points.
2. **Public contracts are FROZEN.** The refactory is internal to `packages/service/src/`. These MUST NOT change in any observable way:
   - **Wire format** - OpenAI (`/v1/chat/completions`, `/v1/responses`, `/v1/models`, `/v1/models/:id`, `/v1/embeddings`) and Anthropic (`/v1/messages`, `/v1/messages/count_tokens`) request/response bytes, headers, SSE frames, status codes, error payloads. No added/removed/renamed headers. No non-standard fields.
   - **Management API** - every route under `/api/*` in `routes/api.ts` (paths, bodies, responses, permissions, status codes). The dashboard and CLI call these; they must keep working unchanged.
   - **`@routerly/shared` exports** - both `index.ts` and `browser.ts`. No type renamed, removed, or reshaped. CLI and dashboard import from here.
3. **Event dispatch = synchronous, in-process, best-effort** (kernel `EventBus`). A throwing listener never blocks others. Reliable/at-least-once delivery for billing usage is NOT introduced; usage persistence stays exactly as `trackUsage` → `appendUsageRecord` does it today.
4. **Phases = closed ordered list with extension slots** (not a free-form DAG). The list is frozen (below). Processors order themselves WITHIN a phase via `before`/`after`/`weight` (the `ProcessorRegistry` DAG from Plan 1). Cross-phase reordering is not allowed.
5. **Processors run sequentially** within a phase (awaited in order). Parallel processors / artifact-reduction are deferred; nothing in this refactory needs them. Note: `routing/router.ts` runs its policies in parallel INTERNALLY - that is unchanged and lives inside the routing processor, not at the pipeline level.
6. **Modules are wrappers, not rewrites** (see strategy above). No provider adapter, router, executor, or middleware function is rewritten. Contrib npm loading and runtime frontend module loading are **contract predisposition only** - a public export surface + stubs, no dynamic loading implemented.
7. **Verbatim-passthrough lane is preserved.** Paths that today proxy upstream bytes unaltered (`anthropic`/`anthropic-oauth`/`anthropic-web` on `/v1/messages`; `openai-oauth` SSE on `/v1/chat/completions`) MUST stay verbatim. The pipeline carries the protocol-native payload and only builds a canonical OpenAI view when the target provider requires cross-protocol translation. `protocol.decode` is identity on the passthrough lane.
8. **Asymmetry is preserved, not "fixed".** The OpenAI route does more than the Anthropic route today (output PII, response guardrails, SSE buffering, fallback/no_candidates events, routing memory). The refactory reproduces each route's exact current behavior - it does NOT unify them. Unifying is a future feature, out of scope.

> **AMENDED 2026-07-26 by decision #11 (aggressive dedup):** decisions #6/#8 still forbid rewriting provider adapters, the router, the executor's upstream mechanics, and the OpenAI/Anthropic route ORCHESTRATION asymmetry. What #11 additionally ALLOWS is collapsing genuinely duplicated *internal computation* onto a single interface. These are not in conflict: the pipeline structure is unchanged, only redundant logic behind it is unified.
9. **Single-instance model identity is unchanged.** No alias layer, no ModelDefinition/ModelInstance type split is introduced. `ModelConfig` (in `models.json`) stays the sole routable entity; catalog→ModelConfig field inheritance (`syncModelsFromCatalog`) is unchanged. The "provider/model" module (Plan 3) reorganizes *where* `getProviderAdapter` lives, not the model data model.
11. **Aggressive dedup of duplicated internal logic (owner directive, 2026-07-26).** Genuinely duplicated *computation* is collapsed onto a single canonical interface - no two implementations of the same thing. Concretely, in scope for Plan 5 (grep-verified first, see below):
    - **Cost math:** the inline cost computation in `llm/executor.ts` is removed; ALL cost is computed by the single `cost/calculator.ts::calculateCost`. The inline version ignores `cacheCreation`; the calculator does not - so internal recorded cost becomes MORE correct.
    - **Model selection:** `routing/selector.ts::selectModel` (a third, largely-unused selection path) is removed IF and only if a repo-wide grep proves no remaining caller (service, CLI, dashboard, tests, `@routerly/shared` consumers). If any caller exists, it is repointed to the router's candidate output first, then the dead path removed. Never delete an export before proving it is unreferenced.
    - **Usage scan:** the repeated full-file `usage.json` scans (`cost/budget.ts`, health/performance/rate-limit/fairness/budget-remaining policies) route through ONE shared read/scan helper (single interface, called from many phases) rather than each re-implementing the read.
    - **Consequence - acceptance criteria change:** the CLIENT wire response is STILL byte-identical (the `usage` block in responses is passed through from the upstream provider, not from our internal calculator). What legitimately CHANGES: internal `usage.json` cost figures and anything derived from them (budget headroom, dashboard cost/usage displays) may shift to the more-correct calculator values. That shift is EXPECTED and is not a regression. The curl byte-diff in Plans 4-5 still applies to the wire response; it does NOT apply to internal `usage.json` numbers.
    - This is the ONLY place internal-number parity is intentionally broken. Everything else stays 1:1.

12. **Feature parity is ABSOLUTE (owner directive, 2026-07-26).** Every capability present in the service today MUST remain present and reachable after the refactory. Nothing is dropped, disabled, or deferred as "later". This includes, non-exhaustively: all 12 provider adapters + the 7 no-adapter providers that throw today; all 11 routing policies (context, cheapest, health, performance, llm, capability, rate-limit, fairness, budget-remaining, semantic-intent, model-preference) with their exact scoring/exclude/abstain semantics and parallel execution; all guardrail rule types (regex, semantic, topic, moderation) with request+response targets and injection; PII input+output scrubbing incl. the streaming buffer; budget/limits with all three check sites; catalog fetch + `syncModelsFromCatalog`; routing memory; embeddings/intent classification; TOTP + backup codes; audit log; notifications/channels; telemetry ping; every endpoint (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/messages/count_tokens`, `/v1/models`, `/v1/models/:id`, `/v1/embeddings`, all `/api/*`). The wrapper strategy structurally guarantees this (existing functions are called, not removed); each plan's self-review MUST include a feature-parity check proving its slice dropped nothing.

13. **Full granular extraction (owner directive, 2026-07-26 - RESOLVES the Plan 4/Plan 5 granularity conflict).** Every request-path concern becomes its OWN granular processor owned by its module (Plan 5). The reverse-proxy module (Plan 4) owns ONLY transport: the phase runner, the per-lane upstream call, the egress writer, and the verbatim-passthrough forward. It does NOT own routing, PII, guardrail, budget, or usage logic. This supersedes Plan 4's original "monolithic core" design (decision #8's "reproduce the sequence, do not restructure" is HEREBY narrowed: the *observable byte output* is reproduced exactly; the *internal structure* is fully atomized into processors). See the reconciliation section below for the binding transport/concern split, the streaming stream-transform-chain, and the dark-pipeline / atomic-flip sequencing.

---

## Full-granular reconciliation (RESOLVED 2026-07-26 - binding for Plans 4 & 5)

Decision #13 chose full granular extraction. This section is the authoritative contract that reconciles Plan 4 (transport) and Plan 5 (concerns). Where a plan file still describes the old monolithic design, THIS section wins; the plan files are being re-authored to match.

### Ownership split (transport vs concern)

| Owner | Phase | Processor(s) | Body |
|-------|-------|--------------|------|
| **Plan 4** reverse-proxy | `upstream.execute` | `openai:upstream`, `anthropic:upstream` | the upstream call ONLY: non-stream → `llmChat`/`llmMessages` → `ctx.result = { kind:'json', body }`; stream → `llmStream` → `ctx.result = { kind:'stream', body: <raw provider async-iterable> }`; passthrough provider → `forward*` piped directly → `ctx.result = { kind:'passthrough' }`. No PII, no guardrail, no routing here. |
| **Plan 4** reverse-proxy | `routing.execute` | `openai:attempt`, `anthropic:attempt` | candidate fallback loop control: pick next `ctx.candidates` entry into `ctx.attempt`; re-run `upstream.prepare`+`upstream.execute` per attempt; emit `routing.fallback_used` / `routing.no_candidates` events on the OpenAI lane (asymmetry preserved: Anthropic lane emits neither). |
| **Plan 4** reverse-proxy | `egress` | `openai:egress`, `anthropic:egress` | THE byte-sensitive writer. Non-stream → `reply.send(ctx.result.body)`. Stream → `reply.hijack()` + manual CORS + SSE framing + trace frames, then pump the (already-wrapped) iterator. Passthrough → already piped in upstream, no-op. This is the single largest regression surface - its bytes must match `main` exactly. |
| **Plan 5** pii | `request.preprocess` | `pii.input` | `mergePolicies('input')` + `scrubMessages` on `ctx.request.messages`. |
| **Plan 5** guardrails | `request.preprocess` | `guardrail.request` (after `pii.input`) | `checkGuardrails('request')` + `buildRequestInjection`; block → `ctx.result` block payload + `shortCircuit`. |
| **Plan 5** routing | `routing.prepare` | `routing.prepare`, `routing.memory` | `routeRequest` → `ctx.candidates`; OpenAI-lane routing memory. |
| **Plan 5** budget | `upstream.prepare` | `budget.upstream` | per-candidate `isAllowed`. |
| **Plan 5** pii | `response.postprocess` | `pii.output` | non-stream → scrub `ctx.result.body` in place; **stream → wrap `ctx.result.body` with `StreamingScrubber`** (see chain below). OpenAI lane only. |
| **Plan 5** guardrails | `response.postprocess` | `guardrail.response` (after `pii.output`) | non-stream → `checkGuardrails('response')` on assembled content; **stream → wrap `ctx.result.body` with the SSE-buffering guardrail transform**. OpenAI lane only. |
| **Plan 5** usage | `finalize` | `usage.finalize` | guardrail-blocked usage record (`ctx.blockedBy`). |
| **Plan 5** logging | `ingress`/`finalize` | `logging.ingress`, `logging.finalize` | trace buffer open/flush. |

### Streaming stream-transform-chain (THE hard part - byte order is load-bearing)

Today's OpenAI streaming path interleaves, in ONE inline loop: `llmStream` → per-chunk output-PII (`StreamingScrubber`) → per-chunk response-guardrail buffering → SSE write + trace frames. Full-granular splits this into: `upstream.execute` emits the RAW iterator; `response.postprocess` processors WRAP it; `egress` writes the final iterator.

- `ctx.result.body` for `kind:'stream'` is an `AsyncIterable<ChatCompletionChunk>` (the provider's raw chunk stream, exactly what `llmStream` yields today).
- `pii.output` (stream branch): replaces `ctx.result.body` with `wrapWithStreamingScrubber(ctx.result.body, ctx.piiOutput)` - the SAME `StreamingScrubber` applied per-chunk today, in an async generator.
- `guardrail.response` (stream branch): replaces `ctx.result.body` with `wrapWithResponseGuardrail(ctx.result.body, ...)` - the SAME buffering logic today.
- **Order is fixed**: `pii.output` (weight -10) wraps FIRST, `guardrail.response` (after `pii.output`) wraps SECOND - so the guardrail sees already-PII-scrubbed text, identical to today's inline sequence (PII scrub before guardrail check).
- `egress` pumps the doubly-wrapped iterator and writes `data: <chunk>\n\n` frames + trace frames + `[DONE]`, byte-identical to `main`.
- The transform helpers (`wrapWithStreamingScrubber`, `wrapWithResponseGuardrail`) are thin async-generator wrappers around the EXISTING `StreamingScrubber` and the existing buffering code, lifted verbatim into generator form. This is the one place decision #6's "no rewrite" is stretched to "re-shape into a generator" - the per-chunk logic inside is copied, not rewritten. The streaming curl byte-diff (below) is the acceptance gate.

### Shared helpers (Plan 4 CREATES `reverse-proxy/helpers.ts`; Plan 5 imports it)

Plan 5's modules import wire-faithful helpers that Plan 4 must actually create (Plan 5 originally assumed they existed):
- `buildContentFilterBlock(protocol, blockMessage?): ProxyResult` - the wire-faithful `content_filter` block payload (OpenAI 200 empty-choice shape; Anthropic equivalent), lifted from the current inline block code.
- `primaryText(request)`, `conversationText(request)`, `assembledResponseText(ctx)` - the text-extraction currently inline in the routes.
- `applyResponseScrub(ctx, effective)` - non-streaming `scrubText`-per-choice loop.
- `wrapWithStreamingScrubber(iter, effective)`, `wrapWithResponseGuardrail(iter, project, ...)` - the streaming transforms above.

### Sequencing - dark pipeline, single atomic flip (preserves green-at-every-commit)

The route MUST NOT delegate to `runProxy` until the FULL processor set exists. Otherwise the mid-state pipeline serves requests with no routing/PII/guardrails.

- **Plan 4** builds the scaffold (`context.ts`, `run.ts`, `module.ts`, `helpers.ts`) + the transport processors + `reverse-proxy/lanes/*` transport, registers the pipeline under `PROXY_PIPELINE`, and unit-tests it in isolation. **It does NOT touch `routes/openai.ts` / `routes/anthropic.ts` routing.** The old inline handlers keep serving live traffic. The pipeline is DARK. Service is green (nothing changed on the hot path).
- **Plan 5** adds all concern modules, then in its FINAL task performs the ATOMIC FLIP: `routes/openai.ts` + `routes/anthropic.ts` POST handlers delegate to `runProxy(getProxyPipeline(), ctx)`; the old inline `handleOpenAICompletion` / Anthropic handler bodies and their now-unused imports are deleted. This is where the streaming + non-streaming + passthrough curl byte-diffs vs `main` run in full. If any byte-diff fails, the flip is reverted (one-line route change) and the service is still green on the old handlers.
- Consequence: Plan 4 removes its original Tasks 3/4 route-flip steps; Plan 5 gains the flip + delete-old-handlers task. The curl byte-diff gate lives at the Plan 5 flip.

### Canonical names (supersede any plan-file drift)

- **Kernel bootstrap function:** `buildKernel(modules): Promise<Kernel>` in `core/bootstrap.ts` (Plan 2). NOT `createKernel`, NOT bare `new Kernel([...])` in illustrative snippets - always `buildKernel`.
- **Module ids** (exact strings, used in every `dependsOn`): `config`, `provider`, `reverse-proxy`, `routing`, `budget`, `usage`, `guardrails`, `pii`, `logging`, `cache`. NOTE: the provider module id is `provider` (NOT `provider-model`, NOT `provider-registry`). Plan 3 defines `provider`; Plans 4 & 5 `dependsOn` must say `provider`.
- **Module manifest version:** `'0.4.0'` for every module (NOT `'1.0.0'`). `dependsOn` ranges use `'^0.4.0'`.
- **PROXY_PIPELINE generic:** `token<ProcessorRegistry<unknown>>` in Plan 2 (`core/tokens.ts`); Plan 4 narrows at the use site via `container.resolve(PROXY_PIPELINE) as ProcessorRegistry<ProxyContext>` (or a typed re-export). The token KEY `'proxy.pipeline'` is frozen.
- **`ProxyContext.blockedBy?: string`** and **`ProxyResult.body: AsyncIterable | object | unknown`** (stream carries the async-iterable) are part of the frozen shape from the start - Plan 4 defines them in `context.ts`, not as a later additive edit.
- **Bootstrap wiring pattern (canonical, supersedes every `createKernel()` snippet in Plans 3/4/5/6):** there is NO `createKernel()` factory. Plan 2 defines `buildKernel(modules: readonly RouterlyModule[]): Promise<Kernel>` in `core/bootstrap.ts`; the module ARRAY is assembled at the call site in `server.ts` (Plan 2 Task 4 starts it as `buildKernel([configModule])`). Every subsequent plan that adds a module EDITS that array in `server.ts`: Plan 3 → `[configModule, providerModule]`; Plan 4 → append `reverseProxyModule`; Plan 5 → append `...coreModules`; Plan 6 → spread `...CONTRIB_MODULES` at the tail. The `grep -rn "new Kernel(" packages/service/src/` check should find exactly ONE match: inside `core/bootstrap.ts::buildKernel`. Any plan snippet showing `createKernel()` or a `new Kernel([...])` outside `bootstrap.ts` is stale - wire into the `server.ts` `buildKernel([...])` array instead.

---

## Frozen phase list (closed, ordered)

The reverse-proxy pipeline. Every current concern maps to exactly one phase. Extension slots are the same list - contrib processors attach to these names, no new phases.

| # | Phase | Runs | Current code it hosts (as processors) |
|---|-------|------|----------------------------------------|
| 1 | `ingress` | once/request | context/trace init, `traceId`, conversation id, trace flags |
| 2 | `protocol.decode` | once/request | parse client body to native view; identity on passthrough lane; Anthropic→canonical only when target needs it |
| 3 | `request.preprocess` | once/request | input PII (`mergePolicies`/`scrubMessages`), request guardrails (`checkGuardrails` + `buildRequestInjection`) |
| 4 | `routing.prepare` | once/request | `readConfig('models')`, `routeRequest(...)` → candidates + trace; routing memory `addRoutingDecision` |
| 5 | `routing.execute` | per attempt | candidate fallback loop control (pick next candidate) |
| 6 | `upstream.prepare` | per attempt | resolve `ModelConfig`, `getProviderAdapter`, per-candidate budget `isAllowed` |
| 7 | `upstream.execute` | per attempt | adapter dispatch: `llmStream`/`llmChat`/`llmMessages`, `forwardOpenAIOAuthSSE`, `forwardAnthropicOAuth`/`forwardAnthropicApiKey` |
| 8 | `response.postprocess` | once/success | output PII (`StreamingScrubber`/`scrubText`), response guardrails (with SSE buffering), usage accumulation |
| 9 | `protocol.encode` | once/success | canonical→client wire (identity on passthrough lane; `chunksToAnthropicSSE` etc. where used today) |
| 10 | `egress` | once/success | write reply / hijack + manual CORS + trace SSE frames (OpenAI streaming) |
| 11 | `finalize` | always | `trackUsage`, fallback/no_candidates events, trace flush |
| - | `error` | cross-cutting | wire-faithful block payloads (`content_filter`/`insufficient_quota`/`server_error`/`refusal`/`rate_limit_error`/`overloaded_error`), `BudgetExceededError` mapping |

---

## Frozen kernel API (from Plan 1 - do not redefine)

Plans 2–6 import these from `packages/service/src/core/index.ts`. Exact names:

- `ServiceContainer`, `token<T>(key)`, `Token<T>` - DI.
- `EventBus`, `topicMatches(pattern, topic)` - events.
- `Kernel` (`.container`, `.events`, `.start()`, `.stop()`, `.startedOrder`).
- `defineModule(mod)`, `RouterlyModule`, `ModuleManifest`, `ModuleRegistry` (`{ container, events }`), `Runtime` (`{ container, events }`).
- `ProcessorRegistry<C>` (`.contribute(p)`, `.orderedFor(phase)`, `.runPhase(phase, ctx)`), `Processor<C>` (`{ id, phase, before?, after?, weight?, run(ctx) }`).
- `topologicalSort`, `KernelError`, `ModuleGraphError`, `MissingDependencyError`, `DependencyCycleError`, `shortCircuit`, `isShortCircuit`, `ShortCircuit`.

---

## Frozen DI service tokens (defined in Plan 2, consumed by 3–6)

Each token wraps existing functions. Modules register these; processors resolve them. Defined once in `core/tokens.ts` (Plan 2, Task 1). Exact keys and value shapes:

```ts
// core/tokens.ts
import { token } from './index.js'
import type { ProviderAdapter } from '../providers/types.js' // existing
import type { RouteResult } from '../routing/router.js'      // existing
// NOTE: StoredTypeMap is NOT exported from loader.ts - capture the fns with
// `typeof import('../config/loader.js').readConfig` instead of importing the map.
// ... (import existing types; do NOT redefine them)

export const CONFIG_STORE = token<{
  readConfig: typeof import('../config/loader.js').readConfig
  writeConfig: typeof import('../config/loader.js').writeConfig
  appendUsageRecord: typeof import('../config/loader.js').appendUsageRecord
}>('config.store')

export const PROVIDER_REGISTRY = token<{
  getProviderAdapter(model: ModelConfig): ProviderAdapter
}>('provider.registry')

export const ROUTER = token<{
  routeRequest(
    request: ChatCompletionRequest, project: ProjectConfig,
    log?: unknown, emit?: unknown, token?: ProjectToken,
    traceId?: string, conversationId?: string,
  ): Promise<RouteResult>
}>('routing.router')

export const USAGE_TRACKER = token<{
  trackUsage(params: unknown): Promise<void>   // existing cost/tracker.ts signature
}>('usage.tracker')

export const BUDGET = token<{
  isAllowed: typeof import('../cost/budget.js').isAllowed
  getViolatedLimits: typeof import('../cost/budget.js').getViolatedLimits
  getLimitUsageSnapshot: typeof import('../cost/budget.js').getLimitUsageSnapshot
}>('cost.budget')

// Declared as <unknown> in Plan 2 because ProxyContext is a Plan 4 type.
// The token KEY ('proxy.pipeline') is frozen; Plan 4 narrows the generic to ProxyContext.
export const PROXY_PIPELINE = token<import('./index.js').ProcessorRegistry<unknown>>('proxy.pipeline')
```

> Each token's value is literally `{ readConfig, writeConfig, ... }` built from the existing module's exports. This is the wrapper strategy: no logic is copied, the token just hands back the real functions.

---

## Frozen `ProxyContext` shape (defined in Plan 4, referenced by 4–6)

The single mutable object threaded through the pipeline. Plan 4 defines it in `reverse-proxy/context.ts`. It carries everything the current `openai.ts`/`anthropic.ts` handlers use. Exact shape:

```ts
// reverse-proxy/context.ts
export interface ProxyResult {
  kind: 'stream' | 'json' | 'block' | 'passthrough'
  // stream: body is an AsyncIterable<ChatCompletionChunk> (raw provider stream);
  //         pii.output / guardrail.response WRAP it in response.postprocess (decision #13
  //         stream-transform-chain); egress pumps the final wrapped iterator.
  // json: full-response object for non-streaming
  // block: wire-faithful error/block payload + status
  // passthrough: verbatim upstream Response already piped by upstream.execute
  status?: number
  body?: unknown            // stream: AsyncIterable; json/block: response object
}

export interface ProxyContext {
  // identity / io
  protocol: 'openai' | 'anthropic'
  req: FastifyRequest
  reply: FastifyReply
  log: FastifyBaseLogger

  // auth (already decorated by the existing auth plugin - unchanged)
  project: ProjectConfig
  projectId: string
  token?: ProjectToken

  // trace
  traceId: string
  traceEnabled: boolean      // x-routerly-trace === '1'
  traceSuppressed: boolean   // x-routerly-no-trace present
  conversationId?: string

  // request views
  original: unknown                 // raw parsed client body, verbatim
  request: ChatCompletionRequest    // canonical OpenAI view (built only when needed; === original for OpenAI lane)
  stream: boolean
  passthrough: boolean              // true = verbatim upstream lane, skip canonicalization

  // routing / attempt loop
  candidates?: RoutingCandidate[]
  routeTrace?: TraceEntry[]
  attempt?: { model: ModelConfig; candidate: RoutingCandidate }

  // middleware state (built in request.preprocess)
  piiInput?: EffectivePii
  piiOutput?: EffectivePii
  requestInjection?: string | null

  // outcome
  result?: ProxyResult
  usage?: UsageInfo
  error?: unknown
  blockedBy?: string          // guardrail rule id that HARD-BLOCKED; consumed by usage.finalize (decision #13)
  guardrailTriggered?: string // guardrail rule id that matched but only LOGGED (non-blocking); threaded into LLMCallContext.guardrailTriggered by upstream.execute. Internal usage attribution only (decision #11 permits the shift). Set by guardrail.request/guardrail.response, read by the transport upstream processor.
  piiRedacted?: string[]      // input-scrub redaction list; threaded into LLMCallContext for usage attribution
}
```

> `ProxyContext` is mutable and single-threaded per request. Processors read/write fields; `shortCircuit` (from the kernel) or setting `ctx.result` with `kind:'block'` ends the pipeline early (cache hit, guardrail block, budget exceeded).

---

## Plan order & dependency (strangler-fig - service green at every commit)

| # | Plan | Depends on | Service after this plan |
|---|------|-----------|--------------------------|
| 1 | Kernel foundation | - | Unchanged (additive `core/`, nothing wired) |
| 2 | Kernel bootstrap + config module | 1 | Boots kernel in `server.ts`; config behind `CONFIG_STORE`; routes still call existing functions directly |
| 3 | Provider/model module | 1,2 | `getProviderAdapter` also reachable via `PROVIDER_REGISTRY`; adapters unchanged |
| 4 | Reverse-proxy pipeline (transport, DARK) | 1,2,3 | Pipeline scaffold + transport processors + `helpers.ts` built and unit-tested; registered under `PROXY_PIPELINE`. Routes UNCHANGED - pipeline is dark, old inline handlers still serve. Service green (hot path untouched). |
| 5 | Core modules + ATOMIC FLIP | 1–4 | All concern modules (routing/budget/usage/guardrails/pii/logging/cache) contribute granular processors; FINAL task flips routes to `runProxy` + deletes old inline handlers; curl byte-diff (stream+non-stream+passthrough) vs `main` is the gate. |
| 6 | Contrib + surfaces predisposition | 1–5 | Public module SDK export + stubs; no runtime loading; no behavior change |

**Honest risk note (full-granular, decision #13):** The regression surface is the **streaming stream-transform-chain** (`upstream.execute` emits raw iterator → `pii.output`/`guardrail.response` wrap it → `egress` pumps it) and the **verbatim-passthrough lanes** - the two places a subtle difference silently breaks Claude Code / SDK clients. Mitigation is structural: the pipeline is built DARK across Plan 4 and only the FINAL task of Plan 5 flips the route, gated by a full streaming + non-streaming + passthrough curl byte-diff vs `main`. If the byte-diff fails, revert the one-line route flip - the service stays green on the untouched inline handlers. If a full green flip cannot be reached in one session, stop before the Plan 5 flip: everything up to it is dark and non-breaking (kernel + config + provider + dark pipeline + concern modules registered, routes still inline).

---

## Knowledge base - reference and update (standing directive)

The architecture analysis lives in the Obsidian **obsidian-personal** vault at `Hobby e nerd/Progetti tech/Routerly/refactory/` (8 notes, incl. `_index`). Owner directive (2026-07-26): throughout ALL refactory work, **reference the KB and keep it updated**.

- **Before a plan:** read the matching KB note(s) for that subsystem (e.g. Plan 4 → `Pipeline del reverse proxy`; Plan 3 → `Provider modelli e traduzione protocolli`; Plan 6 → `Distribuzione dei moduli` + `Superfici e metamoduli`).
- **After a plan (or when a decision is locked):** update the KB - resolve the relevant "Questioni aperte", record what was built, link back to the plan file. The locked decisions in this roadmap are the source of truth; mirror them into the KB.
- Each plan's final task SHOULD include a step: "update the corresponding KB note (obsidian-personal) with what this plan resolved."

## Verification protocol (every plan, replaces coverage)

Per plan, before the final commit:

1. `npm run typecheck` - exit 0 (catches `exactOptionalPropertyTypes` / `noUncheckedIndexedAccess`).
2. `npm test` - existing suites still green (this refactory adds files; it must not break current tests).
3. Plans that touch the request path (4, 5) - **live diff**: with a local Routerly on `:3000` and the test project token, run the smoke set below against the refactored build and confirm byte-identical shape vs `main`:
   ```bash
   # non-streaming OpenAI
   curl -s localhost:3000/v1/chat/completions -H "Authorization: Bearer $ROUTERLY_TEST_TOKEN" \
     -H 'content-type: application/json' \
     -d '{"model":"routerly/ada","messages":[{"role":"user","content":"ping"}]}'
   # streaming OpenAI
   curl -sN localhost:3000/v1/chat/completions -H "Authorization: Bearer $ROUTERLY_TEST_TOKEN" \
     -H 'content-type: application/json' \
     -d '{"model":"routerly/ada","stream":true,"messages":[{"role":"user","content":"ping"}]}'
   # Anthropic passthrough
   curl -sN localhost:3000/v1/messages -H "Authorization: Bearer $ROUTERLY_TEST_TOKEN" \
     -H 'content-type: application/json' -H 'anthropic-version: 2023-06-01' \
     -d '{"model":"claude-sonnet-4","max_tokens":64,"messages":[{"role":"user","content":"ping"}]}'
   # models list (dashboard/CLI contract)
   curl -s localhost:3000/v1/models -H "Authorization: Bearer $ROUTERLY_TEST_TOKEN"
   ```
4. **Browser UAT** (dashboard build first: `npm run build --workspace=packages/dashboard`): log in, open a project, confirm dashboard pages render and the models/usage/routing views still load. The dashboard is a live contract check - it exercises `/api/*` end to end.

---

## Self-review (roadmap-level)

- **Every refactory-notes subsystem is placed:** kernel → Plan 1; module lifecycle/bootstrap → Plan 2; provider/model layer → Plan 3; reverse-proxy pipeline + `ProxyContext` → Plan 4; core-module extraction (config already in 2; routing/cache/budget/usage/logging) → Plan 5; contrib distribution + surfaces/metamodules predisposition → Plan 6.
- **Frozen contracts are named once here** (kernel API, phase list, DI tokens, `ProxyContext`) so no two plans invent different names for the same seam.
- **No behavior change is structurally guaranteed** by the wrapper strategy (existing functions are called, not rewritten) plus the live-diff verification in Plans 4–5.
