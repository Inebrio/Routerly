# Step 14: modules/api-reverse-proxy/ Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `packages/service/src/routes/openai.ts`, `routes/anthropic.ts`, and `routes/passthrough.ts` (+ their test files) into `packages/service/src/modules/api-reverse-proxy/`, fix internal import depth, repoint external consumers, and add a flat-wrap DI token/module wrapper matching the precedent used in Steps 5/6/11/12/13.

**Architecture:** Same flat-wrap precedent as Steps 5/6/11/12: `modules/api-reverse-proxy/index.ts` exports a `defineModule` (`apiReverseProxyModule`) that registers the real Fastify plugin functions (`openaiRoutes`, `anthropicRoutes`, `passthroughHandler`) behind an `API_REVERSE_PROXY` token. Not added to `coreModules`/`buildKernel` — same as `embeddingsModule`/`observabilityModule`, since `server.ts` currently consumes `openaiRoutes`/`anthropicRoutes` via plain ES module imports (`fastify.register(openaiRoutes)`), not via container resolution. No real consumer resolves this token today; it exists so the module boundary is uniform and future work (Step 15's route-contribution hook) has a token to build on. **Discovery, not a fix**: `passthroughHandler` is not wired into `server.ts`'s Fastify instance at all — no `setNotFoundHandler` call registers it outside its own isolated test file. This is a pre-existing gap, confirmed by exhaustive grep (`passthroughHandler` appears only in `routes/passthrough.ts` and `routes/passthrough.test.ts`). Feature-parity ABSOLUTE means this step preserves that exact (unwired) behavior — it moves the dead code, it does not wire it up. Wiring it would be a functional change outside this step's scope.

**Tech Stack:** TypeScript ESM, Vitest, Fastify plugin functions, DI token pattern (`core/tokens.ts`).

## Global Constraints

- Wire-format transparency ABSOLUTE — no request/response handling logic changes, only import paths and one new dark module wrapper.
- Feature-parity ABSOLUTE — `passthroughHandler`'s current unwired state is preserved exactly (see Architecture note); do not add a `setNotFoundHandler` call as part of this step.
- No em-dashes anywhere.
- Imports: `.js` extension; `node:` prefix on builtins.
- Commit subjects: all-lowercase; body lines ≤100 chars.
- `vi.mock('...')` string targets fixed alongside static imports in the same pass (Step 11's lesson).
- **Step 13 lesson, applies here too**: verify EVERY moved file's `core/index.js`/`core/tokens.js`-style top-level import depth explicitly, not just the target-specific imports being tracked — Step 13 missed two files (`pipeline.order.test.ts`, two `lanes/*.test.ts`) this way and caught them only via post-fix grep, not up-front research. This step's moved files (`openai.ts`, `anthropic.ts`, `passthrough.ts` + their 3 test files) do not import `core/index.js`/`core/tokens.js` at all (confirmed by research below) — but re-verify with grep after the move regardless, per that lesson.
- Comment-only prose references to `reverse-proxy/lanes/*.test.ts` in `routes/openai.test.ts`/`anthropic.test.ts` (noted in Step 13's plan) are unaffected by this step and remain untouched — still prose, not imports.

---

### Task 1: Move the three route files (+tests) into `modules/api-reverse-proxy/` and fix internal import depth

**Files:**
- Move (git mv): `routes/openai.ts` → `modules/api-reverse-proxy/openai.ts`, `routes/openai.test.ts` → `modules/api-reverse-proxy/openai.test.ts`, `routes/anthropic.ts` → `modules/api-reverse-proxy/anthropic.ts`, `routes/anthropic.test.ts` → `modules/api-reverse-proxy/anthropic.test.ts`, `routes/passthrough.ts` → `modules/api-reverse-proxy/passthrough.ts`, `routes/passthrough.test.ts` → `modules/api-reverse-proxy/passthrough.test.ts`.
- Modify: `openai.ts`, `openai.test.ts`, `anthropic.ts`, `passthrough.ts`, `passthrough.test.ts` (import depth fixes below). `anthropic.test.ts` needs NO changes (only imports its sibling `./anthropic.js` and `@routerly/shared`/`fastify`/`vitest`, confirmed by research).

**Interfaces:**
- Consumes: `modules/config/loader.js`'s `readConfig`, `modules/reverse-proxy/index.js`'s `buildOpenAIContext`/`buildAnthropicContext`/`runProxy`/`getProxyPipeline`, `modules/auth/auth.js`'s `resolveProjectByToken`/`extractProjectToken` — same signatures, path-only change (old files were at `routes/`, 1 level deep; new files are at `modules/api-reverse-proxy/`, 2 levels deep — every `modules/*` sibling loses one `../`).
- Produces: `modules/api-reverse-proxy/{openai,anthropic,passthrough}.js`'s `openaiRoutes`, `anthropicRoutes`, `passthroughHandler` (+ `pickUpstreamModel`, `buildUpstreamUrl`, `buildUpstreamHeaders` from `passthrough.js`) — same names, same signatures, importable by Task 2's module wrapper and Task 3's external consumers.

Import depth fixes (old path → new path):

| File | Old | New |
|---|---|---|
| `openai.ts` | `'../modules/config/loader.js'` | `'../config/loader.js'` |
| `openai.ts` | `'../modules/reverse-proxy/index.js'` | `'../reverse-proxy/index.js'` |
| `openai.test.ts` | `vi.mock('../modules/config/loader.js', ...)` | `'../config/loader.js'` |
| `openai.test.ts` | `import { readConfig } from '../modules/config/loader.js'` | `'../config/loader.js'` |
| `anthropic.ts` | `'../modules/reverse-proxy/index.js'` | `'../reverse-proxy/index.js'` |
| `passthrough.ts` | `'../modules/config/loader.js'` | `'../config/loader.js'` |
| `passthrough.ts` | `'../modules/auth/auth.js'` | `'../auth/auth.js'` |
| `passthrough.test.ts` | `vi.mock('../modules/config/loader.js', ...)` | `'../config/loader.js'` |
| `passthrough.test.ts` | `vi.mock('../modules/auth/auth.js', ...)` | `'../auth/auth.js'` |
| `passthrough.test.ts` | `import { readConfig } from '../modules/config/loader.js'` | `'../config/loader.js'` |
| `passthrough.test.ts` | `import { resolveProjectByToken } from '../modules/auth/auth.js'` | `'../auth/auth.js'` |

- [ ] **Step 1: Move the files**

```bash
cd packages/service/src
mkdir -p modules/api-reverse-proxy
git mv routes/openai.ts modules/api-reverse-proxy/openai.ts
git mv routes/openai.test.ts modules/api-reverse-proxy/openai.test.ts
git mv routes/anthropic.ts modules/api-reverse-proxy/anthropic.ts
git mv routes/anthropic.test.ts modules/api-reverse-proxy/anthropic.test.ts
git mv routes/passthrough.ts modules/api-reverse-proxy/passthrough.ts
git mv routes/passthrough.test.ts modules/api-reverse-proxy/passthrough.test.ts
```

- [ ] **Step 2: Fix import depth**

```bash
cd modules/api-reverse-proxy
sed -i '' "s#'\\.\\./modules/config/loader\\.js'#'../config/loader.js'#" openai.ts openai.test.ts passthrough.ts passthrough.test.ts
sed -i '' "s#'\\.\\./modules/reverse-proxy/index\\.js'#'../reverse-proxy/index.js'#" openai.ts anthropic.ts
sed -i '' "s#'\\.\\./modules/auth/auth\\.js'#'../auth/auth.js'#" passthrough.ts passthrough.test.ts
cd ../..
```

- [ ] **Step 3: Verify with grep**

```bash
grep -rn "'\\.\\./modules/\|'\\.\\./core/" modules/api-reverse-proxy/
```

Expected: no output. Any hit means a missed depth fix or (per the Step 13 lesson) a `core/index.js`/`core/tokens.js` reference this research did not anticipate — inspect and fix before proceeding.

- [ ] **Step 4: Typecheck (expect exactly the known external-consumer errors from Task 3, nothing else)**

```bash
cd "$(git rev-parse --show-toplevel)"
npm run typecheck --workspace=packages/service 2>&1 | grep -v "TS2307.*routes/openai\|TS2307.*routes/anthropic\|TS2307.*routes/passthrough\|TS2307.*\./passthrough"
```

Expected: empty (remaining errors are exactly Task 3's known external breakage).

---

### Task 2: Add the `API_REVERSE_PROXY` DI token and module wrapper

**Files:**
- Modify: `core/tokens.ts` (add `API_REVERSE_PROXY` token, placed after `PROXY_PIPELINE`).
- Create: `modules/api-reverse-proxy/index.ts`.

**Interfaces:**
- Consumes: `modules/api-reverse-proxy/{openai,anthropic,passthrough}.js`'s `openaiRoutes`, `anthropicRoutes`, `passthroughHandler`.
- Produces: `API_REVERSE_PROXY` token resolvable via the container (unused by any real consumer today, same precedent as `EMBEDDINGS`/`OBSERVABILITY` — not registered in `coreModules`/`buildKernel`).

- [ ] **Step 1: Add the token**

In `packages/service/src/core/tokens.ts`, add immediately after the `PROXY_PIPELINE` token:

```ts
export const API_REVERSE_PROXY = token<{
  openaiRoutes: typeof import('../modules/api-reverse-proxy/openai.js').openaiRoutes;
  anthropicRoutes: typeof import('../modules/api-reverse-proxy/anthropic.js').anthropicRoutes;
  passthroughHandler: typeof import('../modules/api-reverse-proxy/passthrough.js').passthroughHandler;
}>('api-reverse-proxy.registry');
```

- [ ] **Step 2: Create the module wrapper**

Create `packages/service/src/modules/api-reverse-proxy/index.ts`:

```ts
import { defineModule } from '../../core/index.js';
import { API_REVERSE_PROXY } from '../../core/tokens.js';
import { openaiRoutes } from './openai.js';
import { anthropicRoutes } from './anthropic.js';
import { passthroughHandler } from './passthrough.js';

/**
 * Api-reverse-proxy module: owns the real HTTP-facing OpenAI/Anthropic
 * route plugins and the pass-through handler, exposed behind the
 * API_REVERSE_PROXY DI token. server.ts still imports openaiRoutes/
 * anthropicRoutes directly by path to register them as Fastify plugins;
 * this module additionally makes them reachable through the container.
 */
export const apiReverseProxyModule = defineModule({
  manifest: { id: 'api-reverse-proxy', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } },
  register({ container }) {
    container.register(API_REVERSE_PROXY, {
      openaiRoutes,
      anthropicRoutes,
      passthroughHandler,
    });
  },
});
```

- [ ] **Step 3: Typecheck**

```bash
cd "$(git rev-parse --show-toplevel)"
npm run typecheck --workspace=packages/service
```

Expected: clean (Task 3's external-consumer errors are the only ones remaining; this task introduces no new errors).

---

### Task 3: Repoint external consumers

**Files:**
- `server.ts` (2 lines: `openaiRoutes` import, `anthropicRoutes` import)
- `server.test.ts` (2 `vi.mock` targets)
- `server.telemetry.test.ts` (2 `vi.mock` targets)
- `routes/oauthForward.ts` (1 line: `buildUpstreamUrl` import — stays in `routes/`, only its target moved)

**Interfaces:**
- Consumes: `modules/api-reverse-proxy/{openai,anthropic,passthrough}.js`'s existing exports, path-only change.

- [ ] **Step 1: Fix `server.ts`**

```bash
cd packages/service/src
sed -i '' \
  -e "s#'\\./routes/openai\\.js'#'./modules/api-reverse-proxy/openai.js'#" \
  -e "s#'\\./routes/anthropic\\.js'#'./modules/api-reverse-proxy/anthropic.js'#" \
  server.ts
```

- [ ] **Step 2: Fix `server.test.ts` and `server.telemetry.test.ts` (`vi.mock` targets)**

```bash
sed -i '' \
  -e "s#'\\./routes/openai\\.js'#'./modules/api-reverse-proxy/openai.js'#" \
  -e "s#'\\./routes/anthropic\\.js'#'./modules/api-reverse-proxy/anthropic.js'#" \
  server.test.ts server.telemetry.test.ts
```

- [ ] **Step 3: Fix `routes/oauthForward.ts`**

```bash
sed -i '' "s#'\\./passthrough\\.js'#'../modules/api-reverse-proxy/passthrough.js'#" routes/oauthForward.ts
```

`routes/oauthForward.test.ts` needs no change (confirmed by research — it imports only its sibling `./oauthForward.js`, never `passthrough.js` directly). `routes/openaiOAuthForward.ts`/`.test.ts` need no change (confirmed by research — neither imports `passthrough.js`).

- [ ] **Step 4: Verify with grep**

```bash
grep -rn "routes/openai\.js\|routes/anthropic\.js\|'\\./passthrough\\.js'" --include='*.ts' . | grep -v "^\\./modules/api-reverse-proxy/"
```

Expected: no output.

- [ ] **Step 5: Typecheck**

```bash
cd "$(git rev-parse --show-toplevel)"
npm run typecheck --workspace=packages/service
```

Expected: clean, zero errors.

---

### Task 4: Full regression + commits

- [ ] **Step 1: Run all touched test files**

```bash
cd packages/service
npx vitest run \
  src/modules/api-reverse-proxy/ \
  src/routes/oauthForward.test.ts \
  src/routes/openaiOAuthForward.test.ts \
  src/server.test.ts \
  src/server.telemetry.test.ts
```

Expected: all pass, same counts as pre-move baseline.

- [ ] **Step 2: Full-suite regression**

```bash
npx vitest run
```

Expected: identical pre-existing baseline (3 failed / 2151 passed: `oauthForward.test.ts` x2, `modules/provider/anthropic.test.ts` x1) — zero new failures. Note: `oauthForward.test.ts`'s 2 pre-existing failures are unrelated to this step's `buildUpstreamUrl` import repoint (confirmed by the baseline being stable since Step 3) — if the failure count or location changes, treat it as a real regression introduced by this step's `oauthForward.ts` edit, not baseline noise.

- [ ] **Step 3: Commit in the established granularity (move, then token+wrapper, then consumer repoint)**

```bash
cd "$(git rev-parse --show-toplevel)"
git add packages/service/src/modules/api-reverse-proxy
git commit -m "refactor(api-reverse-proxy): move routes/openai,anthropic,passthrough into modules/"

git add packages/service/src/core/tokens.ts packages/service/src/modules/api-reverse-proxy/index.ts
git commit -m "feat(api-reverse-proxy): add api_reverse_proxy di token and module wrapper"

git add packages/service/src/server.ts packages/service/src/server.test.ts \
  packages/service/src/server.telemetry.test.ts packages/service/src/routes/oauthForward.ts
git commit -m "refactor(api-reverse-proxy): repoint external consumers to modules/api-reverse-proxy/"
```

- [ ] **Step 4: Update progress ledger** (gitignored, not committed) — append the Step 14 completion entry, note the `passthroughHandler`-unwired discovery, replace "Next: Step 14..." with "Next: Step 15 (modules/api/, wraps routes/api.ts, exposes route-contribution hook)".
