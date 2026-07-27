# Contrib + Surfaces Predisposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the module-authoring contract as a stable PUBLIC export (the "module SDK") so a future contrib module could be written against it, and lay down the contrib registration seam and the surface/metamodule contract as PREDISPOSITION ONLY. Nothing here loads, discovers, or imports a contrib module at runtime; nothing here changes any externally observable behavior (roadmap decision #6). The deliverable is a curated public surface plus a documented, empty extension point, not a loader.

**Architecture:** Three additive files under `packages/service/src/core/`:
1. `core/sdk.ts` - a curated re-export barrel over `core/index.js` (Plan 1) that names exactly the authoring surface a module author uses, with a doc-comment block describing how to write a module. It is intentionally NARROWER than `core/index.js`: it omits internal kernel mechanics (`Kernel`, `topologicalSort`, `GraphNode`, `topicMatches`) that a module author never touches, so the authoring contract does not drift when the internal barrel grows.
2. `core/contrib.ts` - `export const CONTRIB_MODULES: RouterlyModule[] = []`. The empty extension point. Plan 2's kernel bootstrap spreads it into its static module array; because it is empty, `startedOrder` is unchanged. No filesystem scan, no `import()`, no npm resolution.
3. `core/surface.ts` - a single types-only `SurfaceContribution` interface documenting the intended `surface.*` capability contract (dashboard page / CLI command / API route a future frontend-loadable module would declare). Types-only: erased at compile time, zero runtime, wired to nothing. Runtime frontend module loading is explicitly deferred (see Self-review).

**Tech Stack:** TypeScript ESM (NodeNext, `.js` import specifiers), Node ≥20, Vitest. No new runtime dependencies.

## Global Constraints

- **Module system:** NodeNext ESM. Every relative import MUST use a `.js` extension. Node builtins use the `node:` prefix.
- **TypeScript:** `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `isolatedModules` all on. Optional object properties must be omitted, not set to `undefined`. Type-only re-exports MUST use `export type { ... }` (isolatedModules). Index access returns `T | undefined` - narrow before use.
- **Coverage: NO coverage gate** for this refactory phase (owner decision, 2026-07-26). Minimal behavioral tests only: (a) the SDK barrel re-exports the expected runtime symbols (one import test asserting they are defined); (b) an empty `CONTRIB_MODULES` spread into a kernel does not change `startedOrder`. Do not chase line/branch coverage. `core/surface.ts` is types-only and has nothing to test at runtime - `npm run typecheck` is its only gate.
- **No new dependencies.** Do not add anything to `package.json`.
- **Predisposition ONLY - ABSOLUTE.** No dynamic `import()`, no `fs` scanning, no network, no discovery, no runtime frontend module loading. `CONTRIB_MODULES` is a literal empty array and stays empty. `SurfaceContribution` is wired to nothing.
- **Zero behavior change.** `@routerly/shared` (`index.ts` and `browser.ts`) and the service wire/management API stay FROZEN (roadmap decision #2). Spreading an empty array into the bootstrap module list is a structural no-op.
- **Public surface names MUST match `core/index.ts` exactly.** `core/sdk.ts` re-exports a subset of `core/index.js`; every re-exported name must be a name `core/index.ts` already exports. Do not invent or rename symbols.
- **English only** for all code, comments, identifiers, and commit messages. No em dashes.
- **Scope fence:** create files only under `packages/service/src/core/`; Task 2 makes one additive one-line edit to Plan 2's kernel bootstrap. Do NOT modify `core/index.ts`, any other `core/*` file, any module, any route, or `server.ts` beyond that one spread.

**Hard prerequisites (Plans 1 and 2).** This plan imports:
- `core/index.js` (Plan 1) - source of `defineModule`, `RouterlyModule`, `ModuleManifest`, `ModuleRegistry`, `Runtime`, `Processor`, `ProcessorRegistry`, `token`, `Token`, `EventBus`, `ServiceContainer`, `shortCircuit`, `isShortCircuit`, `KernelError`, `ModuleGraphError`, `MissingDependencyError`, `DependencyCycleError`, and `Kernel` (used by the Task 2 test).
- The module array Plan 2 assembles in `packages/service/src/server.ts` and passes to `buildKernel([...])` (Plan 3 appends `providerModule` to it). There is NO `createKernel()` factory: `buildKernel(modules): Promise<Kernel>` is defined once in `core/bootstrap.ts`, and the module array lives at the `server.ts` call site.

As of writing, Plans 1 and 2 are not yet committed. If either is unmerged when this plan starts, block and land them first - this plan re-exports names Plan 1 defines and edits a module list Plan 2 creates; it cannot do either against files that do not exist.

**All commands below run from `packages/service/`** unless stated otherwise.

---

### Task 1: Module SDK - curated public authoring barrel

**Files:**
- Create: `packages/service/src/core/sdk.ts`
- Test: `packages/service/src/core/sdk.test.ts`

**Interfaces:**
- Consumes: `core/index.js` (Plan 1). Re-exports ONLY, no new logic.
- Produces `packages/service/src/core/sdk.ts` re-exporting exactly the authoring surface:
  - Runtime values: `defineModule`, `ProcessorRegistry`, `token`, `EventBus`, `ServiceContainer`, `shortCircuit`, `isShortCircuit`, `KernelError`, `ModuleGraphError`, `MissingDependencyError`, `DependencyCycleError`.
  - Types: `RouterlyModule`, `ModuleManifest`, `ModuleRegistry`, `Runtime`, `Processor`, `Token`.
  - A doc-comment block describing how to author a module (manifest + `register` + optional `start`/`stop` + contribute processors).
- Deliberately excluded (internal kernel mechanics, not authoring surface): `Kernel`, `topologicalSort`, `GraphNode`, `topicMatches`, `ShortCircuit`, `EventListener`. A module author never constructs a `Kernel` or sorts the graph; those stay reachable via `core/index.js` for the bootstrap, not via the SDK.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/core/sdk.test.ts
import { describe, it, expect } from 'vitest'
import * as sdk from './sdk.js'

describe('module SDK barrel', () => {
  it('re-exports every runtime authoring symbol', () => {
    // Runtime values (functions / classes) the SDK must expose.
    for (const name of [
      'defineModule',
      'ProcessorRegistry',
      'token',
      'EventBus',
      'ServiceContainer',
      'shortCircuit',
      'isShortCircuit',
      'KernelError',
      'ModuleGraphError',
      'MissingDependencyError',
      'DependencyCycleError',
    ] as const) {
      expect(sdk[name], name).toBeDefined()
    }
  })

  it('exposes a working authoring surface (defineModule + token round-trip)', () => {
    const mod = sdk.defineModule({
      manifest: { id: 'sample', version: '0.4.0' },
      register({ container }) {
        container.register(sdk.token<number>('sample.value'), 42)
      },
    })
    expect(mod.manifest.id).toBe('sample')
    const c = new sdk.ServiceContainer()
    void mod.register({ container: c, events: new sdk.EventBus() })
    expect(c.resolve(sdk.token<number>('sample.value'))).toBe(42)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/sdk.test.ts`
Expected: FAIL - cannot find module `./sdk.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/core/sdk.ts
/**
 * Routerly module SDK (0.4.0 refactory, Plan 6).
 *
 * The stable, public authoring surface for Routerly modules. A future contrib
 * module - in-tree or, later, distributed as an npm package - is written
 * against exactly these names. It is a curated view of `core/index.js`: it
 * omits internal kernel mechanics (Kernel, topologicalSort, GraphNode,
 * topicMatches) so the authoring contract does not drift as the kernel grows.
 *
 * Authoring a module:
 *
 *   import { defineModule, token, type ModuleRegistry, type Runtime } from './sdk.js'
 *
 *   const MY_SERVICE = token<MyService>('my.service')
 *
 *   export const myModule = defineModule({
 *     // 1. manifest: identity + ordering. `dependsOn` keys are other module ids;
 *     //    `before` / `after` / `weight` order this module against its peers.
 *     manifest: { id: 'my-module', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
 *
 *     // 2. register: put services behind DI tokens. Runs in dependency order,
 *     //    before any module starts. Contribute processors here by resolving the
 *     //    pipeline ProcessorRegistry from the container and calling `.contribute(p)`.
 *     register({ container, events }: ModuleRegistry) {
 *       container.register(MY_SERVICE, buildMyService())
 *     },
 *
 *     // 3. start (optional): open connections / warm caches. Runs after every
 *     //    module registered.
 *     async start({ container, events }: Runtime) {},
 *
 *     // 4. stop (optional): tear down. Runs in reverse start order, best-effort.
 *     async stop() {},
 *   })
 *
 * A processor is a thin unit contributed to a named pipeline phase:
 *
 *   const p: Processor<Ctx> = { id: 'my-step', phase: 'request.preprocess', run(ctx) {} }
 *
 * ponytail: pure re-export barrel, no runtime code. The doc comment is the SDK's
 * only added value over `core/index.js`; it is the authoring contract, curated.
 */
export {
  defineModule,
  ProcessorRegistry,
  token,
  EventBus,
  ServiceContainer,
  shortCircuit,
  isShortCircuit,
  KernelError,
  ModuleGraphError,
  MissingDependencyError,
  DependencyCycleError,
} from './index.js'

export type {
  RouterlyModule,
  ModuleManifest,
  ModuleRegistry,
  Runtime,
  Processor,
  Token,
} from './index.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/sdk.test.ts`
Expected: PASS (both groups green).

- [ ] **Step 5: Typecheck (confirms every re-exported name exists in `core/index.ts`)**

Run: `npm run typecheck`
Expected: exit 0. A name not exported by `core/index.js` (or a type re-exported without `export type`) fails here.

- [ ] **Step 6: Commit**

```bash
git add packages/service/src/core/sdk.ts packages/service/src/core/sdk.test.ts
git commit -m "feat(core): public module SDK authoring barrel"
```

---

### Task 2: Contrib registration seam - empty, spread into the bootstrap

**Files:**
- Create: `packages/service/src/core/contrib.ts`
- Test: `packages/service/src/core/contrib.test.ts`
- Modify: the module array Plan 2 assembles in `packages/service/src/server.ts` and passes to `buildKernel([...])` (Plan 3/4/5 have appended `providerModule`, `reverseProxyModule`, `...coreModules`). Locate before editing.

**Interfaces:**
- Consumes: `RouterlyModule` from `./index.js`; the existing `buildKernel([...])` module array assembled in `server.ts` (Plan 2).
- Produces:
  - `export const CONTRIB_MODULES: RouterlyModule[] = []` - the documented, inert extension point. Empty now, empty by policy for this phase.
  - The bootstrap module array now ends with `...CONTRIB_MODULES`. Because it is empty, the kernel's module list, ordering, and `startedOrder` are byte-identical.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/core/contrib.test.ts
import { describe, it, expect } from 'vitest'
import { Kernel, defineModule } from './index.js'
import { CONTRIB_MODULES } from './contrib.js'

describe('CONTRIB_MODULES', () => {
  it('is empty (no contrib modules loaded in this phase)', () => {
    expect(CONTRIB_MODULES).toEqual([])
  })

  it('spreading it into a kernel does not change startedOrder', async () => {
    const base = [
      defineModule({ manifest: { id: 'a', version: '1.0.0' }, register() {} }),
      defineModule({ manifest: { id: 'b', version: '1.0.0' }, register() {} }),
    ]
    const k = new Kernel([...base, ...CONTRIB_MODULES])
    await k.start()
    expect(k.startedOrder).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/contrib.test.ts`
Expected: FAIL - cannot find module `./contrib.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/core/contrib.ts
import type { RouterlyModule } from './index.js'

/**
 * Contrib registration seam (0.4.0 refactory, Plan 6).
 *
 * The single extension point for third-party ("contrib") modules. The kernel
 * bootstrap spreads this array into its static module list, so appending a
 * module here is all it takes to register one.
 *
 * PREDISPOSITION ONLY (roadmap decision #6): this array is empty and stays
 * empty for this phase. There is NO dynamic loading - no filesystem scan, no
 * `import()`, no npm resolution. Contrib modules are added here by editing this
 * file, statically, against the module SDK (`./sdk.js`). Automatic discovery is
 * deferred; see the plan's Self-review.
 *
 * ponytail: a typed empty array proves the shape without loading anything.
 * Add a discovery mechanism only when a real contrib module needs to ship
 * out-of-tree.
 */
export const CONTRIB_MODULES: RouterlyModule[] = []
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/contrib.test.ts`
Expected: PASS (both groups green).

- [ ] **Step 5: Locate and edit the server.ts module array**

Run: `grep -rn "buildKernel(" packages/service/src/`
Expected: one call site - the module array Plan 2 assembles in `server.ts` (Plan 3/4/5 have appended `providerModule`, `reverseProxyModule`, `...coreModules`). The single `new Kernel(...)` stays inside `core/bootstrap.ts::buildKernel`; the `grep -rn "new Kernel(" packages/service/src/` check returns exactly one match, there. If Plan 2 is unmerged, STOP: this edit has no target. Land Plan 2 first (hard prerequisite).

Add the import and spread `...CONTRIB_MODULES` as the LAST element (so contrib modules order after all built-ins). Minimal diff against the `server.ts` call site:

```ts
import { buildKernel } from './core/bootstrap.js'
import { CONTRIB_MODULES } from './core/contrib.js'
// ...existing module imports from Plans 2/3/4/5

const kernel = await buildKernel([configModule, providerModule, reverseProxyModule, ...coreModules, ...CONTRIB_MODULES])
```

(Import path is relative to `server.ts`: `./core/contrib.js`. Keep the exact set of built-in modules Plans 2/3/4/5 already list; only append the `...CONTRIB_MODULES` spread at the tail. Do not add a `createKernel` factory.)

- [ ] **Step 6: Typecheck + full suite (empty spread changes nothing)**

Run: `npm run typecheck && npm test`
Expected: exit 0; all suites green, including Plan 2's kernel-bootstrap test. If that test asserts on `startedOrder`, it is UNCHANGED - spreading an empty array adds no module. No new bootstrap test is required here; Task 2's unit test proves the empty-spread invariant in isolation and `npm test` proves the live bootstrap still boots identically.

- [ ] **Step 7: Commit**

```bash
git add packages/service/src/core/contrib.ts packages/service/src/core/contrib.test.ts
git add -A packages/service/src/core/bootstrap.ts
git commit -m "feat(core): inert contrib module registration seam"
```

---

### Task 3: Surface/metamodule contract - types-only predisposition

**Files:**
- Create: `packages/service/src/core/surface.ts`
- Test: none (types-only; erased at compile time; `npm run typecheck` is the gate).

**Interfaces:**
- Consumes: nothing.
- Produces: a single documented `SurfaceContribution` interface (plus its small member types) describing the intended `surface.*` capability contract a future frontend-loadable / metamodule would declare. Wired to nothing. No runtime value, no default export, no registration.

- [ ] **Step 1: Write the types-only contract**

```ts
// packages/service/src/core/surface.ts
/**
 * Surface / metamodule contract (0.4.0 refactory, Plan 6).
 *
 * PREDISPOSITION ONLY (roadmap decision #6) - TYPES, NO IMPLEMENTATION.
 *
 * A "surface" is a user-facing entry point a module exposes: a dashboard page,
 * a CLI command, or a management API route. The eventual metamodule / runtime
 * frontend module loading feature will let a module DECLARE its surfaces so a
 * host can mount them without the host importing the module directly. This file
 * fixes the shape of that declaration so future work has a stable contract to
 * target. Nothing consumes it yet: no module returns a SurfaceContribution, no
 * loader reads one, no runtime frontend module is loaded. It is erased at
 * compile time (types-only) and changes zero behavior.
 *
 * Deferred (NOT built here, see plan Self-review): the mechanism that collects,
 * validates, and mounts these declarations, and any dynamic frontend loading.
 */

/** Where a declared surface attaches. */
export type SurfaceKind = 'dashboard' | 'cli' | 'api'

/** One user-facing entry point a module declares it provides. */
export interface Surface {
  /** Stable id, unique within the owning module. */
  readonly id: string
  /** Which host mounts it. */
  readonly kind: SurfaceKind
  /**
   * Mount hint interpreted by the host for this `kind`:
   * dashboard -> route path (e.g. '/projects/:id/guardrails');
   * cli       -> command path (e.g. 'guardrails list');
   * api       -> route path (e.g. '/api/guardrails').
   */
  readonly at: string
  /** Human-readable label for menus / help text. */
  readonly title: string
}

/**
 * A module's full set of declared surfaces. The intended (future) shape a
 * module would return from a `surfaces()` capability. Not invoked anywhere yet.
 */
export interface SurfaceContribution {
  /** Owning module id (matches ModuleManifest.id). */
  readonly module: string
  readonly surfaces: readonly Surface[]
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. The file compiles and is erased (no runtime emit beyond an empty module). It imports nothing and is imported by nothing - no behavior touched.

- [ ] **Step 3: Confirm it is inert (no consumer)**

Run: `grep -rn "surface.js\|SurfaceContribution\|from './surface'" packages/service/src/`
Expected: matches ONLY inside `core/surface.ts` itself (no importer). This proves the contract is predisposition, not wired.

- [ ] **Step 4: Commit**

```bash
git add packages/service/src/core/surface.ts
git commit -m "feat(core): surface/metamodule contract stub (types-only)"
```

---

## Self-review

- **Roadmap scope mapped:**
  - Scope 1 (module SDK as a public export FROM core, not a separate `@routerly/module-sdk` package) → Task 1: `core/sdk.ts` re-exports the authoring surface with a how-to-author doc block. Not a new package (roadmap decision #6).
  - Scope 2 (inert contrib registration seam the bootstrap already spreads) → Task 2: `CONTRIB_MODULES: RouterlyModule[] = []` + one-line spread into the `server.ts` `buildKernel([...])` array.
  - Scope 3 (surface/metamodule contract, types + comments only) → Task 3: single `SurfaceContribution` interface, wired to nothing.
- **Nothing dynamic is loaded.** No `import()`, no `fs`, no network, no discovery, no npm resolution, no runtime frontend module loading anywhere in the three files. `grep -rn "import(" packages/service/src/core/{sdk,contrib,surface}.ts` returns nothing. `CONTRIB_MODULES` is a literal `[]`.
- **No behavior change.** `core/sdk.ts` and `core/surface.ts` are pure re-exports / types (erased). `core/contrib.ts` is an empty array; spreading `...[]` into the bootstrap list yields the identical module list, so `startedOrder` and boot behavior are byte-identical (Task 2 Step 6). `@routerly/shared` and the service wire/management API are never opened (roadmap decision #2).
- **Public surface names match `core/index.ts` exactly.** Every symbol in `core/sdk.ts` is re-exported FROM `./index.js` - `defineModule`, `ProcessorRegistry`, `token`, `EventBus`, `ServiceContainer`, `shortCircuit`, `isShortCircuit`, `KernelError`, `ModuleGraphError`, `MissingDependencyError`, `DependencyCycleError` (values) and `RouterlyModule`, `ModuleManifest`, `ModuleRegistry`, `Runtime`, `Processor`, `Token` (types). Task 1 Step 5 typecheck fails if any name is not exported by `core/index.ts`. The SDK is a strict subset: internal mechanics (`Kernel`, `topologicalSort`, `GraphNode`, `topicMatches`, `ShortCircuit`, `EventListener`) are intentionally NOT re-exported - a curated authoring contract, not the full barrel.
- **Minimal tests only (no coverage gate).** Two test files: `sdk.test.ts` (barrel re-exports the expected symbols + a round-trip) and `contrib.test.ts` (empty array + empty-spread leaves `startedOrder` unchanged). `surface.ts` is types-only and typecheck-gated. No coverage percentage is asserted (owner decision, 2026-07-26).
- **Deferred as FUTURE work (explicitly, not gaps):**
  - **Contrib discovery / distribution.** No filesystem scan, npm resolution, or `import()` to auto-load contrib modules. Contrib modules are added statically to `CONTRIB_MODULES`. A discovery mechanism is added only when a real out-of-tree contrib module needs to ship. This is the roadmap decision #6 line, honored.
  - **Runtime frontend module loading.** No dynamic UI/CLI/API mounting. `SurfaceContribution` fixes the declaration shape only; the collector/validator/mounter and any dynamic frontend load are deferred. Nothing returns or reads a `SurfaceContribution` today (Task 3 Step 3 proves no consumer).
  - **Provider contribution hook.** Plan 3 deliberately left the provider registry as the static record with no contribution seam and pointed here. This plan does NOT add one either: it would be a speculative seam with zero consumers. When a contrib provider module actually exists, it registers via `CONTRIB_MODULES` like any other module; a provider-contribution point is added then, not now.
- **YAGNI honored.** `core/surface.ts` is a single interface, not a set of stub files. No `@routerly/module-sdk` package, no loader, no registry mutation, no manifest-discovery format. The deliverable is a stable public surface (the SDK barrel) plus a documented empty extension point - no scaffolding "for later".

---

## Plan sequence (this is Plan 6 of 6)

| # | Plan file | Deliverable |
|---|-----------|-------------|
| 1 | `2026-07-26-modular-kernel-foundation.md` | `core/` primitives - additive, nothing wired |
| 2 | `2026-07-26-kernel-bootstrap-config-module.md` | Kernel boots inside `server.ts`; config wrapped as first module; `core/tokens.ts` + bootstrap module list defined |
| 3 | `2026-07-26-provider-model-module.md` | `getProviderAdapter` also reachable via `PROVIDER_REGISTRY`; adapters + frozen contract unchanged |
| 4 | `2026-07-26-reverse-proxy-pipeline.md` | Phase pipeline + `ProxyContext`; routes delegate 1:1; wire byte-identical |
| 5 | `2026-07-26-core-modules-extraction.md` | routing, cache, budget, usage, logging as modules contributing processors |
| 6 | `2026-07-26-contrib-surfaces-predisposition.md` (this doc) | Public module SDK export + inert contrib seam + types-only surface contract; NO runtime loading, NO behavior change |

**Plan complete and saved to `docs/superpowers/plans/2026-07-26-contrib-surfaces-predisposition.md`.**
