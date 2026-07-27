# Modular Restructure (core/lib/modules, hook-based) — Overview & Sequencing

> **For agentic workers:** This is a sequencing/design document, not an execution plan. It maps the full scope, defines the target tree, and lists the per-area execution plans still to be written (each following the strict `superpowers:writing-plans` task template before it is executed). Do not execute against this document directly.

**Goal:** Finish the modularization the KB's `Kernel modulare.md` / `Ristrutturazione del service.md` (2026-07-24, "Direzione emersa") originally proposed but the 0.4.0 refactory intentionally scoped down (Decision #13, ownership-split). Legacy technical-layer directories dissolve; every functional area — including the HTTP surfaces themselves — becomes an atomic module with a manifest, living behind hooks other modules can extend or override. `lib/` holds only what `core/` and modules share at the lowest level, nothing domain-specific.

**Why this diverges from 0.4.0 as merged:** 0.4.0 built the kernel, the phase pipeline, and thin per-concern modules that *wrap* legacy directories via DI tokens without moving logic or exposing override points, and left `routes/` outside the module system entirely. That was deliberate risk-scoping for 0.4.0. This restructure finishes the move and adds the piece 0.4.0 didn't build: a real hook/override primitive, so modules genuinely extend or override each other's behavior (Drupal-style), not just sit in DI + ordered-pipeline.

**Constraints carried over, unchanged:** wire-format transparency ABSOLUTE, feature-parity ABSOLUTE, public contracts frozen (`/api/*`, `@routerly/shared`, frozen kernel API/tokens/`ProxyContext`), same branch/worktree (`refactory/0.4.0-modular-kernel`, `.worktrees/refactory-0.4.0`), continuing before merge, one execution plan per functional area.

## Confirmed decisions (this session)

- **`core`**: application lifecycle only, nothing domain-specific. Gets internal subfolders per the KB's own tree: `container/` (DI), `modules/` (manifest/graph/defineModule), `events/` (EventBus), `hooks/` (NEW — override/alter/route-contribution primitives), `pipeline/` (ProcessorRegistry), `lifecycle/` (Kernel, bootstrap glue, errors, result).
- **`lib`**: only primitives serving `core` itself or shared by multiple modules at the lowest level — no domain logic, ever. Narrower than a general "pure utils" bucket.
- **`modules`**: characterize system behavior. Work via DI + hooks: a module adds a capability; another module can **extend** (wrap, run alongside) or **override** (replace) it. `reverse-proxy`, `api`, `api-reverse-proxy`, `auth`, `routing`, etc. are all modules, no exceptions — including the HTTP surfaces (`routes/` dissolves into `modules/api/` and `modules/api-reverse-proxy/`).
- **Metamodules**: no logic, declare only a bundle of module dependencies to install/enable together (`type: meta`). Used with extreme caution, per KB `Superfici e metamoduli.md`. Not built in this pass — noted as a future capability the module manifest shape must not block.
- **`reverse-proxy` / `api-reverse-proxy` / `api` are 3 separate modules**:
  - `modules/reverse-proxy/` — the pipeline *mechanism*: phases, `ProxyContext`, `run.ts`, `helpers.ts`, and `execute.ts` (absorbs today's `llm/executor.ts` — confirmed by grep as reverse-proxy's de facto per-lane upstream-call implementation already). No Fastify registration here.
  - `modules/api-reverse-proxy/` — the OpenAI/Anthropic-*compatible* endpoints (`routes/openai.ts`, `routes/anthropic.ts`, `routes/passthrough.ts`). Depends on and drives `reverse-proxy`.
  - `modules/api/` — Routerly's own admin/management REST API (`routes/api.ts`). Exposes a route-contribution hook so other modules (notifications, audit, ...) can add endpoints without touching `modules/api/` source.
- **`bootstrap/`** — new top-level dir, matches KB tree exactly. Extracts the module-array assembly + `buildKernel()` call out of `server.ts`.

---

## Step 0 (new, foundational): the 3 module mechanisms in `core`

Modules interact through three distinct mechanisms — confirmed this session, one of the three (events) already exists and just needs wiring in, the other two are gaps:

1. **OOP** — `defineModule`, `ModuleManifest`, `register/start/stop`. Already built (0.4.0). Unchanged.
2. **Hooks (override/extend)** — a module replaces or wraps a *specific* thing another module owns (a service, a processor, a route). **Gap — does not exist today.**
3. **Events** — a module publishes to a path-style channel; any number of unrelated modules subscribe, including via wildcard, without the publisher knowing who's listening. **Already built** (`core/events.ts` — confirmed via read: `EventBus.subscribe(pattern, listener): unsubscribe`, `publish(topic, payload)`, `topicMatches` supports `*` = one segment, `**` = zero-or-more segments, listener errors isolated via `onListenerError`). Not a gap in the kernel — a gap in adoption: no module resolves `EventBus` today. `modules/logging.ts` and `modules/usage.ts` currently wire everything through direct DI + processor contribution, even for the fan-out cases (notifications, logging, audit) that events model better.

This is a **kernel capability gap only for #2** — discovered while grounding the module design against the KB. Today:
- `ServiceContainer.register()` (`core/container.ts:15`) throws on a duplicate token — no override.
- `ProcessorRegistry` (`core/processors.ts`) only orders and runs; a full `ShortCircuit` skips the rest of a phase, but there's no way for one module to replace or wrap a *specific* processor or service owned by another module.
- Nothing lets a module contribute a route to another module's HTTP surface.

Every module from Step 1 onward depends on all three existing first. Concrete design for #2 (the actual gap), ready for the detailed task plan:

**1. Service override — extend `core/container.ts`:**
```ts
override<T>(t: Token<T>, decorate: (previous: T) => T): void
```
Requires the base token already registered (`MissingDependencyError` otherwise); applies `decorate` to the currently-resolved value and re-registers the result under the same token. Multiple `override()` calls compose in registration order (last-registered decorator wraps outermost). "Extend" = decorator that calls through to `previous`; "override" = decorator that ignores `previous` and returns something new — both are the same mechanism, the module author's choice is just what the function body does.

**2. Generic alterable registry — new `core/hooks/registry.ts`:**
```ts
export interface Contribution<T> {
  id: string
  before?: string[]
  after?: string[]
  weight?: number
  value: T
}
export class AlterableRegistry<T> {
  contribute(c: Contribution<T>): void        // add a new entry
  override(id: string, alter: (previous: T) => T): void   // wrap/replace an existing entry's value by id
  ordered(): T[]                               // topological order, same semantics as ProcessorRegistry (reuses core/graph.ts)
}
```
This is the one new core primitive. It generalizes what `ProcessorRegistry` already does (ordered contribution) and adds the missing `override(id, alter)` — reused for both processors and routes rather than inventing a second ordering mechanism. `ProcessorRegistry` becomes a thin specialization of `AlterableRegistry<Processor<C>>` scoped per phase (no behavior change to existing processor contracts — `contribute`/`orderedFor`/`runPhase` keep their exact current signatures, `orderedFor` calls into the shared `AlterableRegistry` under the hood).

**3. Route contribution — used by `modules/api/` and `modules/api-reverse-proxy/`:**
```ts
export interface RouteContribution {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  url: string
  handler: RouteHandlerMethod  // Fastify's type, unchanged
}
```
Each of `modules/api/` and `modules/api-reverse-proxy/` registers its own `AlterableRegistry<RouteContribution>` behind its own DI token (`API_ROUTES`, `API_REVERSE_PROXY_ROUTES`) at `register()`, applies contributed routes to the Fastify instance at `start()`. Any module can resolve that token in its own `register()` and call `.contribute(...)` to add an endpoint, or `.override(id, ...)` to wrap/replace an existing one — this is the concrete mechanism behind "routes è un modulo che viene esteso da chi ha bisogno tramite hook".

**4. Event wiring — no new core code, adoption only:**
`EventBus` is already resolvable via DI (confirmed token exists in `core/tokens.ts` from the 0.4.0 kernel). Step 0's task list adds: publish calls at the natural points in `modules/reverse-proxy/` (e.g. `request/completed`, `request/blocked`, topic segments matching the domain, not HTTP verbs), and converts the fan-out consumers — `modules/notifications/`, `modules/audit/`, parts of `modules/logging/` — from direct processor/DI wiring to `EventBus.subscribe('request/**', ...)`-style subscriptions where the pattern is genuinely "N independent listeners, no ordering dependency between them," which is what `notifications`+`audit`+`logging` all are today (three separate processors that currently have to know about each other's existence only via phase ordering, when they actually don't depend on each other at all). Where order or short-circuit *is* required (e.g. guardrails blocking a request before it reaches the provider), that stays on `ProcessorRegistry` — events are for the cases that don't need it.

**Compatibility check:** `ProcessorRegistry`'s public shape (`contribute`, `orderedFor`, `runPhase`) is part of the frozen 0.4.0 kernel API (roadmap-locked). Re-basing it onto `AlterableRegistry` internally must not change any of those three signatures or `Processor<C>`'s shape — verified in the detailed plan's task list via the existing `processors.test.ts` suite passing unchanged, plus new tests for the added `override()` path. `EventBus`'s public shape (`subscribe`, `publish`) is equally frozen (0.4.0 kernel API) and gets zero changes — only new callers.

---

## Target tree

```text
packages/service/src/
├── core/
│   ├── container/       # ServiceContainer, Token, token(), override()
│   ├── modules/         # ModuleManifest, RouterlyModule, defineModule, graph.ts (topologicalSort)
│   ├── events/          # EventBus, topicMatches
│   ├── hooks/           # NEW — AlterableRegistry<T>, RouteContribution
│   ├── pipeline/        # ProcessorRegistry, Processor<C> (re-based on AlterableRegistry)
│   ├── lifecycle/       # Kernel, bootstrap.ts, errors.ts, result.ts
│   ├── sdk.ts            # unchanged — public authoring barrel
│   ├── surface.ts        # unchanged — types-only contract
│   ├── contrib.ts        # unchanged — empty seam
│   └── index.ts          # unchanged — barrel, re-exports from the new subfolders
├── lib/
│   ├── cost.ts           # calculateCost — the one function Decision #11 already proved pure
│   └── paths.ts          # ROUTERLY_HOME resolution — pure, no state
├── modules/
│   ├── config/
│   ├── provider/
│   ├── catalog/            # NEW
│   ├── embeddings/         # NEW
│   ├── routing/
│   ├── budget/
│   ├── usage/
│   ├── guardrails/
│   ├── pii/
│   ├── logging/
│   ├── cache/
│   ├── auth/               # NEW — auth/roles.ts, auth/totp.ts, plugins/jwt.ts, plugins/auth.ts
│   ├── audit/               # NEW — audit/logger.ts
│   ├── notifications/       # NEW — notifications/emitter.ts, sender.ts, channels/*
│   ├── observability/        # NEW — integrations/ (datadog, otel, influxdb, grafana, webhook, metrics-snapshot, runner). Named to avoid collision with the unrelated phone-home telemetry service (telemetry.routerly.ai) the KB documents separately.
│   ├── reverse-proxy/        # pipeline mechanism, absorbs llm/executor.ts as execute.ts
│   ├── api-reverse-proxy/    # NEW as a module — routes/openai.ts, anthropic.ts, passthrough.ts
│   └── api/                  # NEW as a module — routes/api.ts, exposes route-contribution hook
└── bootstrap/                # NEW — module-list assembly + buildKernel() call, out of server.ts
```

`routes/` and `llm/` disappear entirely as top-level dirs once this lands. `server.ts` shrinks to: build Fastify instance, call `bootstrap()`, decorate the instance, register the module-contributed route sets.

---

## Sequencing (dependency order)

0. **Core hook/override primitive** (`core/hooks/`, `container.override()`, `ProcessorRegistry` re-base) — must land green, all existing kernel tests unchanged, before any module below is written against it.
1. `core/` internal subfolder reorganization (`container/`, `modules/`, `events/`, `hooks/`, `pipeline/`, `lifecycle/`) — mechanical file moves + import updates, no behavior change. Can be folded into Step 0's plan since it touches the same files.
2. `lib/` extraction (`cost.ts`, `paths.ts`).
3. `modules/config/` full extraction.
4. `modules/provider/` full extraction — stays ONE module (no per-provider submodules yet, matches 0.4.0 Plan 3 scope; KB's `ModelDefinition`/`ModelInstance` split stays rejected per `_index.md` decisions, untouched by this restructure). But per the standing rule that every module must be extensible/overridable via hooks, `getProviderAdapter`'s internal dispatch becomes hook-based from this pass: a `PROVIDER_REGISTRY` token backed by Step 0's `AlterableRegistry<ProviderAdapter>`, each built-in provider (openai/anthropic/ollama) registered as a contribution at module `register()` time instead of a hardcoded switch. Adding a provider later (or a third party contributing one) is `.contribute()`, no `modules/provider/` source edit — the module boundary stays flat, the mechanism inside it is not.
5. `modules/catalog/` (new). **Open KB question, never answered in `_index.md`'s locked decisions**: is the model catalog integrated in-service, fully remote, or layered (defaults + local overrides)? Today's code (`catalog/fetcher.ts`, `catalog/sync.ts`) already does periodic remote-fetch-into-local-cache — extraction should preserve that behavior as-is regardless of the answer; the open question only matters if it changes the catalog's *shape* (single source vs. layered merge), which needs your call before this step's detailed plan is drafted.
6. `modules/embeddings/` (new).
7. `modules/budget/`, `modules/usage/` full extraction (parallel-safe with each other).
8. `modules/routing/` full extraction (needs provider, catalog, embeddings, usage landed).
9. `modules/guardrails/`, `modules/pii/` full extraction (guardrails needs embeddings + provider).
10. `modules/logging/` extraction + traceStore absorption.
11. `modules/auth/`, `modules/audit/`, `modules/notifications/` (new, independent of each other and of the routing/cost chain — parallel-safe).
12. `modules/observability/` (new, needs usage landed).
13. `modules/reverse-proxy/` — absorbs `llm/executor.ts` as `execute.ts`, moves under `modules/`.
14. `modules/api-reverse-proxy/` — `routes/openai.ts`/`anthropic.ts`/`passthrough.ts` become this module, wired to `modules/reverse-proxy/`.
15. `modules/api/` — `routes/api.ts` becomes this module, exposes the route-contribution hook (Step 0's `AlterableRegistry<RouteContribution>`).
16. `bootstrap/` extraction from `server.ts` — last, once every module import path is stable.

Each numbered step becomes its own execution plan file: `docs/superpowers/plans/2026-07-27-modular-<area>.md`, written in this order, self-contained per the `superpowers:writing-plans` template.

**Per-step rollout gate** (KB-confirmed precedent, reused unchanged from 0.4.0 Plans 4-5, not a new design): each area is built "dark" — new module registered but not wired to live traffic — then flipped atomically, gated by a curl byte-diff (stream + non-stream + passthrough where applicable) against a second worktree pinned at the pre-flip commit on `main`. Revert the single flip line on any diff. No coverage-percentage gate at this phase, per `_index.md`'s locked constraint — minimal tests + browser/curl byte-diff is the bar.

---

## KB cross-check status

`provider` (deep-checked): KB has a dedicated note with a richer per-provider design; the data-model half (`ModelDefinition`/`ModelInstance` split) is explicitly rejected in `_index.md`'s locked decisions, untouched here. The adapter half (per-provider registration) folded into Step 0's hook mechanism, module stays flat.

`catalog`, `embeddings`, `auth`, `audit`, `notifications`, `observability` (cross-checked this session): no KB opinion contradicts or adds scope to a flat wrap-the-existing-directory treatment. `audit`/`notifications`/`observability` are implied only as generic event-subscribers in the KB's own event-bus diagram (`Kernel modulare.md`) — consistent with Step 0's event-wiring plan (#4 above), not additional scope. `embeddings` and `auth` are total silence in the KB — bare directory listings only, no design opinion either way.

## Decisions closed (this session)

1. **`catalog` shape** — stays unchanged: remote fetch → local cache, exactly as `catalog/fetcher.ts`/`sync.ts` do today. No layering introduced. Step 5 is a pure extraction, no redesign.
2. **Parallelization** — step 11 (`auth`/`audit`/`notifications`) runs sequentially, one plan at a time, same worktree. No isolated parallel subagents.
3. **Metamodule manifest shape** — not built this pass. KB gives the exact future shape (`Superfici e metamoduli.md`): `id`, `type: meta`, `dependsOn: [...]`, no lifecycle. Today's `ModuleManifest` (`core/module.ts`) has no `type` field but adding an optional one later is additive, non-breaking — no action needed in Step 0, confirmed compatible by inspection.

All pre-flight verification closed. Ready to draft Step 0's detailed execution plan (core hook/override primitive + core/ subfolder reorg + event-wiring adoption), in full, following the strict `superpowers:writing-plans` task template — no code changes until you separately authorize execution.
