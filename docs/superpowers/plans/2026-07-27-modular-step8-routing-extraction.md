# Step 8: modules/routing/ Full Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `routing/router.ts`, `routing/policies/*`, `routing/intent/*`, and `routing/routingMemoryStore.ts` into `modules/routing/`, and fold the existing flat wrapper `modules/routing.ts` into `modules/routing/index.ts` — a pure extraction, zero behavior change, matching the flat-wrap pattern used for every module in this restructure except provider (Step 4).

**Architecture:** `modules/routing/` becomes a directory: `router.ts` (routing engine), `routingMemoryStore.ts` (per-conversation memory), `policies/` (11 policy files + `types.ts`), `intent/` (semantic-intent classifier: `classifier.ts`, `cache.ts`, `similarity.ts`), `index.ts` (the `defineModule` wrapper, moved from the pre-existing flat `modules/routing.ts`). `routing/traceStore.ts` stays at `src/routing/traceStore.ts` — it is Step 10's concern (traceStore absorption into `modules/logging/`), not this step's.

**Tech Stack:** TypeScript ESM, Vitest, existing DI kernel (`core/tokens.ts` `ROUTER` token, `defineModule`).

## Global Constraints

- Wire-format transparency ABSOLUTE — no behavior change, pure file moves + import path fixes.
- No em dashes anywhere (code/comments/docs).
- `git mv` for every move (preserves history); `git status --short` after every multi-pathspec `git add` before committing (pathspec failures abort the whole `add` silently).
- Token key strings in `core/tokens.ts` are stable identifiers, never change when files move — only the `typeof import('...')` path literals change. `ROUTER`'s key `'routing.router'` stays as-is.
- `routing/traceStore.ts` and `routing/traceStore.test.ts` are OUT OF SCOPE — they stay at `src/routing/` untouched. Any import that reaches `traceStore.js` gets a depth fix (files moved deeper into `modules/routing/...`) but the target path itself stays `../routing/traceStore.js` relative to wherever the new file now lives.
- Sibling-to-sibling imports within the moved tree (e.g. `router.ts` importing `./policies/llm.js`, `policies/llm.ts` importing `../routingMemoryStore.js`, `policies/semantic-intent.ts` importing `../intent/classifier.js`) are UNCHANGED — the whole subtree moves together, preserving internal relative structure.
- Imports reaching `modules/config`, `modules/budget`, `modules/usage`, `modules/catalog`, `modules/embeddings` (all already-extracted sibling modules) drop one `../` level per extra directory of nesting under the new `modules/routing/...` location, and drop the `modules/` path segment once the importing file itself lives under `modules/` (established precedent from Steps 5-7).
- `llm/executor.ts` has NOT moved yet (Step 13's concern) — imports reaching it get a depth fix only, the `llm/` segment stays.
- Direct Bash/Edit execution, no subagent dispatch — same precedent as Steps 3-7: fully mechanical, pre-specified transcription plus verification, no design judgment required.

---

### Task 1: Move router.ts, routingMemoryStore.ts, policies/* into modules/routing/

**Files:**
- Move: `packages/service/src/routing/router.ts` → `packages/service/src/modules/routing/router.ts`
- Move: `packages/service/src/routing/router.test.ts` → `packages/service/src/modules/routing/router.test.ts`
- Move: `packages/service/src/routing/routingMemoryStore.ts` → `packages/service/src/modules/routing/routingMemoryStore.ts`
- Move: `packages/service/src/routing/routingMemoryStore.test.ts` → `packages/service/src/modules/routing/routingMemoryStore.test.ts`
- Move: `packages/service/src/routing/policies/*.ts` (12 files: `types.ts`, `context.ts`, `cheapest.ts`, `health.ts`, `performance.ts`, `llm.ts`, `capability.ts`, `rate-limit.ts`, `fairness.ts`, `budget-remaining.ts`, `semantic-intent.ts`, `model-preference.ts`) → `packages/service/src/modules/routing/policies/*.ts`
- Move: `packages/service/src/routing/policies/*.test.ts` (11 files, all except `types.ts` which has no test) → `packages/service/src/modules/routing/policies/*.test.ts`

**Interfaces:**
- Consumes: `readConfig` (`modules/config/loader.js`), `isAllowed`/`getViolatedLimits`/`getLimitUsageSnapshot`/`LimitSnapshot` (`modules/budget/budget.js`), `readUsageRecords` (`modules/usage/usageStore.js`), `trackUsage` (`modules/usage/tracker.js`), `catalogFetcher` (`modules/catalog/fetcher.js`), `llmChat`/`BudgetExceededError`/`LLMCallContext` (`llm/executor.js`, unmoved), `TraceEntry`/`TracePanel` (`routing/traceStore.js`, unmoved), `classifyIntent` (moves in Task 2, sibling `../intent/classifier.js`).
- Produces: `routeRequest` (`modules/routing/router.js`), `addRoutingDecision`/`getRoutingHistory` (`modules/routing/routingMemoryStore.js`), 11 policy functions (`modules/routing/policies/*.js`) — all consumed by Task 3's `modules/routing/index.ts`.

- [ ] **Step 1: Move the files with git mv**

```bash
cd packages/service/src
mkdir -p modules/routing/policies
git mv routing/router.ts modules/routing/router.ts
git mv routing/router.test.ts modules/routing/router.test.ts
git mv routing/routingMemoryStore.ts modules/routing/routingMemoryStore.ts
git mv routing/routingMemoryStore.test.ts modules/routing/routingMemoryStore.test.ts
for f in types context cheapest health performance llm capability rate-limit fairness budget-remaining semantic-intent model-preference; do
  git mv routing/policies/$f.ts modules/routing/policies/$f.ts
done
for f in context cheapest health performance llm capability rate-limit fairness budget-remaining semantic-intent model-preference; do
  git mv routing/policies/$f.test.ts modules/routing/policies/$f.test.ts
done
```

- [ ] **Step 2: Fix router.ts imports**

`modules/routing/router.ts` — change lines 2-4 and 18:

```typescript
import { readConfig } from '../config/loader.js';
import { isAllowed, getViolatedLimits } from '../budget/budget.js';
import type { LimitSnapshot } from '../budget/budget.js';
```

and:

```typescript
import type { TraceEntry, TracePanel } from '../../routing/traceStore.js';
```

(the 11 `./policies/*.js` imports stay unchanged — sibling subdir moves with it)

- [ ] **Step 3: Fix router.test.ts imports**

`modules/routing/router.test.ts` — change the `vi.mock` and `import` lines reaching config/budget:

```typescript
vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../budget/budget.js', () => ({ isAllowed: vi.fn(), getViolatedLimits: vi.fn() }))
```

and:

```typescript
import { readConfig } from '../config/loader.js'
import { isAllowed, getViolatedLimits } from '../budget/budget.js'
```

(the 11 `vi.mock('./policies/*.js', ...)` lines and the `./router.js` self-import stay unchanged)

- [ ] **Step 4: routingMemoryStore.ts / routingMemoryStore.test.ts — no changes needed**

`routingMemoryStore.ts` has no imports. `routingMemoryStore.test.ts` only imports `./routingMemoryStore.js` (unchanged, same dir).

- [ ] **Step 5: Fix policies/types.ts**

`modules/routing/policies/types.ts` — change line 2:

```typescript
import type { TraceEntry } from '../../../routing/traceStore.js';
```

- [ ] **Step 6: context.ts, cheapest.ts, capability.ts, model-preference.ts and their tests — no changes needed**

These 4 policy files (and their tests) only import `./types.js` (or `./<name>.js`), unchanged.

- [ ] **Step 7: Fix health.ts, performance.ts, fairness.ts, rate-limit.ts (usage import)**

Each of these 4 files has one line to change, from:

```typescript
import { readUsageRecords } from '../../modules/usage/usageStore.js';
```

to:

```typescript
import { readUsageRecords } from '../../usage/usageStore.js';
```

Apply to `modules/routing/policies/health.ts`, `performance.ts`, `fairness.ts`, `rate-limit.ts`.

- [ ] **Step 8: Fix health.test.ts, performance.test.ts, fairness.test.ts, rate-limit.test.ts (config import)**

Each of these 4 test files has one line to change, from:

```typescript
import { readConfig } from '../../modules/config/loader.js'
```

to:

```typescript
import { readConfig } from '../../config/loader.js'
```

Apply to `modules/routing/policies/health.test.ts`, `performance.test.ts`, `fairness.test.ts`, `rate-limit.test.ts`.

- [ ] **Step 9: Fix budget-remaining.ts**

`modules/routing/policies/budget-remaining.ts` — change lines 2-3:

```typescript
import { getLimitUsageSnapshot } from '../../budget/budget.js';
import { readConfig } from '../../config/loader.js';
```

- [ ] **Step 10: Fix budget-remaining.test.ts**

`modules/routing/policies/budget-remaining.test.ts` — change lines 7-8:

```typescript
import { readConfig } from '../../config/loader.js'
import { getLimitUsageSnapshot } from '../../budget/budget.js'
```

- [ ] **Step 11: Fix llm.ts**

`modules/routing/policies/llm.ts` — change lines 2-3, 5-7:

```typescript
import { readConfig } from '../../config/loader.js';
import { llmChat, BudgetExceededError } from '../../../llm/executor.js';
import { getRoutingHistory } from '../routingMemoryStore.js';
import type { LLMCallContext } from '../../../llm/executor.js';
import { getLimitUsageSnapshot } from '../../budget/budget.js';
import type { LimitSnapshot } from '../../budget/budget.js';
```

(`../routingMemoryStore.js` is unchanged — it moves alongside as a sibling of `policies/`)

- [ ] **Step 12: Fix llm.test.ts**

`modules/routing/policies/llm.test.ts` — change the `vi.mock` and `import` lines:

```typescript
vi.mock('../../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../../../llm/executor.js', () => ({
  llmChat: vi.fn(),
  BudgetExceededError: class BudgetExceededError extends Error {
    constructor(msg = 'budget') { super(msg); this.name = 'BudgetExceededError' }
  },
}))
vi.mock('../routingMemoryStore.js', () => ({ getRoutingHistory: vi.fn() }))
vi.mock('../../budget/budget.js', () => ({ getLimitUsageSnapshot: vi.fn() }))

import { llmPolicy } from './llm.js'
import { readConfig } from '../../config/loader.js'
import { llmChat, BudgetExceededError } from '../../../llm/executor.js'
import { getRoutingHistory } from '../routingMemoryStore.js'
import { getLimitUsageSnapshot } from '../../budget/budget.js'
```

- [ ] **Step 13: Fix semantic-intent.ts**

`modules/routing/policies/semantic-intent.ts` — change lines 3-5 (line 2, `../intent/classifier.js`, stays unchanged — `intent/` moves alongside in Task 2):

```typescript
import { trackUsage } from '../../usage/tracker.js';
import { readConfig } from '../../config/loader.js';
import { catalogFetcher } from '../../catalog/fetcher.js';
```

- [ ] **Step 14: Fix semantic-intent.test.ts**

`modules/routing/policies/semantic-intent.test.ts` — change the 4 `vi.mock` lines and the `trackUsage` import (the `clearIntentCache` import from `../intent/cache.js` stays unchanged):

```typescript
vi.mock('../../embeddings/dispatch.js', () => ({
  // ...unchanged mock body
}));
vi.mock('../../usage/tracker.js', () => ({
  // ...unchanged mock body
}));
vi.mock('../../catalog/fetcher.js', () => ({
  // ...unchanged mock body
}));
vi.mock('../../config/loader.js', () => ({
  // ...unchanged mock body
}));
```

and:

```typescript
import { trackUsage } from '../../usage/tracker.js';
```

- [ ] **Step 15: Run the moved tests**

```bash
npx vitest run packages/service/src/modules/routing/router.test.ts packages/service/src/modules/routing/routingMemoryStore.test.ts packages/service/src/modules/routing/policies --root packages/service
```

Expected: all pass, same counts as before the move (verify against pre-move baseline: `router.test.ts`, `routingMemoryStore.test.ts`, and 11 policy test files).

- [ ] **Step 16: Commit**

```bash
git add packages/service/src/routing packages/service/src/modules/routing
git status --short
git commit -m "refactor(routing): move router, routingmemorystore, policies into modules/"
```

(commit subject lowercased per commitlint `subject-case`, same precedent as `readusagerecords`/`calculatecost`)

---

### Task 2: Move intent/* into modules/routing/intent/

**Files:**
- Move: `packages/service/src/routing/intent/similarity.ts` → `packages/service/src/modules/routing/intent/similarity.ts`
- Move: `packages/service/src/routing/intent/similarity.test.ts` → `packages/service/src/modules/routing/intent/similarity.test.ts`
- Move: `packages/service/src/routing/intent/cache.ts` → `packages/service/src/modules/routing/intent/cache.ts`
- Move: `packages/service/src/routing/intent/cache.test.ts` → `packages/service/src/modules/routing/intent/cache.test.ts`
- Move: `packages/service/src/routing/intent/classifier.ts` → `packages/service/src/modules/routing/intent/classifier.ts`
- Move: `packages/service/src/routing/intent/classifier.test.ts` → `packages/service/src/modules/routing/intent/classifier.test.ts`

**Interfaces:**
- Consumes: `EmbeddingProvider` type (`modules/embeddings/types.js`), `getEmbeddingProvider` (`modules/embeddings/dispatch.js`).
- Produces: `classifyIntent` (`modules/routing/intent/classifier.js`) — consumed by Task 1's already-moved `policies/semantic-intent.ts` (unchanged sibling import) and by Task 3's external consumer `middleware/guardrails.ts`.

- [ ] **Step 1: Move the files with git mv**

```bash
cd packages/service/src
mkdir -p modules/routing/intent
git mv routing/intent/similarity.ts modules/routing/intent/similarity.ts
git mv routing/intent/similarity.test.ts modules/routing/intent/similarity.test.ts
git mv routing/intent/cache.ts modules/routing/intent/cache.ts
git mv routing/intent/cache.test.ts modules/routing/intent/cache.test.ts
git mv routing/intent/classifier.ts modules/routing/intent/classifier.ts
git mv routing/intent/classifier.test.ts modules/routing/intent/classifier.test.ts
```

- [ ] **Step 2: similarity.ts / similarity.test.ts — no changes needed**

No cross-boundary imports (only `./similarity.js` self-reference in the test).

- [ ] **Step 3: Fix cache.ts**

`modules/routing/intent/cache.ts` — change line 2:

```typescript
import type { EmbeddingProvider } from '../../embeddings/types.js';
```

(`./similarity.js` import stays unchanged)

- [ ] **Step 4: Fix cache.test.ts**

`modules/routing/intent/cache.test.ts` — change line 4:

```typescript
import type { EmbeddingProvider } from '../../embeddings/types.js'
```

- [ ] **Step 5: Fix classifier.ts**

`modules/routing/intent/classifier.ts` — change line 2:

```typescript
import { getEmbeddingProvider } from '../../embeddings/dispatch.js';
```

(`./similarity.js` and `./cache.js` imports stay unchanged)

- [ ] **Step 6: Fix classifier.test.ts**

`modules/routing/intent/classifier.test.ts` — change line 4:

```typescript
vi.mock('../../embeddings/dispatch.js', () => ({
  // ...unchanged mock body
}))
```

(`./classifier.js` and `./cache.js` imports stay unchanged)

- [ ] **Step 7: Run the moved tests**

```bash
npx vitest run packages/service/src/modules/routing/intent --root packages/service
```

Expected: all pass (3 files: similarity, cache, classifier).

- [ ] **Step 8: Commit**

```bash
git add packages/service/src/routing packages/service/src/modules/routing/intent
git status --short
git commit -m "refactor(routing): move intent classifier/cache/similarity into modules/"
```

---

### Task 3: Move module wrapper to index.ts, fix token/barrel paths, repoint external consumers

**Files:**
- Move: `packages/service/src/modules/routing.ts` → `packages/service/src/modules/routing/index.ts`
- Move: `packages/service/src/modules/routing.test.ts` → `packages/service/src/modules/routing/index.test.ts`
- Modify: `packages/service/src/core/tokens.ts`
- Modify: `packages/service/src/modules/index.ts`
- Modify: `packages/service/src/middleware/guardrails.ts`
- Modify: `packages/service/src/middleware/guardrails.test.ts`

**Interfaces:**
- Consumes: `routeRequest` (Task 1's `./router.js`), `addRoutingDecision` (Task 1's `./routingMemoryStore.js`), `appendTrace`/`TraceEntry` (`../../routing/traceStore.js`, unmoved), `classifyIntent` (Task 2's `modules/routing/intent/classifier.js`).
- Produces: `routingModule` (`modules/routing/index.js`) — consumed by `modules/index.ts`'s `coreModules` barrel (unchanged array contents, only the import path changes).

- [ ] **Step 1: Move the wrapper files with git mv**

```bash
cd packages/service/src
git mv modules/routing.ts modules/routing/index.ts
git mv modules/routing.test.ts modules/routing/index.test.ts
```

- [ ] **Step 2: Fix modules/routing/index.ts**

Full corrected file:

```typescript
import { defineModule, type Processor, type RouterlyModule } from '../../core/index.js'
import { ROUTER, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { routeRequest } from './router.js'
import { addRoutingDecision } from './routingMemoryStore.js'
import { appendTrace } from '../../routing/traceStore.js'
import type { TraceEntry } from '../../routing/traceStore.js'

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
    container.resolve(PROXY_PIPELINE).contribute(prepare)
    container.resolve(PROXY_PIPELINE).contribute(memory)
  },
})
```

(only the import paths at the top changed: `../core/*` → `../../core/*`, `../reverse-proxy/context.js` → `../../reverse-proxy/context.js`, `../routing/router.js` → `./router.js`, `../routing/routingMemoryStore.js` → `./routingMemoryStore.js`, `../routing/traceStore.js` → `../../routing/traceStore.js`; the processor bodies and manifest are byte-identical to the pre-move file)

- [ ] **Step 3: Fix modules/routing/index.test.ts**

Change the import block to:

```typescript
import { describe, it, expect } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { ROUTER, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { routeRequest } from './router.js'
import { routingModule } from './index.js'
```

(test bodies unchanged)

- [ ] **Step 4: Fix core/tokens.ts**

Change line 6:

```typescript
import type { RouteResult } from '../modules/routing/router.js';
```

(the `ROUTER` token's key string `'routing.router'` stays unchanged)

- [ ] **Step 5: Fix modules/index.ts**

Change line 1:

```typescript
import { routingModule } from './routing/index.js'
```

(the `coreModules` array entry `routingModule` is unchanged)

- [ ] **Step 6: Fix middleware/guardrails.ts**

Change line 12:

```typescript
import { classifyIntent } from '../modules/routing/intent/classifier.js';
```

- [ ] **Step 7: Fix middleware/guardrails.test.ts**

Change line 14 (`vi.mock` target) and line 21 (`import`):

```typescript
vi.mock('../modules/routing/intent/classifier.js', () => ({ classifyIntent: vi.fn() }));
```

```typescript
import { classifyIntent } from '../modules/routing/intent/classifier.js';
```

- [ ] **Step 8: Blanket stale-reference grep**

```bash
cd packages/service/src
grep -rn "from '.*routing/router\.js'\|from '.*routing/routingMemoryStore\.js'\|from '.*routing/policies/\|from '.*routing/intent/\|routing/router\.js\|routing/routingMemoryStore\.js\|routing/policies/\|routing/intent/" --include="*.ts" . | grep -v "modules/routing/" | grep -v "'\.\./\.\./routing/traceStore\.js'" | grep -v "'\.\.\/routing\/traceStore\.js'"
grep -rn "import(" --include="*.ts" . | grep -i "routing/router\|routing/policies\|routing/intent\|routing/routingMemoryStore"
```

Expected: no output beyond legitimate `traceStore.js` references (which stay pointed at `routing/traceStore.js`, unmoved).

- [ ] **Step 9: Run full suite and typecheck**

```bash
npm run typecheck --workspace=packages/service
npx vitest run --root packages/service
```

Expected: same 3 pre-existing baseline failures (`oauthForward.test.ts` x2, `modules/provider/anthropic.test.ts` x1), no new failures, `tsc` clean.

- [ ] **Step 10: Commit**

```bash
git add packages/service/src/modules/routing.ts packages/service/src/modules/routing.test.ts packages/service/src/modules/routing packages/service/src/core/tokens.ts packages/service/src/modules/index.ts packages/service/src/middleware/guardrails.ts packages/service/src/middleware/guardrails.test.ts
git status --short
git commit -m "refactor(routing): move module wrapper to index.ts, fix token/consumer paths"
```

---

## Self-Review

**1. Spec coverage:** Every file under `routing/` except `traceStore.ts`/`traceStore.test.ts` (explicitly out of scope, Step 10's concern) is accounted for: `router.ts`+test, `routingMemoryStore.ts`+test, all 12 `policies/*.ts` + 11 tests, all 3 `intent/*.ts` + 3 tests (35 files total in Tasks 1-2), plus the wrapper `modules/routing.ts`+test and its 4 external consumer touch points (`core/tokens.ts`, `modules/index.ts`, `middleware/guardrails.ts`+test) in Task 3. Matches the exhaustive grep performed during research (only `core/tokens.ts`, `modules/routing.ts`/`.test.ts`, `middleware/guardrails.ts`/`.test.ts` reference the routing subtree from outside it).

**2. Placeholder scan:** No TBD/TODO. The `vi.mock` mock-body ellipses in Steps 14 (Task 1) and 6 (Task 2) are the ONLY placeholders in this plan, and they are deliberate — they mark existing mock bodies that are not changing (only the `vi.mock` first-argument path string changes), not missing content. Every changed line is given verbatim.

**3. Type consistency:** `RouteResult`, `routeRequest`, `ROUTER` token key `'routing.router'`, `addRoutingDecision`/`getRoutingHistory`, `classifyIntent` signatures are unchanged throughout — only import paths move. Cross-checked against the live pre-move files read during research (`router.ts`, all 11 policy files, all 3 intent files, `routingMemoryStore.ts`, `modules/routing.ts`, `modules/routing.test.ts`, `core/tokens.ts`'s `ROUTER` block, `modules/index.ts`, `middleware/guardrails.ts`/`.test.ts`).

---

## Execution Handoff

Fully mechanical extraction with every import-path change pre-specified against the live codebase (no design judgment, no new logic). Per established precedent for Steps 3-7 in this restructure, execute directly via Bash/Edit in this session — no subagent dispatch.
