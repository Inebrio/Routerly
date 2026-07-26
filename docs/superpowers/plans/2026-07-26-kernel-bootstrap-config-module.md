# Plan 2: Kernel Bootstrap + Config Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-07-26-refactory-roadmap.md` (frozen contracts) and `2026-07-26-modular-kernel-foundation.md` (Plan 1, the `core/` API this plan consumes) before starting.

**Goal:** Boot a `Kernel` instance inside `packages/service/src/server.ts` alongside the existing Fastify app, and register the FIRST module — the config module — which exposes the existing `config/loader.ts` functions behind the `CONFIG_STORE` DI token. Routes and all other existing code stay UNCHANGED and keep calling `config/loader.ts` directly. This plan only ADDS the kernel wiring; it must not alter any request behavior.

**Architecture:** Plan 1 shipped the dependency-free `core/` kernel (`ServiceContainer`, `token`, `Kernel`, `defineModule`, `EventBus`, `ProcessorRegistry`) as additive infrastructure that nothing wired. This plan wires it: a `core/tokens.ts` declares the six frozen DI service tokens (only `CONFIG_STORE` is registered here; the rest are declared for Plans 3-6). A `modules/config/index.ts` is a thin `defineModule` whose `register()` hands the container the REAL `readConfig`/`writeConfig`/`appendUsageRecord` from `config/loader.ts` behind `CONFIG_STORE` — no logic copied. A tiny `core/bootstrap.ts` seam (`buildKernel`) assembles and starts a kernel. `server.ts` builds and starts that kernel early in `buildServer`, decorates the Fastify instance with `kernel` so later plans reach the container/events, and calls `kernel.stop()` on server close. Existing registration order is untouched.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` import specifiers), Node ≥20, Fastify 5, Vitest, no new runtime dependencies.

## Global Constraints

- **Module system:** NodeNext ESM. Every relative import MUST use a `.js` extension. Node builtins use the `node:` prefix.
- **TypeScript:** `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` on. Optional object properties must be omitted, not set to `undefined`. Array/record index access returns `T | undefined` — narrow before use.
- **Coverage: NO coverage gate for this refactory phase** (owner decision, 2026-07-26). Two behavioral tests total, as specified below. Do not chase line/branch coverage.
- **Tests:** Vitest. Test files are `*.test.ts` in the SAME directory as the source. Run per-file with `npx vitest run <path>` from `packages/service/`.
- **No new dependencies.** Do not add anything to `package.json`.
- **Wrapper strategy — ABSOLUTE:** the config module hands back the REAL `config/loader.js` functions. No logic is copied or rewritten. The token value is literally `{ readConfig, writeConfig, appendUsageRecord }` built from the existing exports.
- **Additive only in `server.ts`:** do NOT move or remove any existing registration. Startup order is load-bearing — `loadSecret` must precede any JWT op; `initConfigDirs` must precede config reads. Kernel start is placed so those still run first (they run in `startServer` before `buildServer` is ever called).
- **Frozen public contracts unchanged:** wire format, `/api/*` management routes, `@routerly/shared` exports. This plan handles no request; it must not touch any of them.
- **English only** for all code, comments, identifiers, and commit messages. No em dashes anywhere.

**All commands below run from `packages/service/`** unless stated otherwise.

---

### Task 1: DI service tokens (`core/tokens.ts`)

Declares the six frozen DI service tokens EXACTLY as the roadmap "Frozen DI service tokens" section specifies. Only `CONFIG_STORE` is registered by a module in this plan; `PROVIDER_REGISTRY`, `ROUTER`, `USAGE_TRACKER`, `BUDGET`, `PROXY_PIPELINE` are declared now so Plans 3-6 import stable token keys. Existing types are imported, never redefined.

`core/tokens.ts` is a type-only + token-declaration module (no runtime branching), so its verification is `npm run typecheck` (proves every imported type resolves and the token generics compile), not a behavioral test. The two behavioral tests this plan owns live in Tasks 2 and 3.

**Files:**
- Create: `packages/service/src/core/tokens.ts`

**Interfaces:**
- Consumes:
  - `token` and `ProcessorRegistry` from `./index.js` (Plan 1 barrel).
  - `ProviderAdapter` from `../providers/types.js` (existing, `providers/types.ts` L13).
  - `RouteResult` from `../routing/router.js` (existing, `routing/router.ts` L24).
  - `ModelConfig`, `ProjectConfig`, `ProjectToken`, `ChatCompletionRequest` from `@routerly/shared` (existing exports).
  - `readConfig`, `writeConfig`, `appendUsageRecord`, `isAllowed`, `getViolatedLimits`, `getLimitUsageSnapshot` captured via `typeof import(...)` (no named import needed; `StoredTypeMap` is NOT exported from `loader.ts`, so the `typeof` form is used deliberately).
- Produces (names Plans 3-6 rely on):
  - `CONFIG_STORE: Token<{ readConfig; writeConfig; appendUsageRecord }>` key `'config.store'`
  - `PROVIDER_REGISTRY: Token<{ getProviderAdapter(model: ModelConfig): ProviderAdapter }>` key `'provider.registry'`
  - `ROUTER: Token<{ routeRequest(...): Promise<RouteResult> }>` key `'routing.router'`
  - `USAGE_TRACKER: Token<{ trackUsage(params: unknown): Promise<void> }>` key `'usage.tracker'`
  - `BUDGET: Token<{ isAllowed; getViolatedLimits; getLimitUsageSnapshot }>` key `'cost.budget'`
  - `PROXY_PIPELINE: Token<ProcessorRegistry<unknown>>` key `'proxy.pipeline'`

> **`PROXY_PIPELINE` note (load-bearing deviation from the roadmap literal):** the roadmap writes `token<ProcessorRegistry<ProxyContext>>`. `ProxyContext` is defined in Plan 4 (`reverse-proxy/context.ts`) and does not exist yet; importing it here would break `typecheck` and create a forward dependency. So the generic is `unknown` now. The token KEY (`'proxy.pipeline'`) is frozen and unchanged. Plan 4 narrows the generic to `ProxyContext` in a one-line edit when that type lands. No consumer resolves `PROXY_PIPELINE` in this plan, so the placeholder generic is invisible to runtime.

- [ ] **Step 1: Write `core/tokens.ts`**

```ts
// packages/service/src/core/tokens.ts
import { token, type ProcessorRegistry } from './index.js';
import type { ProviderAdapter } from '../providers/types.js';
import type { RouteResult } from '../routing/router.js';
import type {
  ModelConfig,
  ProjectConfig,
  ProjectToken,
  ChatCompletionRequest,
} from '@routerly/shared';

// Each token wraps existing functions/types. Modules register these; processors
// resolve them. Only CONFIG_STORE is registered in Plan 2; the rest are declared
// so Plans 3-6 import stable token keys. Types are imported, never redefined.

export const CONFIG_STORE = token<{
  readConfig: typeof import('../config/loader.js').readConfig;
  writeConfig: typeof import('../config/loader.js').writeConfig;
  appendUsageRecord: typeof import('../config/loader.js').appendUsageRecord;
}>('config.store');

export const PROVIDER_REGISTRY = token<{
  getProviderAdapter(model: ModelConfig): ProviderAdapter;
}>('provider.registry');

export const ROUTER = token<{
  routeRequest(
    request: ChatCompletionRequest,
    project: ProjectConfig,
    log?: unknown,
    emit?: unknown,
    token?: ProjectToken,
    traceId?: string,
    conversationId?: string,
  ): Promise<RouteResult>;
}>('routing.router');

export const USAGE_TRACKER = token<{
  trackUsage(params: unknown): Promise<void>;
}>('usage.tracker');

export const BUDGET = token<{
  isAllowed: typeof import('../cost/budget.js').isAllowed;
  getViolatedLimits: typeof import('../cost/budget.js').getViolatedLimits;
  getLimitUsageSnapshot: typeof import('../cost/budget.js').getLimitUsageSnapshot;
}>('cost.budget');

// ProxyContext is defined in Plan 4 (reverse-proxy/context.ts). Until then the
// pipeline registry is parameterized over `unknown`; Plan 4 narrows the generic
// to ProxyContext. The token key 'proxy.pipeline' is frozen now.
export const PROXY_PIPELINE = token<ProcessorRegistry<unknown>>('proxy.pipeline');
```

- [ ] **Step 2: Typecheck**

Run (from `packages/service/`): `npm run typecheck`
Expected: exit 0. This proves every imported existing type (`ProviderAdapter`, `RouteResult`, `ModelConfig`, `ProjectConfig`, `ProjectToken`, `ChatCompletionRequest`) resolves, the `typeof import(...)` captures for `loader.ts`/`budget.ts` compile, and `token` / `ProcessorRegistry` from the Plan 1 barrel are found. If it fails with "cannot find module `./index.js`", Plan 1 has not been merged — stop and land Plan 1 first.

- [ ] **Step 3: Commit**

```bash
git add packages/service/src/core/tokens.ts
git commit -m "feat(core): frozen DI service tokens"
```

---

### Task 2: Config module (`modules/config/index.ts`)

A `defineModule` whose `register()` puts `{ readConfig, writeConfig, appendUsageRecord }` (the real functions from `config/loader.js`) into the container under `CONFIG_STORE`. Manifest id `'config'`, version `'0.4.0'`. No `start`/`stop` needed — registration is the whole job.

**Files:**
- Create: `packages/service/src/modules/config/index.ts`
- Test: `packages/service/src/modules/config/index.test.ts`

**Interfaces:**
- Consumes:
  - `defineModule` from `../../core/index.js` (Plan 1).
  - `CONFIG_STORE` from `../../core/tokens.js` (Task 1).
  - `readConfig`, `writeConfig`, `appendUsageRecord` from `../../config/loader.js` (existing).
  - `ModuleRegistry` shape `{ container, events }` — `register` destructures `{ container }`.
- Produces:
  - `configModule: RouterlyModule` (manifest `{ id: 'config', version: '0.4.0' }`). Later plans and `server.ts` import this by name.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/modules/config/index.test.ts
import { describe, it, expect } from 'vitest';
import { ServiceContainer, EventBus } from '../../core/index.js';
import { configModule } from './index.js';
import { CONFIG_STORE } from '../../core/tokens.js';
import { readConfig, writeConfig, appendUsageRecord } from '../../config/loader.js';

describe('config module', () => {
  it('registers CONFIG_STORE with the real loader functions', async () => {
    const container = new ServiceContainer();
    const events = new EventBus();
    await configModule.register({ container, events });

    expect(container.has(CONFIG_STORE)).toBe(true);
    const store = container.resolve(CONFIG_STORE);
    // Wrapper strategy: the token hands back the real functions, not copies.
    expect(store.readConfig).toBe(readConfig);
    expect(store.writeConfig).toBe(writeConfig);
    expect(store.appendUsageRecord).toBe(appendUsageRecord);
  });

  it('has the frozen manifest identity', () => {
    expect(configModule.manifest.id).toBe('config');
    expect(configModule.manifest.version).toBe('0.4.0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/config/index.test.ts`
Expected: FAIL — cannot find module `./index.js` (the config module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/modules/config/index.ts
import { defineModule } from '../../core/index.js';
import { CONFIG_STORE } from '../../core/tokens.js';
import { readConfig, writeConfig, appendUsageRecord } from '../../config/loader.js';

/**
 * Config module — the first Routerly module. Its only job is to expose the
 * existing, already-tested config/loader.ts functions behind the CONFIG_STORE
 * DI token. No logic is copied: the token value is literally the real function
 * references. Routes continue to import config/loader.ts directly; this module
 * only makes the same functions reachable through the container for later plans.
 */
export const configModule = defineModule({
  manifest: { id: 'config', version: '0.4.0' },
  register({ container }) {
    container.register(CONFIG_STORE, { readConfig, writeConfig, appendUsageRecord });
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/config/index.test.ts`
Expected: PASS (2 assertions groups green).

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/modules/config/index.ts packages/service/src/modules/config/index.test.ts
git commit -m "feat(config): config module exposes loader behind CONFIG_STORE"
```

---

### Task 3: Kernel bootstrap seam (`core/bootstrap.ts`)

A tiny seam: `buildKernel(modules)` assembles a `Kernel` with the given modules and returns it started. Kept minimal — no registry configuration, no options. `server.ts` and tests call it.

**Files:**
- Create: `packages/service/src/core/bootstrap.ts`
- Test: `packages/service/src/core/bootstrap.test.ts`

**Interfaces:**
- Consumes: `Kernel` from `./kernel.js`, `RouterlyModule` from `./module.js` (both Plan 1).
- Produces:
  - `async function buildKernel(modules: readonly RouterlyModule[]): Promise<Kernel>` — `new Kernel(modules)`, `await kernel.start()`, return it. `server.ts` (Task 4) consumes this.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/core/bootstrap.test.ts
import { describe, it, expect } from 'vitest';
import { buildKernel } from './bootstrap.js';
import { defineModule } from './index.js';

describe('buildKernel', () => {
  it('assembles and starts the given modules', async () => {
    const started: string[] = [];
    const probe = defineModule({
      manifest: { id: 'probe', version: '0.4.0' },
      register() {},
      start() {
        started.push('probe');
      },
    });

    const kernel = await buildKernel([probe]);

    expect(started).toEqual(['probe']);
    expect(kernel.startedOrder).toEqual(['probe']);

    await kernel.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/bootstrap.test.ts`
Expected: FAIL — cannot find module `./bootstrap.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/core/bootstrap.ts
import { Kernel } from './kernel.js';
import type { RouterlyModule } from './module.js';

/**
 * Assemble a Kernel from the given modules and return it already started.
 * This is the single seam server.ts uses to boot the modular kernel alongside
 * Fastify. Kept intentionally tiny — module composition lives at the call site.
 */
export async function buildKernel(
  modules: readonly RouterlyModule[],
): Promise<Kernel> {
  const kernel = new Kernel(modules);
  await kernel.start();
  return kernel;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/bootstrap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/bootstrap.ts packages/service/src/core/bootstrap.test.ts
git commit -m "feat(core): buildKernel bootstrap seam"
```

---

### Task 4: Wire the kernel into `server.ts`

Create and start the kernel early in `buildServer`, decorate the Fastify instance with `kernel` so later plans reach `container`/`events`, and add an `onClose` hook that calls `kernel.stop()`. Additive only: no existing registration is moved or removed. `loadSecret` and `initConfigDirs` still run first because they run in `startServer` (L93-94) BEFORE `buildServer` (L125) is ever called; the config module's `register` does no config IO (it only hands back function references), so kernel start is order-safe regardless of that path.

**Files:**
- Modify: `packages/service/src/server.ts`
  - Add imports after the existing import block (after L17).
  - Add a `declare module 'fastify'` augmentation for `FastifyInstance.kernel` near the top (after imports).
  - Insert the kernel build + decorate + `onClose` hook inside `buildServer`, immediately after the Fastify instance is created (after the `});` that closes the `Fastify({ ... })` call at L34) and BEFORE the CORS registration at L37.

**Interfaces:**
- Consumes: `buildKernel` from `./core/bootstrap.js` (Task 3), `configModule` from `./modules/config/index.js` (Task 2), `Kernel` (type) from `./core/index.js` (Plan 1).
- Produces:
  - `FastifyInstance.kernel: Kernel` decoration — Plans 4-6 read `fastify.kernel.container` / `fastify.kernel.events`. This is the only new externally visible surface, and it is internal to the process (not a wire or `/api/*` contract).

- [ ] **Step 1: Add the imports and the Fastify type augmentation**

Edit `packages/service/src/server.ts`. After the last existing import (L17, `import { startIntegrationRunner } from './integrations/runner.js';`), add:

```ts
import { buildKernel } from './core/bootstrap.js';
import { configModule } from './modules/config/index.js';
import type { Kernel } from './core/index.js';
```

Then, immediately after the import block and before `const __dirname = ...` (L19), add the augmentation:

```ts
// The modular kernel (0.4.0) is decorated onto the Fastify instance so later
// refactory plans can reach its container/events. Routes still call
// config/loader.ts directly; nothing depends on this decoration yet.
declare module 'fastify' {
  interface FastifyInstance {
    kernel: Kernel;
  }
}
```

- [ ] **Step 2: Insert kernel build + decorate + onClose in `buildServer`**

In `buildServer`, the Fastify instance is created at L25-34. Immediately after the closing `});` of `Fastify({ ... })` (L34) and before the `// ─── Plugins ───` / CORS block (L36-37), insert:

```ts
  // ─── Modular kernel (0.4.0) ───────────────────────────────────────────────
  // Boots alongside Fastify; registers the config module so config/loader.ts is
  // reachable via CONFIG_STORE for later plans. loadSecret()/initConfigDirs()
  // already ran in startServer() before buildServer(); the config module does no
  // IO at register time, so this is order-safe. Additive only — no existing
  // registration is touched.
  const kernel = await buildKernel([configModule]);
  fastify.decorate('kernel', kernel);
  fastify.addHook('onClose', async () => {
    await kernel.stop();
  });
```

After this edit, the top of `buildServer` reads:

```ts
export async function buildServer() {
  const settings = await readConfig('settings');

  const fastify = Fastify({
    logger: {
      level: settings.logLevel,
      ...(process.env['NODE_ENV'] !== 'production'
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
    disableRequestLogging: true,
    bodyLimit: 256 * 1024 * 1024, // 256 MB — support large files, vision, and 2M-token contexts
  });

  // ─── Modular kernel (0.4.0) ───────────────────────────────────────────────
  const kernel = await buildKernel([configModule]);
  fastify.decorate('kernel', kernel);
  fastify.addHook('onClose', async () => {
    await kernel.stop();
  });

  // ─── Plugins ─────────────────────────────────────────────────────────────────
  await fastify.register(cors, { origin: true, exposedHeaders: ['x-routerly-trace-id'] });
  // ... unchanged from here down
```

- [ ] **Step 3: Typecheck**

Run (from `packages/service/`): `npm run typecheck`
Expected: exit 0. Confirms the `FastifyInstance.kernel` augmentation, the `Kernel` type import, and `buildKernel([configModule])` all compile.

- [ ] **Step 4: Run the full service suite (no regressions)**

Run (from `packages/service/`): `npm test`
Expected: previously-passing suites still green, plus the two new tests from Tasks 2-3. This plan added files and made one additive `server.ts` edit; no existing behavior changed. Any server test that calls `buildServer()` via `fastify.inject()` still passes because the kernel decoration is inert (the config module registers function references and does no IO).

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/server.ts
git commit -m "feat(service): boot modular kernel + config module in buildServer"
```

---

## Self-review

Roadmap requirement coverage for Plan 2:

- **Task 1 in the roadmap plan table** ("config behind `CONFIG_STORE`; routes still call existing functions directly") — satisfied: config module registers `CONFIG_STORE` (Task 2); routes untouched (Task 4 is additive only).
- **Frozen DI service tokens** — all six declared in `core/tokens.ts` (Task 1) with the EXACT keys from the roadmap: `'config.store'`, `'provider.registry'`, `'routing.router'`, `'usage.tracker'`, `'cost.budget'`, `'proxy.pipeline'`. Existing types imported, none redefined. Only `CONFIG_STORE` is registered by a module here; the rest are declared for Plans 3-6.
  - **Token-key confirmation:** `CONFIG_STORE='config.store'`, `PROVIDER_REGISTRY='provider.registry'`, `ROUTER='routing.router'`, `USAGE_TRACKER='usage.tracker'`, `BUDGET='cost.budget'`, `PROXY_PIPELINE='proxy.pipeline'` — byte-for-byte the roadmap keys.
  - **Documented deviation:** `PROXY_PIPELINE` generic is `ProcessorRegistry<unknown>` (not `<ProxyContext>`) because `ProxyContext` is a Plan 4 type; the token KEY is unchanged and Plan 4 narrows the generic. Called out in Task 1.
- **Wrapper strategy** — the config module's token value is `{ readConfig, writeConfig, appendUsageRecord }` built from the real `config/loader.js` exports (Task 2). The test asserts identity (`store.readConfig === readConfig`), proving no logic is copied.
- **Bootstrap seam** — `buildKernel` (Task 3) assembles a `Kernel` and returns it started; test proves modules start (`startedOrder`).
- **`server.ts` wiring** — kernel created + started early in `buildServer`, `fastify.decorate('kernel', kernel)`, `onClose` hook calls `kernel.stop()` (Task 4). Uses the existing Fastify decorate/hook pattern already present in the codebase (`decorateRequest`/`addHook` in `plugins/auth.ts`).
- **Startup order preserved** — CONFIRMED against `server.ts`: `initConfigDirs()` (L93) and `loadSecret()` (L94) run inside `startServer` BEFORE `buildServer()` (L125). The kernel is started inside `buildServer` after those, and the config module's `register` performs no IO, so `loadSecret`-before-JWT and `initConfigDirs`-before-config-reads invariants are untouched. No existing `register`/hook line is moved or removed — the edit only inserts new lines and an import block.
- **Minimal tests only, no coverage gate** — exactly two behavioral tests (`modules/config/index.test.ts`, `core/bootstrap.test.ts`); `tokens.ts` and the `server.ts` edit are verified by `npm run typecheck` + `npm test` green.
- **ESM / strict conformance** — all relative imports end in `.js`; optional props omitted not set to `undefined`; no `any`; `typeof import(...)` used for `loader.ts`/`budget.ts` captures because `StoredTypeMap` is not exported.
- **No wire / `/api/*` / `@routerly/shared` change** — this plan handles no request and touches none of those surfaces; the only new surface is the internal `fastify.kernel` decoration.
