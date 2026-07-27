# Step 0 — Core Hook Mechanism + core/ Subfolder Reorg — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the kernel a generic, hook-based extension mechanism (service override, ordered/overridable contribution registry, route contribution) so later modules can extend or override each other's behavior without new kernel surface per feature, then reorganize `core/` into subfolders that reflect its actual responsibilities.

**Architecture:** Add `ServiceContainer.override()` for DI-token decoration. Add a new generic `AlterableRegistry<T>` (ordered contribution list with weight/before/after ordering, reusing the existing `topologicalSort` scoping semantics) in a new `core/hooks/` folder. Re-base `ProcessorRegistry` on top of `AlterableRegistry` internally, with zero change to its public API, and add a new `ProcessorRegistry.override(phase, id, alter)` method. Add a small `RouteContribution` factory on the same primitive, for later use by `modules/api/` and `modules/api-reverse-proxy/` (not built in this plan). Finish with a purely mechanical move of existing `core/*.ts` files into `container/`, `modules/`, `events/`, `pipeline/`, `lifecycle/` subfolders, updating only internal import paths — `errors.ts`, `result.ts`, `graph.ts`, `tokens.ts`, `sdk.ts`, `surface.ts`, `contrib.ts`, `index.ts` stay at `core/` top level as cross-cutting primitives.

**Tech Stack:** TypeScript ESM, Vitest, Node ≥20. No new dependencies.

## Global Constraints

- Wire-format transparency ABSOLUTE — this plan touches no request/response payload code, no wire-format risk.
- Feature-parity ABSOLUTE — every existing test in `core/container.test.ts`, `core/processors.test.ts`, `core/module.test.ts`, `core/events.test.ts`, `core/kernel.test.ts`, `core/bootstrap.test.ts`, `core/sdk.test.ts` must pass unchanged (same assertions, same behavior) after every task, whether the file moved or not.
- Public/frozen surfaces unchanged: `Processor<C>` shape, `ProcessorRegistry.contribute/orderedFor/runPhase` signatures, `ServiceContainer.register/has/tryResolve/resolve` signatures, `core/tokens.ts` token identities, `/api/*` — none of these change shape in this plan, only gain new additive members.
- Imports: `.js` extension on relative imports; `node:` prefix on builtins (per `.claude/rules/service.md`).
- Test files: `*.test.ts` in the same directory as the source file they test (per `.claude/rules/service.md`).
- No em dashes anywhere (code, comments, commit messages, this plan).
- No coverage-percentage gate for this plan (locked constraint from `_index.md`) — correctness is verified by existing + new unit tests passing, not a coverage threshold.
- Run `npx vitest run` from `packages/service/` (its `test` script) to verify; the root `npm test` also runs it via `--workspaces --if-present`.

---

### Task 1: `ServiceContainer.override()`

**Files:**
- Modify: `packages/service/src/core/container.ts`
- Test: `packages/service/src/core/container.test.ts`

**Interfaces:**
- Consumes: existing `Token<T>`, `KernelError`, `MissingDependencyError` from `./errors.js` (already imported in this file).
- Produces: `ServiceContainer.override<T>(t: Token<T>, decorate: (previous: T) => T): void` — throws `MissingDependencyError` if `t` isn't registered yet; otherwise replaces the stored value with `decorate(previous)`. Later tasks (and later plans' modules) call this to wrap/replace a service another module registered.

- [ ] **Step 1: Write the failing tests**

Read the existing file first to match its exact style:

```bash
cat packages/service/src/core/container.test.ts
```

Append these `it` blocks inside the existing `describe('ServiceContainer', ...)` block (reuse the file's existing `token`/`ServiceContainer`/`MissingDependencyError` imports, add `KernelError` to the import if not already present):

```ts
it('overrides a registered service by decorating the previous value', () => {
  const clock = token<{ now(): number }>('clock')
  const c = new ServiceContainer()
  c.register(clock, { now: () => 1 })
  c.override(clock, (prev) => ({ now: () => prev.now() + 10 }))
  expect(c.resolve(clock).now()).toBe(11)
})

it('composes multiple overrides in registration order', () => {
  const clock = token<{ now(): number }>('clock')
  const c = new ServiceContainer()
  c.register(clock, { now: () => 1 })
  c.override(clock, (prev) => ({ now: () => prev.now() + 1 }))
  c.override(clock, (prev) => ({ now: () => prev.now() * 10 }))
  expect(c.resolve(clock).now()).toBe(20)
})

it('throws MissingDependencyError when overriding an unregistered token', () => {
  const clock = token<{ now(): number }>('clock')
  const c = new ServiceContainer()
  expect(() => c.override(clock, (prev) => prev)).toThrow(MissingDependencyError)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/container.test.ts` (from `packages/service/`)
Expected: FAIL — `c.override is not a function`

- [ ] **Step 3: Implement `override()`**

In `packages/service/src/core/container.ts`, add this method to the `ServiceContainer` class, after `register()`:

```ts
  override<T>(t: Token<T>, decorate: (previous: T) => T): void {
    if (!this.services.has(t.key)) {
      throw new MissingDependencyError(`cannot override unregistered service: ${t.key}`)
    }
    const previous = this.services.get(t.key) as T
    this.services.set(t.key, decorate(previous))
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/container.test.ts`
Expected: PASS, all tests (existing 3 + new 3)

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/container.ts packages/service/src/core/container.test.ts
git commit -m "feat(core): add ServiceContainer.override for service decoration"
```

---

### Task 2: `AlterableRegistry<T>`

**Files:**
- Create: `packages/service/src/core/hooks/registry.ts`
- Test: `packages/service/src/core/hooks/registry.test.ts`

**Interfaces:**
- Consumes: `topologicalSort`, `GraphNode` from `../graph.js`; `KernelError`, `MissingDependencyError` from `../errors.js`.
- Produces:
  - `interface Contribution<T> { id: string; before?: string[]; after?: string[]; weight?: number; value: T }`
  - `class AlterableRegistry<T>` with:
    - `contribute(c: Contribution<T>): void` — throws `KernelError` (code `DUPLICATE_CONTRIBUTION`) on duplicate `id`.
    - `override(id: string, alter: (previous: T) => T): void` — throws `MissingDependencyError` if `id` unknown.
    - `ordered(): T[]` — returns contribution values ordered by the same before/after/weight rules as `ProcessorRegistry.orderedFor` today (unknown/cross-registry refs silently dropped, not thrown).
  - Task 3 rebuilds `ProcessorRegistry` on top of this. Task 4 builds route contributions on top of this.

- [ ] **Step 1: Write the failing tests**

Create `packages/service/src/core/hooks/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { AlterableRegistry } from './registry.js'
import { KernelError, MissingDependencyError } from '../errors.js'

describe('AlterableRegistry', () => {
  it('orders contributions by weight then before/after', () => {
    const reg = new AlterableRegistry<string>()
    reg.contribute({ id: 'b', value: 'B', after: ['a'] })
    reg.contribute({ id: 'a', value: 'A' })
    reg.contribute({ id: 'c', value: 'C', after: ['a'], before: ['b'] })
    expect(reg.ordered()).toEqual(['A', 'C', 'B'])
  })

  it('overrides an existing contribution value by id', () => {
    const reg = new AlterableRegistry<string>()
    reg.contribute({ id: 'a', value: 'A' })
    reg.override('a', (prev) => prev + '!')
    expect(reg.ordered()).toEqual(['A!'])
  })

  it('throws MissingDependencyError when overriding an unknown id', () => {
    const reg = new AlterableRegistry<string>()
    expect(() => reg.override('missing', (v) => v)).toThrow(MissingDependencyError)
  })

  it('throws KernelError on duplicate contribution id', () => {
    const reg = new AlterableRegistry<string>()
    reg.contribute({ id: 'a', value: 'A' })
    expect(() => reg.contribute({ id: 'a', value: 'A2' })).toThrow(KernelError)
  })

  it('silently drops before/after references to ids outside this registry', () => {
    const reg = new AlterableRegistry<string>()
    reg.contribute({ id: 'a', value: 'A', after: ['outside-this-registry'] })
    expect(reg.ordered()).toEqual(['A'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/hooks/registry.test.ts`
Expected: FAIL — cannot find module `./registry.js`

- [ ] **Step 3: Implement `AlterableRegistry`**

Create `packages/service/src/core/hooks/registry.ts`:

```ts
import { topologicalSort, type GraphNode } from '../graph.js'
import { KernelError, MissingDependencyError } from '../errors.js'

export interface Contribution<T> {
  id: string
  before?: string[]
  after?: string[]
  weight?: number
  value: T
}

export class AlterableRegistry<T> {
  private readonly items = new Map<string, Contribution<T>>()
  private readonly order: string[] = []

  contribute(c: Contribution<T>): void {
    if (this.items.has(c.id)) {
      throw new KernelError(`contribution already exists: ${c.id}`, 'DUPLICATE_CONTRIBUTION')
    }
    this.items.set(c.id, c)
    this.order.push(c.id)
  }

  override(id: string, alter: (previous: T) => T): void {
    const existing = this.items.get(id)
    if (!existing) {
      throw new MissingDependencyError(`no contribution registered: ${id}`)
    }
    this.items.set(id, { ...existing, value: alter(existing.value) })
  }

  ordered(): T[] {
    const ids = new Set(this.items.keys())
    const scoped = (refs: string[] | undefined): string[] => (refs ?? []).filter((r) => ids.has(r))
    const nodes: GraphNode[] = this.order.map((id) => {
      const c = this.items.get(id)
      if (!c) {
        throw new KernelError(`resolved contribution not found: ${id}`, 'CONTRIBUTION_NOT_FOUND')
      }
      return { id, before: scoped(c.before), after: scoped(c.after), weight: c.weight ?? 0 }
    })
    return topologicalSort(nodes).map((id) => {
      const c = this.items.get(id)
      if (!c) {
        throw new KernelError(`resolved contribution not found: ${id}`, 'CONTRIBUTION_NOT_FOUND')
      }
      return c.value
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/hooks/registry.test.ts`
Expected: PASS, all 5 tests

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/hooks/registry.ts packages/service/src/core/hooks/registry.test.ts
git commit -m "feat(core): add AlterableRegistry generic hook-ordered contribution registry"
```

---

### Task 3: Re-base `ProcessorRegistry` onto `AlterableRegistry`

**Files:**
- Modify: `packages/service/src/core/processors.ts`
- Test: `packages/service/src/core/processors.test.ts`

**Interfaces:**
- Consumes: `AlterableRegistry<T>` from `./hooks/registry.js` (Task 2); `isShortCircuit`, `ShortCircuit` from `./result.js` (unchanged import).
- Produces: `ProcessorRegistry<C>.contribute/orderedFor/runPhase` — same signatures as before (byte-identical). New method: `ProcessorRegistry<C>.override(phase: string, id: string, alter: (previous: Processor<C>) => Processor<C>): void`.
- Must NOT change: `Processor<C>` interface shape.

- [ ] **Step 1: Write the failing tests**

Read the existing file first:

```bash
cat packages/service/src/core/processors.test.ts
```

Add `MissingDependencyError` to its imports from `./errors.js` (add the import if the file doesn't already import from `./errors.js`; if it does, extend the existing import list). Append these two `it` blocks to the existing `describe('ProcessorRegistry', ...)` block, matching whatever local `Ctx`/`step()` test helpers the file already defines for its other tests:

```ts
it('overrides a specific processor by phase+id, wrapping its run', async () => {
  const reg = new ProcessorRegistry<{ trail: string[] }>()
  reg.contribute({
    id: 'a',
    phase: 'p',
    run: (c) => {
      c.trail.push('a')
    },
  })
  reg.override('p', 'a', (prev) => ({
    ...prev,
    run: async (c) => {
      c.trail.push('before-a')
      await prev.run(c)
      c.trail.push('after-a')
    },
  }))
  const ctx = { trail: [] as string[] }
  await reg.runPhase('p', ctx)
  expect(ctx.trail).toEqual(['before-a', 'a', 'after-a'])
})

it('throws MissingDependencyError overriding an id not contributed to that phase', () => {
  const reg = new ProcessorRegistry<{ trail: string[] }>()
  expect(() => reg.override('p', 'missing', (prev) => prev)).toThrow(MissingDependencyError)
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/core/processors.test.ts`
Expected: FAIL on the 2 new tests — `reg.override is not a function`; the 6 pre-existing tests still PASS (confirms baseline untouched before the refactor).

- [ ] **Step 3: Re-implement `ProcessorRegistry` on top of `AlterableRegistry`**

Replace the full contents of `packages/service/src/core/processors.ts`:

```ts
import { AlterableRegistry } from './hooks/registry.js'
import { isShortCircuit, type ShortCircuit } from './result.js'

export interface Processor<C> {
  id: string
  phase: string
  before?: string[]
  after?: string[]
  weight?: number
  run(context: C): void | Promise<void> | ShortCircuit | Promise<ShortCircuit | void>
}

export class ProcessorRegistry<C> {
  private readonly byPhase = new Map<string, AlterableRegistry<Processor<C>>>()

  private registryFor(phase: string): AlterableRegistry<Processor<C>> {
    let reg = this.byPhase.get(phase)
    if (!reg) {
      reg = new AlterableRegistry<Processor<C>>()
      this.byPhase.set(phase, reg)
    }
    return reg
  }

  contribute(p: Processor<C>): void {
    this.registryFor(p.phase).contribute({
      id: p.id,
      before: p.before,
      after: p.after,
      weight: p.weight,
      value: p,
    })
  }

  override(phase: string, id: string, alter: (previous: Processor<C>) => Processor<C>): void {
    this.registryFor(phase).override(id, alter)
  }

  orderedFor(phase: string): Processor<C>[] {
    return this.byPhase.get(phase)?.ordered() ?? []
  }

  async runPhase(phase: string, context: C): Promise<void> {
    for (const p of this.orderedFor(phase)) {
      const outcome = await p.run(context)
      if (isShortCircuit(outcome)) return
    }
  }
}
```

Compatibility note (record this in the commit body, not just here): `contribute()` on the same `(phase, id)` pair twice now throws `KernelError('DUPLICATE_CONTRIBUTION')` where before it silently allowed duplicates (dead array-push code path). Verified via project-wide grep that no existing module contributes a duplicate id within a phase today — this is a deliberate, safe tightening, not a hidden behavior change.

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run src/core/processors.test.ts`
Expected: PASS, all 8 tests (6 pre-existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/processors.ts packages/service/src/core/processors.test.ts
git commit -m "refactor(core): rebase ProcessorRegistry onto AlterableRegistry, add per-processor override"
```

---

### Task 4: `RouteContribution` + route registry factory

**Files:**
- Create: `packages/service/src/core/hooks/routes.ts`
- Test: `packages/service/src/core/hooks/routes.test.ts`

**Interfaces:**
- Consumes: `AlterableRegistry` from `./registry.js` (same folder, Task 2).
- Produces: `interface RouteContribution { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; url: string; handler: (request: unknown, reply: unknown) => unknown | Promise<unknown> }`, `function createRouteRegistry(): AlterableRegistry<RouteContribution>`. Intentionally transport-framework-agnostic (`handler` is untyped w.r.t. Fastify) — `modules/api/` (a later, separate plan) adapts these onto a real `FastifyInstance` when it's built; core stays domain- and framework-free.

- [ ] **Step 1: Write the failing test**

Create `packages/service/src/core/hooks/routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createRouteRegistry } from './routes.js'

describe('createRouteRegistry', () => {
  it('creates an AlterableRegistry of route contributions, ordered and overridable', () => {
    const routes = createRouteRegistry()
    routes.contribute({ id: 'list', value: { method: 'GET', url: '/things', handler: () => 'list' } })
    routes.contribute({ id: 'create', value: { method: 'POST', url: '/things', handler: () => 'create' } })
    expect(routes.ordered().map((r) => r.method)).toEqual(['GET', 'POST'])

    routes.override('list', (prev) => ({ ...prev, handler: () => 'overridden' }))
    expect(routes.ordered()[0]?.handler(undefined, undefined)).toBe('overridden')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/hooks/routes.test.ts`
Expected: FAIL — cannot find module `./routes.js`

- [ ] **Step 3: Implement**

Create `packages/service/src/core/hooks/routes.ts`:

```ts
import { AlterableRegistry } from './registry.js'

export interface RouteContribution {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  url: string
  handler: (request: unknown, reply: unknown) => unknown | Promise<unknown>
}

export function createRouteRegistry(): AlterableRegistry<RouteContribution> {
  return new AlterableRegistry<RouteContribution>()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/hooks/routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/hooks/routes.ts packages/service/src/core/hooks/routes.test.ts
git commit -m "feat(core): add RouteContribution and createRouteRegistry for future route-hook modules"
```

---

### Task 5: Extend `core/index.ts` and `core/sdk.ts` barrels

**Files:**
- Modify: `packages/service/src/core/index.ts`
- Modify: `packages/service/src/core/sdk.ts`
- Test: `packages/service/src/core/sdk.test.ts`

**Interfaces:**
- Consumes: `AlterableRegistry`, `Contribution` from `./hooks/registry.js`; `RouteContribution`, `createRouteRegistry` from `./hooks/routes.js`.
- Produces: both new hook symbols now reachable via `core/index.js` (internal barrel) and `core/sdk.js` (module-authoring barrel), alongside the existing sdk exports.

- [ ] **Step 1: Write the failing test**

Read the existing files first:

```bash
cat packages/service/src/core/index.ts packages/service/src/core/sdk.ts packages/service/src/core/sdk.test.ts
```

Add to `packages/service/src/core/sdk.test.ts`'s existing "every runtime authoring symbol is defined" list/assertions (matching the file's existing style, e.g. if it does `expect(defineModule).toBeDefined()` per symbol, add the same pattern for the new ones):

```ts
import { AlterableRegistry, createRouteRegistry } from './sdk.js'

it('exports AlterableRegistry and createRouteRegistry', () => {
  expect(AlterableRegistry).toBeDefined()
  expect(createRouteRegistry).toBeDefined()
})

it('AlterableRegistry round-trips a contribution via the sdk barrel', () => {
  const reg = new AlterableRegistry<number>()
  reg.contribute({ id: 'x', value: 1 })
  expect(reg.ordered()).toEqual([1])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/sdk.test.ts`
Expected: FAIL — `AlterableRegistry`/`createRouteRegistry` not exported from `./sdk.js`

- [ ] **Step 3: Extend the barrels**

In `packages/service/src/core/index.ts`, add (near the existing `export * from './processors.js'` line):

```ts
export * from './hooks/registry.js'
export * from './hooks/routes.js'
```

In `packages/service/src/core/sdk.ts`, add `AlterableRegistry` and `createRouteRegistry` to the existing runtime re-export list, and `Contribution`, `RouteContribution` to the existing type re-export list (same `export { ... } from './index.js'` / `export type { ... } from './index.js'` statements already in the file — extend them, do not add new statements).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/sdk.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/index.ts packages/service/src/core/sdk.ts packages/service/src/core/sdk.test.ts
git commit -m "feat(core): expose AlterableRegistry and route-contribution hooks via core barrels"
```

---

### Task 6: Mechanical `core/` subfolder reorg

**Files:**
- Move: `packages/service/src/core/container.ts` → `packages/service/src/core/container/index.ts`
- Move: `packages/service/src/core/container.test.ts` → `packages/service/src/core/container/index.test.ts`
- Move: `packages/service/src/core/module.ts` → `packages/service/src/core/modules/index.ts`
- Move: `packages/service/src/core/module.test.ts` → `packages/service/src/core/modules/index.test.ts`
- Move: `packages/service/src/core/events.ts` → `packages/service/src/core/events/index.ts`
- Move: `packages/service/src/core/events.test.ts` → `packages/service/src/core/events/index.test.ts`
- Move: `packages/service/src/core/processors.ts` → `packages/service/src/core/pipeline/index.ts`
- Move: `packages/service/src/core/processors.test.ts` → `packages/service/src/core/pipeline/index.test.ts`
- Move: `packages/service/src/core/kernel.ts` → `packages/service/src/core/lifecycle/kernel.ts`
- Move: `packages/service/src/core/kernel.test.ts` → `packages/service/src/core/lifecycle/kernel.test.ts`
- Move: `packages/service/src/core/bootstrap.ts` → `packages/service/src/core/lifecycle/bootstrap.ts`
- Move: `packages/service/src/core/bootstrap.test.ts` → `packages/service/src/core/lifecycle/bootstrap.test.ts`
- Create: `packages/service/src/core/lifecycle/index.ts`
- Modify: `packages/service/src/core/index.ts`
- Modify: `packages/service/src/server.ts:18`
- Unchanged (stay at `core/` top level): `errors.ts`, `result.ts`, `graph.ts`, `tokens.ts`, `sdk.ts`, `sdk.test.ts`, `surface.ts`, `contrib.ts`, `index.ts`, `hooks/registry.ts`, `hooks/routes.ts` (and their tests)

**Interfaces:**
- Consumes: nothing new — this task only changes file locations and import paths.
- Produces: nothing new — same exported symbols, same `core/index.ts`/`core/sdk.ts` public surface as Task 5 left it. `packages/service/src/core/lifecycle/index.ts` is a thin new barrel: `export * from './kernel.js'; export * from './bootstrap.js'`.

- [ ] **Step 1: Confirm no other file imports the files being moved by their old direct path**

```bash
grep -rn "core/container.js\|core/module.js\|core/events.js\|core/processors.js\|core/kernel.js\|core/bootstrap.js" packages/service/src --include="*.ts" | grep -v "^packages/service/src/core/"
```

Expected: only `packages/service/src/server.ts` matches, and only for `core/bootstrap.js` (line 18). Everything else (all `modules/*.ts`, `reverse-proxy/*.ts` etc.) imports via `core/index.js` or `core/tokens.js`, which are unaffected by the move. If this grep turns up any other direct-path importer, stop and add it to Step 4 below before proceeding.

- [ ] **Step 2: Move the files**

```bash
cd packages/service/src/core
mkdir -p container modules events pipeline lifecycle
git mv container.ts container/index.ts
git mv container.test.ts container/index.test.ts
git mv module.ts modules/index.ts
git mv module.test.ts modules/index.test.ts
git mv events.ts events/index.ts
git mv events.test.ts events/index.test.ts
git mv processors.ts pipeline/index.ts
git mv processors.test.ts pipeline/index.test.ts
git mv kernel.ts lifecycle/kernel.ts
git mv kernel.test.ts lifecycle/kernel.test.ts
git mv bootstrap.ts lifecycle/bootstrap.ts
git mv bootstrap.test.ts lifecycle/bootstrap.test.ts
```

- [ ] **Step 3: Fix internal import paths in the moved files**

In `core/container/index.ts`: change `from './errors.js'` to `from '../errors.js'`.
In `core/container/index.test.ts`: change `from './container.js'` to `from './index.js'`; change `from './errors.js'` to `from '../errors.js'`.

In `core/modules/index.ts`: change any `from './container.js'` to `from '../container/index.js'`; any `from './events.js'` to `from '../events/index.js'`; any `from './errors.js'` to `from '../errors.js'`.
In `core/modules/index.test.ts`: change `from './module.js'` to `from './index.js'`; adjust any other `./x.js` core-file imports the same way as above (`../errors.js`, etc).

In `core/events/index.test.ts`: change `from './events.js'` to `from './index.js'` (the source file itself, `core/events/index.ts`, has no internal core imports today, so it needs no path changes).

In `core/pipeline/index.ts`: change `from './hooks/registry.js'` to `from '../hooks/registry.js'`; change `from './result.js'` to `from '../result.js'`.
In `core/pipeline/index.test.ts`: change `from './processors.js'` to `from './index.js'`; change any `from './errors.js'` to `from '../errors.js'`.

In `core/lifecycle/kernel.ts`: change `from './container.js'` to `from '../container/index.js'`; `from './events.js'` to `from '../events/index.js'`; `from './graph.js'` to `from '../graph.js'`; `from './errors.js'` to `from '../errors.js'`; `from './module.js'` to `from '../modules/index.js'`.
In `core/lifecycle/kernel.test.ts`: same path fix-ups as above for whichever of these it imports directly, plus `from './kernel.js'` stays `from './kernel.js'` (same directory now).
In `core/lifecycle/bootstrap.ts`: change `from './module.js'` to `from '../modules/index.js'`; `from './kernel.js'` stays `from './kernel.js'` (same directory).
In `core/lifecycle/bootstrap.test.ts`: same path fix-ups, `from './bootstrap.js'` stays `from './bootstrap.js'`.

- [ ] **Step 4: Create the lifecycle barrel**

Create `packages/service/src/core/lifecycle/index.ts`:

```ts
export * from './kernel.js'
export * from './bootstrap.js'
```

- [ ] **Step 5: Update `core/index.ts`**

Replace `packages/service/src/core/index.ts` with (preserving whatever export ordering it already had for `errors.js`/`result.js`/`graph.js`/`hooks/*` from Task 5, just repointing the moved ones):

```ts
export * from './result.js'
export * from './errors.js'
export * from './graph.js'
export * from './container/index.js'
export * from './events/index.js'
export * from './modules/index.js'
export * from './pipeline/index.js'
export * from './lifecycle/index.js'
export * from './hooks/registry.js'
export * from './hooks/routes.js'
```

- [ ] **Step 6: Update `server.ts`'s one affected import**

In `packages/service/src/server.ts:18`, change:

```ts
import { buildKernel } from './core/bootstrap.js';
```

to:

```ts
import { buildKernel } from './core/lifecycle/bootstrap.js';
```

Leave lines 19-24 (module imports, `CONTRIB_MODULES` from `./core/contrib.js`, `Kernel` type from `./core/index.js`) untouched — `contrib.ts` and `index.ts` did not move.

- [ ] **Step 7: Run the full service test suite**

Run: `npx vitest run` (from `packages/service/`)
Expected: PASS, every test file in `packages/service/src` (including all moved ones, `sdk.test.ts`, `tokens`-consuming module tests, `server.ts`-adjacent tests) — 0 failures.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit` (from `packages/service/`, or the repo's configured typecheck script if one wraps this — check `packages/service/package.json` scripts for `typecheck`/`build` and use that if present)
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add -A packages/service/src/core packages/service/src/server.ts
git commit -m "refactor(core): reorganize core/ into container, modules, events, pipeline, lifecycle subfolders"
```

---

## Self-Review

**1. Spec coverage against the overview doc's Step 0 section:**
- `ServiceContainer.override()` → Task 1. ✅
- New `AlterableRegistry<T>` in `core/hooks/registry.ts`, replicating `orderedFor`'s scoped-ref-drop semantics → Task 2. ✅
- `ProcessorRegistry` re-based internally, signatures/shape frozen, all 6 existing tests pass unchanged → Task 3. ✅
- `RouteContribution` + route-registry factory in `core/hooks/routes.ts`, deliberately Fastify-agnostic (adoption deferred to the later `modules/api/` plan) → Task 4. ✅
- `sdk.ts` barrel extended with new symbols → Task 5. ✅
- Mechanical `core/` subfolder reorg with `errors.ts`/`result.ts`/`graph.ts`/`tokens.ts`/`sdk.ts`/`surface.ts`/`contrib.ts`/`index.ts` staying top-level → Task 6. ✅
- Event-wiring "adoption" (notifications/audit/logging pub-sub conversions) — explicitly out of scope for Step 0 per the overview doc (deferred to steps 10/11/13); no task in this plan touches `events.ts` behavior, only its file location. ✅ (correctly excluded, not a gap)
- Provider hook-based dispatch (`PROVIDER_REGISTRY` token) — explicitly out of scope for Step 0; it's sequencing step 4's own work, consuming `AlterableRegistry` built here. ✅ (correctly excluded, not a gap)

**2. Placeholder scan:** No "TBD"/"TODO"/"add appropriate X" in any step above; every step has runnable code or an exact shell command.

**3. Type consistency check across tasks:**
- `Contribution<T>` defined once in Task 2, reused as-is (not redefined) in Task 3's re-implementation and Task 4's `RouteContribution` usage.
- `AlterableRegistry<T>` constructed the same way (`new AlterableRegistry<T>()`) in Tasks 2, 3, 4, 5.
- `ProcessorRegistry<C>.contribute/orderedFor/runPhase` signatures identical before and after Task 3 (verified against the exact pre-existing code read from the file).
- `override(phase, id, alter)` on `ProcessorRegistry` (Task 3) vs. `override(id, alter)` on `AlterableRegistry` (Task 2) are deliberately different arities — `ProcessorRegistry` adds the `phase` parameter to route to the right per-phase sub-registry; this is documented in Task 3's Interfaces block, not an inconsistency.
- Import path rewrites in Task 6 were derived from the actual current file contents read earlier in this session (`container.ts` imports only `./errors.js`; `processors.ts` post-Task-3 imports `./hooks/registry.js` and `./result.js`; `kernel.ts` imports `./container.js`, `./events.js`, `./graph.js`, `./errors.js`, `./module.js`; `bootstrap.ts` imports `./module.js` and `./kernel.js`) — no invented import.

No gaps found. Plan ready.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-27-modular-step0-core-hooks.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Per your standing rule, actual execution does not start until you give separate explicit authorization — picking an approach here is not that authorization.
