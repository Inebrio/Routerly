# Core Modules Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the remaining core capabilities of `packages/service/src` as kernel modules. Each module (a) exposes its existing, already-tested functions behind the frozen DI tokens (`ROUTER` → `routeRequest`, `USAGE_TRACKER` → `trackUsage`, `BUDGET` → `{ isAllowed, getViolatedLimits, getLimitUsageSnapshot }`) and (b) contributes its own granular reverse-proxy processor(s) for that concern (roadmap decision #13, full-granular extraction). Plan 4 is transport-only and DARK; it contributes ONLY transport processors and never had inline concern contributions to move. This plan's modules are the sole source of the concern processors. After this plan the ownership map is: `routing` module owns the `routing.prepare` processor (calls `routeRequest`) plus OpenAI-lane routing memory; `budget` module owns the per-candidate `isAllowed` check in `upstream.prepare`; `usage` module owns the `trackUsage` processor in `finalize`; `guardrails` module owns the request/response-guardrail processors; `pii` module owns the input/output-PII processors; `logging` module owns the ingress/finalize trace processors; `cache` module is an empty no-op predisposition (there is NO response cache in the codebase today — YAGNI). Net request behavior is byte-for-byte unchanged: this is a reorganization of ownership, not a rewrite.

**Architecture:** The kernel (`core/`, Plan 1), its bootstrap + `CONFIG_STORE` (Plan 2), the `PROVIDER_REGISTRY` (Plan 3) and the reverse-proxy pipeline + `ProxyContext` + `PROXY_PIPELINE` (Plan 4) already exist. This plan adds one `RouterlyModule` per capability under `packages/service/src/modules/`. Every module's `register()` resolves `PROXY_PIPELINE` from the container, registers its own DI token value (built from the real existing exports — the wrapper strategy), and contributes its `Processor<ProxyContext>` entries. Each processor body calls the EXISTING function with its EXISTING signature. There is a single shared `PROXY_PIPELINE` registry (the frozen token is singular); OpenAI-lane-only processors reproduce the current asymmetry by guarding on `ctx.protocol === 'openai'` and returning early otherwise — matching `routes/anthropic.ts`, which has neither output PII, response guardrails, nor routing memory. These modules are added to the `server.ts` `buildKernel([...])` array; they are the exclusive source of the concern processors. Plan 4 contributes only transport processors and is not modified by this plan.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` import specifiers), Node ≥20, Fastify 5, Vitest. No new runtime dependencies.

## Global Constraints

- **Depends on Plans 1–4 landed per the roadmap's frozen contracts** (`2026-07-26-refactory-roadmap.md`). This plan imports, and does not redefine:
  - Kernel API from `core/index.js`: `defineModule`, `RouterlyModule`, `ModuleRegistry`, `Processor`, `ProcessorRegistry`, `shortCircuit`.
  - DI tokens from `core/tokens.js`: `CONFIG_STORE`, `PROVIDER_REGISTRY`, `ROUTER`, `USAGE_TRACKER`, `BUDGET`, `PROXY_PIPELINE` (exact keys and value shapes are frozen in the roadmap §"Frozen DI service tokens").
  - `ProxyContext` / `ProxyResult` from `reverse-proxy/context.js` (frozen shape, roadmap §"Frozen ProxyContext shape").
  - The phase names from the frozen phase list: `ingress`, `request.preprocess`, `routing.prepare`, `upstream.prepare`, `response.postprocess`, `finalize` (this plan contributes only to these).
  - The module manifest ids declared by earlier plans: `'config'` (Plan 2), `'provider'` (Plan 3 — canonical id per roadmap §"Canonical names"; NOT `provider-model`), `'reverse-proxy'` (Plan 4). The id strings are the only coupling; every `dependsOn` key in this plan's manifests uses these exact strings.
- **Wrapper strategy is absolute.** No processor body reimplements logic. It calls the real `routeRequest` / `trackUsage` / `isAllowed` / `checkGuardrails` / `buildRequestInjection` / `mergePolicies` / `scrubMessages` / `scrubText` / `StreamingScrubber` / `addRoutingDecision` / `setTrace` / `getTrace`. The executor (`llm/executor.ts`) stays untouched — the `upstream.execute` processor (Plan 4) still calls `llmChat`/`llmStream`/`llmMessages`/`forward*`, and those continue to self-track budget and usage. This plan does NOT add a second usage or budget record for the executor/passthrough paths (no double count).
- **Preserve asymmetry (roadmap decision #8).** Output-PII, response-guardrail and routing-memory processors run for the OpenAI lane only (`ctx.protocol === 'openai'` guard). Input-PII and request-guardrail processors run for both lanes (both `routes/openai.ts` and `routes/anthropic.ts` call them today).
- **Ordering within a phase is fixed by `before`/`after`/`weight` and verified.** Confirmed current order: in `request.preprocess`, input PII runs BEFORE request guardrails (`routes/openai.ts`: "Runs BEFORE guardrails so the judge never sees raw PII"). In `response.postprocess`, output PII runs before response guardrails. The Task 8 ordering test locks the full per-phase sequence.
- **No coverage gate** (roadmap decision #1). Minimal behavioral tests only: each module registers its token/processors, resolving the token returns the real function, and the processor appears in the phase's ordered list. Heavy verification is the roadmap curl byte-diff + browser UAT (roadmap §"Verification protocol"), run at the atomic flip (Task 12) where the pipeline goes live.
- **Module system:** NodeNext ESM. Every relative import uses a `.js` extension. Node builtins use the `node:` prefix.
- **TypeScript:** `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`. Optional properties omitted, not set to `undefined`. Index access narrowed before use.
- **Wire transparency + management API + `@routerly/shared` are FROZEN** (roadmap decision #2). `ProxyContext` is an INTERNAL type (`reverse-proxy/context.ts`); its `blockedBy` and `guardrailTriggered` fields are Plan-4-owned (frozen shape) and this plan only reads/writes them.
- **Scope fence:** create files under `packages/service/src/modules/`. The edits to existing files are: the `...coreModules` append to the `server.ts` `buildKernel([...])` array (Task 8); the dedup edits to `llm/executor.ts`, `cost/budget.ts`, and the usage-scanning routing policies (Tasks 9-11); and the atomic route flip in `routes/openai.ts` / `routes/anthropic.ts` plus deletion of the now-dead inline handlers (Task 12). `reverse-proxy/context.ts` is NOT edited by this plan — `ctx.blockedBy` and `ctx.guardrailTriggered` are Plan-4-owned; this plan only uses them. Plan 4's reverse-proxy files are NOT edited by this plan (it is transport-only and had no inline concern contributions to remove).
- **English only** for all code, comments, identifiers, and commit messages. No em dashes.

**All commands below run from `packages/service/`** unless stated otherwise.

---

### Task 1: Routing module — `ROUTER` token + `routing.prepare` + routing memory

**Files:**
- Create: `packages/service/src/modules/routing.ts`
- Test: `packages/service/src/modules/routing.test.ts`

**Interfaces:**
- Consumes:
  - `defineModule`, `ProcessorRegistry`, `type Processor` from `../core/index.js`
  - `ROUTER`, `PROXY_PIPELINE` from `../core/tokens.js`
  - `type ProxyContext` from `../reverse-proxy/context.js`
  - `routeRequest` from `../routing/router.js` — `routeRequest(request, project, log?, emit?, token?, traceId?, conversationId?): Promise<{ models: RoutingCandidate[]; trace: TraceEntry[] }>`
  - `addRoutingDecision` from `../routing/routingMemoryStore.js` — `addRoutingDecision(projectId: string, conversationId: string, model: string): void`
  - `appendTrace` from `../routing/traceStore.js` — `appendTrace(id: string, entries: TraceEntry[]): void`
- Produces:
  - `const routingModule: RouterlyModule` (default export via `defineModule`), manifest `{ id: 'routing', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } }`.
  - Registers `ROUTER` → `{ routeRequest }` (the real function reference).
  - Contributes processor `{ id: 'routing.prepare', phase: 'routing.prepare' }`: calls `routeRequest(ctx.request, ctx.project, ctx.log, emit, ctx.token, ctx.traceId, ctx.conversationId)`; sets `ctx.candidates = models`, `ctx.routeTrace = trace`. `emit` streams each `TraceEntry` into the request trace via `appendTrace(ctx.traceId, [entry])`, exactly as the routes do today.
  - Contributes processor `{ id: 'routing.memory', phase: 'routing.prepare', after: ['routing.prepare'] }`: OpenAI-lane only (`ctx.protocol === 'openai'` guard); when `ctx.conversationId` is set and memory is enabled, records `addRoutingDecision(ctx.project.id, ctx.conversationId, ctx.candidates[0].model)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/modules/routing.test.ts
import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { ROUTER, PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { routeRequest } from '../routing/router.js'
import { routingModule } from './routing.js'

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  const pipeline = new ProcessorRegistry<ProxyContext>()
  container.register(PROXY_PIPELINE, pipeline)
  return { container, events, pipeline }
}

describe('routing module', () => {
  it('registers ROUTER with the real routeRequest', async () => {
    const { container, events, pipeline } = harness()
    await routingModule.register({ container, events })
    expect(container.resolve(ROUTER).routeRequest).toBe(routeRequest)
    void pipeline
  })

  it('contributes routing.prepare and routing.memory to the routing.prepare phase', async () => {
    const { container, events, pipeline } = harness()
    await routingModule.register({ container, events })
    const ids = pipeline.orderedFor('routing.prepare').map((p) => p.id)
    expect(ids).toEqual(['routing.prepare', 'routing.memory'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/routing.test.ts`
Expected: FAIL — cannot find module `./routing.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/modules/routing.ts
import { defineModule, type Processor, type RouterlyModule } from '../core/index.js'
import { ROUTER, PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { routeRequest } from '../routing/router.js'
import { addRoutingDecision } from '../routing/routingMemoryStore.js'
import { appendTrace } from '../routing/traceStore.js'
import type { TraceEntry } from '../routing/traceStore.js'

const prepare: Processor<ProxyContext> = {
  id: 'routing.prepare',
  phase: 'routing.prepare',
  async run(ctx) {
    if (ctx.result) return
    const emit = (entry: TraceEntry): void => appendTrace(ctx.traceId, [entry])
    const { models, trace } = await routeRequest(
      ctx.request,
      ctx.project,
      ctx.log,
      emit,
      ctx.token,
      ctx.traceId,
      ctx.conversationId,
    )
    ctx.candidates = models
    ctx.routeTrace = trace
  },
}

const memory: Processor<ProxyContext> = {
  id: 'routing.memory',
  phase: 'routing.prepare',
  after: ['routing.prepare'],
  run(ctx) {
    // Asymmetry: routing memory is an OpenAI-lane concern only (routes/anthropic.ts has none).
    if (ctx.protocol !== 'openai') return
    if (!ctx.conversationId) return
    const top = ctx.candidates?.[0]
    if (!top) return
    const memoryEnabled = (ctx.project.policies ?? []).some(
      (p) => p.type === 'llm' && p.enabled && (p.config as { memory?: unknown } | undefined)?.memory === true,
    )
    if (!memoryEnabled) return
    addRoutingDecision(ctx.project.id, ctx.conversationId, top.model)
  },
}

export const routingModule: RouterlyModule = defineModule({
  manifest: { id: 'routing', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } },
  register({ container }) {
    container.register(ROUTER, { routeRequest })
    const pipeline = container.resolve(PROXY_PIPELINE)
    pipeline.contribute(prepare)
    pipeline.contribute(memory)
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/routing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/modules/routing.ts packages/service/src/modules/routing.test.ts
git commit -m "feat(modules): routing module wraps routeRequest + routing memory"
```

---

### Task 2: Budget module — `BUDGET` token + `upstream.prepare` per-candidate `isAllowed`

**Files:**
- Create: `packages/service/src/modules/budget.ts`
- Test: `packages/service/src/modules/budget.test.ts`

**Interfaces:**
- Consumes:
  - `defineModule`, `type Processor`, `type RouterlyModule` from `../core/index.js`
  - `BUDGET`, `PROVIDER_REGISTRY`, `PROXY_PIPELINE` from `../core/tokens.js`
  - `type ProxyContext` from `../reverse-proxy/context.js`
  - `isAllowed`, `getViolatedLimits`, `getLimitUsageSnapshot` from `../cost/budget.js` (exact existing signatures).
- Produces:
  - `const budgetModule: RouterlyModule`, manifest `{ id: 'budget', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0', 'provider': '^0.4.0' } }`.
  - Registers `BUDGET` → `{ isAllowed, getViolatedLimits, getLimitUsageSnapshot }`.
  - Contributes processor `{ id: 'budget.upstream', phase: 'upstream.prepare' }`: for the current attempt candidate (`ctx.attempt.model`), calls `BUDGET.isAllowed(model, ctx.project, ctx.token)`. On `false`, marks the candidate ineligible so `routing.execute` advances to the next candidate (sets `ctx.attempt = undefined`). It does NOT record usage or emit budget events — the executor's `checkBudget` (inside `upstream.execute`) remains the single authoritative recorder, unchanged. In the normal flow `routeRequest` already pre-filtered over-budget candidates, so this re-check is a cheap idempotent guard and the set of attempted candidates is identical to today.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/modules/budget.test.ts
import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { BUDGET, PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { isAllowed, getViolatedLimits, getLimitUsageSnapshot } from '../cost/budget.js'
import { budgetModule } from './budget.js'

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  return { container, events }
}

describe('budget module', () => {
  it('registers BUDGET with the real functions', async () => {
    const { container, events } = harness()
    await budgetModule.register({ container, events })
    const b = container.resolve(BUDGET)
    expect(b.isAllowed).toBe(isAllowed)
    expect(b.getViolatedLimits).toBe(getViolatedLimits)
    expect(b.getLimitUsageSnapshot).toBe(getLimitUsageSnapshot)
  })

  it('contributes budget.upstream to the upstream.prepare phase', async () => {
    const { container, events } = harness()
    await budgetModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    expect(pipeline.orderedFor('upstream.prepare').map((p) => p.id)).toEqual(['budget.upstream'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/budget.test.ts`
Expected: FAIL — cannot find module `./budget.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/modules/budget.ts
import { defineModule, type Processor, type RouterlyModule } from '../core/index.js'
import { BUDGET, PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { isAllowed, getViolatedLimits, getLimitUsageSnapshot } from '../cost/budget.js'

const upstream: Processor<ProxyContext> = {
  id: 'budget.upstream',
  phase: 'upstream.prepare',
  async run(ctx) {
    if (ctx.result) return
    const attempt = ctx.attempt
    if (!attempt) return
    // Per-candidate eligibility. The executor's checkBudget (inside upstream.execute)
    // stays the authoritative recorder of budget-exceeded events + usage; this guard only
    // decides whether the candidate is attempted, mirroring routeRequest's existing pre-filter.
    const allowed = await isAllowed(attempt.model, ctx.project, ctx.token)
    if (!allowed) {
      // ponytail: drop the candidate; routing.execute picks the next one, or the
      // no_candidates path fires in finalize when the loop exhausts.
      delete (ctx as { attempt?: unknown }).attempt
    }
  },
}

export const budgetModule: RouterlyModule = defineModule({
  manifest: {
    id: 'budget',
    version: '0.4.0',
    dependsOn: { 'reverse-proxy': '^0.4.0', 'provider': '^0.4.0' },
  },
  register({ container }) {
    container.register(BUDGET, { isAllowed, getViolatedLimits, getLimitUsageSnapshot })
    container.resolve(PROXY_PIPELINE).contribute(upstream)
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/budget.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/modules/budget.ts packages/service/src/modules/budget.test.ts
git commit -m "feat(modules): budget module wraps isAllowed for upstream.prepare"
```

---

### Task 3: Usage module — `USAGE_TRACKER` token + `finalize` blocked-usage recording

**Files:**
- Create: `packages/service/src/modules/usage.ts`
- Test: `packages/service/src/modules/usage.test.ts`

**Interfaces:**
- Consumes:
  - `defineModule`, `type Processor`, `type RouterlyModule` from `../core/index.js`
  - `USAGE_TRACKER`, `CONFIG_STORE`, `PROXY_PIPELINE` from `../core/tokens.js`
  - `type ProxyContext` from `../reverse-proxy/context.js`
  - `trackUsage` from `../cost/tracker.js` — `trackUsage(params: TrackUsageParams): Promise<void>`
- Produces:
  - `const usageModule: RouterlyModule`, manifest `{ id: 'usage', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0', config: '^0.4.0' } }`.
  - Registers `USAGE_TRACKER` → `{ trackUsage }`.
  - Contributes processor `{ id: 'usage.finalize', phase: 'finalize' }`: records the guardrail-blocked usage event that `routes/*.ts` record inline today via `trackBlockedRequest` (zero tokens, `outcome: 'blocked'`, `callType: 'guardrail'`, attributed to the project's first model). It fires only when `ctx.blockedBy` is set (a guardrail block, set in Task 4). Completion, streaming, messages and verbatim-passthrough usage are self-tracked inside the executor and the `forward*` helpers and are NOT re-recorded here (no double count — roadmap decision #3, usage persistence unchanged).

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/modules/usage.test.ts
import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { USAGE_TRACKER, CONFIG_STORE, PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { readConfig, writeConfig, appendUsageRecord } from '../config/loader.js'
import { trackUsage } from '../cost/tracker.js'
import { usageModule } from './usage.js'

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  container.register(CONFIG_STORE, { readConfig, writeConfig, appendUsageRecord })
  return { container, events }
}

describe('usage module', () => {
  it('registers USAGE_TRACKER with the real trackUsage', async () => {
    const { container, events } = harness()
    await usageModule.register({ container, events })
    expect(container.resolve(USAGE_TRACKER).trackUsage).toBe(trackUsage)
  })

  it('contributes usage.finalize to the finalize phase', async () => {
    const { container, events } = harness()
    await usageModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    expect(pipeline.orderedFor('finalize').map((p) => p.id)).toEqual(['usage.finalize'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/usage.test.ts`
Expected: FAIL — cannot find module `./usage.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/modules/usage.ts
import { defineModule, type Processor, type RouterlyModule } from '../core/index.js'
import { USAGE_TRACKER, CONFIG_STORE, PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { trackUsage } from '../cost/tracker.js'

export const usageModule: RouterlyModule = defineModule({
  manifest: { id: 'usage', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0', config: '^0.4.0' } },
  register({ container }) {
    container.register(USAGE_TRACKER, { trackUsage })
    const store = container.resolve(CONFIG_STORE)

    const finalize: Processor<ProxyContext> = {
      id: 'usage.finalize',
      phase: 'finalize',
      async run(ctx) {
        // Only the guardrail-blocked usage event lives here (today: trackBlockedRequest in routes/*.ts).
        // Completion / stream / messages / passthrough usage is self-tracked upstream — do not re-record.
        const blockedBy = ctx.blockedBy
        if (!blockedBy) return
        const models = await store.readConfig('models')
        const firstModelId = ctx.project.models?.[0]?.modelId
        const model = firstModelId ? models.find((m) => m.id === firstModelId) : undefined
        if (!model) return // ponytail: no project model to attribute to -> nothing to record
        await trackUsage({
          projectId: ctx.project.id,
          model,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          outcome: 'blocked',
          callType: 'guardrail',
          traceId: ctx.traceId,
          guardrailTriggered: blockedBy,
          blockedBy,
        }).catch(() => {})
      },
    }

    container.resolve(PROXY_PIPELINE).contribute(finalize)
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/usage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/modules/usage.ts packages/service/src/modules/usage.test.ts
git commit -m "feat(modules): usage module wraps trackUsage in finalize"
```

---

### Task 4: Guardrails module — request + response guardrail processors

**Files:**
- Create: `packages/service/src/modules/guardrails.ts`
- Test: `packages/service/src/modules/guardrails.test.ts`

> `ctx.blockedBy` and `ctx.guardrailTriggered` are already defined on the frozen `ProxyContext` by Plan 4; this module only reads/writes them.

**Interfaces:**
- Consumes:
  - `defineModule`, `type Processor`, `type RouterlyModule` from `../core/index.js`
  - `PROXY_PIPELINE` from `../core/tokens.js`
  - `type ProxyContext` from `../reverse-proxy/context.js`
  - `checkGuardrails`, `buildRequestInjection` from `../middleware/guardrails.js`:
    - `checkGuardrails(target, text, config, pctx, log?, context?): Promise<GuardrailResult>` where `GuardrailResult = { triggered?, block?, log?, blockMessage?, evaluated }`
    - `buildRequestInjection(config): string | null`
  - `appendTrace` from `../routing/traceStore.js`
- Produces:
  - `const guardrailsModule: RouterlyModule`, manifest `{ id: 'guardrails', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } }`.
  - Contributes processor `{ id: 'guardrail.request', phase: 'request.preprocess', after: ['pii.input'] }` (both lanes): runs `checkGuardrails('request', ...)`; on `block`, sets `ctx.blockedBy = result.triggered` and `ctx.result = { kind: 'block', status: 403, body: <wire-faithful content_filter payload built by Plan 4's error helper> }`, then `shortCircuit`. On no block, applies `buildRequestInjection(ctx.project.guardrails)` to the outgoing request exactly as `routes/openai.ts` does (prepend a system message). Ordered AFTER `pii.input` so the judge never sees raw PII (matches current route order).
  - Contributes processor `{ id: 'guardrail.response', phase: 'response.postprocess', after: ['pii.output'] }`: OpenAI-lane only (`ctx.protocol === 'openai'` guard). For a non-streaming `kind: 'json'` result it runs `checkGuardrails('response', <assembled content>, ...)` in place and, on block, replaces `ctx.result` with the wire-faithful block. For a `kind: 'stream'` result it WRAPS the iterator: `ctx.result.body = wrapWithResponseGuardrail(ctx.result.body, ...)` (the SSE-buffering guardrail transform from Plan 4's `reverse-proxy/helpers.ts`, lifted verbatim into generator form). Because it is `after: ['pii.output']`, it wraps SECOND — its wrapper is outermost, so the guardrail buffer sees text the PII scrubber already cleaned, byte-identical to today's inline order (PII scrub before guardrail check). `egress` pumps the doubly-wrapped iterator.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/modules/guardrails.test.ts
import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { guardrailsModule } from './guardrails.js'

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  return { container, events }
}

describe('guardrails module', () => {
  it('contributes request + response guardrail processors', async () => {
    const { container, events } = harness()
    await guardrailsModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    expect(pipeline.orderedFor('request.preprocess').map((p) => p.id)).toContain('guardrail.request')
    expect(pipeline.orderedFor('response.postprocess').map((p) => p.id)).toContain('guardrail.response')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/guardrails.test.ts`
Expected: FAIL — cannot find module `./guardrails.js`.

- [ ] **Step 3: Write minimal implementation**

`ctx.blockedBy` and `ctx.guardrailTriggered` are already defined on the frozen `ProxyContext` by Plan 4; this module only reads/writes them (no `context.ts` edit here).

```ts
// packages/service/src/modules/guardrails.ts
import { defineModule, shortCircuit, type Processor, type RouterlyModule } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { checkGuardrails, buildRequestInjection } from '../middleware/guardrails.js'
import { appendTrace } from '../routing/traceStore.js'
import {
  buildContentFilterBlock,
  primaryText,
  conversationText,
  assembledResponseText,
  wrapWithResponseGuardrail,
} from '../reverse-proxy/helpers.js'

const request: Processor<ProxyContext> = {
  id: 'guardrail.request',
  phase: 'request.preprocess',
  after: ['pii.input'],
  async run(ctx) {
    if (ctx.result) return
    const guardrails = ctx.project.guardrails
    if (!guardrails) return
    const pctx = { projectId: ctx.project.id, project: ctx.project, ...(ctx.token ? { token: ctx.token } : {}) }
    const result = await checkGuardrails(
      'request',
      primaryText(ctx.request),
      guardrails,
      pctx,
      ctx.log,
      conversationText(ctx.request),
    )
    appendTrace(ctx.traceId, [{ panel: 'request', message: 'guardrail:evaluated', details: { evaluated: result.evaluated } }])
    if (result.block) {
      ctx.blockedBy = result.triggered
      // Plan 4 owns the wire-faithful content_filter payload shape; this reuses it unchanged.
      ctx.result = buildContentFilterBlock(ctx.protocol, result.blockMessage)
      return shortCircuit(ctx.result)
      // ponytail: driver stops the pipeline on shortCircuit; usage.finalize still runs (finalize is "always").
    }
    // Matched but non-blocking (log-only): record the trigger for internal usage attribution.
    // Matches main's `if (result.log) guardrailTriggered = hit.triggered`; threaded into
    // LLMCallContext by Plan 4's upstream.execute.
    if (result.triggered && result.log) ctx.guardrailTriggered = result.triggered
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
      // Streaming: WRAP the (already-PII-wrapped) iterator with the SSE-buffering guardrail transform.
      // pii.output ran first (after: ['pii.output']) so its wrapper is innermost; this wrapper is
      // outermost, identical to today's inline order (PII scrub before guardrail buffer). egress pumps
      // the doubly-wrapped iterator. The transform lives in Plan 4's reverse-proxy/helpers.ts.
      ctx.result.body = wrapWithResponseGuardrail(
        ctx.result.body as AsyncIterable<unknown>,
        ctx.project,
        guardrails,
        pctx,
        ctx.log,
      )
      return
    }
    // Non-streaming JSON: check the assembled content in place.
    const result = await checkGuardrails('response', assembledResponseText(ctx), guardrails, pctx, ctx.log)
    if (result.block) {
      ctx.blockedBy = result.triggered
      ctx.result = buildContentFilterBlock(ctx.protocol, result.blockMessage)
    } else if (result.triggered && result.log) {
      // Matched but non-blocking (log-only): record for internal usage attribution.
      ctx.guardrailTriggered = result.triggered
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
```

> `primaryText`, `conversationText`, `assembledResponseText`, `buildContentFilterBlock` and `wrapWithResponseGuardrail` are provided by Plan 4's `reverse-proxy/helpers.ts` under exactly these names (frozen per roadmap §"Shared helpers"). Plan 4 is re-authored to CREATE that file with this exact export surface, lifted verbatim from the current inline text-extraction, block-payload, and streaming-guardrail code in `routes/openai.ts` / `routes/anthropic.ts`. This module imports them unchanged; it does not reimplement the wire-faithful block payload or the guardrail buffer.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/guardrails.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/modules/guardrails.ts packages/service/src/modules/guardrails.test.ts
git commit -m "feat(modules): guardrails module owns request+response guardrail processors"
```

---

### Task 5: PII module — input + output PII processors

**Files:**
- Create: `packages/service/src/modules/pii.ts`
- Test: `packages/service/src/modules/pii.test.ts`

**Interfaces:**
- Consumes:
  - `defineModule`, `type Processor`, `type RouterlyModule` from `../core/index.js`
  - `PROXY_PIPELINE` from `../core/tokens.js`
  - `type ProxyContext` from `../reverse-proxy/context.js`
  - `mergePolicies`, `scrubMessages`, `scrubText` from `../middleware/piiScrubber.js`:
    - `mergePolicies(policies, direction: 'input' | 'output'): EffectivePii`
    - `scrubMessages(messages, effective): { messages: unknown[]; redacted: string[] }`
    - `scrubText(text, effective): { text: string; found: string[] }`
    - `type EffectivePii` (has optional `entities`, `customPatterns`, `outputBufferSize`)
  - `appendTrace` from `../routing/traceStore.js`
  - `applyResponseScrub` from `../reverse-proxy/helpers.js` (Plan 4's non-streaming response-scrub helper; applies `scrubText` to each choice's content in `ctx.result`).
- Produces:
  - `const piiModule: RouterlyModule`, manifest `{ id: 'pii', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } }`.
  - Contributes processor `{ id: 'pii.input', phase: 'request.preprocess', weight: -10 }` (both lanes, runs first in the phase): when input policies exist, computes `mergePolicies(policies, 'input')`, scrubs `ctx.request.messages` via `scrubMessages`, writes back the scrubbed messages, sets `ctx.piiInput` and records the redacted entity list for the executor/usage (`ctx.piiRedacted`, threaded by Plan 4). Emits the `pii:evaluated` / `pii:scrubbed` trace entries exactly as `routes/*.ts` do.
  - Contributes processor `{ id: 'pii.output', phase: 'response.postprocess', weight: -10 }`: OpenAI-lane only (`ctx.protocol === 'openai'` guard); computes `ctx.piiOutput = mergePolicies(policies, 'output')`. For a non-streaming `kind: 'json'` result it scrubs the response content in place via `applyResponseScrub`. For a `kind: 'stream'` result it WRAPS the raw provider iterator: `ctx.result.body = wrapWithStreamingScrubber(ctx.result.body, effective)` (the per-chunk `StreamingScrubber` from Plan 4's `reverse-proxy/helpers.ts`, lifted verbatim into generator form). `weight: -10` makes it run FIRST in the phase, so it wraps BEFORE `guardrail.response` (which is `after: ['pii.output']`): PII wrapper innermost, guardrail wrapper outermost, matching today's inline order (PII scrub before guardrail check). The Task 8 ordering test locks `[pii.output, guardrail.response]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/modules/pii.test.ts
import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { piiModule } from './pii.js'

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  return { container, events }
}

describe('pii module', () => {
  it('contributes input + output PII processors', async () => {
    const { container, events } = harness()
    await piiModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    expect(pipeline.orderedFor('request.preprocess').map((p) => p.id)).toContain('pii.input')
    expect(pipeline.orderedFor('response.postprocess').map((p) => p.id)).toContain('pii.output')
  })

  it('orders pii.input before guardrail-style later processors via weight', async () => {
    const { container, events } = harness()
    await piiModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    // pii.input carries weight -10 so it wins the ready-set tiebreak and runs first.
    expect(pipeline.orderedFor('request.preprocess')[0]?.id).toBe('pii.input')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/pii.test.ts`
Expected: FAIL — cannot find module `./pii.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/modules/pii.ts
import { defineModule, type Processor, type RouterlyModule } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { mergePolicies, scrubMessages } from '../middleware/piiScrubber.js'
import { appendTrace } from '../routing/traceStore.js'
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
    // second, so the guardrail buffer sees already-scrubbed text — identical to today's inline order.
    // wrapWithStreamingScrubber lives in Plan 4's reverse-proxy/helpers.ts.
    if (ctx.result?.kind === 'stream') {
      ctx.result.body = wrapWithStreamingScrubber(ctx.result.body as AsyncIterable<unknown>, effective)
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
```

> `applyResponseScrub` and `wrapWithStreamingScrubber` are provided by Plan 4's `reverse-proxy/helpers.ts` under exactly these names (frozen per roadmap §"Shared helpers"). `applyResponseScrub` wraps the current non-streaming `scrubText`-per-choice loop from `routes/openai.ts`; `wrapWithStreamingScrubber` wraps the existing per-chunk `StreamingScrubber` into an async generator, lifted verbatim. `ChatCompletionRequest` is imported from `@routerly/shared` for the message cast. This module does not reimplement either scrub path.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/pii.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/modules/pii.ts packages/service/src/modules/pii.test.ts
git commit -m "feat(modules): pii module owns input+output PII processors"
```

---

### Task 6: Logging module — ingress + finalize trace processors

**Files:**
- Create: `packages/service/src/modules/logging.ts`
- Test: `packages/service/src/modules/logging.test.ts`

**Interfaces:**
- Consumes:
  - `defineModule`, `type Processor`, `type RouterlyModule` from `../core/index.js`
  - `PROXY_PIPELINE` from `../core/tokens.js`
  - `type ProxyContext` from `../reverse-proxy/context.js`
  - `setTrace`, `getTrace` from `../routing/traceStore.js`:
    - `setTrace(id: string, trace: TraceEntry[]): void`
    - `getTrace(id: string): TraceEntry[] | null`
- Produces:
  - `const loggingModule: RouterlyModule`, manifest `{ id: 'logging', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } }`.
  - Contributes processor `{ id: 'logging.ingress', phase: 'ingress', weight: -100 }` (runs first in ingress): opens the per-request trace buffer with `setTrace(ctx.traceId, [])`, exactly as `routes/*.ts` do at request start. `traceId`, `traceEnabled`, `traceSuppressed`, `conversationId` are populated by Plan 4's ingress from headers before processors run; this processor only initializes the trace store.
  - Contributes processor `{ id: 'logging.finalize', phase: 'finalize', after: ['usage.finalize'] }`: a no-op flush hook — the trace buffer is snapshotted by `trackUsage` via `getTrace(traceId)` (unchanged). Present so the trace-lifecycle owner is explicit and future trace teardown has a home. It reads `getTrace(ctx.traceId)` and drops it into `ctx.routeTrace` if not already set, so downstream consumers see the final trace.
  - Audit (`audit/logger.ts` `logAudit`) and telemetry (`telemetry.ts` `pingTelemetry`) are NOT request-pipeline concerns and are NOT moved: `logAudit` stays wired in `routes/api.ts` (management plane) and `pingTelemetry` stays wired in `server.ts` (startup) and `routes/api.ts`. The logging module is their nominal owner for the module map; their call sites and behavior are unchanged. This is documented in the Self-review inventory.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/modules/logging.test.ts
import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { getTrace } from '../routing/traceStore.js'
import { loggingModule } from './logging.js'

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  return { container, events }
}

describe('logging module', () => {
  it('contributes ingress + finalize trace processors', async () => {
    const { container, events } = harness()
    await loggingModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    expect(pipeline.orderedFor('ingress').map((p) => p.id)).toContain('logging.ingress')
    expect(pipeline.orderedFor('finalize').map((p) => p.id)).toContain('logging.finalize')
  })

  it('logging.ingress opens the trace buffer', async () => {
    const { container, events } = harness()
    await loggingModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    const ingress = pipeline.orderedFor('ingress').find((p) => p.id === 'logging.ingress')!
    const ctx = { traceId: 'trace-test-1' } as unknown as ProxyContext
    await ingress.run(ctx)
    expect(getTrace('trace-test-1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/logging.test.ts`
Expected: FAIL — cannot find module `./logging.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/modules/logging.ts
import { defineModule, type Processor, type RouterlyModule } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { setTrace, getTrace } from '../routing/traceStore.js'

const ingress: Processor<ProxyContext> = {
  id: 'logging.ingress',
  phase: 'ingress',
  weight: -100, // trace buffer must exist before any other processor appends to it.
  run(ctx) {
    setTrace(ctx.traceId, [])
  },
}

const finalize: Processor<ProxyContext> = {
  id: 'logging.finalize',
  phase: 'finalize',
  after: ['usage.finalize'],
  run(ctx) {
    // trackUsage already snapshots getTrace(traceId); expose the final buffer for any late consumer.
    if (!ctx.routeTrace) {
      const trace = getTrace(ctx.traceId)
      if (trace) ctx.routeTrace = trace
    }
  },
}

export const loggingModule: RouterlyModule = defineModule({
  manifest: { id: 'logging', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } },
  register({ container }) {
    const pipeline = container.resolve(PROXY_PIPELINE)
    pipeline.contribute(ingress)
    pipeline.contribute(finalize)
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/logging.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/modules/logging.ts packages/service/src/modules/logging.test.ts
git commit -m "feat(modules): logging module owns ingress+finalize trace processors"
```

---

### Task 7: Cache module — no-op predisposition (YAGNI)

**Files:**
- Create: `packages/service/src/modules/cache.ts`
- Test: `packages/service/src/modules/cache.test.ts`

**Rationale (verified by grep):** There is NO response cache in the codebase today. The only caches are `routing/intent/cache.ts` (embedding/intent classification cache, internal to the classifier) and `catalog/fetcher.ts` (6h catalog TTL). Neither short-circuits a completion request. Per the roadmap's `request.preprocess` cache-hit short-circuit predisposition and YAGNI, this module is registered as a pure no-op: it declares the capability slot and the module map entry but contributes NO processor. When a real response cache is built, its `cache.lookup` processor (phase `request.preprocess`, `weight: -100`, before `pii.input`) will `shortCircuit` on a hit — that processor is intentionally not written now.

**Interfaces:**
- Consumes: `defineModule`, `type RouterlyModule` from `../core/index.js`.
- Produces: `const cacheModule: RouterlyModule`, manifest `{ id: 'cache', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } }`, empty `register()`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/modules/cache.test.ts
import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { cacheModule } from './cache.js'

describe('cache module', () => {
  it('is a no-op predisposition: registers cleanly and contributes no processor', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    const pipeline = new ProcessorRegistry<ProxyContext>()
    container.register(PROXY_PIPELINE, pipeline)
    await cacheModule.register({ container, events })
    expect(cacheModule.manifest.id).toBe('cache')
    expect(pipeline.orderedFor('request.preprocess')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/cache.test.ts`
Expected: FAIL — cannot find module `./cache.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/modules/cache.ts
import { defineModule, type RouterlyModule } from '../core/index.js'

// ponytail: no response cache exists in the codebase (only the intent-classifier and catalog
// fetch caches, neither of which short-circuits a request). This module is a pure predisposition:
// it holds the capability slot in the module map. Add a `cache.lookup` processor on
// request.preprocess (weight -100, shortCircuit on hit) only when a real response cache lands.
export const cacheModule: RouterlyModule = defineModule({
  manifest: { id: 'cache', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } },
  register() {
    // intentionally empty
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/modules/cache.ts packages/service/src/modules/cache.test.ts
git commit -m "feat(modules): cache module no-op predisposition (no response cache exists)"
```

---

### Task 8: Wire core modules into the kernel (DARK), ordering test, green-check

**Files:**
- Create: `packages/service/src/modules/index.ts`
- Create: `packages/service/src/modules/ordering.test.ts`
- Edit: `packages/service/src/server.ts` — append `...coreModules` to the existing `buildKernel([...])` array (roadmap §"Canonical names": there is NO `createKernel` factory and NO `new Kernel([...])` outside `core/bootstrap.ts`; the module array is assembled at the `buildKernel([...])` call site in `server.ts`).

**Interfaces:**
- Consumes: every module from Tasks 1–7; `buildKernel` (already imported in `server.ts` from Plan 2); `PROXY_PIPELINE` from `../core/tokens.js`.
- Produces:
  - `packages/service/src/modules/index.ts` exporting `export const coreModules = [routingModule, budgetModule, usageModule, guardrailsModule, piiModule, loggingModule, cacheModule]`.
  - The `server.ts` `buildKernel([...])` array gains `...coreModules` after the `config`, `provider` and `reverse-proxy` modules (their manifests' `dependsOn` guarantees ordering; the list order is a readability aid only).
  - **No Plan 4 code is removed.** Plan 4 is transport-only and DARK (roadmap decision #13 + §"Full-granular reconciliation"): it contributes exclusively the transport processors (`protocol.decode`, `routing.execute` candidate-loop control, `upstream.execute`, `protocol.encode`, `egress`, and the `error` block mapping) and never had inline concern `contribute(...)` calls to strip. The concern processors (routing/budget/usage/guardrails/pii/logging) come EXCLUSIVELY from these Plan 5 modules.
  - The pipeline stays **DARK** after this task: `routes/openai.ts` / `routes/anthropic.ts` still call the old inline handlers, so live traffic is unchanged and the service is green (hot path untouched). Registering the modules only populates `PROXY_PIPELINE`; nothing yet calls `runProxy`. The route flip is the FINAL task (Task 12).

- [ ] **Step 1: Write the barrel + ordering test (failing)**

```ts
// packages/service/src/modules/index.ts
import { routingModule } from './routing.js'
import { budgetModule } from './budget.js'
import { usageModule } from './usage.js'
import { guardrailsModule } from './guardrails.js'
import { piiModule } from './pii.js'
import { loggingModule } from './logging.js'
import { cacheModule } from './cache.js'

export const coreModules = [
  routingModule,
  budgetModule,
  usageModule,
  guardrailsModule,
  piiModule,
  loggingModule,
  cacheModule,
]
```

```ts
// packages/service/src/modules/ordering.test.ts
import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { CONFIG_STORE, PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { readConfig, writeConfig, appendUsageRecord } from '../config/loader.js'
import { coreModules } from './index.js'

// Registers all core modules against a fresh pipeline and asserts the per-phase
// processor order is exactly what Plan 4's lanes produced. This is the parity anchor:
// if a future edit reorders a processor within a phase, this test fails.
describe('core modules processor ordering', () => {
  it('produces the frozen per-phase processor sequence', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
    container.register(CONFIG_STORE, { readConfig, writeConfig, appendUsageRecord })
    for (const mod of coreModules) await mod.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    const ids = (phase: string) => pipeline.orderedFor(phase).map((p) => p.id)

    expect(ids('ingress')).toEqual(['logging.ingress'])
    expect(ids('request.preprocess')).toEqual(['pii.input', 'guardrail.request'])
    expect(ids('routing.prepare')).toEqual(['routing.prepare', 'routing.memory'])
    expect(ids('upstream.prepare')).toEqual(['budget.upstream'])
    expect(ids('response.postprocess')).toEqual(['pii.output', 'guardrail.response'])
    expect(ids('finalize')).toEqual(['usage.finalize', 'logging.finalize'])
  })
})
```

- [ ] **Step 2: Run the ordering test to verify it fails**

Run: `npx vitest run src/modules/ordering.test.ts`
Expected: FAIL — cannot find module `./index.js` (until the barrel is added) or an order mismatch if a `before`/`after`/`weight` hint is wrong. Fix the hints in the offending module until the sequence matches, then this test passes.

- [ ] **Step 3: Append `coreModules` to the `server.ts` `buildKernel([...])` array**

`server.ts` already builds the kernel via `buildKernel([...])` (Plan 2 started it as `buildKernel([configModule])`; Plan 3 added `providerModule`; Plan 4 appended `reverseProxyModule`). Edit that SAME array in place to spread `coreModules` at the tail (canonical wiring pattern — do NOT introduce `createKernel` or a bare `new Kernel([...])`; the only `new Kernel(` in the tree lives inside `core/bootstrap.ts::buildKernel`):

```ts
import { coreModules } from './modules/index.js'
// ...
const kernel = await buildKernel([
  configModule,       // Plan 2
  providerModule,     // Plan 3  (manifest id 'provider')
  reverseProxyModule, // Plan 4  (owns PROXY_PIPELINE, transport-only, dark)
  ...coreModules,     // Plan 5  (concern processors)
])
```

Nothing is deleted from Plan 4. Plan 4 is transport-only and never contributed concern processors inline (roadmap decision #13); its transport processors (`protocol.decode`, `routing.execute` candidate-loop control, `upstream.execute` executor + `forward*` dispatch, `protocol.encode`, `egress` hijack + CORS + SSE trace frames + pumping the pre-wrapped streaming iterator, and the `error` block mapping) stay exactly as Plan 4 built them. The concern processors now populate `PROXY_PIPELINE` from the Plan 5 modules. The routes are still untouched — the pipeline is DARK until Task 12.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0 (catches `exactOptionalPropertyTypes` / `noUncheckedIndexedAccess` across the new modules; `ctx.blockedBy` / `ctx.guardrailTriggered` are Plan-4-owned fields this plan only uses).

- [ ] **Step 5: Run the module suite + full service suite**

Run: `npx vitest run src/modules`
Expected: all module tests green, including `ordering.test.ts`.

Run: `npm test`
Expected: the existing suites (routes, executor, budget, guardrails, pii, routing) still green — this plan added files and moved registration; it did not change any wrapped function.

- [ ] **Step 6: Green-check (pipeline is DARK — behavior must be unchanged)**

The pipeline is dark after this task: the routes still call the old inline handlers, so registering the modules must not change any live behavior. Boot a local Routerly on `:3000` and confirm it starts cleanly and the roadmap smoke set (non-streaming OpenAI, streaming OpenAI, Anthropic passthrough, `/v1/models`) responds exactly as before — this is a sanity check that adding modules to `buildKernel` did not break boot or the hot path, NOT the byte-diff gate. The full curl byte-diff vs `main` runs at the atomic flip (Task 12), which is where the pipeline goes live. If boot fails or any smoke response changes here, a module's `register()` has a side effect on live traffic — fix before commit.

- [ ] **Step 7: Commit**

```bash
git add packages/service/src/modules/index.ts packages/service/src/modules/ordering.test.ts packages/service/src/server.ts
git commit -m "feat(modules): wire core modules into kernel (dark pipeline, routes still inline)"
```

---

### Task 9: Dedup — unify all cost math onto `calculateCost`

> Decision #11 (aggressive dedup). The executor computes the completion cost inline at three sites (`llm/executor.ts` chat ~L247-250, stream ~L503-506, messages ~L593-596): `totalCostUsd = inputCostUsd + cachedCostUsd + outputCostUsd`. This inline total OMITS `cacheCreationInputTokens`, so it is a second, less-correct implementation of the cost formula. `cost/calculator.ts::calculateCost(inputTokens, outputTokens, model, cachedInputTokens?, cacheCreationInputTokens?)` is the canonical one and accounts for cache-creation. This task removes the inline total and routes all three sites through `calculateCost`.

**Consequence (documented, not a regression):** the persisted `usage.json` `cost` field ALREADY routes through `calculateCost` (`cost/tracker.ts:41`), so the recorded total does not change. What changes is the executor's EMITTED trace total (`model:success` -> `details.totalCostUsd`), which the dashboard trace panel and derived cost displays show: it becomes cache-creation-aware. The CLIENT wire response is unchanged (the response `usage` block is passed through verbatim from the provider, never from our calculator). The curl byte-diff applies to the wire response only, NOT to internal trace/`usage.json` numbers. This is the one place internal-number parity is intentionally broken (decision #11).

**Files:**
- Edit: `packages/service/src/llm/executor.ts` (import `calculateCost`; replace the inline `totalCostUsd` at all three emit sites; ensure `cacheCreationInputTokens` is read before the emit)
- Test: `packages/service/src/llm/executor.cost.test.ts`

**Interfaces:**
- Consumes: `calculateCost` from `../cost/calculator.js` (existing signature, unchanged).
- Produces: at each emit site, `totalCostUsd = calculateCost(inputTokens, outputTokens, model, cachedTokens, cacheCreationTokens)`. The `inputCostUsd` / `outputCostUsd` fields remain as display-only splits (calculateCost returns only the total); a `// ponytail:` comment marks them display-only with the authoritative total from calculateCost.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/llm/executor.cost.test.ts
import { describe, it, expect, vi } from 'vitest'
import type { ModelConfig } from '@routerly/shared'
import { calculateCost } from '../cost/calculator.js'

// Stub the provider adapter so llmChat runs without a network call, returning a
// usage block that includes cache-creation tokens. If the old inline total (which
// omits cacheCreation) were still present, the emitted totalCostUsd would differ
// from calculateCost and this test would fail.
vi.mock('../providers/index.js', () => ({
  getProviderAdapter: () => ({
    chat: async () => ({
      id: 'x',
      choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 200,
        prompt_tokens_details: { cached_tokens: 100, cache_creation_tokens: 400 },
      },
    }),
  }),
}))
vi.mock('../cost/tracker.js', () => ({ trackUsage: async () => {} }))

const model: ModelConfig = {
  id: 'm1',
  cost: { inputPerMillion: 3, outputPerMillion: 15, cachePerMillion: 0.3, cacheWritePerMillion: 3.75 },
} as unknown as ModelConfig

describe('executor cost is computed by calculateCost (cache-creation aware)', () => {
  it('emits totalCostUsd equal to calculateCost for a cache-creation case', async () => {
    const { llmChat } = await import('./executor.js')
    const traces: Array<{ message: string; details?: Record<string, unknown> }> = []
    await llmChat(
      { model, project: { id: 'p1' }, request: { model: 'm1', messages: [{ role: 'user', content: 'hi' }] } } as never,
      (t) => traces.push(t as never),
    )
    const success = traces.find((t) => t.message === 'model:success')
    const expected = calculateCost(1000, 200, model, 100, 400)
    expect(success?.details?.totalCostUsd).toBe(expected)
  })
})
```

> The exact `llmChat` call shape and the emit-callback position follow the real `LLMCallContext` / emit signature in `executor.ts`; adjust the argument object to match the current signature when implementing. The load-bearing assertion is `details.totalCostUsd === calculateCost(...)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/llm/executor.cost.test.ts`
Expected: FAIL — emitted `totalCostUsd` omits the 400 cache-creation tokens, so it differs from `calculateCost`.

- [ ] **Step 3: Write minimal implementation**

Import at the top of `executor.ts`:

```ts
import { calculateCost } from '../cost/calculator.js'
```

At the chat site (~L245), read cache-creation before the emit and replace the inline total:

```ts
    // Calculate costs
    const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0
    const cacheCreationTokens =
      (response.usage as { prompt_tokens_details?: { cache_creation_tokens?: number } } | undefined)
        ?.prompt_tokens_details?.cache_creation_tokens ?? 0
    const plainInput = inputTokens - cachedTokens - cacheCreationTokens
    // ponytail: input/output splits are display-only for the trace panel; the authoritative
    // total is calculateCost (single cost implementation, cache-creation aware).
    const inputCostUsd = (plainInput / 1_000_000) * model.cost.inputPerMillion
    const outputCostUsd = (outputTokens / 1_000_000) * model.cost.outputPerMillion
    const totalCostUsd = calculateCost(inputTokens, outputTokens, model, cachedTokens, cacheCreationTokens)
```

Apply the same replacement at the stream site (~L503) and the messages site (~L593): drop each local `cachedCostUsd` and `totalCostUsd = inputCostUsd + cachedCostUsd + outputCostUsd`, compute `totalCostUsd` via `calculateCost(...)` passing that site's cached and cache-creation token counts. No other logic changes; `trackUsage` calls stay as-is (tracker already uses `calculateCost`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/llm/executor.cost.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: green. The wire response is untouched; only trace `totalCostUsd` shifts (expected, decision #11).

- [ ] **Step 6: Commit**

```bash
git add packages/service/src/llm/executor.ts packages/service/src/llm/executor.cost.test.ts
git commit -m "refactor(cost): route executor cost through calculateCost (dedup, cache-creation aware)"
```

---

### Task 10: Dedup — remove dead `selectModel`

> Decision #11. `routing/selector.ts::selectModel` is a third, largely-unused model-selection path. Remove it IF AND ONLY IF a repo-wide grep proves no remaining caller. Never delete a proven-referenced export.

**Files:**
- Delete (conditional on Step 1): `packages/service/src/routing/selector.ts`, `packages/service/src/routing/selector.test.ts`

- [ ] **Step 1: Prove there are no callers (grep gate — MANDATORY FIRST)**

Run exactly:

```bash
grep -rn "selectModel" packages/service/src packages/cli/src packages/dashboard/src packages/shared/src
```

Expected (verified 2026-07-26): the only matches are `packages/service/src/routing/selector.ts` (the definition) and `packages/service/src/routing/selector.test.ts` (its own test). No caller in service runtime, CLI, dashboard, or `@routerly/shared`. Build artifacts under `dist/` and `coverage/` are not source and are ignored.
- If ANY caller outside `selector.ts` / `selector.test.ts` exists: STOP the deletion. Repoint that caller to the router's candidate output (`routeRequest(...).models[0]`) first, verify green, then proceed.

- [ ] **Step 2: Delete the dead path**

```bash
git rm packages/service/src/routing/selector.ts packages/service/src/routing/selector.test.ts
```

- [ ] **Step 3: Typecheck + full suite stay green**

Run: `npm run typecheck && npm test`
Expected: green (nothing imported `selectModel`).

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(routing): remove dead selectModel path (grep-gated, zero callers)"
```

---

### Task 11: Dedup — single `usage.json` scan helper

> Decision #11. `readConfig('usage')` full-file scans are re-implemented at seven sites: `cost/budget.ts` (x3) and the `performance` / `health` / `rate-limit` / `fairness` routing policies. The `budget-remaining` policy reads usage transitively through `cost/budget.ts`, so it is covered once those route through the helper. Introduce ONE shared read helper and route all direct readers through it. Behavior is identical (same records read); only the number of read implementations drops to one.

**Files:**
- Create: `packages/service/src/cost/usageStore.ts`
- Test: `packages/service/src/cost/usageStore.test.ts`
- Edit: `packages/service/src/cost/budget.ts` (3 sites), `packages/service/src/routing/policies/performance.ts`, `.../health.ts`, `.../rate-limit.ts`, `.../fairness.ts`

**Interfaces:**
- Consumes: `readConfig` from `../config/loader.js`; `type UsageRecord` from `@routerly/shared`.
- Produces: `export async function readUsageRecords(): Promise<UsageRecord[]>` — the single canonical usage read. Every current `await readConfig('usage')` (with its `as UsageRecord[]` cast) is replaced by `await readUsageRecords()`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/cost/usageStore.test.ts
import { describe, it, expect, vi } from 'vitest'
import type { UsageRecord } from '@routerly/shared'

const fixture = [
  { projectId: 'p1', modelId: 'm1', outcome: 'success', timestamp: '2026-07-26T00:00:00.000Z' },
  { projectId: 'p1', modelId: 'm2', outcome: 'blocked', timestamp: '2026-07-26T01:00:00.000Z' },
] as unknown as UsageRecord[]

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(async () => fixture) }))

describe('readUsageRecords', () => {
  it('returns exactly the records readConfig("usage") returns', async () => {
    const { readUsageRecords } = await import('./usageStore.js')
    const { readConfig } = await import('../config/loader.js')
    const direct = (await readConfig('usage')) as UsageRecord[]
    const viaHelper = await readUsageRecords()
    expect(viaHelper).toEqual(direct)
  })

  it('a policy still scores identically through the helper', async () => {
    const { readUsageRecords } = await import('./usageStore.js')
    const records = await readUsageRecords()
    const successForP1 = records.filter((r) => r.projectId === 'p1' && r.outcome === 'success')
    expect(successForP1).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cost/usageStore.test.ts`
Expected: FAIL — cannot find module `./usageStore.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/cost/usageStore.ts
import type { UsageRecord } from '@routerly/shared'
import { readConfig } from '../config/loader.js'

// Single canonical usage read. All budget checks and usage-scanning routing policies
// go through here instead of each calling readConfig('usage') with its own cast.
// ponytail: thin wrapper by design — the value is ONE scan implementation + ONE type
// cast. Upgrade point: if usage.json growth (issue #124) forces a windowed or streamed
// read, change it here once and every phase inherits it.
export async function readUsageRecords(): Promise<UsageRecord[]> {
  return (await readConfig('usage')) as UsageRecord[]
}
```

Then repoint each site. In `cost/budget.ts` replace all three `const records = await readConfig('usage')` (with the surrounding `as UsageRecord[]` cast) with `const records = await readUsageRecords()` and import `readUsageRecords` from `./usageStore.js`. In each of `routing/policies/{performance,health,rate-limit,fairness}.ts` replace `const records: UsageRecord[] = await readConfig('usage')` with `const records = await readUsageRecords()` and import from `../../cost/usageStore.js`. Drop the now-unused `readConfig` import where it becomes unused. No filter/scoring logic changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cost/usageStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full suite (parity of all usage scans)**

Run: `npm run typecheck && npm test`
Expected: green — budget checks and all four usage-scanning policies read the same records as before, now through one helper.

- [ ] **Step 6: Commit**

```bash
git add packages/service/src/cost/usageStore.ts packages/service/src/cost/usageStore.test.ts packages/service/src/cost/budget.ts packages/service/src/routing/policies/
git commit -m "refactor(cost): single readUsageRecords helper for all usage.json scans (dedup)"
```

- [ ] **Step 7: Update the KB note (dedup applied)**

Append a dated line to the Obsidian KB note recording that decision #11 dedup landed, via the `obsidian-personal` MCP server:

```
mcp__obsidian-personal__vault_append({
  filename: 'Hobby e nerd/Progetti tech/Routerly/refactory/Ristrutturazione del service.md',
  content: '\n- 2026-07-26 (Plan 5, decision #11 dedup): unified cost math onto calculateCost (cache-creation aware; usage.json total already used it, executor trace total now matches), removed dead selectModel (grep-gated, zero callers), single readUsageRecords helper for all usage.json scans. Client wire output byte-identical; internal trace/dashboard cost numbers may shift by design.'
})
```

If the note path has moved, locate it first with `mcp__obsidian-personal__search_simple({ query: 'Ristrutturazione del service' })` and append to the match.

---

### Task 12: Atomic flip — route OpenAI + Anthropic through the pipeline; delete old inline handlers; full curl byte-diff gate

> **This is the single gate for the whole dark pipeline (Plans 4 + 5).** Everything before this task is dark and non-breaking: the kernel, config, provider, transport pipeline, and all concern modules are registered but `routes/openai.ts` / `routes/anthropic.ts` still serve live traffic through the old inline handlers. This task makes the pipeline LIVE by flipping the routes to `runProxy`, deletes the now-dead inline handlers, and gates the change on a full curl byte-diff vs a `main` build. The **streaming byte-diff is the highest-risk check** (roadmap §"Honest risk note"): the stream-transform-chain (`upstream.execute` raw iterator → `pii.output` wrap → `guardrail.response` wrap → `egress` pump) and the verbatim-passthrough lanes are the two places a subtle difference silently breaks Claude Code / SDK clients. If any byte-diff fails, REVERT the one-line route flip and the service stays green on the untouched inline handlers.

**Files:**
- Edit: `packages/service/src/routes/openai.ts` — POST handler builds the lane `ProxyContext` and calls `runProxy(getProxyPipeline(), ctx)`; delete the dead inline `handleOpenAICompletion` body + now-unused imports.
- Edit: `packages/service/src/routes/anthropic.ts` — POST handler builds the lane `ProxyContext` and calls `runProxy(getProxyPipeline(), ctx)`; delete the dead inline Anthropic handler body + now-unused imports.

**Interfaces:**
- Consumes: `runProxy`, `getProxyPipeline` (or the typed `PROXY_PIPELINE` narrowing at the use site), and the `ProxyContext` builder from Plan 4's `reverse-proxy/`. The auth/trace plugins already decorate `req`/`reply` exactly as today — the handler only assembles `ProxyContext` from the decorated request and delegates.
- Produces: both POST routes delegate to the pipeline; the inline handler functions and their orphaned imports are gone. No `@routerly/shared` type, no `/api/*` route, no header, and no SSE frame changes — the wire output must be byte-identical to `main`.

- [ ] **Step 1: Flip the OpenAI route to `runProxy`**

In `routes/openai.ts`, replace the body of the `/v1/chat/completions` (and `/v1/responses`) POST handler with the lane-context build + delegate:

```ts
const ctx = buildOpenAIProxyContext(req, reply) // Plan 4 lane builder: fills protocol/req/reply/log/project/token/trace/original/request/stream/passthrough
await runProxy(getProxyPipeline(), ctx)
```

Then delete the inline `handleOpenAICompletion` function body and every import it alone used (executor calls, guardrail/pii calls, block-payload builders, etc.) — those concerns now live in the modules and Plan 4's transport processors. Let the typechecker (Step 4) prove which imports are now orphaned.

- [ ] **Step 2: Flip the Anthropic route to `runProxy`**

In `routes/anthropic.ts`, do the same for the `/v1/messages` POST handler:

```ts
const ctx = buildAnthropicProxyContext(req, reply) // passthrough === true for the verbatim lanes
await runProxy(getProxyPipeline(), ctx)
```

Delete the inline Anthropic handler body and its now-unused imports. `/v1/messages/count_tokens` and `/v1/models*` handlers are unchanged (not part of the completion pipeline).

- [ ] **Step 3: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: exit 0 and green. The typecheck surfaces every orphaned import left by the deleted handlers — remove each until clean. Existing route tests exercise the flipped path through the pipeline.

- [ ] **Step 4: FULL curl byte-diff vs a `main` build (THE GATE)**

Build `main` and the flipped branch, run each against the roadmap §"Verification protocol" smoke set with a local Routerly on `:3000` and the test project token, and diff the raw bytes. The streaming diff is the highest-risk line — compare SSE frames verbatim (`data:` chunks, trace frames, `[DONE]`), not just the decoded text.

```bash
# capture each response from BOTH builds and `diff` them; they must be byte-identical
# 1. non-streaming OpenAI
curl -s localhost:3000/v1/chat/completions -H "Authorization: Bearer $ROUTERLY_TEST_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"model":"routerly/ada","messages":[{"role":"user","content":"ping"}]}'
# 2. streaming OpenAI  (HIGHEST RISK — stream-transform-chain; diff SSE frames byte-for-byte)
curl -sN localhost:3000/v1/chat/completions -H "Authorization: Bearer $ROUTERLY_TEST_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"model":"routerly/ada","stream":true,"messages":[{"role":"user","content":"ping"}]}'
# 3. Anthropic passthrough (verbatim lane — must stay byte-verbatim)
curl -sN localhost:3000/v1/messages -H "Authorization: Bearer $ROUTERLY_TEST_TOKEN" \
  -H 'content-type: application/json' -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"claude-sonnet-4","max_tokens":64,"messages":[{"role":"user","content":"ping"}]}'
# 4. models list (dashboard/CLI contract)
curl -s localhost:3000/v1/models -H "Authorization: Bearer $ROUTERLY_TEST_TOKEN"
```

Expected: every response byte-identical to the `main` build. Per decision #11, the diff applies to the WIRE response only — internal `usage.json` cost figures may legitimately shift (cache-creation-aware calculator) and are NOT part of this gate.

- [ ] **Step 5: Browser UAT (build dashboard first)**

Run: `npm run build --workspace=packages/dashboard`, then log in, open a project, and confirm the models / usage / routing / trace views render and load. The dashboard is the live `/api/*` contract check end to end.

- [ ] **Step 6: Revert path if the gate fails**

If ANY byte-diff in Step 4 fails (streaming especially), REVERT the one-line route flip in the offending route (restore the inline handler call) — the service returns to green on the untouched inline handlers, and the pipeline goes back to dark. Diagnose the diff (most likely the stream-transform-chain wrap order or an `egress` framing detail), fix in Plan 4's transport/helpers or the Plan 5 wrap processors, and re-run the gate. Do NOT commit a failing flip.

- [ ] **Step 7: Update the KB note (pipeline is live)**

Append a dated line to the Obsidian KB (`obsidian-personal`) recording that the atomic flip landed and the pipeline is live:

```
mcp__obsidian-personal__vault_append({
  filename: 'Hobby e nerd/Progetti tech/Routerly/refactory/Pipeline del reverse proxy.md',
  content: '\n- 2026-07-26 (Plan 5 Task 12, atomic flip): routes/openai.ts + routes/anthropic.ts now delegate to runProxy(getProxyPipeline(), ctx); old inline handlers deleted. Full curl byte-diff vs main (non-stream + stream + Anthropic passthrough + /v1/models) passed; dashboard UAT green. Pipeline is LIVE.'
})
```

If the note path has moved, locate it first with `mcp__obsidian-personal__search_simple({ query: 'Pipeline del reverse proxy' })` and append to the match. Also resolve the relevant "Questioni aperte" in that note per the roadmap §"Knowledge base" directive.

- [ ] **Step 8: Commit**

```bash
git add packages/service/src/routes/openai.ts packages/service/src/routes/anthropic.ts
git commit -m "feat(reverse-proxy): atomic flip routes to runProxy; delete inline handlers (pipeline live)"
```

---

## Self-review

### FEATURE INVENTORY — parity proof

Every capability present before this plan remains reachable after it. Each row names the module (or unchanged call site) that now owns the capability and confirms it is still wired.

| Capability | Underlying function(s) (unchanged) | Owner after Plan 5 | Phase / site | Lane | Still wired |
|---|---|---|---|---|---|
| Routing policy: context | `contextPolicy` via `routeRequest` | `routing` | `routing.prepare` | both | yes (inside `routeRequest`, unchanged) |
| Routing policy: cheapest | `cheapestPolicy` via `routeRequest` | `routing` | `routing.prepare` | both | yes |
| Routing policy: health | `healthPolicy` via `routeRequest` | `routing` | `routing.prepare` | both | yes |
| Routing policy: performance | `performancePolicy` via `routeRequest` | `routing` | `routing.prepare` | both | yes |
| Routing policy: llm | `llmPolicy` via `routeRequest` | `routing` | `routing.prepare` | both | yes |
| Routing policy: capability | `capabilityPolicy` via `routeRequest` | `routing` | `routing.prepare` | both | yes |
| Routing policy: rate-limit | `rateLimitPolicy` via `routeRequest` | `routing` | `routing.prepare` | both | yes |
| Routing policy: fairness | `fairnessPolicy` via `routeRequest` | `routing` | `routing.prepare` | both | yes |
| Routing policy: budget-remaining | `budgetRemainingPolicy` via `routeRequest` | `routing` | `routing.prepare` | both | yes |
| Routing policy: semantic-intent | `semanticIntentPolicy` via `routeRequest` | `routing` | `routing.prepare` | both | yes |
| Routing policy: model-preference | `modelPreferencePolicy` via `routeRequest` | `routing` | `routing.prepare` | both | yes |
| Routing parallel policy execution | `Promise.all` inside `routeRequest` | `routing` (internal, unchanged) | `routing.prepare` | both | yes (parallelism lives inside `routeRequest`, not the pipeline) |
| Routing candidate pre-filter (limits) | `isAllowed`/`getViolatedLimits` inside `routeRequest` | `routing` (internal) | `routing.prepare` | both | yes |
| Routing memory | `addRoutingDecision` | `routing` (`routing.memory`) | `routing.prepare` | OpenAI only | yes (guarded `ctx.protocol==='openai'`, matches current) |
| Guardrail: regex | `checkGuardrails`/`checkRule` | `guardrails` | `request.preprocess` / `response.postprocess` | request=both, response=OpenAI | yes |
| Guardrail: semantic | `checkGuardrails` (embedding + `classifyIntent`) | `guardrails` | same | same | yes |
| Guardrail: topic (judge) | `checkGuardrails` (`llmChat` judge) | `guardrails` | same | same | yes |
| Guardrail: moderation (judge) | `checkGuardrails` (`llmChat` judge) | `guardrails` | same | same | yes |
| Guardrail: injection detection | `checkGuardrails` (`detectInjection`) | `guardrails` | `request.preprocess` | both | yes |
| Guardrail: request injection (steering) | `buildRequestInjection` | `guardrails` | `request.preprocess` | both | yes |
| Guardrail: response check + SSE buffering | `checkGuardrails('response')` | `guardrails` (`guardrail.response` wraps the stream via `wrapWithResponseGuardrail`; non-stream checks in place) + Plan 4 egress (pumps the wrapped iterator) | `response.postprocess` | OpenAI only | yes |
| Guardrail-blocked usage record | `trackUsage` (blocked) | `usage` (`usage.finalize`, reads `ctx.blockedBy`) | `finalize` | both | yes |
| PII input scrub | `mergePolicies('input')` + `scrubMessages` | `pii` (`pii.input`) | `request.preprocess` | both | yes (runs before guardrails, weight -10) |
| PII output scrub (non-streaming) | `mergePolicies('output')` + `scrubText` | `pii` (`pii.output`) | `response.postprocess` | OpenAI only | yes |
| PII output scrub (streaming buffer) | `StreamingScrubber` (via `wrapWithStreamingScrubber`) | `pii` (`pii.output` wraps the raw iterator) + Plan 4 egress (pumps the wrapped iterator) | `response.postprocess` / `egress` | OpenAI only | yes |
| Budget / limits enforcement (completion) | `checkBudget`→`isAllowed` inside executor | executor (unchanged, inside `upstream.execute`) | `upstream.execute` | both | yes (single authoritative recorder) |
| Budget / limits per-candidate gate | `isAllowed` | `budget` (`budget.upstream`) | `upstream.prepare` | both | yes |
| Budget snapshots / violations API | `getViolatedLimits`, `getLimitUsageSnapshot` | `budget` (`BUDGET` token) | DI token | n/a | yes (exposed for consumers) |
| Usage tracking (completion/stream/messages) | `trackUsage` inside executor | executor (unchanged) | `upstream.execute` | both | yes (self-tracked, no double count) |
| Usage tracking (verbatim passthrough) | `trackUsage` inside `forward*` | Plan 4 `forward*` (unchanged) | `upstream.execute` | both | yes |
| Usage tracker DI exposure | `trackUsage` | `usage` (`USAGE_TRACKER` token) | DI token | n/a | yes |
| Cost calculation | `calculateCost` (called by `trackUsage`) | executor/`usage` (internal, unchanged) | `upstream.execute` / `finalize` | both | yes |
| Router DI exposure | `routeRequest` | `routing` (`ROUTER` token) | DI token | n/a | yes |
| Trace init | `setTrace` | `logging` (`logging.ingress`) | `ingress` | both | yes |
| Trace flush / snapshot | `getTrace` (via `trackUsage`) | `logging` (`logging.finalize`) | `finalize` | both | yes |
| Catalog sync | `syncModelsFromCatalog` | `provider` (Plan 3) | management / startup (`routes/api.ts`) | n/a | yes (unchanged, not a pipeline concern; roadmap decision #9) |
| Telemetry | `pingTelemetry` | `logging` (nominal) | startup (`server.ts`) + `routes/api.ts` | n/a | yes (unchanged call sites) |
| Audit | `logAudit` | `logging` (nominal) | management (`routes/api.ts`) | n/a | yes (unchanged call sites) |
| Response cache | none (does not exist) | `cache` (no-op predisposition) | — | — | n/a (YAGNI; slot reserved, no processor) |

Nothing is dropped. Every routing policy, every guardrail rule type, PII input+output (incl. streaming buffer), budget/limits, catalog sync, routing memory, telemetry and audit is accounted for and still wired.

### Processor ordering — unchanged vs Plan 4

The Task 8 `ordering.test.ts` asserts the exact per-phase sequence the modules produce:

- `ingress`: `[logging.ingress]`
- `request.preprocess`: `[pii.input, guardrail.request]` — input PII before request guardrail (matches `routes/*.ts`: "Runs BEFORE guardrails so the judge never sees raw PII"), enforced by `pii.input` `weight: -10` and `guardrail.request` `after: ['pii.input']`.
- `routing.prepare`: `[routing.prepare, routing.memory]` — memory after routing, enforced by `after: ['routing.prepare']`.
- `upstream.prepare`: `[budget.upstream]`.
- `response.postprocess`: `[pii.output, guardrail.response]` — output PII before response guardrail, enforced by `pii.output` `weight: -10` and `guardrail.response` `after: ['pii.output']`.
- `finalize`: `[usage.finalize, logging.finalize]` — trace flush after usage, enforced by `logging.finalize` `after: ['usage.finalize']`.

This is the same order the current inline route handlers ran (Plan 4 is transport-only; the concern order is reproduced entirely by these modules). The wrapped functions are byte-for-byte identical; combined with the roadmap curl byte-diff + browser UAT at the atomic flip (Task 12), the wire output is unchanged. The asymmetry is preserved: `routing.memory`, `pii.output` and `guardrail.response` early-return for `ctx.protocol !== 'openai'`, reproducing `routes/anthropic.ts` having none of them, against the single shared `PROXY_PIPELINE`.

### Dedup (decision #11)

Aggressive dedup of duplicated internal computation, in scope for Plan 5 (Tasks 9-11). The pipeline structure and the wrapper strategy are unchanged; only redundant logic behind them is unified.

1. **No duplicate cost implementation remains.** The executor's three inline `totalCostUsd` computations (chat/stream/messages, each omitting cache-creation) are removed; all cost is computed by the single `cost/calculator.ts::calculateCost`. Confirmed the persisted `usage.json` total already used `calculateCost` (`cost/tracker.ts:41`), so the only observable shift is the executor's emitted trace total becoming cache-creation-aware. Verified by `executor.cost.test.ts` (Task 9), which fails on the old inline path.
2. **`selectModel` removal was grep-gated.** Task 10 Step 1 runs `grep -rn "selectModel" packages/*/src` FIRST; the export is deleted only because the sole matches are its own definition and test (zero runtime/CLI/dashboard/`@routerly/shared` callers). If a caller had existed it would have been repointed to `routeRequest(...).models[0]` before deletion.
3. **Usage scan has one implementation.** All seven direct `readConfig('usage')` scans (`cost/budget.ts` x3, `performance`/`health`/`rate-limit`/`fairness` policies; `budget-remaining` reads via `budget.ts`) route through the single `cost/usageStore.ts::readUsageRecords`. Same records read, one implementation. Verified by `usageStore.test.ts` (Task 11).
4. **Client wire output is still byte-identical; internal numbers may shift by design.** The response `usage` block is passed through verbatim from the provider, never from our calculator, so the Task 8 curl byte-diff on the wire response still holds. Internal `usage.json`-derived figures (budget headroom, dashboard/trace cost displays) may move to the more-correct cache-creation-aware calculator values. That shift is EXPECTED (decision #11) and is the ONLY intentionally-broken internal-number parity; the curl byte-diff does NOT apply to `usage.json` numbers.

### Design notes / deliberate simplifications

- **Single `PROXY_PIPELINE`, protocol guard for asymmetry.** The frozen token is singular, so OpenAI-only processors guard on `ctx.protocol` rather than living in a separate registry. Simplest approach consistent with the frozen contract.
- **Executor stays the authoritative budget/usage recorder.** `budget.upstream` only gates candidate eligibility; `usage.finalize` records only the guardrail-blocked event. This avoids the double-count a naive "trackUsage in finalize for everything" would cause, and honors roadmap decision #3 (usage persistence unchanged).
- **`cache` is a no-op** — verified by grep that no response cache exists. Not invented (YAGNI).
- **`ProxyContext.blockedBy?` and `ProxyContext.guardrailTriggered?`** are Plan-4-owned fields on the frozen shape; this plan adds no context field, it only reads/writes them (`blockedBy` hands the guardrail block reason to `usage.finalize`; `guardrailTriggered` carries the log-only trigger for internal usage attribution). `ProxyContext` is internal (not a frozen public contract).
- **Streaming stream-transform-chain (roadmap decision #13).** In `response.postprocess` the `pii.output` processor (weight -10, first) WRAPS the raw provider iterator with `wrapWithStreamingScrubber`, then `guardrail.response` (`after: ['pii.output']`, second) WRAPS that with `wrapWithResponseGuardrail`. PII wrapper innermost, guardrail wrapper outermost — identical to today's inline order (PII scrub before guardrail check). Plan 4's `egress` only PUMPS the doubly-wrapped iterator. The wrap helpers live in Plan 4's `reverse-proxy/helpers.ts` and are the existing `StreamingScrubber` / buffering code lifted verbatim into generator form (the one place decision #6's "no rewrite" is stretched to "re-shape into a generator"). The streaming curl byte-diff at Task 12 is the acceptance gate.
