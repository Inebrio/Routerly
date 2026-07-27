# Provider/Model Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing static provider adapter registry (`providers/index.ts` `getProviderAdapter`) behind a `provider` module that registers the `PROVIDER_REGISTRY` DI token. `getProviderAdapter` stays exported and callable directly (`executor.ts`, `routes/anthropic.ts`, `routes/api.ts` keep importing it unchanged). The module ALSO exposes it via the container so the future reverse-proxy pipeline (Plan 4) can resolve it from DI instead of importing directly. This is pure predisposition: zero behavior change, zero adapter rewrites.

**Architecture:** A one-file wrapper module at `packages/service/src/modules/provider/index.ts`. Its `register()` puts `{ getProviderAdapter }` (the REAL function from `providers/index.js`) into the kernel container under the frozen `PROVIDER_REGISTRY` token. The 12 adapter classes and the `adapters` lookup record stay byte-for-byte unchanged. The module is added to the kernel bootstrap module list (introduced in Plan 2) after the config module.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` import specifiers), Node ≥20, Vitest. No new runtime dependencies.

## Global Constraints

- **Module system:** NodeNext ESM. Every relative import MUST use a `.js` extension. Node builtins use the `node:` prefix.
- **TypeScript:** `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride` all on. Optional object properties must be omitted, not set to `undefined`. Index access returns `T | undefined` - narrow before use.
- **Tests:** Vitest. Test files are `*.test.ts` in the SAME directory as the source. Run per-file with `npx vitest run <path>` from `packages/service/`.
- **Coverage: NO coverage gate** for this refactory phase (owner decision, 2026-07-26). Minimal behavioral tests only: resolving `PROVIDER_REGISTRY` returns `getProviderAdapter`, which returns a working adapter for a known provider (`openai`) and throws for a provider with no adapter (`mistral`). Do not chase line/branch coverage.
- **No new dependencies.** Do not add anything to `package.json`.
- **Wrapper strategy - ABSOLUTE.** Hand back the REAL `getProviderAdapter`. Do NOT rewrite adapters, the `adapters` record, or the lookup. The module is a registration shell only; no logic is copied.
- **Frozen `ProviderAdapter` contract (roadmap decision #2).** `messages` / `messagesStream` stay OPTIONAL - `executor.ts:564` guards on `if (!adapter.messages)`. Do NOT make them required. Do NOT touch `providers/types.ts`.
- **The 7 adapterless providers stay throwing.** `mistral`, `cohere`, `xai`, `deepseek`, `groq`, `together`, `perplexity` are in the `Provider` union (`shared/types/config.ts`) but have no entry in the `adapters` record, so `getProviderAdapter` throws `Unknown provider ...` for them today. Preserve that exactly - do NOT add adapters for them.
- **Single-instance model identity is unchanged (roadmap decision #9).** No `ModelDefinition`/`ModelInstance` split, no alias layer. `ModelConfig` stays the sole routable entity. This plan reorganizes only WHERE `getProviderAdapter` is reachable from, not the model data model.
- **English only** for all code, comments, identifiers, and commit messages. No em dashes.
- **Scope fence:** create files only under `packages/service/src/modules/provider/`; Task 2 makes one additive edit to the kernel bootstrap module list. Do NOT modify `providers/index.ts`, `providers/types.ts`, any adapter, `executor.ts`, or any route.

**Dependency on Plan 2 (`core/tokens.ts`):** This plan imports `PROVIDER_REGISTRY` and the kernel bootstrap module list, both introduced by Plan 2 (`2026-07-26-kernel-bootstrap-config-module.md`). As of writing, Plan 2 is not yet committed. `core/tokens.ts` MUST export exactly:

```ts
// core/tokens.ts (defined by Plan 2, consumed here)
export const PROVIDER_REGISTRY = token<{
  getProviderAdapter(model: ModelConfig): ProviderAdapter
}>('provider.registry')
```

Do NOT define `PROVIDER_REGISTRY` in this plan - import it. If Plan 2 is not merged when this plan starts, block and land Plan 2 first (it is a hard prerequisite: this plan cannot register a token that does not exist).

**All commands below run from `packages/service/`** unless stated otherwise.

---

### Task 1: Provider module - register `getProviderAdapter` under `PROVIDER_REGISTRY`

**Files:**
- Create: `packages/service/src/modules/provider/index.ts`
- Test: `packages/service/src/modules/provider/index.test.ts`

**Interfaces:**
- Consumes:
  - `defineModule`, `ModuleRegistry`, `ServiceContainer`, `EventBus` from `../../core/index.js` (Plan 1).
  - `PROVIDER_REGISTRY` from `../../core/tokens.js` (Plan 2).
  - `getProviderAdapter` from `../../providers/index.js` (existing, UNCHANGED).
  - `ModelConfig`, `ProviderAdapter` types (existing).
- Produces:
  - `export const providerModule: RouterlyModule` - manifest `{ id: 'provider', version: '0.4.0', dependsOn: { config: '^0.4.0' } }`. `register({ container })` calls `container.register(PROVIDER_REGISTRY, { getProviderAdapter })`. No `start` / `stop` (nothing to boot or tear down).

The value stored under the token is literally `{ getProviderAdapter }` - the real function reference. No wrapper closure, no re-implementation.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/modules/provider/index.test.ts
import { describe, it, expect } from 'vitest'
import type { ModelConfig } from '@routerly/shared'
import { ServiceContainer, EventBus } from '../../core/index.js'
import { PROVIDER_REGISTRY } from '../../core/tokens.js'
import { providerModule } from './index.js'

// Minimal ModelConfig views: getProviderAdapter only reads `provider` and `id`.
// Casting keeps the test focused on registry behavior, not model shape.
const model = (provider: string): ModelConfig =>
  ({ provider, id: 'test-model' }) as ModelConfig

describe('provider module', () => {
  it('has the frozen manifest', () => {
    expect(providerModule.manifest.id).toBe('provider')
    expect(providerModule.manifest.version).toBe('0.4.0')
    expect(providerModule.manifest.dependsOn).toEqual({ config: '^0.4.0' })
  })

  it('registers PROVIDER_REGISTRY exposing the real getProviderAdapter', async () => {
    const container = new ServiceContainer()
    await providerModule.register({ container, events: new EventBus() })

    const registry = container.resolve(PROVIDER_REGISTRY)

    // Known provider with an adapter -> returns a working ProviderAdapter.
    const adapter = registry.getProviderAdapter(model('openai'))
    expect(typeof adapter.chatCompletion).toBe('function')
    expect(typeof adapter.streamCompletion).toBe('function')

    // Provider in the union but with no adapter entry -> still throws today.
    expect(() => registry.getProviderAdapter(model('mistral'))).toThrow(
      /Unknown provider/,
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/provider/index.test.ts`
Expected: FAIL - cannot find module `./index.js` (the module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/modules/provider/index.ts
import { defineModule, type ModuleRegistry } from '../../core/index.js'
import { PROVIDER_REGISTRY } from '../../core/tokens.js'
import { getProviderAdapter } from '../../providers/index.js'

/**
 * Provider module (0.4.0 refactory, Plan 3).
 *
 * Predisposition only: wraps the existing static adapter registry behind the
 * PROVIDER_REGISTRY DI token so the future reverse-proxy pipeline can resolve
 * it from the container. The real getProviderAdapter stays exported and its
 * existing callers (executor.ts, routes/*) are untouched. Zero behavior change.
 *
 * ponytail: value is the real function, not a closure. No dynamic/contrib
 * adapter registration here (roadmap decisions #6/#9) - see Self-review.
 */
export const providerModule = defineModule({
  manifest: { id: 'provider', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container }: ModuleRegistry): void {
    container.register(PROVIDER_REGISTRY, { getProviderAdapter })
  },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/provider/index.test.ts`
Expected: PASS (both groups green).

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/modules/provider/index.ts packages/service/src/modules/provider/index.test.ts
git commit -m "feat(provider): expose getProviderAdapter via PROVIDER_REGISTRY module"
```

---

### Task 2: Register the provider module in the kernel bootstrap

**Files:**
- Modify: the module array Plan 2 assembles in `packages/service/src/server.ts` and passes to `buildKernel(...)`. Plan 2 Task 4 starts it as `buildKernel([configModule])`. There is NO `createKernel()` factory: `buildKernel(modules): Promise<Kernel>` is defined once in `packages/service/src/core/bootstrap.ts`; the array lives at the `server.ts` call site, which is what this task edits.

**Interfaces:**
- Consumes: `providerModule` from `./modules/provider/index.js` (Task 1), the existing config module from Plan 2.
- Produces: the `server.ts` module array now includes `providerModule` immediately after the config module. The kernel's `dependsOn: { config }` ordering guarantees config's `register` runs first, so `PROVIDER_REGISTRY` is registered after `CONFIG_STORE`.

- [ ] **Step 1: Locate the server.ts module array**

Run: `grep -rn "buildKernel(" packages/service/src/`
Expected: one call site - the module array Plan 2 assembles in `server.ts`, e.g.:

```ts
// packages/service/src/server.ts (illustrative - Plan 2's actual shape)
import { buildKernel } from './core/bootstrap.js'
import { configModule } from './modules/config/index.js'

const kernel = await buildKernel([configModule])
```

The single `new Kernel(...)` in the codebase stays inside `core/bootstrap.ts::buildKernel`; the `grep -rn "new Kernel(" packages/service/src/` check returns exactly one match, there. If Plan 2 is not yet merged, STOP: this task cannot proceed without the bootstrap seam. Land Plan 2 first (hard prerequisite, see Global Constraints).

- [ ] **Step 2: Add the import and register the module**

Edit `server.ts` to import `providerModule` and add it to the `buildKernel([...])` array after the config module. Minimal diff:

```ts
import { configModule } from './modules/config/index.js'
import { providerModule } from './modules/provider/index.js'

const kernel = await buildKernel([configModule, providerModule])
```

(Import path is relative to `server.ts`: `./modules/provider/index.js`. Do not add a `createKernel` factory; the array is edited in place at the `buildKernel` call site.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. Catches any path or type mismatch in the wiring.

- [ ] **Step 4: Verify the kernel boots with both modules and the token resolves**

Run: `npm test`
Expected: previously-passing suites still green, including Plan 2's kernel-bootstrap test. If Plan 2's bootstrap test asserts on `startedOrder`, confirm it now lists `provider` after `config` (dependency order). No new test file is required here - Task 1 proves the module's `register` contract in isolation; `npm test` proves it slots into the live kernel without breaking boot.

- [ ] **Step 5: Commit**

```bash
git add -A packages/service/src
git commit -m "feat(provider): register provider module in kernel bootstrap"
```

---

### Task 3: Verification - no behavior change, contract untouched

**Files:** none created. This task confirms the predisposition changed nothing observable.

**Interfaces:**
- Consumes: the full service test suite and the existing `getProviderAdapter` callers.
- Produces: evidence that the 3 direct call sites still resolve `getProviderAdapter` from `providers/index.js` and that the frozen contract is intact.

- [ ] **Step 1: Confirm direct callers are unchanged**

Run: `grep -rn "getProviderAdapter" packages/service/src/llm/executor.ts packages/service/src/routes/anthropic.ts packages/service/src/routes/api.ts`
Expected: unchanged from before this plan - all still `import { getProviderAdapter } from '../providers/index.js'` and call it directly (`executor.ts:209`, `:362`, `:563`; `routes/api.ts:676`). This plan added a DI path; it did NOT migrate any caller.

- [ ] **Step 2: Confirm the frozen contract is untouched**

Run: `git diff --stat main -- packages/service/src/providers/`
Expected: empty. `providers/types.ts` (the `ProviderAdapter` interface with optional `messages` / `messagesStream`), `providers/index.ts` (the `adapters` record + `getProviderAdapter`), and all 12 adapter files are byte-for-byte unchanged.

- [ ] **Step 3: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: exit 0; all suites green. The service behaves identically - `getProviderAdapter` is now reachable two ways (direct import AND `PROVIDER_REGISTRY`), and both return the same adapter instances from the same static record.

- [ ] **Step 4: Commit (if any tracking file changed)**

```bash
# only if .ai/state.md or similar tracking changed; otherwise skip
git status
```

---

## Self-review

- **Roadmap requirements mapped:**
  - Scope 1 (`modules/provider/index.ts`, `defineModule` id `provider` v `0.4.0`, `dependsOn` config, register `{ getProviderAdapter }` under `PROVIDER_REGISTRY`) → Task 1.
  - Scope 2 (register the module in the kernel bootstrap after config) → Task 2.
  - Scope 3 (predisposition only; document that dynamic/contrib registration is NOT implemented) → this Self-review + the module docstring.
- **Wrapper strategy honored:** the token value is the real `getProviderAdapter` reference (`{ getProviderAdapter }`), not a re-implementation. The 12 adapters, the `adapters` record, and the lookup are untouched (Task 3 Step 2 proves it via `git diff --stat`).
- **Frozen `ProviderAdapter` contract untouched:** `providers/types.ts` is never opened. `messages` / `messagesStream` remain OPTIONAL; `executor.ts:564`'s `if (!adapter.messages)` guard keeps working. Task 3 Step 2 asserts zero diff under `providers/`.
- **7 adapterless providers still throw:** the test's `mistral` case (roadmap: one of `mistral`/`cohere`/`xai`/`deepseek`/`groq`/`together`/`perplexity`) asserts `getProviderAdapter` still throws `Unknown provider ...` through the DI path, matching current behavior exactly.
- **Existing callers unchanged:** `getProviderAdapter` stays exported; `executor.ts` and `routes/*` keep their direct imports (Task 3 Step 1). The DI path is additive.
- **Single-instance model identity unchanged (decision #9):** no `ModelDefinition`/`ModelInstance` split, no alias layer. Only WHERE `getProviderAdapter` is reachable from moved; `ModelConfig` remains the sole routable entity.
- **Deliberately NOT built (YAGNI, roadmap decisions #6/#9):** no dynamic/contrib adapter registration, no `registerAdapter` hook, no mutable adapter map, no seam for a future contrib module to contribute an adapter. The registry wraps the existing static record verbatim. Adding a contribution hook now would be a speculative seam with one implementation and would risk changing `getProviderAdapter`'s current behavior for the 12 built-ins. Contrib provider predisposition is deferred to Plan 6 (`2026-07-26-contrib-surfaces-predisposition.md`), which owns the public module SDK surface and stubs. If Plan 6 later needs a contribution point, it adds a no-op-compatible one there, not here.
- **Hard prerequisite noted:** `core/tokens.ts` `PROVIDER_REGISTRY` and the kernel bootstrap module list both come from Plan 2. This plan imports them; it does not define them. If Plan 2 is unmerged, this plan blocks on it.

---

## Plan sequence (this is Plan 3 of 6)

| # | Plan file | Deliverable |
|---|-----------|-------------|
| 1 | `2026-07-26-modular-kernel-foundation.md` | `core/` primitives - additive, nothing wired |
| 2 | `2026-07-26-kernel-bootstrap-config-module.md` | Kernel boots inside `server.ts`; config wrapped as first module; `core/tokens.ts` defined |
| 3 | `2026-07-26-provider-model-module.md` (this doc) | `getProviderAdapter` also reachable via `PROVIDER_REGISTRY`; adapters + frozen contract unchanged |
| 4 | `2026-07-26-reverse-proxy-pipeline.md` | Phase pipeline + `ProxyContext`; routes delegate 1:1; wire byte-identical |
| 5 | `2026-07-26-core-modules-extraction.md` | routing, cache, budget, usage, logging as modules contributing processors |
| 6 | `2026-07-26-contrib-surfaces-predisposition.md` | Public module SDK export + contract stubs; NO runtime loading, NO behavior change |

**Plan complete and saved to `docs/superpowers/plans/2026-07-26-provider-model-module.md`.**
