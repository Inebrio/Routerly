# Step 15: modules/api/ Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `packages/service/src/routes/api.ts` (+ `api.test.ts`, `api.sessions.test.ts`) into `packages/service/src/modules/api/`, fix internal import depth, repoint external consumers, and expose the route-contribution hook (Step 0's `createRouteRegistry()`/`AlterableRegistry<RouteContribution>`) behind a new DI token.

**Architecture:** Same flat-wrap precedent as Steps 6/11/12/14, with one addition: `modules/api/index.ts` also calls `createRouteRegistry()` and registers the resulting empty `AlterableRegistry<RouteContribution>` behind a new `API_ROUTES` token. This mirrors `core/contrib.ts`'s `CONTRIB_MODULES = []` precedent exactly — an inert extension point, not a wired mechanism. `routes/api.ts`'s 2373-line hand-written `apiRoutes` Fastify plugin is NOT rewritten to dynamically iterate the registry; nothing contributes to it yet (no consumer exists, same as `EMBEDDINGS`/`OBSERVABILITY`/`API_REVERSE_PROXY` today). Converting `apiRoutes` into a dynamic-dispatch plugin would be new behavior invented for this step, not something the spec or any current consumer requires — out of scope per "touch only what the task requires." The token exists so a later module (in-tree or contrib) has a stable place to register additional REST routes without editing `api.ts` directly.

**Tech Stack:** TypeScript ESM, Vitest, Fastify plugin functions, DI token pattern (`core/tokens.ts`), `AlterableRegistry<RouteContribution>` (`core/hooks/routes.ts`).

## Global Constraints

- Wire-format transparency ABSOLUTE — no request/response handling logic changes, only import paths and one new dark token registration.
- Feature-parity ABSOLUTE — `apiRoutes`' behavior is unchanged; the route-contribution registry starts empty and stays empty (no contributor exists yet).
- No em-dashes anywhere.
- Imports: `.js` extension; `node:` prefix on builtins.
- Commit subjects: all-lowercase; body lines ≤100 chars.
- **Lesson from Steps 7/11/13, applied up front here**: grep for `vi.mock(`, static `import`, AND dynamic `await import(` — this file has real hits in all three categories (see research below), unlike Step 14 which had none.
- Verify every moved file's `core/index.js`/`core/tokens.js` import depth explicitly (Step 13's lesson) — confirmed by research below: `api.ts`/`api.test.ts`/`api.sessions.test.ts` import no `core/` path at all.

---

### Task 1: Move `routes/api.ts` (+tests) into `modules/api/` and fix internal import depth

**Files:**
- Move (git mv): `routes/api.ts` → `modules/api/api.ts`, `routes/api.test.ts` → `modules/api/api.test.ts`, `routes/api.sessions.test.ts` → `modules/api/api.sessions.test.ts`.
- Modify: all three (import depth fixes below).

**Interfaces:**
- Consumes: `modules/config/loader.js`, `modules/auth/{jwt,totp,roles}.js`, `modules/catalog/{fetcher,sync}.js`, `modules/logging/traceStore.js`, `modules/provider/registry.js`, `modules/notifications/{sender,emitter}.js`, `modules/audit/logger.js` (all one level shallower — `api.ts` was at `routes/`, 1 deep; now at `modules/api/`, 2 deep, same as every prior step's `modules/*`-sibling invariant). `lib/paths.js`, `telemetry.js`, `update-checker.js` stay at `src/`-root/`lib/` level (unmoved) — these need an EXTRA `../` since `api.ts` is now one level deeper. `routes/openaiOAuthForward.js` (dynamic `await import`, unmoved, stays in `routes/`) needs the ancestor-derived path from `modules/api/`.
- Produces: `modules/api/api.js`'s `apiRoutes` — same name, same signature, importable by Task 3's external consumers.

Import depth fixes (old path → new path):

| File | Old | New |
|---|---|---|
| `api.ts` | `'../modules/config/loader.js'` | `'../config/loader.js'` |
| `api.ts` | `'../modules/auth/jwt.js'` | `'../auth/jwt.js'` |
| `api.ts` | `'../modules/auth/totp.js'` | `'../auth/totp.js'` |
| `api.ts` | `'../modules/catalog/fetcher.js'` | `'../catalog/fetcher.js'` |
| `api.ts` | `'../modules/catalog/sync.js'` | `'../catalog/sync.js'` |
| `api.ts` | `'../modules/logging/traceStore.js'` | `'../logging/traceStore.js'` |
| `api.ts` | `'../modules/provider/registry.js'` | `'../provider/registry.js'` |
| `api.ts` | `'../modules/notifications/sender.js'` | `'../notifications/sender.js'` |
| `api.ts` | `'../modules/notifications/emitter.js'` | `'../notifications/emitter.js'` |
| `api.ts` | `'../modules/auth/roles.js'` | `'../auth/roles.js'` |
| `api.ts` | `'../modules/audit/logger.js'` (2 occurrences: value + type import) | `'../audit/logger.js'` |
| `api.ts` | `'../lib/paths.js'` | `'../../lib/paths.js'` |
| `api.ts` | `'../telemetry.js'` | `'../../telemetry.js'` |
| `api.ts` | `'../update-checker.js'` | `'../../update-checker.js'` |
| `api.ts` line 1801 | `await import('./openaiOAuthForward.js')` | `await import('../../routes/openaiOAuthForward.js')` |
| `api.test.ts` / `api.sessions.test.ts` | same `../modules/*` `vi.mock` targets + static imports as above | same `../*` fix |
| `api.test.ts` / `api.sessions.test.ts` | `vi.mock('../update-checker.js', ...)` | `'../../update-checker.js'` |
| `api.test.ts` / `api.sessions.test.ts` | `vi.mock('../telemetry.js', ...)` | `'../../telemetry.js'` |
| `api.test.ts` (3 dynamic imports, lines 1659/2500/2513) | `await import('../update-checker.js')` | `'../../update-checker.js'` |
| `api.test.ts` (1 dynamic import, line 5756) | `await import('../telemetry.js')` | `'../../telemetry.js'` |
| `api.test.ts` | `vi.mock('./openaiOAuthForward.js', ...)` + `import { resolveCodexToken } from './openaiOAuthForward.js'` | `'../../routes/openaiOAuthForward.js'` |

`node:crypto`/`node:child_process`/`node:fs`/`node:os`/`bcrypt`/`uuid`/`zod`/`@routerly/shared` imports and dynamic `await import('node:crypto')` calls are unaffected (package/builtin specifiers, not relative paths).

- [ ] **Step 1: Move the files**

```bash
cd packages/service/src
mkdir -p modules/api
git mv routes/api.ts modules/api/api.ts
git mv routes/api.test.ts modules/api/api.test.ts
git mv routes/api.sessions.test.ts modules/api/api.sessions.test.ts
```

- [ ] **Step 2: Fix import depth (modules/* one level shallower)**

```bash
cd modules/api
sed -i '' \
  -e "s#'\\.\\./modules/config/loader\\.js'#'../config/loader.js'#g" \
  -e "s#'\\.\\./modules/auth/jwt\\.js'#'../auth/jwt.js'#g" \
  -e "s#'\\.\\./modules/auth/totp\\.js'#'../auth/totp.js'#g" \
  -e "s#'\\.\\./modules/auth/roles\\.js'#'../auth/roles.js'#g" \
  -e "s#'\\.\\./modules/catalog/fetcher\\.js'#'../catalog/fetcher.js'#g" \
  -e "s#'\\.\\./modules/catalog/sync\\.js'#'../catalog/sync.js'#g" \
  -e "s#'\\.\\./modules/logging/traceStore\\.js'#'../logging/traceStore.js'#g" \
  -e "s#'\\.\\./modules/provider/registry\\.js'#'../provider/registry.js'#g" \
  -e "s#'\\.\\./modules/notifications/sender\\.js'#'../notifications/sender.js'#g" \
  -e "s#'\\.\\./modules/notifications/emitter\\.js'#'../notifications/emitter.js'#g" \
  -e "s#'\\.\\./modules/audit/logger\\.js'#'../audit/logger.js'#g" \
  api.ts api.test.ts api.sessions.test.ts
```

- [ ] **Step 3: Fix depth for src-root-level files (extra `../` — these did NOT move)**

```bash
sed -i '' \
  -e "s#'\\.\\./lib/paths\\.js'#'../../lib/paths.js'#g" \
  -e "s#'\\.\\./telemetry\\.js'#'../../telemetry.js'#g" \
  -e "s#'\\.\\./update-checker\\.js'#'../../update-checker.js'#g" \
  api.ts api.test.ts api.sessions.test.ts
```

- [ ] **Step 4: Fix `openaiOAuthForward.js` references (stays in `routes/`, ancestor-derived path)**

```bash
sed -i '' "s#'\\./openaiOAuthForward\\.js'#'../../routes/openaiOAuthForward.js'#g" api.ts api.test.ts
cd ../..
```

- [ ] **Step 5: Verify with grep**

```bash
grep -rn "'\\.\\./modules/\|'\\.\\./core/\|'\\.\\./lib/\|'\\.\\./telemetry\\.js'\|'\\.\\./update-checker\\.js'\|'\\./openaiOAuthForward\\.js'" modules/api/
```

Expected: no output. Any hit means a missed depth fix.

- [ ] **Step 6: Typecheck (expect exactly the known external-consumer errors from Task 2, nothing else)**

```bash
cd "$(git rev-parse --show-toplevel)"
npm run typecheck --workspace=packages/service 2>&1 | grep -v "TS2307.*routes/api"
```

Expected: empty (remaining errors are exactly Task 2's known external breakage).

---

### Task 2: Repoint external consumers

**Files:**
- `server.ts` (1 import: `apiRoutes`; `fastify.register(apiRoutes)` call site unchanged)
- `server.test.ts` (1 `vi.mock` target)
- `server.telemetry.test.ts` (1 `vi.mock` target)

**Interfaces:**
- Consumes: `modules/api/api.js`'s existing `apiRoutes` export, path-only change.

- [ ] **Step 1: Fix `server.ts`, `server.test.ts`, `server.telemetry.test.ts`**

```bash
cd packages/service/src
sed -i '' "s#'\\./routes/api\\.js'#'./modules/api/api.js'#" server.ts server.test.ts server.telemetry.test.ts
```

- [ ] **Step 2: Verify with grep**

```bash
grep -rn "routes/api\.js" --include='*.ts' . | grep -v "^\\./modules/api/"
```

Expected: no output.

- [ ] **Step 3: Typecheck**

```bash
cd "$(git rev-parse --show-toplevel)"
npm run typecheck --workspace=packages/service
```

Expected: clean, zero errors.

---

### Task 3: Add the `API_ROUTES` DI token and module wrapper (route-contribution hook)

**Files:**
- Modify: `core/tokens.ts` (add `API_ROUTES` token, placed after `API_REVERSE_PROXY`).
- Create: `modules/api/index.ts`.

**Interfaces:**
- Consumes: `core/index.js`'s `createRouteRegistry`, `modules/api/api.js`'s `apiRoutes`.
- Produces: `API_ROUTES` token resolving to an empty `AlterableRegistry<RouteContribution>` (unused by any real consumer today — same precedent as `EMBEDDINGS`/`OBSERVABILITY`/`API_REVERSE_PROXY`, not registered in `coreModules`/`buildKernel`'s explicit list beyond what already resolves it).

- [ ] **Step 1: Add the token**

In `packages/service/src/core/tokens.ts`, add immediately after the `API_REVERSE_PROXY` token:

```ts
export const API_ROUTES = token<AlterableRegistry<RouteContribution>>('api.routes');
```

This requires importing `AlterableRegistry` and `RouteContribution` as types at the top of `core/tokens.ts`:

```ts
import { token, type ProcessorRegistry, type AlterableRegistry, type RouteContribution } from './index.js';
```

(replacing the existing `import { token, type ProcessorRegistry } from './index.js';` line with the same import widened to include the two new type names.)

- [ ] **Step 2: Create the module wrapper**

Create `packages/service/src/modules/api/index.ts`:

```ts
import { defineModule, createRouteRegistry } from '../../core/index.js';
import { API_ROUTES } from '../../core/tokens.js';
import { apiRoutes } from './api.js';

export { apiRoutes };

/**
 * Api module: owns the dashboard REST API plugin (api.ts) and exposes the
 * route-contribution hook behind the API_ROUTES token. The registry starts
 * empty — no in-tree or contrib module contributes routes through it yet;
 * apiRoutes itself is still one large hand-written Fastify plugin. server.ts
 * still imports apiRoutes directly by path to register it; this module
 * additionally makes the contribution point reachable through the container
 * for future modules that want to add REST routes without editing api.ts.
 */
export const apiModule = defineModule({
  manifest: { id: 'api', version: '0.4.0' },
  register({ container }) {
    container.register(API_ROUTES, createRouteRegistry());
  },
});
```

- [ ] **Step 3: Typecheck**

```bash
cd "$(git rev-parse --show-toplevel)"
npm run typecheck --workspace=packages/service
```

Expected: clean.

---

### Task 4: Full regression + commits

- [ ] **Step 1: Run all touched test files**

```bash
cd packages/service
npx vitest run \
  src/modules/api/ \
  src/routes/openaiOAuthForward.test.ts \
  src/routes/oauthForward.test.ts \
  src/server.test.ts \
  src/server.telemetry.test.ts
```

Expected: all pass, same counts as pre-move baseline (`oauthForward.test.ts`'s 2 pre-existing failures unaffected, unrelated to this step).

- [ ] **Step 2: Full-suite regression**

```bash
npx vitest run
```

Expected: identical pre-existing baseline (3 failed / 2151 passed: `oauthForward.test.ts` x2, `modules/provider/anthropic.test.ts` x1) — zero new failures.

- [ ] **Step 3: Commit in the established granularity (move, then consumer repoint, then token+wrapper)**

```bash
cd "$(git rev-parse --show-toplevel)"
git add packages/service/src/modules/api/api.ts packages/service/src/modules/api/api.test.ts packages/service/src/modules/api/api.sessions.test.ts
git commit -m "refactor(api): move routes/api.ts into modules/api/"

git add packages/service/src/server.ts packages/service/src/server.test.ts packages/service/src/server.telemetry.test.ts
git commit -m "refactor(api): repoint external consumers to modules/api/"

git add packages/service/src/core/tokens.ts packages/service/src/modules/api/index.ts
git commit -m "feat(api): add api_routes di token exposing the route-contribution hook"
```

- [ ] **Step 4: Update progress ledger** (gitignored, not committed) — append the Step 15 completion entry, note the API_ROUTES/route-contribution-hook decision, replace "Next: Step 15..." with "Next: Step 16 (bootstrap/ extraction from server.ts, last step)".
