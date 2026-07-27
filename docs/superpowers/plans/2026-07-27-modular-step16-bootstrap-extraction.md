# Step 16: bootstrap/ extraction from server.ts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** extract the module-array assembly + `buildKernel()` call out of `server.ts` into a new top-level `bootstrap/` dir, per the overview doc's confirmed decision ("new top-level dir, matches KB tree exactly. Extracts the module-array assembly + `buildKernel()` call out of `server.ts`.").

**Architecture:** this is the last of the 17 steps, run only once every other module's import path is stable. Unlike Steps 13-15 (pure relocation of already-modular concerns), this is an actual extraction: `server.ts` currently inlines the 8-module array (`configModule`, `providerModule`, `catalogModule`, `reverseProxyModule`, `...coreModules`, `...CONTRIB_MODULES`) directly in `buildServer()`. `bootstrap/index.ts` gets a single exported `bootstrap()` function (no arguments, returns `Promise<Kernel>`) that owns that array and calls the existing `buildKernel()` from `core/lifecycle/bootstrap.ts` (unchanged, not renamed — different directory, no collision). `server.ts` shrinks to: build Fastify instance, call `bootstrap()`, decorate the instance (`fastify.decorate('kernel', kernel)` + the `onClose` hook stay in `server.ts`, per the overview's "decorate the instance" wording), register the module-contributed route sets. No new module manifest, no container registration change — this is pure code motion, same modules, same order, same kernel behavior.

**Tech Stack:** TypeScript ESM, Fastify 5, existing `core/lifecycle/bootstrap.ts` `buildKernel()`.

## Global Constraints

- Wire-format transparency ABSOLUTE — no behavior change, no touched route contract.
- Feature-parity ABSOLUTE — same kernel, same modules, same start order.
- Public contracts frozen — kernel API/tokens/`ProxyContext` untouched.
- No em-dashes anywhere (code/comments/docs/commits).
- Imports: `.js` extension; builtins: `node:` prefix (per `.claude/rules/service.md`).
- Per-step rollout gate re-examined (not auto-applied): this is a same-process, same-request-path code motion with no new dark/live-traffic distinction possible (there is only ever one `bootstrap()` call site, invoked synchronously at server construction) — the dark-build/atomic-flip/curl-byte-diff gate does not apply. Verification is via typecheck + targeted vitest + full-suite regression matching the established baseline (3 failed / 2151 passed), same judgment as Steps 13-15.
- New lesson from Step 15 applied proactively: grepped `server.ts` and the new `bootstrap/index.ts` for `new URL(`, `import.meta.url`, `__dirname`, `fileURLToPath` before finishing — `server.ts` itself uses `dirname(fileURLToPath(import.meta.url))` at line 30-31 to resolve `pkgVersion` from `../package.json`, but `server.ts` does not move in this step (only `bootstrap/index.ts` is new), so `__dirname`'s relative depth is unchanged and needs no fix. `bootstrap/index.ts` contains no file-relative path construction.

---

### Task 1: create `bootstrap/index.ts`, repoint `server.ts`, verify, commit

**Files:**
- Create: `packages/service/src/bootstrap/index.ts`
- Modify: `packages/service/src/server.ts`

**Interfaces:**
- Produces: `bootstrap(): Promise<Kernel>` — exported from `packages/service/src/bootstrap/index.ts`. Internally imports `buildKernel` from `../core/lifecycle/bootstrap.js`, `configModule` from `../modules/config/index.js`, `providerModule` from `../modules/provider/index.js`, `catalogModule` from `../modules/catalog/index.js`, `reverseProxyModule` from `../modules/reverse-proxy/index.js`, `coreModules` from `../modules/index.js`, `CONTRIB_MODULES` from `../core/contrib.js`, and `type Kernel` from `../core/index.js`.
- Consumes (in `server.ts`): `import { bootstrap } from './bootstrap/index.js';` replaces the 7 removed imports (`buildKernel`, `configModule`, `providerModule`, `catalogModule`, `reverseProxyModule`, `coreModules`, `CONTRIB_MODULES`). `type { Kernel } from './core/index.js'` stays (still used by the `declare module 'fastify'` augmentation).

- [x] **Step 1: write `bootstrap/index.ts`**

```ts
import { buildKernel } from '../core/lifecycle/bootstrap.js';
import { configModule } from '../modules/config/index.js';
import { providerModule } from '../modules/provider/index.js';
import { catalogModule } from '../modules/catalog/index.js';
import { reverseProxyModule } from '../modules/reverse-proxy/index.js';
import { coreModules } from '../modules/index.js';
import { CONTRIB_MODULES } from '../core/contrib.js';
import type { Kernel } from '../core/index.js';

export async function bootstrap(): Promise<Kernel> {
  return buildKernel([
    configModule,
    providerModule,
    catalogModule,
    reverseProxyModule,
    ...coreModules,
    ...CONTRIB_MODULES,
  ]);
}
```

- [x] **Step 2: repoint `server.ts`**

Replace the 7-import block (`buildKernel` through `CONTRIB_MODULES`) with a single `import { bootstrap } from './bootstrap/index.js';`. Replace the inline `buildKernel([...])` call in `buildServer()` with `const kernel = await bootstrap();`. `fastify.decorate('kernel', kernel)` and the `onClose` hook calling `kernel.stop()` stay exactly where they are.

- [x] **Step 3: grep for the Step 15 file-relative-path lesson**

Run: `grep -n "new URL(\|import.meta.url\|__dirname\|fileURLToPath" packages/service/src/server.ts packages/service/src/bootstrap/index.ts`
Expected: only `server.ts`'s pre-existing `__dirname`/`fileURLToPath` lines (unchanged, `server.ts` did not move); `bootstrap/index.ts` has no hits.

- [x] **Step 4: typecheck**

Run: `npm run typecheck --workspace=packages/service` (from repo root) or `npx tsc --noEmit` (from `packages/service/`)
Expected: clean, no errors.

- [x] **Step 5: targeted tests**

Run (from `packages/service/`): `npx vitest run src/server.test.ts src/server.telemetry.test.ts`
Expected: all pass. Neither test file mocks `buildKernel`/`configModule`/`providerModule`/`catalogModule`/`reverseProxyModule`/`coreModules`/`CONTRIB_MODULES` by path (confirmed via grep before starting), so moving the call site does not require any mock-target update — vitest's `vi.mock` intercepts by resolved module path regardless of which file imports it.

- [x] **Step 6: full-suite regression**

Run (from `packages/service/`): `npx vitest run`
Expected: exactly 3 failed / 2151 passed, matching the established baseline (`oauthForward.test.ts` x2, `modules/provider/anthropic.test.ts` x1 — both pre-existing, unrelated to this step).

- [x] **Step 7: commit**

```bash
git add packages/service/src/bootstrap/ packages/service/src/server.ts
git commit -m "refactor(service): extract bootstrap/ module-array assembly from server.ts"
```

---

## Result

`routes/` and `llm/` have now fully dissolved (per Steps 13-15 and earlier steps); `bootstrap/` is the last new top-level dir the overview specified. `server.ts` now only builds the Fastify instance, calls `bootstrap()`, decorates the kernel, and registers the module-contributed route sets — matching the overview's target shape exactly. This closes all 17 steps (0-16) of the modular restructure sequencing.
