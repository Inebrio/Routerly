# Step 7: modules/budget/ + modules/usage/ Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `cost/budget.ts`, `cost/tracker.ts`, `cost/usageStore.ts` (+ tests) into `modules/budget/` and `modules/usage/`, merging in the existing flat `modules/budget.ts`/`modules/usage.ts` wrappers as `modules/budget/index.ts`/`modules/usage/index.ts`. `cost/` disappears entirely. Pure extraction, no behavior change, no manifest/`dependsOn` change.

**Architecture:** Same shape as Steps 3-6: real logic files move unchanged (or with import-depth fixes only), the existing thin `defineModule` wrapper moves into the new directory as `index.ts`. Two wrinkles specific to this step: (a) two directories land in the same task, since the overview marks them "parallel-safe with each other" (no ordering dependency between them) — done as one plan, sequential tasks, since a single plan drafts faster than two near-duplicate ones; (b) `budget.ts` has a real file-level dependency on `usageStore.ts` (`readUsageRecords`) that survives the move as a cross-module-directory import (`modules/budget/budget.ts` importing `../usage/usageStore.js`), the same as `modules/catalog/sync.ts` already imports `../config/loader.js` directly — established precedent, not a new pattern.

**Tech Stack:** TypeScript ESM, Vitest, Fastify 5.

## Global Constraints

- Wire-format transparency ABSOLUTE — no request/response payload logic touched, only file locations and import paths.
- No em dashes anywhere (code, comments, commits).
- Imports: `.js` extension on relative imports; `node:` prefix on builtins.
- Public contracts frozen: `isAllowed`, `isAllowedForRoutingModel`, `getViolatedLimits`, `getLimitUsageSnapshot`, `LimitSnapshot`, `trackUsage`, `TrackUsageParams`, `readUsageRecords` signatures and behavior unchanged.
- `budgetModule`'s manifest (`{id: 'budget', version: '0.4.0', dependsOn: {'reverse-proxy': '^0.4.0', provider: '^0.4.0'}}`) and `usageModule`'s manifest (`{id: 'usage', version: '0.4.0', dependsOn: {'reverse-proxy': '^0.4.0', config: '^0.4.0'}}`) do NOT change. `budget.ts`'s new direct import of `usageStore.ts` is a plain function call, not a `container.resolve()` — this codebase's convention (confirmed via `catalogModule`/`providerModule`) is that manifest `dependsOn` tracks kernel registration-order requirements (a module's `register()` calling `container.resolve()` on another module's token), not the transitive source-level import graph. Do not add a speculative `dependsOn: { usage: ... }` entry — YAGNI, nothing in `budgetModule.register()` resolves a usage token.
- `BUDGET` and `USAGE_TRACKER` tokens in `core/tokens.ts` keep their exact shape; only their internal `typeof import(...)` path literals change.
- Commit subjects must be all-lowercase (commitlint `subject-case`).
- Full suite + `tsc --noEmit` must stay at the established baseline (3 pre-existing failures, no new failures) before each commit.

---

### Task 1: Move budget/tracker/usageStore source + tests into modules/budget/ and modules/usage/

**Files:**
- Move: `packages/service/src/cost/budget.ts` -> `packages/service/src/modules/budget/budget.ts` (git mv, 1 import fix)
- Move: `packages/service/src/cost/budget.test.ts` -> `packages/service/src/modules/budget/budget.test.ts` (git mv, 1 import fix)
- Move: `packages/service/src/cost/tracker.ts` -> `packages/service/src/modules/usage/tracker.ts` (git mv, 2 import fixes)
- Move: `packages/service/src/cost/tracker.test.ts` -> `packages/service/src/modules/usage/tracker.test.ts` (git mv, 2 import/mock fixes)
- Move: `packages/service/src/cost/usageStore.ts` -> `packages/service/src/modules/usage/usageStore.ts` (git mv, 1 import fix)
- Move: `packages/service/src/cost/usageStore.test.ts` -> `packages/service/src/modules/usage/usageStore.test.ts` (git mv, 1 mock fix)

**Interfaces:**
- Consumes: nothing new.
- Produces: `modules/budget/budget.ts` exporting `isAllowed`, `isAllowedForRoutingModel`, `getViolatedLimits`, `getLimitUsageSnapshot`, `LimitSnapshot` (unchanged); `modules/usage/tracker.ts` exporting `trackUsage`, `TrackUsageParams` (unchanged); `modules/usage/usageStore.ts` exporting `readUsageRecords` (unchanged).

- [ ] **Step 1: Move the 6 files with git mv**

```bash
mkdir -p packages/service/src/modules/budget packages/service/src/modules/usage
git mv packages/service/src/cost/budget.ts packages/service/src/modules/budget/budget.ts
git mv packages/service/src/cost/budget.test.ts packages/service/src/modules/budget/budget.test.ts
git mv packages/service/src/cost/tracker.ts packages/service/src/modules/usage/tracker.ts
git mv packages/service/src/cost/tracker.test.ts packages/service/src/modules/usage/tracker.test.ts
git mv packages/service/src/cost/usageStore.ts packages/service/src/modules/usage/usageStore.ts
git mv packages/service/src/cost/usageStore.test.ts packages/service/src/modules/usage/usageStore.test.ts
```

- [ ] **Step 2: Fix modules/budget/budget.ts's import**

`budget.ts` was a sibling of `usageStore.ts` under `cost/`; after the move they are siblings of each other's new module directories (`modules/budget/` and `modules/usage/`), one level deeper each, so the relative path becomes `../usage/`. Change:
```ts
import { readUsageRecords } from './usageStore.js';
```
to:
```ts
import { readUsageRecords } from '../usage/usageStore.js';
```

- [ ] **Step 3: Fix modules/budget/budget.test.ts's import**

`cost/budget.test.ts`'s own `'./budget.js'` self-import needs no change (still a same-directory sibling). Only the `config/loader.js` depth needs fixing (was `../modules/config/loader.js` from `cost/`, one level under `src/`; `modules/budget/` is one level under `modules/`, itself under `src/` — same total depth, but the `modules/` segment is now redundant). Change:
```ts
import { readConfig } from '../modules/config/loader.js'
```
to:
```ts
import { readConfig } from '../config/loader.js'
```

- [ ] **Step 4: Fix modules/usage/tracker.ts's imports**

Change:
```ts
import { appendUsageRecord } from '../modules/config/loader.js';
import { calculateCost } from '../lib/cost.js';
import { getTrace } from '../routing/traceStore.js';
```
to:
```ts
import { appendUsageRecord } from '../config/loader.js';
import { calculateCost } from '../../lib/cost.js';
import { getTrace } from '../../routing/traceStore.js';
```
(`config/loader.js` depth-fix same reasoning as Step 3; `lib/cost.js` and `routing/traceStore.js` need one extra `../` since `modules/usage/` is one level deeper than `cost/` relative to those two targets.)

- [ ] **Step 5: Fix modules/usage/tracker.test.ts's imports and mocks**

Change:
```ts
vi.mock('../modules/config/loader.js', () => ({ appendUsageRecord: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../routing/traceStore.js', () => ({ getTrace: vi.fn() }))
```
to:
```ts
vi.mock('../config/loader.js', () => ({ appendUsageRecord: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../routing/traceStore.js', () => ({ getTrace: vi.fn() }))
```
and change:
```ts
import { appendUsageRecord } from '../modules/config/loader.js'
import { getTrace } from '../routing/traceStore.js'
```
to:
```ts
import { appendUsageRecord } from '../config/loader.js'
import { getTrace } from '../../routing/traceStore.js'
```
(`'./tracker.js'` self-import is unchanged, same directory.)

- [ ] **Step 6: Fix modules/usage/usageStore.ts's import**

Change:
```ts
import { readConfig } from '../modules/config/loader.js'
```
to:
```ts
import { readConfig } from '../config/loader.js'
```

- [ ] **Step 7: Fix modules/usage/usageStore.test.ts's mock**

Change:
```ts
vi.mock('../modules/config/loader.js', () => ({ readConfig: vi.fn(async () => fixture) }))
```
to:
```ts
vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(async () => fixture) }))
```

- [ ] **Step 8: Run the moved tests**

Run: `cd packages/service && npx vitest run src/modules/budget/budget.test.ts src/modules/usage/tracker.test.ts src/modules/usage/usageStore.test.ts`
Expected: all tests pass (same counts as before the move).

- [ ] **Step 9: Commit**

```bash
git add packages/service/src/modules/budget packages/service/src/modules/usage packages/service/src/cost
git status --short
git commit -m "refactor(budget,usage): move budget/tracker/usagestore into modules/"
```

Verify with `git status --short` before committing that `packages/service/src/cost/` shows only deletions.

---

### Task 2: Move budget/usage module wrappers to index.ts, fix core/tokens.ts and modules/index.ts

**Files:**
- Move: `packages/service/src/modules/budget.ts` -> `packages/service/src/modules/budget/index.ts` (git mv, 4 import fixes)
- Move: `packages/service/src/modules/budget.test.ts` -> `packages/service/src/modules/budget/index.test.ts` (git mv, 5 import fixes)
- Move: `packages/service/src/modules/usage.ts` -> `packages/service/src/modules/usage/index.ts` (git mv, 4 import fixes)
- Move: `packages/service/src/modules/usage.test.ts` -> `packages/service/src/modules/usage/index.test.ts` (git mv, 6 import fixes)
- Modify: `packages/service/src/core/tokens.ts`
- Modify: `packages/service/src/modules/index.ts`

**Interfaces:**
- Consumes: `isAllowed`, `getViolatedLimits`, `getLimitUsageSnapshot` from `./budget.js` (Task 1); `trackUsage` from `./tracker.js` (Task 1).
- Produces: `budgetModule`, `usageModule` importable from `modules/budget/index.js`, `modules/usage/index.js` respectively (same names, new paths).

- [ ] **Step 1: Move the 4 wrapper files with git mv**

```bash
git mv packages/service/src/modules/budget.ts packages/service/src/modules/budget/index.ts
git mv packages/service/src/modules/budget.test.ts packages/service/src/modules/budget/index.test.ts
git mv packages/service/src/modules/usage.ts packages/service/src/modules/usage/index.ts
git mv packages/service/src/modules/usage.test.ts packages/service/src/modules/usage/index.test.ts
```

- [ ] **Step 2: Fix modules/budget/index.ts's imports**

Before the move `modules/budget.ts` was a direct child of `modules/`; after the move `modules/budget/index.ts` is a child of `modules/budget/`, one level deeper. Change:
```ts
import { defineModule, type Processor, type RouterlyModule } from '../core/index.js'
import { BUDGET, PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { isAllowed, getViolatedLimits, getLimitUsageSnapshot } from '../cost/budget.js'
```
to:
```ts
import { defineModule, type Processor, type RouterlyModule } from '../../core/index.js'
import { BUDGET, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { isAllowed, getViolatedLimits, getLimitUsageSnapshot } from './budget.js'
```

- [ ] **Step 3: Fix modules/budget/index.test.ts's imports**

Change:
```ts
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { BUDGET, PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { isAllowed, getViolatedLimits, getLimitUsageSnapshot } from '../cost/budget.js'
import { budgetModule } from './budget.js'
```
to:
```ts
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { BUDGET, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { isAllowed, getViolatedLimits, getLimitUsageSnapshot } from './budget.js'
import { budgetModule } from './index.js'
```

- [ ] **Step 4: Fix modules/usage/index.ts's imports**

Change:
```ts
import { defineModule, type Processor, type RouterlyModule } from '../core/index.js'
import { USAGE_TRACKER, CONFIG_STORE, PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { trackUsage } from '../cost/tracker.js'
```
to:
```ts
import { defineModule, type Processor, type RouterlyModule } from '../../core/index.js'
import { USAGE_TRACKER, CONFIG_STORE, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { trackUsage } from './tracker.js'
```

- [ ] **Step 5: Fix modules/usage/index.test.ts's imports**

Change:
```ts
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { USAGE_TRACKER, CONFIG_STORE, PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { readConfig, writeConfig, appendUsageRecord } from '../modules/config/loader.js'
import { trackUsage } from '../cost/tracker.js'
import { usageModule } from './usage.js'
```
to:
```ts
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { USAGE_TRACKER, CONFIG_STORE, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { readConfig, writeConfig, appendUsageRecord } from '../config/loader.js'
import { trackUsage } from './tracker.js'
import { usageModule } from './index.js'
```

- [ ] **Step 6: Fix core/tokens.ts's BUDGET token type paths**

In `packages/service/src/core/tokens.ts`, change:
```ts
export const BUDGET = token<{
  isAllowed: typeof import('../cost/budget.js').isAllowed;
  getViolatedLimits: typeof import('../cost/budget.js').getViolatedLimits;
  getLimitUsageSnapshot: typeof import('../cost/budget.js').getLimitUsageSnapshot;
}>('cost.budget');
```
to:
```ts
export const BUDGET = token<{
  isAllowed: typeof import('../modules/budget/budget.js').isAllowed;
  getViolatedLimits: typeof import('../modules/budget/budget.js').getViolatedLimits;
  getLimitUsageSnapshot: typeof import('../modules/budget/budget.js').getLimitUsageSnapshot;
}>('cost.budget');
```
(Token key string `'cost.budget'` is a stable identifier, not a file path — left unchanged, same as `CATALOG`'s key stayed `'catalog.registry'` through Step 5's move.)

- [ ] **Step 7: Fix modules/index.ts's import paths**

Change:
```ts
import { routingModule } from './routing.js'
import { budgetModule } from './budget.js'
import { usageModule } from './usage.js'
```
to:
```ts
import { routingModule } from './routing.js'
import { budgetModule } from './budget/index.js'
import { usageModule } from './usage/index.js'
```

- [ ] **Step 8: Run the wrapper tests and tsc**

Run: `cd packages/service && npx vitest run src/modules/budget/index.test.ts src/modules/usage/index.test.ts && npx tsc --noEmit`
Expected: both test files pass. `tsc` still shows errors from Task 3's not-yet-repointed external consumers — expected at this point, resolved by Task 3.

- [ ] **Step 9: Commit**

```bash
git add packages/service/src/modules/budget packages/service/src/modules/usage packages/service/src/core/tokens.ts packages/service/src/modules/index.ts
git commit -m "refactor(budget,usage): move module wrappers to index.ts, fix token paths"
```

---

### Task 3: Repoint external consumers

**Files:**
- Modify: `packages/service/src/llm/executor.ts`
- Modify: `packages/service/src/llm/executor.test.ts`
- Modify: `packages/service/src/llm/executor.cost.test.ts`
- Modify: `packages/service/src/integrations/metrics-snapshot.ts`
- Modify: `packages/service/src/integrations/metrics-snapshot.test.ts`
- Modify: `packages/service/src/routing/router.ts`
- Modify: `packages/service/src/routing/router.test.ts`
- Modify: `packages/service/src/routing/policies/budget-remaining.ts`
- Modify: `packages/service/src/routing/policies/budget-remaining.test.ts`
- Modify: `packages/service/src/routing/policies/llm.ts`
- Modify: `packages/service/src/routing/policies/llm.test.ts`
- Modify: `packages/service/src/routes/metrics.test.ts`
- Modify: `packages/service/src/middleware/guardrails.ts`
- Modify: `packages/service/src/middleware/guardrails.test.ts`
- Modify: `packages/service/src/routing/policies/semantic-intent.ts`
- Modify: `packages/service/src/routing/policies/semantic-intent.test.ts`
- Modify: `packages/service/src/routes/openaiOAuthForward.ts`
- Modify: `packages/service/src/routes/openaiOAuthForward.test.ts`
- Modify: `packages/service/src/routes/oauthForward.ts`
- Modify: `packages/service/src/routes/oauthForward.test.ts`
- Modify: `packages/service/src/routing/policies/performance.ts`
- Modify: `packages/service/src/routing/policies/health.ts`
- Modify: `packages/service/src/routing/policies/fairness.ts`
- Modify: `packages/service/src/routing/policies/rate-limit.ts`

**Interfaces:**
- Consumes: `modules/budget/budget.js` exporting `isAllowed`, `isAllowedForRoutingModel`, `getViolatedLimits`, `getLimitUsageSnapshot`, `LimitSnapshot` (Task 1); `modules/usage/tracker.js` exporting `trackUsage` (Task 1); `modules/usage/usageStore.js` exporting `readUsageRecords` (Task 1).
- Produces: nothing new for later tasks — last task of Step 7.

Path rule applied throughout: files directly under `src/<dir>/` (one level deep: `llm/`, `core/` — already done in Task 2 — `integrations/`, `middleware/`, `routes/`, and `routing/router.ts` itself) use `'../modules/budget/budget.js'` / `'../modules/usage/tracker.js'` / `'../modules/usage/usageStore.js'`. Files under `src/routing/policies/` (two levels deep) use `'../../modules/budget/budget.js'` / `'../../modules/usage/tracker.js'` / `'../../modules/usage/usageStore.js'`.

- [ ] **Step 1: llm/executor.ts**

Change:
```ts
import { isAllowed, isAllowedForRoutingModel, getLimitUsageSnapshot } from '../cost/budget.js';
import { trackUsage } from '../cost/tracker.js';
```
to:
```ts
import { isAllowed, isAllowedForRoutingModel, getLimitUsageSnapshot } from '../modules/budget/budget.js';
import { trackUsage } from '../modules/usage/tracker.js';
```

- [ ] **Step 2: llm/executor.test.ts**

Change:
```ts
vi.mock('../cost/budget.js', () => ({ isAllowed: vi.fn(), isAllowedForRoutingModel: vi.fn(), getLimitUsageSnapshot: vi.fn().mockResolvedValue([]) }))
vi.mock('../cost/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }))
```
to:
```ts
vi.mock('../modules/budget/budget.js', () => ({ isAllowed: vi.fn(), isAllowedForRoutingModel: vi.fn(), getLimitUsageSnapshot: vi.fn().mockResolvedValue([]) }))
vi.mock('../modules/usage/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }))
```
and change:
```ts
import { isAllowed, isAllowedForRoutingModel, getLimitUsageSnapshot } from '../cost/budget.js'
import { trackUsage } from '../cost/tracker.js'
```
to:
```ts
import { isAllowed, isAllowedForRoutingModel, getLimitUsageSnapshot } from '../modules/budget/budget.js'
import { trackUsage } from '../modules/usage/tracker.js'
```

- [ ] **Step 3: llm/executor.cost.test.ts**

Change:
```ts
vi.mock('../cost/budget.js', () => ({
```
to:
```ts
vi.mock('../modules/budget/budget.js', () => ({
```
and change:
```ts
vi.mock('../cost/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }))
```
to:
```ts
vi.mock('../modules/usage/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }))
```

- [ ] **Step 4: integrations/metrics-snapshot.ts**

Change:
```ts
import { getLimitUsageSnapshot } from '../cost/budget.js';
```
to:
```ts
import { getLimitUsageSnapshot } from '../modules/budget/budget.js';
```

- [ ] **Step 5: integrations/metrics-snapshot.test.ts**

Change:
```ts
vi.mock('../cost/budget.js', () => ({ getLimitUsageSnapshot: mockGetLimitUsageSnapshot }));
```
to:
```ts
vi.mock('../modules/budget/budget.js', () => ({ getLimitUsageSnapshot: mockGetLimitUsageSnapshot }));
```

- [ ] **Step 6: routing/router.ts**

Change:
```ts
import { isAllowed, getViolatedLimits } from '../cost/budget.js';
import type { LimitSnapshot } from '../cost/budget.js';
```
to:
```ts
import { isAllowed, getViolatedLimits } from '../modules/budget/budget.js';
import type { LimitSnapshot } from '../modules/budget/budget.js';
```

- [ ] **Step 7: routing/router.test.ts**

Change:
```ts
vi.mock('../cost/budget.js', () => ({ isAllowed: vi.fn(), getViolatedLimits: vi.fn() }))
```
to:
```ts
vi.mock('../modules/budget/budget.js', () => ({ isAllowed: vi.fn(), getViolatedLimits: vi.fn() }))
```
and change:
```ts
import { isAllowed, getViolatedLimits } from '../cost/budget.js'
```
to:
```ts
import { isAllowed, getViolatedLimits } from '../modules/budget/budget.js'
```

- [ ] **Step 8: routing/policies/budget-remaining.ts**

Change:
```ts
import { getLimitUsageSnapshot } from '../../cost/budget.js';
```
to:
```ts
import { getLimitUsageSnapshot } from '../../modules/budget/budget.js';
```

- [ ] **Step 9: routing/policies/budget-remaining.test.ts**

Change:
```ts
vi.mock('../../cost/budget.js', () => ({ getLimitUsageSnapshot: vi.fn() }))
```
to:
```ts
vi.mock('../../modules/budget/budget.js', () => ({ getLimitUsageSnapshot: vi.fn() }))
```
and change:
```ts
import { getLimitUsageSnapshot } from '../../cost/budget.js'
```
to:
```ts
import { getLimitUsageSnapshot } from '../../modules/budget/budget.js'
```

- [ ] **Step 10: routing/policies/llm.ts**

Change:
```ts
import { getLimitUsageSnapshot } from '../../cost/budget.js';
import type { LimitSnapshot } from '../../cost/budget.js';
```
to:
```ts
import { getLimitUsageSnapshot } from '../../modules/budget/budget.js';
import type { LimitSnapshot } from '../../modules/budget/budget.js';
```

- [ ] **Step 11: routing/policies/llm.test.ts**

Change:
```ts
vi.mock('../../cost/budget.js', () => ({ getLimitUsageSnapshot: vi.fn() }))
```
to:
```ts
vi.mock('../../modules/budget/budget.js', () => ({ getLimitUsageSnapshot: vi.fn() }))
```
and change:
```ts
import { getLimitUsageSnapshot } from '../../cost/budget.js'
```
to:
```ts
import { getLimitUsageSnapshot } from '../../modules/budget/budget.js'
```

- [ ] **Step 12: routes/metrics.test.ts**

Change:
```ts
vi.mock('../cost/budget.js', () => ({ getLimitUsageSnapshot: vi.fn() }));
```
to:
```ts
vi.mock('../modules/budget/budget.js', () => ({ getLimitUsageSnapshot: vi.fn() }));
```
and change:
```ts
import { getLimitUsageSnapshot } from '../cost/budget.js';
```
to:
```ts
import { getLimitUsageSnapshot } from '../modules/budget/budget.js';
```

- [ ] **Step 13: middleware/guardrails.ts**

Change:
```ts
import { trackUsage } from '../cost/tracker.js';
```
to:
```ts
import { trackUsage } from '../modules/usage/tracker.js';
```

- [ ] **Step 14: middleware/guardrails.test.ts**

Change:
```ts
vi.mock('../cost/tracker.js', () => ({ trackUsage: vi.fn(() => Promise.resolve()) }));
```
to:
```ts
vi.mock('../modules/usage/tracker.js', () => ({ trackUsage: vi.fn(() => Promise.resolve()) }));
```
and change:
```ts
import { trackUsage } from '../cost/tracker.js';
```
to:
```ts
import { trackUsage } from '../modules/usage/tracker.js';
```

- [ ] **Step 15: routing/policies/semantic-intent.ts**

Change:
```ts
import { trackUsage } from '../../cost/tracker.js';
```
to:
```ts
import { trackUsage } from '../../modules/usage/tracker.js';
```

- [ ] **Step 16: routing/policies/semantic-intent.test.ts**

Change:
```ts
vi.mock('../../cost/tracker.js', () => ({
```
to:
```ts
vi.mock('../../modules/usage/tracker.js', () => ({
```
and change:
```ts
import { trackUsage } from '../../cost/tracker.js';
```
to:
```ts
import { trackUsage } from '../../modules/usage/tracker.js';
```

- [ ] **Step 17: routes/openaiOAuthForward.ts**

Change:
```ts
import { trackUsage } from '../cost/tracker.js';
```
to:
```ts
import { trackUsage } from '../modules/usage/tracker.js';
```

- [ ] **Step 18: routes/openaiOAuthForward.test.ts**

Change:
```ts
vi.mock('../cost/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }))
```
to:
```ts
vi.mock('../modules/usage/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }))
```
and change:
```ts
import { trackUsage } from '../cost/tracker.js'
```
to:
```ts
import { trackUsage } from '../modules/usage/tracker.js'
```

- [ ] **Step 19: routes/oauthForward.ts**

Change:
```ts
import { trackUsage } from '../cost/tracker.js';
```
to:
```ts
import { trackUsage } from '../modules/usage/tracker.js';
```

- [ ] **Step 20: routes/oauthForward.test.ts**

Change:
```ts
vi.mock('../cost/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }))
```
to:
```ts
vi.mock('../modules/usage/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }))
```
and change:
```ts
import { trackUsage } from '../cost/tracker.js'
```
to:
```ts
import { trackUsage } from '../modules/usage/tracker.js'
```

- [ ] **Step 21: routing/policies/performance.ts**

Change:
```ts
import { readUsageRecords } from '../../cost/usageStore.js';
```
to:
```ts
import { readUsageRecords } from '../../modules/usage/usageStore.js';
```

- [ ] **Step 22: routing/policies/health.ts**

Change:
```ts
import { readUsageRecords } from '../../cost/usageStore.js';
```
to:
```ts
import { readUsageRecords } from '../../modules/usage/usageStore.js';
```

- [ ] **Step 23: routing/policies/fairness.ts**

Change:
```ts
import { readUsageRecords } from '../../cost/usageStore.js';
```
to:
```ts
import { readUsageRecords } from '../../modules/usage/usageStore.js';
```

- [ ] **Step 24: routing/policies/rate-limit.ts**

Change:
```ts
import { readUsageRecords } from '../../cost/usageStore.js';
```
to:
```ts
import { readUsageRecords } from '../../modules/usage/usageStore.js';
```

- [ ] **Step 25: Run the blanket stale-reference grep**

Run: `cd packages/service/src && grep -rln "cost/budget\|cost/tracker\|cost/usageStore" . --include="*.ts"`
Expected: zero results.

Also verify the `cost/` directory itself is now gone:
Run: `ls packages/service/src/cost 2>&1`
Expected: `No such file or directory`.

- [ ] **Step 26: Run the full suite and tsc**

Run: `cd packages/service && npx vitest run && npx tsc --noEmit`
Expected: same baseline as before Step 7 (3 pre-existing failures: `modules/provider/anthropic.test.ts` line ~324, `routes/oauthForward.test.ts` x2), no new failures, tsc clean.

- [ ] **Step 27: Commit**

```bash
git add packages/service/src/llm packages/service/src/integrations packages/service/src/routing packages/service/src/routes packages/service/src/middleware
git status --short
git commit -m "refactor(budget,usage): repoint external consumers to modules/"
```

---

## Self-Review

**1. Spec coverage:** Overview's Step 7 text ("`modules/budget/`, `modules/usage/` full extraction (parallel-safe with each other)") is covered: both directories fully extracted in Tasks 1-2, all 24 external consumer files repointed in Task 3, no manifest/behavior change per the constraint documented above. `cost/` disappears entirely, matching the established pattern from `config/`, `providers/`, `catalog/`.

**2. Placeholder scan:** No TBD/TODO, no "add appropriate X", no "similar to Task N" without code. All 3 tasks contain full, exact before/after code for every edit.

**3. Type consistency:** `BUDGET`/`USAGE_TRACKER` token shapes are unchanged (only their internal `typeof import(...)` literal paths move) — verified against the exact current `core/tokens.ts` content read during research. `isAllowed`/`getViolatedLimits`/`getLimitUsageSnapshot`/`trackUsage`/`readUsageRecords` names match their real exports (confirmed via full reads of `cost/budget.ts`, `cost/tracker.ts`, `cost/usageStore.ts` during research) and match what Task 3's 24 consumer files already call today (only the import path changes, no call-site changes).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-27-modular-step7-budget-usage-extraction.md`. Per established precedent for Steps 2-6 (fully-mechanical, completely-pre-specified extraction tasks with no design judgment left to make), this plan is executed directly via Bash/Edit rather than dispatching implementer/reviewer subagent pairs.
