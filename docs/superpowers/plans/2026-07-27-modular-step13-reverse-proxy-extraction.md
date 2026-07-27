# Step 13: modules/reverse-proxy/ Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the top-level `packages/service/src/reverse-proxy/` directory to `packages/service/src/modules/reverse-proxy/`, and move `packages/service/src/llm/executor.ts` (+ its two test files) into that same directory as `execute.ts`. Fix internal import depth throughout the moved files, repoint all 20 external consumer files, and remove the now-empty `llm/` directory. No behavior change: same processors, same registration order, same route wiring, same wire format.

**Architecture:** `reverse-proxy/` is already a real `defineModule` (`reverseProxyModule`, registered live in `server.ts`'s `buildKernel()` call) — unlike Steps 5/6/11/12's "new, dark, unregistered wrapper" pattern, this module is already wired into live request traffic. This step is nonetheless a **pure file move + import-path fix**, not a redesign: no processor logic, registration order, or route wiring changes. Judgment call (stated per the overview's rollout-gate note): the KB-precedent dark-build/atomic-flip/curl-byte-diff gate applies when a *new alternate implementation* is built alongside the old one and then cut over (as in 0.4.0 Plans 4-5). Here nothing new is built — the same code moves to a new file path, verified by typecheck + full regression suite exactly as Steps 3-12 were. No flip line, no parallel dark path, nothing to revert. A manual curl smoke test against the running dev server is added as extra diligence (Task 5) precisely because this module sits on the live request path, but it is a verification step, not a cutover mechanism.

**Tech Stack:** TypeScript ESM, Vitest, `node:path`-relative import fixes verified by ancestor-directory arithmetic (see Task 1/2's tables) and confirmed by `tsc`.

## Global Constraints

- Wire-format transparency ABSOLUTE — this step changes zero request/response handling code, only import paths. Verified by full regression suite + a manual curl smoke test.
- Feature-parity ABSOLUTE — `/v1/chat/completions` (OpenAI lane) and `/v1/messages` (Anthropic lane) must behave identically before/after.
- No em-dashes anywhere (code/comments/docs/commits).
- Imports: `.js` extension on relative imports; `node:` prefix on builtins.
- Commit subjects: all-lowercase (commitlint `subject-case`), body lines ≤100 chars (commitlint `body-max-line-length`).
- `vi.mock('...')` string targets must be grepped and fixed explicitly alongside static imports in the SAME pass — this was the root cause of two missed-consumer bugs in Step 11. This plan's research already covers both static imports and `vi.mock` targets exhaustively (see Task 1-3's tables); do not re-derive, but DO re-verify with the final grep sweep in Task 4 before declaring done.
- Research already done (do not re-derive): exhaustive repo-wide grep for `llm/executor` and `reverse-proxy/` (any form, including `vi.mock`) found exactly the files listed in Tasks 1-3 below. Two comment-only references (`core/tokens.ts` line 93, `routes/openai.test.ts` line 40, `routes/anthropic.test.ts` line 24) mention `reverse-proxy/...` paths in prose, not in an import or mock — leave them, no functional effect, not worth the diff.

---

### Task 1: Move `llm/executor.ts` (+tests) into `modules/reverse-proxy/execute.ts` and fix its internal imports

**Files:**
- Move (git mv): `llm/executor.ts` → `modules/reverse-proxy/execute.ts`, `llm/executor.test.ts` → `modules/reverse-proxy/execute.test.ts`, `llm/executor.cost.test.ts` → `modules/reverse-proxy/execute.cost.test.ts`.
- Modify: all three moved files (import depth fixes below).

**Interfaces:**
- Consumes: `modules/provider/registry.js`'s `getProviderAdapter`, `modules/budget/budget.js`'s `isAllowed`/`isAllowedForRoutingModel`/`getLimitUsageSnapshot`, `modules/usage/tracker.js`'s `trackUsage`, `lib/cost.js`'s `calculateCost`, `modules/notifications/emitter.js`'s `emitEvent`, `modules/logging/traceStore.js`'s `TraceEntry`/`TracePanel` types — all unchanged signatures, only the import path changes (old file was at `llm/`, one level deep; new file is at `modules/reverse-proxy/`, two levels deep — one level deeper for the `modules/*` siblings, since `reverse-proxy` now nests inside `modules/`; two levels deeper for `lib/`, which stays a top-level sibling of `modules/`).
- Produces: `modules/reverse-proxy/execute.js`'s `llmChat`, `llmStream`, `llmMessages`, `checkBudget`, `BudgetExceededError`, `LLMCallContext`, `StreamResult` — same names, same signatures, importable by Task 2's lane files and Task 3's external consumers.

Import depth fixes (old path → new path), derived by common-ancestor arithmetic, applies identically to `execute.ts`, `execute.test.ts` (as `vi.mock`/import), and `execute.cost.test.ts` (as `vi.mock`/import):

| Old (in `llm/executor*.ts`) | New (in `modules/reverse-proxy/execute*.ts`) |
|---|---|
| `../modules/provider/registry.js` | `../provider/registry.js` |
| `../modules/budget/budget.js` | `../budget/budget.js` |
| `../modules/usage/tracker.js` | `../usage/tracker.js` |
| `../lib/cost.js` | `../../lib/cost.js` |
| `../modules/notifications/emitter.js` | `../notifications/emitter.js` |
| `../modules/logging/traceStore.js` | `../logging/traceStore.js` |
| `./executor.js` (in the two test files) | `./execute.js` |

- [ ] **Step 1: Move the files**

```bash
cd packages/service/src
git mv llm/executor.ts modules/reverse-proxy/execute.ts
git mv llm/executor.test.ts modules/reverse-proxy/execute.test.ts
git mv llm/executor.cost.test.ts modules/reverse-proxy/execute.cost.test.ts
rmdir llm
```

- [ ] **Step 2: Fix import depth (sed, then verify with grep)**

```bash
sed -i '' \
  -e "s#'\\.\\./modules/provider/registry\\.js'#'../provider/registry.js'#" \
  -e "s#'\\.\\./modules/budget/budget\\.js'#'../budget/budget.js'#" \
  -e "s#'\\.\\./modules/usage/tracker\\.js'#'../usage/tracker.js'#" \
  -e "s#'\\.\\./lib/cost\\.js'#'../../lib/cost.js'#" \
  -e "s#'\\.\\./modules/notifications/emitter\\.js'#'../notifications/emitter.js'#" \
  -e "s#'\\.\\./modules/logging/traceStore\\.js'#'../logging/traceStore.js'#" \
  modules/reverse-proxy/execute.ts modules/reverse-proxy/execute.test.ts modules/reverse-proxy/execute.cost.test.ts

sed -i '' "s#'\\./executor\\.js'#'./execute.js'#" \
  modules/reverse-proxy/execute.test.ts modules/reverse-proxy/execute.cost.test.ts

grep -n "modules/\|lib/cost\|executor" modules/reverse-proxy/execute.ts modules/reverse-proxy/execute.test.ts modules/reverse-proxy/execute.cost.test.ts
```

Expected: every `modules/`-rooted import shows exactly one level (`../provider/`, `../budget/`, `../usage/`, `../notifications/`, `../logging/`), `lib/cost.js` shows `../../lib/cost.js`, and no line still says `executor.js` or `../modules/`.

- [ ] **Step 3: Commit (deferred)** — do not commit yet; Task 2 moves the rest of `reverse-proxy/` in the same logical unit, and typecheck will show errors until Task 2's lane-file repoints land (the lanes still reference `../../llm/executor.js`, which no longer exists). Proceed directly to Task 2.

---

### Task 2: Move `reverse-proxy/` to `modules/reverse-proxy/` and fix internal import depth

**Files:**
- Move (git mv, into the `modules/reverse-proxy/` directory already created by Task 1): `reverse-proxy/context.ts`, `reverse-proxy/helpers.ts`, `reverse-proxy/helpers.test.ts`, `reverse-proxy/index.ts`, `reverse-proxy/module.ts`, `reverse-proxy/module.test.ts`, `reverse-proxy/run.ts`, `reverse-proxy/run.test.ts`, `reverse-proxy/pipeline.harness.test.ts`, `reverse-proxy/pipeline.order.test.ts`, `reverse-proxy/lanes/openai.ts`, `reverse-proxy/lanes/openai.test.ts`, `reverse-proxy/lanes/anthropic.ts`, `reverse-proxy/lanes/anthropic.test.ts`.
- Modify: `context.ts`, `helpers.ts`, `helpers.test.ts`, `run.ts`, `module.ts`, `module.test.ts`, `run.test.ts`, `pipeline.harness.test.ts`, `lanes/openai.ts`, `lanes/anthropic.ts` (import depth fixes below). `index.ts`, `pipeline.order.test.ts`, `lanes/openai.test.ts`, `lanes/anthropic.test.ts` need NO import changes (verified — their only external references are `../core/index.js`-family, handled in the table, or pure siblings).

**Interfaces:**
- Consumes: same as before the move — `core/index.js` (`ProcessorRegistry`, `Processor`, `ServiceContainer`, `EventBus`), `core/tokens.js` (`PROXY_PIPELINE`), `modules/pii/piiScrubber.js`, `modules/guardrails/guardrails.js`, `modules/config/loader.js`, `modules/logging/traceStore.js`, `modules/notifications/emitter.js`, `routes/openaiOAuthForward.js`, `routes/oauthForward.js`, and (from Task 1) `./execute.js`.
- Produces: `modules/reverse-proxy/{context,helpers,index,module,run}.js` and `modules/reverse-proxy/lanes/{openai,anthropic}.js` — same exports, same names, importable by Task 3's external consumers and by `server.ts`.

Import depth fixes, split by old directory depth (root files were 1 level deep under `src/`, `lanes/` files were 2 levels deep; both move one level deeper):

**Root files** (`context.ts`, `helpers.ts`, `run.ts`, `module.ts`, `module.test.ts`, `run.test.ts`, `helpers.test.ts`, `pipeline.harness.test.ts`):

| Old | New |
|---|---|
| `../core/index.js` | `../../core/index.js` |
| `../core/tokens.js` | `../../core/tokens.js` |
| `../modules/pii/piiScrubber.js` | `../pii/piiScrubber.js` |
| `../modules/guardrails/guardrails.js` | `../guardrails/guardrails.js` |
| `../modules/logging/traceStore.js` | `../logging/traceStore.js` |
| `../modules/config/loader.js` | `../config/loader.js` |
| `./context.js`, `./run.js`, `./module.js`, `./lanes/openai.js`, `./lanes/anthropic.js`, `./helpers.js` | unchanged (siblings, same relative depth preserved) |

**`lanes/` files** (`lanes/openai.ts`, `lanes/anthropic.ts`):

| Old | New |
|---|---|
| `../../core/index.js` | `../../../core/index.js` |
| `../../modules/config/loader.js` | `../../config/loader.js` |
| `../../modules/logging/traceStore.js` | `../../logging/traceStore.js` |
| `../../modules/notifications/emitter.js` | `../../notifications/emitter.js` |
| `../../llm/executor.js` | `../execute.js` |
| `../../routes/openaiOAuthForward.js` (openai.ts only) | `../../../routes/openaiOAuthForward.js` |
| `../../routes/oauthForward.js` (anthropic.ts only) | `../../../routes/oauthForward.js` |
| `../context.js`, `../run.js`, `./openai.js`, `./anthropic.js` | unchanged (siblings, same relative depth preserved) |

- [ ] **Step 1: Move the files**

```bash
cd packages/service/src
mkdir -p modules/reverse-proxy/lanes
git mv reverse-proxy/context.ts modules/reverse-proxy/context.ts
git mv reverse-proxy/helpers.ts modules/reverse-proxy/helpers.ts
git mv reverse-proxy/helpers.test.ts modules/reverse-proxy/helpers.test.ts
git mv reverse-proxy/index.ts modules/reverse-proxy/index.ts
git mv reverse-proxy/module.ts modules/reverse-proxy/module.ts
git mv reverse-proxy/module.test.ts modules/reverse-proxy/module.test.ts
git mv reverse-proxy/run.ts modules/reverse-proxy/run.ts
git mv reverse-proxy/run.test.ts modules/reverse-proxy/run.test.ts
git mv reverse-proxy/pipeline.harness.test.ts modules/reverse-proxy/pipeline.harness.test.ts
git mv reverse-proxy/pipeline.order.test.ts modules/reverse-proxy/pipeline.order.test.ts
git mv reverse-proxy/lanes/openai.ts modules/reverse-proxy/lanes/openai.ts
git mv reverse-proxy/lanes/openai.test.ts modules/reverse-proxy/lanes/openai.test.ts
git mv reverse-proxy/lanes/anthropic.ts modules/reverse-proxy/lanes/anthropic.ts
git mv reverse-proxy/lanes/anthropic.test.ts modules/reverse-proxy/lanes/anthropic.test.ts
rmdir reverse-proxy/lanes reverse-proxy
```

- [ ] **Step 2: Fix root-file import depth**

```bash
cd modules/reverse-proxy
sed -i '' \
  -e "s#'\\.\\./core/index\\.js'#'../../core/index.js'#" \
  -e "s#'\\.\\./core/tokens\\.js'#'../../core/tokens.js'#" \
  -e "s#'\\.\\./modules/pii/piiScrubber\\.js'#'../pii/piiScrubber.js'#" \
  -e "s#'\\.\\./modules/guardrails/guardrails\\.js'#'../guardrails/guardrails.js'#" \
  -e "s#'\\.\\./modules/logging/traceStore\\.js'#'../logging/traceStore.js'#" \
  -e "s#'\\.\\./modules/config/loader\\.js'#'../config/loader.js'#" \
  context.ts helpers.ts helpers.test.ts run.ts module.ts module.test.ts run.test.ts pipeline.harness.test.ts
cd ../..
```

- [ ] **Step 3: Fix `lanes/` import depth**

```bash
sed -i '' \
  -e "s#'\\.\\./\\.\\./core/index\\.js'#'../../../core/index.js'#" \
  -e "s#'\\.\\./\\.\\./modules/config/loader\\.js'#'../../config/loader.js'#" \
  -e "s#'\\.\\./\\.\\./modules/logging/traceStore\\.js'#'../../logging/traceStore.js'#" \
  -e "s#'\\.\\./\\.\\./modules/notifications/emitter\\.js'#'../../notifications/emitter.js'#" \
  -e "s#'\\.\\./\\.\\./llm/executor\\.js'#'../execute.js'#" \
  -e "s#'\\.\\./\\.\\./routes/openaiOAuthForward\\.js'#'../../../routes/openaiOAuthForward.js'#" \
  -e "s#'\\.\\./\\.\\./routes/oauthForward\\.js'#'../../../routes/oauthForward.js'#" \
  modules/reverse-proxy/lanes/openai.ts modules/reverse-proxy/lanes/anthropic.ts
```

- [ ] **Step 4: Verify with grep**

```bash
grep -rn "'\\.\\./modules/\|'\\.\\./core/\|llm/executor\|'\\.\\./\\.\\./routes/" modules/reverse-proxy/
```

Expected: no output (every reference now correctly repointed; the only remaining `modules/` or `core/` matches, if any, should show the correct new depth — re-inspect manually if this prints anything).

- [ ] **Step 5: Typecheck (still expect the 20 external-consumer errors from Task 3 — confirm nothing else)**

```bash
npm run typecheck --workspace=packages/service 2>&1 | grep -v "TS2307.*reverse-proxy\|TS2307.*llm/executor"
```

Expected: empty output (all remaining errors are exactly the known external-consumer breakage Task 3 fixes next; anything else here is a real bug in this task's depth fixes).

---

### Task 3: Repoint the 20 external consumer files

**Files (grouped by fix, all confirmed via exhaustive grep, none require depth beyond what's shown):**

*Group A — `server.ts` (1 file):*
- `server.ts` line 22: `'./reverse-proxy/index.js'` → `'./modules/reverse-proxy/index.js'`

*Group B — `routes/` (2 files):*
- `routes/anthropic.ts` line 3: `'../reverse-proxy/index.js'` → `'../modules/reverse-proxy/index.js'`
- `routes/openai.ts` line 4: `'../reverse-proxy/index.js'` → `'../modules/reverse-proxy/index.js'`

*Group C — `modules/*.test.ts` direct children of `modules/` (2 files, one level shallower than the nested-module files below):*
- `modules/cache.test.ts` line 4: `'../reverse-proxy/context.js'` → `'./reverse-proxy/context.js'`
- `modules/ordering.test.ts` line 4: `'../reverse-proxy/context.js'` → `'./reverse-proxy/context.js'`

*Group D — nested `modules/X/*.ts` files referencing `context.js`/`helpers.js` (12 files, all `'../../reverse-proxy/...'` → `'../reverse-proxy/...'`):*
- `modules/pii/index.ts` (2 lines: `context.js`, `helpers.js`)
- `modules/pii/index.test.ts` (1 line: `context.js`)
- `modules/guardrails/index.ts` (2 lines: `context.js`, `helpers.js`)
- `modules/guardrails/index.test.ts` (1 line: `context.js`)
- `modules/usage/index.ts` (1 line: `context.js`)
- `modules/usage/index.test.ts` (1 line: `context.js`)
- `modules/routing/index.ts` (1 line: `context.js`)
- `modules/routing/index.test.ts` (1 line: `context.js`)
- `modules/logging/index.ts` (1 line: `context.js`)
- `modules/logging/index.test.ts` (1 line: `context.js`)
- `modules/budget/index.ts` (1 line: `context.js`)
- `modules/budget/index.test.ts` (1 line: `context.js`)

*Group E — nested `modules/X/*.ts` files referencing `llm/executor.js` (2 files, `'../../llm/executor.js'` → `'../reverse-proxy/execute.js'`):*
- `modules/guardrails/index.ts` line 7: `import { BudgetExceededError } from '../../llm/executor.js'` → `'../reverse-proxy/execute.js'`
- `modules/guardrails/index.test.ts` line 6: same fix

*Group F — `modules/guardrails/guardrails.ts` + `.test.ts` (2 files, `'../../llm/executor.js'` → `'../reverse-proxy/execute.js'`, includes a `vi.mock`):*
- `modules/guardrails/guardrails.ts` lines 14-15 (static imports)
- `modules/guardrails/guardrails.test.ts` line 4 (`vi.mock`) + line 19 (static import)

*Group G — `modules/routing/policies/llm.ts` + `.test.ts` (2 files, one level deeper: `'../../../llm/executor.js'` → `'../../reverse-proxy/execute.js'`, includes a `vi.mock`):*
- `modules/routing/policies/llm.ts` lines 3, 5 (static imports)
- `modules/routing/policies/llm.test.ts` line 4 (`vi.mock`) + line 15 (static import)

**Interfaces:**
- Consumes: `modules/reverse-proxy/{index,context,helpers,execute}.js`'s existing exports — no signature changes, path-only.

- [ ] **Step 1: Group A + B (top-level routes/server)**

```bash
cd packages/service/src
sed -i '' "s#'\\./reverse-proxy/index\\.js'#'./modules/reverse-proxy/index.js'#" server.ts
sed -i '' "s#'\\.\\./reverse-proxy/index\\.js'#'../modules/reverse-proxy/index.js'#" routes/anthropic.ts routes/openai.ts
```

- [ ] **Step 2: Group C (direct `modules/` children)**

```bash
sed -i '' "s#'\\.\\./reverse-proxy/context\\.js'#'./reverse-proxy/context.js'#" modules/cache.test.ts modules/ordering.test.ts
```

- [ ] **Step 3: Group D (nested modules, context/helpers)**

```bash
sed -i '' "s#'\\.\\./\\.\\./reverse-proxy/context\\.js'#'../reverse-proxy/context.js'#" \
  modules/pii/index.ts modules/pii/index.test.ts \
  modules/guardrails/index.ts modules/guardrails/index.test.ts \
  modules/usage/index.ts modules/usage/index.test.ts \
  modules/routing/index.ts modules/routing/index.test.ts \
  modules/logging/index.ts modules/logging/index.test.ts \
  modules/budget/index.ts modules/budget/index.test.ts

sed -i '' "s#'\\.\\./\\.\\./reverse-proxy/helpers\\.js'#'../reverse-proxy/helpers.js'#" \
  modules/pii/index.ts modules/guardrails/index.ts
```

- [ ] **Step 4: Group E + F (guardrails' llm/executor refs)**

```bash
sed -i '' "s#'\\.\\./\\.\\./llm/executor\\.js'#'../reverse-proxy/execute.js'#" \
  modules/guardrails/index.ts modules/guardrails/index.test.ts \
  modules/guardrails/guardrails.ts modules/guardrails/guardrails.test.ts
```

- [ ] **Step 5: Group G (routing/policies' llm/executor refs)**

```bash
sed -i '' "s#'\\.\\./\\.\\./\\.\\./llm/executor\\.js'#'../../reverse-proxy/execute.js'#" \
  modules/routing/policies/llm.ts modules/routing/policies/llm.test.ts
```

- [ ] **Step 6: Verify with grep (must return nothing)**

```bash
grep -rln "llm/executor\|'\\.\\./reverse-proxy/\|'\\.\\./\\.\\./reverse-proxy/\|'\\./reverse-proxy/index" --include='*.ts' . | grep -v "^\\./modules/reverse-proxy/"
```

Re-run with the exact old-path patterns from the tables above (`'../../reverse-proxy/context.js'`, `'../../reverse-proxy/helpers.js'`, `'./reverse-proxy/index.js'` outside `server.ts`, etc.) to confirm zero survivors; the command above is a broad safety net, not the primary check — the per-group greps after each sed (implicit — inspect `git diff` for each file if anything looks off) are the primary verification.

- [ ] **Step 7: Typecheck**

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
  src/modules/reverse-proxy/ \
  src/modules/guardrails/ \
  src/modules/routing/ \
  src/modules/pii/ \
  src/modules/usage/ \
  src/modules/logging/ \
  src/modules/budget/ \
  src/modules/cache.test.ts \
  src/modules/ordering.test.ts \
  src/routes/openai.test.ts \
  src/routes/anthropic.test.ts \
  src/server.test.ts \
  src/server.telemetry.test.ts
```

Expected: all pass, same counts as pre-move baseline.

- [ ] **Step 2: Full-suite regression**

```bash
npx vitest run
```

Expected: identical pre-existing baseline (3 failed / 2151 passed: `oauthForward.test.ts` x2, `modules/provider/anthropic.test.ts` x1) — zero new failures.

- [ ] **Step 3: Commit in the same granularity as prior steps (move, then consumer repoint)**

```bash
cd "$(git rev-parse --show-toplevel)"
git add packages/service/src/modules/reverse-proxy
git commit -m "refactor(reverse-proxy): move llm/executor.ts and reverse-proxy/ into modules/reverse-proxy/"
git add packages/service/src/server.ts packages/service/src/routes/anthropic.ts \
  packages/service/src/routes/openai.ts packages/service/src/modules/cache.test.ts \
  packages/service/src/modules/ordering.test.ts packages/service/src/modules/pii \
  packages/service/src/modules/guardrails packages/service/src/modules/usage \
  packages/service/src/modules/routing packages/service/src/modules/logging \
  packages/service/src/modules/budget
git commit -m "refactor(reverse-proxy): repoint external consumers to modules/reverse-proxy/"
```

---

### Task 5: Manual curl smoke test (extra diligence — live request path)

Not a rollout gate (see Architecture note — no dark/flip mechanism exists here), just a direct sanity check that the moved-and-repointed pipeline still serves real traffic identically, since `reverse-proxy/` is the actual OpenAI/Anthropic request path.

- [ ] **Step 1: Start the local service** (see `CLAUDE.local.md` for `ROUTERLY_HOME`, port, test project token)

```bash
routerly service start 2>/dev/null || npm run dev --workspace=packages/service
```

- [ ] **Step 2: Byte-diff a real chat completion against a known-good pre-change response** (using the local Ollama provider from `CLAUDE.local.md`, non-stream and stream)

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $ROUTERLY_TEST_PROJECT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3:4b","messages":[{"role":"user","content":"say OK"}],"stream":false}' | head -c 500
```

Expected: a normal OpenAI-shaped chat completion response, HTTP 200, no error. Repeat with `"stream": true` and confirm SSE chunks arrive in the expected `data: {...}` shape, terminated by `data: [DONE]`.

- [ ] **Step 2: Update progress ledger** (gitignored, not committed) — append the Step 13 completion entry, replace "Next: Step 13..." with "Next: Step 14 (modules/api-reverse-proxy/, wraps routes/openai.ts, anthropic.ts, passthrough.ts)".
