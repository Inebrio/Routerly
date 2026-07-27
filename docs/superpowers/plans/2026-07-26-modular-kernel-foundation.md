# Modular Kernel Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dependency-free modular kernel (`packages/service/src/core/`) - DI container, module manifest + lifecycle, dependency graph with topological ordering, typed hierarchical event bus, and processor DAG - as isolated infrastructure that no existing code depends on yet.

**Architecture:** A `core/` package inside `packages/service/src` that provides the abstract lifecycle and composition primitives described in the 0.4.0 refactory notes. This plan builds ONLY the kernel mechanics with unit tests; it does NOT migrate any existing service behavior, does NOT wire real modules (routing, reverse-proxy, cache…), and does NOT touch `server.ts`, `routes/`, `llm/` or `routing/`. Those are later plans (see "Plan sequence" at the end). The kernel is decision-complete: the notes give concrete TS contracts for every piece here.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` import specifiers), Vitest, no new runtime dependencies (topological sort and wildcard matching are hand-rolled - stdlib only).

## Global Constraints

- **Module system:** NodeNext ESM. Every relative import MUST use a `.js` extension (e.g. `import { X } from './x.js'`). Node builtins use the `node:` prefix.
- **TypeScript:** `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride` all on. Optional object properties must be omitted, not set to `undefined`. Array/record index access returns `T | undefined` - narrow before use.
- **Tests:** Vitest. Test files are `*.test.ts` in the SAME directory as the source. Run per-file with `npx vitest run <path>` from `packages/service/`.
- **Coverage: NO coverage gate for this refactory phase.** The standing 98% repo threshold is explicitly waived here (owner decision, 2026-07-26). Write MINIMAL behavioral tests only: one happy-path assertion per exported function plus the error branches that a later module actually relies on. Do not chase line/branch coverage. Speed of execution and behavioral correctness take priority; deep verification is done by browser UAT + curl at integration time, not by unit coverage.
- **No new dependencies.** Do not add anything to `package.json`.
- **Scope fence:** create files only under `packages/service/src/core/`. Do NOT modify any existing file in this plan.
- **English only** for all code, comments, identifiers, and commit messages.
- **Wire-format transparency** is not exercised here (no request handling yet) but the primitives must not assume any payload mutation.

**All commands below run from `packages/service/`** unless stated otherwise.

---

### Task 1: Core result & error primitives

**Files:**
- Create: `packages/service/src/core/result.ts`
- Create: `packages/service/src/core/errors.ts`
- Test: `packages/service/src/core/errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ShortCircuit<R = unknown> = { readonly kind: 'short-circuit'; readonly result: R }`
  - `function shortCircuit<R>(result: R): ShortCircuit<R>`
  - `function isShortCircuit(value: unknown): value is ShortCircuit`
  - `class KernelError extends Error` with `readonly code: string`
  - `class ModuleGraphError extends KernelError` (code `'MODULE_GRAPH'`)
  - `class MissingDependencyError extends KernelError` (code `'MISSING_DEPENDENCY'`)
  - `class DependencyCycleError extends KernelError` (code `'DEPENDENCY_CYCLE'`, `readonly cycle: string[]`)

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/core/errors.test.ts
import { describe, it, expect } from 'vitest'
import { shortCircuit, isShortCircuit } from './result.js'
import {
  KernelError,
  ModuleGraphError,
  MissingDependencyError,
  DependencyCycleError,
} from './errors.js'

describe('result', () => {
  it('wraps a value in a short-circuit', () => {
    const sc = shortCircuit(42)
    expect(sc.kind).toBe('short-circuit')
    expect(sc.result).toBe(42)
  })

  it('recognizes a short-circuit and rejects other values', () => {
    expect(isShortCircuit(shortCircuit('x'))).toBe(true)
    expect(isShortCircuit(null)).toBe(false)
    expect(isShortCircuit({ kind: 'other' })).toBe(false)
    expect(isShortCircuit(42)).toBe(false)
  })
})

describe('errors', () => {
  it('KernelError carries a code and is an Error', () => {
    const e = new KernelError('boom', 'X')
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('X')
    expect(e.message).toBe('boom')
    expect(e.name).toBe('KernelError')
  })

  it('subclasses set their fixed codes and names', () => {
    expect(new ModuleGraphError('m').code).toBe('MODULE_GRAPH')
    expect(new ModuleGraphError('m').name).toBe('ModuleGraphError')
    expect(new MissingDependencyError('d').code).toBe('MISSING_DEPENDENCY')
    const cyc = new DependencyCycleError('c', ['a', 'b', 'a'])
    expect(cyc.code).toBe('DEPENDENCY_CYCLE')
    expect(cyc.cycle).toEqual(['a', 'b', 'a'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/errors.test.ts`
Expected: FAIL - cannot find module `./result.js` / `./errors.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/core/result.ts
export type ShortCircuit<R = unknown> = {
  readonly kind: 'short-circuit'
  readonly result: R
}

export function shortCircuit<R>(result: R): ShortCircuit<R> {
  return { kind: 'short-circuit', result }
}

export function isShortCircuit(value: unknown): value is ShortCircuit {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'short-circuit'
  )
}
```

```ts
// packages/service/src/core/errors.ts
export class KernelError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'KernelError'
    this.code = code
  }
}

export class ModuleGraphError extends KernelError {
  constructor(message: string) {
    super(message, 'MODULE_GRAPH')
    this.name = 'ModuleGraphError'
  }
}

export class MissingDependencyError extends KernelError {
  constructor(message: string) {
    super(message, 'MISSING_DEPENDENCY')
    this.name = 'MissingDependencyError'
  }
}

export class DependencyCycleError extends KernelError {
  readonly cycle: string[]
  constructor(message: string, cycle: string[]) {
    super(message, 'DEPENDENCY_CYCLE')
    this.name = 'DependencyCycleError'
    this.cycle = cycle
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/errors.test.ts`
Expected: PASS (2 + 2 assertions groups green).

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/result.ts packages/service/src/core/errors.ts packages/service/src/core/errors.test.ts
git commit -m "feat(core): result and kernel error primitives"
```

---

### Task 2: Typed service container (dependency injection)

**Files:**
- Create: `packages/service/src/core/container.ts`
- Test: `packages/service/src/core/container.test.ts`

**Interfaces:**
- Consumes: `MissingDependencyError` from `./errors.js` (Task 1).
- Produces:
  - `interface Token<T> { readonly key: string; readonly _type?: T }`
  - `function token<T>(key: string): Token<T>`
  - `class ServiceContainer` with:
    - `register<T>(token: Token<T>, value: T): void` - throws `KernelError` code `'DUPLICATE_SERVICE'` if the key is already registered
    - `has(token: Token<unknown>): boolean`
    - `resolve<T>(token: Token<T>): T` - throws `MissingDependencyError` if absent
    - `tryResolve<T>(token: Token<T>): T | undefined`

The `_type` phantom field on `Token` is never assigned at runtime; it only carries the type for `resolve`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/core/container.test.ts
import { describe, it, expect } from 'vitest'
import { ServiceContainer, token } from './container.js'
import { MissingDependencyError, KernelError } from './errors.js'

interface Clock {
  now(): number
}
const CLOCK = token<Clock>('clock')

describe('ServiceContainer', () => {
  it('registers and resolves a typed service', () => {
    const c = new ServiceContainer()
    c.register(CLOCK, { now: () => 7 })
    expect(c.resolve(CLOCK).now()).toBe(7)
    expect(c.has(CLOCK)).toBe(true)
  })

  it('throws MissingDependencyError on unknown token', () => {
    const c = new ServiceContainer()
    expect(c.has(CLOCK)).toBe(false)
    expect(() => c.resolve(CLOCK)).toThrow(MissingDependencyError)
    expect(c.tryResolve(CLOCK)).toBeUndefined()
  })

  it('rejects duplicate registration of the same key', () => {
    const c = new ServiceContainer()
    c.register(CLOCK, { now: () => 1 })
    expect(() => c.register(CLOCK, { now: () => 2 })).toThrow(KernelError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/container.test.ts`
Expected: FAIL - cannot find module `./container.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/core/container.ts
import { KernelError, MissingDependencyError } from './errors.js'

export interface Token<T> {
  readonly key: string
  readonly _type?: T
}

export function token<T>(key: string): Token<T> {
  return { key }
}

export class ServiceContainer {
  private readonly services = new Map<string, unknown>()

  register<T>(t: Token<T>, value: T): void {
    if (this.services.has(t.key)) {
      throw new KernelError(`service already registered: ${t.key}`, 'DUPLICATE_SERVICE')
    }
    this.services.set(t.key, value)
  }

  has(t: Token<unknown>): boolean {
    return this.services.has(t.key)
  }

  tryResolve<T>(t: Token<T>): T | undefined {
    return this.services.get(t.key) as T | undefined
  }

  resolve<T>(t: Token<T>): T {
    if (!this.services.has(t.key)) {
      throw new MissingDependencyError(`service not registered: ${t.key}`)
    }
    return this.services.get(t.key) as T
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/container.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/container.ts packages/service/src/core/container.test.ts
git commit -m "feat(core): typed service container"
```

---

### Task 3: Dependency graph - topological sort with cycle & missing-node detection

**Files:**
- Create: `packages/service/src/core/graph.ts`
- Test: `packages/service/src/core/graph.test.ts`

**Interfaces:**
- Consumes: `DependencyCycleError`, `MissingDependencyError` from `./errors.js`.
- Produces:
  - `interface GraphNode { readonly id: string; readonly dependsOn?: readonly string[]; readonly before?: readonly string[]; readonly after?: readonly string[]; readonly weight?: number }`
  - `function topologicalSort(nodes: readonly GraphNode[]): string[]`
    - Edges: for a node N, `dependsOn` + `after` mean "N runs after those"; `before` means "N runs before those" (an inbound edge on the referenced node). Ordering is stable: among nodes with no remaining constraints, lower `weight` first (default weight 0), then insertion order as final tiebreak.
    - Throws `MissingDependencyError` if any `dependsOn` / `before` / `after` names an unknown id.
    - Throws `DependencyCycleError` (with the offending `cycle`) if the graph is cyclic.

This is Kahn's algorithm with a weight-aware ready-set. Hand-rolled - no library.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/core/graph.test.ts
import { describe, it, expect } from 'vitest'
import { topologicalSort } from './graph.js'
import { DependencyCycleError, MissingDependencyError } from './errors.js'

describe('topologicalSort', () => {
  it('orders by dependsOn', () => {
    const order = topologicalSort([
      { id: 'b', dependsOn: ['a'] },
      { id: 'a' },
      { id: 'c', dependsOn: ['b'] },
    ])
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('honors before/after relations', () => {
    const order = topologicalSort([
      { id: 'policy', after: ['candidates'] },
      { id: 'candidates' },
      { id: 'budget', before: ['policy'], after: ['candidates'] },
    ])
    expect(order.indexOf('candidates')).toBeLessThan(order.indexOf('budget'))
    expect(order.indexOf('budget')).toBeLessThan(order.indexOf('policy'))
  })

  it('uses weight as a stable tiebreak among ready nodes', () => {
    const order = topologicalSort([
      { id: 'late', weight: 10 },
      { id: 'early', weight: -10 },
      { id: 'mid' },
    ])
    expect(order).toEqual(['early', 'mid', 'late'])
  })

  it('throws on an unknown referenced id', () => {
    expect(() => topologicalSort([{ id: 'a', dependsOn: ['ghost'] }])).toThrow(
      MissingDependencyError,
    )
  })

  it('throws DependencyCycleError with the cycle', () => {
    try {
      topologicalSort([
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['a'] },
      ])
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(DependencyCycleError)
      expect((e as DependencyCycleError).cycle.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/graph.test.ts`
Expected: FAIL - cannot find module `./graph.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/core/graph.ts
import { DependencyCycleError, MissingDependencyError } from './errors.js'

export interface GraphNode {
  readonly id: string
  readonly dependsOn?: readonly string[]
  readonly before?: readonly string[]
  readonly after?: readonly string[]
  readonly weight?: number
}

export function topologicalSort(nodes: readonly GraphNode[]): string[] {
  const ids = new Set(nodes.map((n) => n.id))
  const index = new Map<string, number>()
  const weight = new Map<string, number>()
  nodes.forEach((n, i) => {
    index.set(n.id, i)
    weight.set(n.id, n.weight ?? 0)
  })

  // edge from -> to means "from must run before to"
  const outgoing = new Map<string, Set<string>>()
  const indegree = new Map<string, number>()
  for (const id of ids) {
    outgoing.set(id, new Set())
    indegree.set(id, 0)
  }

  const addEdge = (from: string, to: string): void => {
    const outs = outgoing.get(from)!
    if (!outs.has(to)) {
      outs.add(to)
      indegree.set(to, (indegree.get(to) ?? 0) + 1)
    }
  }

  const requireKnown = (owner: string, ref: string): void => {
    if (!ids.has(ref)) {
      throw new MissingDependencyError(`node "${owner}" references unknown node "${ref}"`)
    }
  }

  for (const n of nodes) {
    for (const dep of n.dependsOn ?? []) {
      requireKnown(n.id, dep)
      addEdge(dep, n.id)
    }
    for (const a of n.after ?? []) {
      requireKnown(n.id, a)
      addEdge(a, n.id)
    }
    for (const b of n.before ?? []) {
      requireKnown(n.id, b)
      addEdge(n.id, b)
    }
  }

  const readyBetter = (a: string, b: string): number => {
    const wa = weight.get(a)!
    const wb = weight.get(b)!
    if (wa !== wb) return wa - wb
    return index.get(a)! - index.get(b)!
  }

  const ready: string[] = [...ids].filter((id) => (indegree.get(id) ?? 0) === 0)
  const order: string[] = []
  while (ready.length > 0) {
    ready.sort(readyBetter)
    const next = ready.shift()!
    order.push(next)
    for (const to of outgoing.get(next)!) {
      const d = (indegree.get(to) ?? 0) - 1
      indegree.set(to, d)
      if (d === 0) ready.push(to)
    }
  }

  if (order.length !== ids.size) {
    const remaining = [...ids].filter((id) => !order.includes(id))
    throw new DependencyCycleError(
      `dependency cycle among: ${remaining.join(', ')}`,
      remaining,
    )
  }
  return order
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/graph.test.ts`
Expected: PASS (5 groups green).

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/graph.ts packages/service/src/core/graph.test.ts
git commit -m "feat(core): dependency graph topological sort"
```

---

### Task 4: Hierarchical typed event bus with `*` / `**` wildcards

**Files:**
- Create: `packages/service/src/core/events.ts`
- Test: `packages/service/src/core/events.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `function topicMatches(pattern: string, topic: string): boolean` - segments split on `/`, leading slash normalized away, no trailing slash. `*` matches exactly one segment; `**` matches zero or more segments.
  - `type EventListener = (topic: string, payload: unknown) => void`
  - `class EventBus` with:
    - `subscribe(pattern: string, listener: EventListener): () => void` (returns an unsubscribe fn)
    - `publish(topic: string, payload?: unknown): void` - synchronous, best-effort in-process dispatch. A throwing listener MUST NOT stop other listeners; collected errors are reported to an optional `onListenerError` callback passed to the constructor.
    - `constructor(opts?: { onListenerError?: (err: unknown, topic: string) => void })`

> Delivery-guarantee decision for this plan: dispatch is **synchronous, in-process, best-effort** (the notes' default). Reliable/at-least-once delivery for billing-critical usage events is explicitly out of scope here and belongs to the usage-persistence module plan.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/core/events.test.ts
import { describe, it, expect, vi } from 'vitest'
import { EventBus, topicMatches } from './events.js'

describe('topicMatches', () => {
  it('matches exact topics and normalizes leading slash', () => {
    expect(topicMatches('/routing/started', 'routing/started')).toBe(true)
    expect(topicMatches('routing/started', '/routing/started')).toBe(true)
    expect(topicMatches('routing/started', 'routing/completed')).toBe(false)
  })

  it('* matches a single segment only', () => {
    expect(topicMatches('routing/*/failed', 'routing/policy/failed')).toBe(true)
    expect(topicMatches('routing/*/failed', 'routing/a/b/failed')).toBe(false)
    expect(topicMatches('routing/*/failed', 'routing/failed')).toBe(false)
  })

  it('** matches zero or more segments', () => {
    expect(topicMatches('routing/**', 'routing')).toBe(true)
    expect(topicMatches('routing/**', 'routing/policy/cheapest/completed')).toBe(true)
    expect(topicMatches('**/failed', 'a/b/failed')).toBe(true)
    expect(topicMatches('**/failed', 'ok')).toBe(false)
  })
})

describe('EventBus', () => {
  it('delivers to matching subscribers only', () => {
    const bus = new EventBus()
    const hits: string[] = []
    bus.subscribe('routing/**', (t) => hits.push(t))
    bus.subscribe('upstream/**', (t) => hits.push(`u:${t}`))
    bus.publish('routing/completed', { ok: true })
    expect(hits).toEqual(['routing/completed'])
  })

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus()
    const fn = vi.fn()
    const off = bus.subscribe('a/**', fn)
    bus.publish('a/x')
    off()
    bus.publish('a/y')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('isolates a throwing listener and reports the error', () => {
    const onListenerError = vi.fn()
    const bus = new EventBus({ onListenerError })
    const good = vi.fn()
    bus.subscribe('t/**', () => {
      throw new Error('bad')
    })
    bus.subscribe('t/**', good)
    bus.publish('t/x')
    expect(good).toHaveBeenCalledTimes(1)
    expect(onListenerError).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/events.test.ts`
Expected: FAIL - cannot find module `./events.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/core/events.ts
export type EventListener = (topic: string, payload: unknown) => void

const segments = (s: string): string[] => s.split('/').filter((p) => p.length > 0)

export function topicMatches(pattern: string, topic: string): boolean {
  const p = segments(pattern)
  const t = segments(topic)
  // dp over (pattern index, topic index)
  const match = (pi: number, ti: number): boolean => {
    if (pi === p.length) return ti === t.length
    const seg = p[pi]!
    if (seg === '**') {
      // consume zero or more topic segments
      for (let k = ti; k <= t.length; k++) {
        if (match(pi + 1, k)) return true
      }
      return false
    }
    if (ti === t.length) return false
    if (seg === '*' || seg === t[ti]) return match(pi + 1, ti + 1)
    return false
  }
  return match(0, 0)
}

interface Subscription {
  pattern: string
  listener: EventListener
}

export class EventBus {
  private readonly subs = new Set<Subscription>()
  private readonly onListenerError?: (err: unknown, topic: string) => void

  constructor(opts?: { onListenerError?: (err: unknown, topic: string) => void }) {
    if (opts?.onListenerError) this.onListenerError = opts.onListenerError
  }

  subscribe(pattern: string, listener: EventListener): () => void {
    const sub: Subscription = { pattern, listener }
    this.subs.add(sub)
    return () => {
      this.subs.delete(sub)
    }
  }

  publish(topic: string, payload?: unknown): void {
    for (const sub of this.subs) {
      if (!topicMatches(sub.pattern, topic)) continue
      try {
        sub.listener(topic, payload)
      } catch (err) {
        this.onListenerError?.(err, topic)
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/events.ts packages/service/src/core/events.test.ts
git commit -m "feat(core): hierarchical wildcard event bus"
```

---

### Task 5: Module manifest, `defineModule`, and lifecycle contracts

**Files:**
- Create: `packages/service/src/core/module.ts`
- Test: `packages/service/src/core/module.test.ts`

**Interfaces:**
- Consumes: `ServiceContainer` from `./container.js`, `EventBus` from `./events.js`.
- Produces:
  - `interface ModuleManifest { id: string; version: string; dependsOn?: Record<string, string>; before?: string[]; after?: string[]; weight?: number }`
  - `interface ModuleRegistry { container: ServiceContainer; events: EventBus }` (the surface passed to `register`; extended by later plans)
  - `interface RouterlyModule { manifest: ModuleManifest; register(registry: ModuleRegistry): void | Promise<void>; start?(runtime: Runtime): void | Promise<void>; stop?(): void | Promise<void> }`
  - `interface Runtime { container: ServiceContainer; events: EventBus }`
  - `function defineModule(mod: RouterlyModule): RouterlyModule` (identity helper that also validates `manifest.id` and `manifest.version` are non-empty, throwing `KernelError` code `'INVALID_MANIFEST'` otherwise)

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/core/module.test.ts
import { describe, it, expect } from 'vitest'
import { defineModule } from './module.js'
import { KernelError } from './errors.js'

describe('defineModule', () => {
  it('returns the module unchanged when the manifest is valid', () => {
    const mod = defineModule({
      manifest: { id: 'routing', version: '1.0.0' },
      register() {},
    })
    expect(mod.manifest.id).toBe('routing')
  })

  it('throws on an empty id or version', () => {
    expect(() =>
      defineModule({ manifest: { id: '', version: '1.0.0' }, register() {} }),
    ).toThrow(KernelError)
    expect(() =>
      defineModule({ manifest: { id: 'x', version: '' }, register() {} }),
    ).toThrow(KernelError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/module.test.ts`
Expected: FAIL - cannot find module `./module.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/core/module.ts
import type { ServiceContainer } from './container.js'
import type { EventBus } from './events.js'
import { KernelError } from './errors.js'

export interface ModuleManifest {
  id: string
  version: string
  dependsOn?: Record<string, string>
  before?: string[]
  after?: string[]
  weight?: number
}

export interface ModuleRegistry {
  container: ServiceContainer
  events: EventBus
}

export interface Runtime {
  container: ServiceContainer
  events: EventBus
}

export interface RouterlyModule {
  manifest: ModuleManifest
  register(registry: ModuleRegistry): void | Promise<void>
  start?(runtime: Runtime): void | Promise<void>
  stop?(): void | Promise<void>
}

export function defineModule(mod: RouterlyModule): RouterlyModule {
  if (!mod.manifest.id) {
    throw new KernelError('module manifest id must be non-empty', 'INVALID_MANIFEST')
  }
  if (!mod.manifest.version) {
    throw new KernelError('module manifest version must be non-empty', 'INVALID_MANIFEST')
  }
  return mod
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/module.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/module.ts packages/service/src/core/module.test.ts
git commit -m "feat(core): module manifest and defineModule"
```

---

### Task 6: Kernel - load, order, register, start, stop modules

**Files:**
- Create: `packages/service/src/core/kernel.ts`
- Test: `packages/service/src/core/kernel.test.ts`

**Interfaces:**
- Consumes: `topologicalSort` + `GraphNode` from `./graph.js`, `ServiceContainer` from `./container.js`, `EventBus` from `./events.js`, `RouterlyModule` from `./module.js`, `ModuleGraphError` from `./errors.js`.
- Produces:
  - `class Kernel` with:
    - `constructor(modules: readonly RouterlyModule[])`
    - `readonly container: ServiceContainer`
    - `readonly events: EventBus`
    - `async start(): Promise<void>` - validates unique ids (throws `ModuleGraphError` on duplicate), builds `GraphNode[]` from each manifest's `dependsOn` (keys) + `before` + `after` + `weight`, topologically sorts, calls every `register` in order, then every `start` in order. Verifies each manifest `dependsOn` id is present (throws `MissingDependencyError` if a declared module dependency id is not in the set).
    - `async stop(): Promise<void>` - calls `stop` in REVERSE start order; a throwing `stop` is caught and does not prevent stopping the rest.
    - `readonly startedOrder: readonly string[]` (populated after `start`, for assertions)

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/core/kernel.test.ts
import { describe, it, expect } from 'vitest'
import { Kernel } from './kernel.js'
import { defineModule } from './module.js'
import { ModuleGraphError, MissingDependencyError } from './errors.js'

const trace = (log: string[], id: string) =>
  defineModule({
    manifest: { id, version: '1.0.0' },
    register() {
      log.push(`register:${id}`)
    },
    start() {
      log.push(`start:${id}`)
    },
    stop() {
      log.push(`stop:${id}`)
    },
  })

describe('Kernel', () => {
  it('registers then starts modules in dependency order', async () => {
    const log: string[] = []
    const a = trace(log, 'a')
    const b = defineModule({
      manifest: { id: 'b', version: '1.0.0', dependsOn: { a: '^1.0.0' } },
      register() {
        log.push('register:b')
      },
      start() {
        log.push('start:b')
      },
    })
    const k = new Kernel([b, a])
    await k.start()
    expect(k.startedOrder).toEqual(['a', 'b'])
    expect(log).toEqual(['register:a', 'register:b', 'start:a', 'start:b'])
  })

  it('stops modules in reverse start order', async () => {
    const log: string[] = []
    const k = new Kernel([trace(log, 'a'), trace(log, 'b')])
    await k.start()
    log.length = 0
    await k.stop()
    expect(log).toEqual(['stop:b', 'stop:a'])
  })

  it('rejects duplicate module ids', async () => {
    const k = new Kernel([
      defineModule({ manifest: { id: 'dup', version: '1.0.0' }, register() {} }),
      defineModule({ manifest: { id: 'dup', version: '2.0.0' }, register() {} }),
    ])
    await expect(k.start()).rejects.toThrow(ModuleGraphError)
  })

  it('rejects a missing declared dependency', async () => {
    const k = new Kernel([
      defineModule({
        manifest: { id: 'x', version: '1.0.0', dependsOn: { ghost: '^1.0.0' } },
        register() {},
      }),
    ])
    await expect(k.start()).rejects.toThrow(MissingDependencyError)
  })

  it('continues stopping when a stop handler throws', async () => {
    const log: string[] = []
    const boom = defineModule({
      manifest: { id: 'boom', version: '1.0.0' },
      register() {},
      stop() {
        throw new Error('nope')
      },
    })
    const k = new Kernel([trace(log, 'a'), boom])
    await k.start()
    log.length = 0
    await k.stop()
    expect(log).toEqual(['stop:a'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/kernel.test.ts`
Expected: FAIL - cannot find module `./kernel.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/core/kernel.ts
import { ServiceContainer } from './container.js'
import { EventBus } from './events.js'
import { topologicalSort, type GraphNode } from './graph.js'
import { ModuleGraphError, MissingDependencyError } from './errors.js'
import type { RouterlyModule } from './module.js'

export class Kernel {
  readonly container = new ServiceContainer()
  readonly events = new EventBus()
  private readonly modules: readonly RouterlyModule[]
  private started: string[] = []

  constructor(modules: readonly RouterlyModule[]) {
    this.modules = modules
  }

  get startedOrder(): readonly string[] {
    return this.started
  }

  async start(): Promise<void> {
    const byId = new Map<string, RouterlyModule>()
    for (const mod of this.modules) {
      if (byId.has(mod.manifest.id)) {
        throw new ModuleGraphError(`duplicate module id: ${mod.manifest.id}`)
      }
      byId.set(mod.manifest.id, mod)
    }

    for (const mod of this.modules) {
      for (const dep of Object.keys(mod.manifest.dependsOn ?? {})) {
        if (!byId.has(dep)) {
          throw new MissingDependencyError(
            `module "${mod.manifest.id}" depends on missing module "${dep}"`,
          )
        }
      }
    }

    const nodes: GraphNode[] = this.modules.map((m) => ({
      id: m.manifest.id,
      dependsOn: Object.keys(m.manifest.dependsOn ?? {}),
      before: m.manifest.before ?? [],
      after: m.manifest.after ?? [],
      weight: m.manifest.weight ?? 0,
    }))

    const order = topologicalSort(nodes)
    const ordered = order.map((id) => byId.get(id)!)

    for (const mod of ordered) {
      await mod.register({ container: this.container, events: this.events })
    }
    for (const mod of ordered) {
      await mod.start?.({ container: this.container, events: this.events })
      this.started.push(mod.manifest.id)
    }
  }

  async stop(): Promise<void> {
    const byId = new Map(this.modules.map((m) => [m.manifest.id, m]))
    for (const id of [...this.started].reverse()) {
      const mod = byId.get(id)
      try {
        await mod?.stop?.()
      } catch {
        // stop is best-effort; a failing module must not block the rest
      }
    }
    this.started = []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/kernel.test.ts`
Expected: PASS (5 groups green).

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/kernel.ts packages/service/src/core/kernel.test.ts
git commit -m "feat(core): module kernel lifecycle runner"
```

---

### Task 7: Processor DAG for named pipeline phases

**Files:**
- Create: `packages/service/src/core/processors.ts`
- Test: `packages/service/src/core/processors.test.ts`

**Interfaces:**
- Consumes: `topologicalSort` from `./graph.js`.
- Produces:
  - `interface Processor<C> { id: string; phase: string; before?: string[]; after?: string[]; weight?: number; run(context: C): void | Promise<void> }`
  - `class ProcessorRegistry<C>` with:
    - `contribute(p: Processor<C>): void`
    - `orderedFor(phase: string): Processor<C>[]` - returns the processors registered for `phase`, ordered by `topologicalSort` over their `before`/`after`/`weight` (references scoped to the same phase; a cross-phase `before`/`after` id is ignored, not an error).
    - `async runPhase(phase: string, context: C): Promise<void>` - runs each processor in order; `run` is awaited sequentially.

Parallel processors are explicitly out of scope for this plan (the notes leave the artifact-reduction contract open). Sequential ordering only here.

- [ ] **Step 1: Write the failing test**

```ts
// packages/service/src/core/processors.test.ts
import { describe, it, expect } from 'vitest'
import { ProcessorRegistry, type Processor } from './processors.js'

interface Ctx {
  trail: string[]
}

const step = (id: string, phase: string, rel: Partial<Processor<Ctx>> = {}): Processor<Ctx> => ({
  id,
  phase,
  run(c) {
    c.trail.push(id)
  },
  ...rel,
})

describe('ProcessorRegistry', () => {
  it('orders processors within a phase by before/after', async () => {
    const reg = new ProcessorRegistry<Ctx>()
    reg.contribute(step('policies', 'routing', { after: ['candidates'] }))
    reg.contribute(step('candidates', 'routing'))
    reg.contribute(step('budget', 'routing', { after: ['candidates'], before: ['policies'] }))
    const ctx: Ctx = { trail: [] }
    await reg.runPhase('routing', ctx)
    expect(ctx.trail).toEqual(['candidates', 'budget', 'policies'])
  })

  it('runs only the processors of the requested phase', async () => {
    const reg = new ProcessorRegistry<Ctx>()
    reg.contribute(step('a', 'ingress'))
    reg.contribute(step('b', 'egress'))
    const ctx: Ctx = { trail: [] }
    await reg.runPhase('ingress', ctx)
    expect(ctx.trail).toEqual(['a'])
  })

  it('ignores cross-phase ordering references', () => {
    const reg = new ProcessorRegistry<Ctx>()
    reg.contribute(step('a', 'ingress', { after: ['b-in-other-phase'] }))
    expect(reg.orderedFor('ingress').map((p) => p.id)).toEqual(['a'])
  })

  it('returns empty for an unknown phase', async () => {
    const reg = new ProcessorRegistry<Ctx>()
    const ctx: Ctx = { trail: [] }
    await reg.runPhase('nope', ctx)
    expect(ctx.trail).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/processors.test.ts`
Expected: FAIL - cannot find module `./processors.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/service/src/core/processors.ts
import { topologicalSort, type GraphNode } from './graph.js'

export interface Processor<C> {
  id: string
  phase: string
  before?: string[]
  after?: string[]
  weight?: number
  run(context: C): void | Promise<void>
}

export class ProcessorRegistry<C> {
  private readonly byPhase = new Map<string, Processor<C>[]>()

  contribute(p: Processor<C>): void {
    const list = this.byPhase.get(p.phase) ?? []
    list.push(p)
    this.byPhase.set(p.phase, list)
  }

  orderedFor(phase: string): Processor<C>[] {
    const list = this.byPhase.get(phase) ?? []
    const ids = new Set(list.map((p) => p.id))
    const scoped = (refs: string[] | undefined): string[] =>
      (refs ?? []).filter((r) => ids.has(r))
    const nodes: GraphNode[] = list.map((p) => ({
      id: p.id,
      before: scoped(p.before),
      after: scoped(p.after),
      weight: p.weight ?? 0,
    }))
    const order = topologicalSort(nodes)
    const index = new Map(list.map((p) => [p.id, p]))
    return order.map((id) => index.get(id)!)
  }

  async runPhase(phase: string, context: C): Promise<void> {
    for (const p of this.orderedFor(phase)) {
      await p.run(context)
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/processors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/processors.ts packages/service/src/core/processors.test.ts
git commit -m "feat(core): phase-scoped processor DAG"
```

---

### Task 8: Public barrel export + full-suite green

**Files:**
- Create: `packages/service/src/core/index.ts`
- Test: (no new test file; this task verifies the whole `core/` suite and coverage)

**Interfaces:**
- Consumes: every `core/*` module built above.
- Produces: `packages/service/src/core/index.ts` re-exporting the public surface (`ServiceContainer`, `token`, `Token`, `EventBus`, `topicMatches`, `Kernel`, `defineModule`, `ProcessorRegistry`, `topologicalSort`, all error classes, `shortCircuit`, `isShortCircuit`, and the module/processor types). This is the single import point later plans and future `@routerly/core` extraction will use.

- [ ] **Step 1: Write the barrel export**

```ts
// packages/service/src/core/index.ts
export * from './result.js'
export * from './errors.js'
export * from './container.js'
export * from './graph.js'
export * from './events.js'
export * from './module.js'
export * from './kernel.js'
export * from './processors.js'
```

- [ ] **Step 2: Typecheck the package**

Run: `npm run typecheck`
Expected: exit 0, no errors. (Catches any `exactOptionalPropertyTypes` / `noUncheckedIndexedAccess` violation across `core/`.)

- [ ] **Step 3: Run the full core suite**

Run: `npx vitest run src/core`
Expected: all `core/*.test.ts` green. Do NOT run `--coverage` and do NOT gate on a coverage percentage (waived for this phase). Only requirement: every test file passes.

- [ ] **Step 4: Run the entire service test suite (no regressions)**

Run: `npm test`
Expected: previously-passing suites still green (this plan added files only; it modified nothing existing).

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/index.ts
git commit -m "feat(core): public barrel export for modular kernel"
```

---

## Self-review notes

- **Spec coverage (this plan's slice):** DI container (Kernel modulare §DI) → Task 2. Dependency graph + topological order + `weight` tiebreak + cycle/missing errors (Kernel modulare §Moduli, Ristrutturazione §Moduli) → Tasks 3, 6. Typed event bus with `/`, `*`, `**` (Kernel modulare §Topic gerarchici) → Task 4. Module manifest + `register`/`start`/`stop` lifecycle (Ristrutturazione §Moduli) → Tasks 5, 6. Processor DAG per phase (Kernel modulare §Processor) → Task 7. `ShortCircuit` primitive (Ristrutturazione §Hook, cache short-circuit) → Task 1.
- **Deliberately deferred (needs decisions - see plan sequence below):** parallel processors + artifact reduction; reliable event delivery for billing-critical usage; the closed-phase-list-vs-DAG question; `ProxyContext` shape; capability/token contribution model beyond DI; contrib npm SDK surface.
- **Type consistency:** `GraphNode` is the single ordering contract consumed by both `Kernel` (Task 6) and `ProcessorRegistry` (Task 7). `Token<T>`/`token` naming consistent across Tasks 2, 8. `ModuleRegistry`/`Runtime` both `{ container, events }` in Tasks 5, 6.

---

## Plan sequence (this is Plan 1 of 6)

Open questions are now LOCKED (owner decisions, see `2026-07-26-refactory-roadmap.md` §Locked decisions). All six plans are written and placeholder-free. Strangler-fig ordering: the live service stays green at every commit; each plan swaps one seam and leaves the wire format byte-identical.

| # | Plan file | Deliverable |
|---|-----------|-------------|
| 1 | `2026-07-26-modular-kernel-foundation.md` (this doc) | `core/` primitives - additive, nothing wired |
| 2 | `2026-07-26-kernel-bootstrap-config-module.md` | Kernel boots inside `server.ts`; config wrapped as first module; routes untouched |
| 3 | `2026-07-26-provider-model-module.md` | `getProviderAdapter` behind a provider-registry module; frozen `ProviderAdapter` contract |
| 4 | `2026-07-26-reverse-proxy-pipeline.md` | Phase pipeline + `ProxyContext`; OpenAI/Anthropic routes delegate 1:1; wire byte-identical |
| 5 | `2026-07-26-core-modules-extraction.md` | routing, cache, budget, usage, logging as modules contributing processors |
| 6 | `2026-07-26-contrib-surfaces-predisposition.md` | Public module SDK export + contract stubs; NO runtime loading, NO behavior change |

**Plan complete and saved to `docs/superpowers/plans/2026-07-26-modular-kernel-foundation.md`.**
