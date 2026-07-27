# Step 3 — modules/config/ Full Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `modules/config/` currently just wraps `config/loader.ts`'s functions behind the `CONFIG_STORE` token (predisposition only, per Plan 2 of the 0.4.0 refactory). This step physically relocates `config/loader.ts` and `config/migrate.ts` (and their tests) into `modules/config/`, so the module owns the real implementation. Every one of the 51 real consumer files across the codebase is repointed to the new path.

**Architecture:** `git mv` the 5 files (`loader.ts`, `loader.test.ts`, `loader.race.test.ts`, `migrate.ts`, `migrate.test.ts`) into `modules/config/`. Fix the 2 files' own `../lib/paths.js` import (now one directory deeper: `../../lib/paths.js`). `migrate.ts`'s `./loader.js` import stays unchanged (sibling). Update `modules/config/index.ts`/`index.test.ts` to import from `./loader.js` (sibling, was `../../config/loader.js`). Mechanically repoint the 51 external consumers via exact string substitution (`config/loader.js` → `modules/config/loader.js`, `config/migrate.js` → `modules/config/migrate.js`), confirmed safe since the substring's leading `./`/`../`/`../../` is untouched and no file outside this set currently contains that substring.

**Tech Stack:** TypeScript ESM, Vitest.

## Global Constraints

- Wire-format transparency ABSOLUTE — pure import-path change, zero behavior change, zero payload/header change.
- Feature-parity ABSOLUTE — every function's exported signature and runtime behavior stays byte-identical.
- Imports: `.js` extension on relative imports.
- No em dashes anywhere.
- Verify with `npx vitest run` and `npx tsc --noEmit` (or `npm run typecheck --workspace=packages/service`) from `packages/service/`.
- Baseline to compare against (per `.superpowers/sdd/progress.md`): 3 pre-existing unrelated failures (`routes/oauthForward.test.ts` x2, `providers/anthropic.test.ts` x1). No new failures allowed.

---

### Task 1: Move the 5 files into `modules/config/` and fix their own imports

**Files:**
- Move: `config/loader.ts` → `modules/config/loader.ts`
- Move: `config/loader.test.ts` → `modules/config/loader.test.ts`
- Move: `config/loader.race.test.ts` → `modules/config/loader.race.test.ts`
- Move: `config/migrate.ts` → `modules/config/migrate.ts`
- Move: `config/migrate.test.ts` → `modules/config/migrate.test.ts`
- Modify: `modules/config/index.ts`
- Modify: `modules/config/index.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: identical exports as before (`AuditEntry`, `initConfigDirs`, `readConfig`, `writeConfig`, `appendUsageRecord`, `pruneOrphanUsage`, `getOrCreateSecret` from `loader.ts`; `migrateProjectConfigs` from `migrate.ts`), now importable from `modules/config/loader.js`/`modules/config/migrate.js` instead of `config/loader.js`/`config/migrate.js`.

- [ ] **Step 1: Move the 5 files with git mv**

```bash
git mv packages/service/src/config/loader.ts packages/service/src/modules/config/loader.ts
git mv packages/service/src/config/loader.test.ts packages/service/src/modules/config/loader.test.ts
git mv packages/service/src/config/loader.race.test.ts packages/service/src/modules/config/loader.race.test.ts
git mv packages/service/src/config/migrate.ts packages/service/src/modules/config/migrate.ts
git mv packages/service/src/config/migrate.test.ts packages/service/src/modules/config/migrate.test.ts
```

- [ ] **Step 2: Fix `modules/config/loader.ts`'s own import (one directory deeper)**

Change line 6 from:
```ts
import { CONFIG_PATHS } from '../lib/paths.js';
```
to:
```ts
import { CONFIG_PATHS } from '../../lib/paths.js';
```
`migrate.ts`'s `import { readConfig, writeConfig } from './loader.js';` is unchanged — both files are still siblings after the move.

- [ ] **Step 3: Fix `modules/config/loader.test.ts`'s `vi.mock` target and `modules/config/loader.race.test.ts`'s import (both one directory deeper)**

In `loader.test.ts`, change:
```ts
vi.mock('../lib/paths.js', () => ({
```
to:
```ts
vi.mock('../../lib/paths.js', () => ({
```
(the mocked object body is unchanged; `import { readConfig, writeConfig, initConfigDirs, getOrCreateSecret, appendUsageRecord, pruneOrphanUsage } from './loader.js'` stays `./loader.js`, sibling).

In `loader.race.test.ts`, change:
```ts
import { CONFIG_PATHS } from '../lib/paths.js';
```
to:
```ts
import { CONFIG_PATHS } from '../../lib/paths.js';
```
(`import { readConfig, writeConfig, initConfigDirs } from './loader.js';` stays `./loader.js`, sibling).

`migrate.test.ts` needs no import changes at all — its `vi.mock('./loader.js', ...)` and `import { migrateProjectConfigs } from './migrate.js'` / `import { readConfig, writeConfig } from './loader.js'` are all sibling-relative and already correct post-move.

- [ ] **Step 4: Update `modules/config/index.ts` (sibling import, was two levels up)**

Change:
```ts
import { defineModule } from '../../core/index.js'
import { CONFIG_STORE } from '../../core/tokens.js'
import { readConfig, writeConfig, appendUsageRecord } from '../../config/loader.js'

/**
 * Config module: the first Routerly module. Its only job is to expose the
 * existing, already-tested config/loader.ts functions behind the CONFIG_STORE
 * DI token. No logic is copied: the token value is literally the real function
 * references. Routes continue to import config/loader.ts directly; this module
 * only makes the same functions reachable through the container for later plans.
 */
export const configModule = defineModule({
  manifest: { id: 'config', version: '0.4.0' },
  register({ container }) {
    container.register(CONFIG_STORE, { readConfig, writeConfig, appendUsageRecord })
  },
})
```
to:
```ts
import { defineModule } from '../../core/index.js'
import { CONFIG_STORE } from '../../core/tokens.js'
import { readConfig, writeConfig, appendUsageRecord } from './loader.js'

/**
 * Config module: owns the real config store implementation (loader.ts,
 * migrate.ts) and exposes readConfig/writeConfig/appendUsageRecord behind
 * the CONFIG_STORE DI token. Other files still import loader.ts functions
 * directly by path; this module additionally makes them reachable through
 * the container.
 */
export const configModule = defineModule({
  manifest: { id: 'config', version: '0.4.0' },
  register({ container }) {
    container.register(CONFIG_STORE, { readConfig, writeConfig, appendUsageRecord })
  },
})
```

- [ ] **Step 5: Update `modules/config/index.test.ts` (sibling import)**

Change both occurrences of:
```ts
import { readConfig, writeConfig, appendUsageRecord } from '../../config/loader.js'
```
to:
```ts
import { readConfig, writeConfig, appendUsageRecord } from './loader.js'
```
(one is a top-level import, used identically elsewhere in the file — same single-line change).

- [ ] **Step 6: Run the moved files' own tests**

Run: `npx vitest run src/modules/config/loader.test.ts src/modules/config/loader.race.test.ts src/modules/config/migrate.test.ts src/modules/config/index.test.ts` (from `packages/service/`)
Expected: PASS, all tests, same counts as before the move.

- [ ] **Step 7: Commit**

```bash
git add -A packages/service/src/modules/config packages/service/src/config
git commit -m "refactor(config): move loader and migrate into modules/config"
```

---

### Task 2: Repoint the 51 external consumers

**Files:** the exact 51 files listed below (every file, both source and test, that imports `config/loader.js` or `config/migrate.js` anywhere in the repo, confirmed by full-repo grep):

```
server.telemetry.test.ts
server.test.ts
server.ts
middleware/guardrails.ts
middleware/guardrails.test.ts
core/tokens.ts
plugins/jwt.ts
plugins/jwt.test.ts
plugins/auth.test.ts
plugins/auth.ts
catalog/sync.ts
catalog/sync.test.ts
cost/usageStore.ts
cost/usageStore.test.ts
cost/budget.test.ts
cost/tracker.ts
cost/tracker.test.ts
integrations/runner.ts
integrations/runner.test.ts
integrations/metrics-snapshot.ts
integrations/metrics-snapshot.test.ts
audit/logger.ts
audit/logger.test.ts
routing/router.ts
routing/router.test.ts
routing/policies/budget-remaining.ts
routing/policies/budget-remaining.test.ts
routing/policies/semantic-intent.ts
routing/policies/semantic-intent.test.ts
routing/policies/fairness.test.ts
routing/policies/rate-limit.test.ts
routing/policies/performance.test.ts
routing/policies/llm.ts
routing/policies/llm.test.ts
routing/policies/health.test.ts
modules/ordering.test.ts
modules/usage.test.ts
routes/api.sessions.test.ts
routes/metrics.test.ts
routes/openai.ts
routes/openai.test.ts
routes/passthrough.ts
routes/passthrough.test.ts
routes/api.ts
routes/metrics.ts
notifications/emitter.ts
notifications/emitter.test.ts
reverse-proxy/pipeline.harness.test.ts
reverse-proxy/lanes/openai.ts
reverse-proxy/lanes/anthropic.ts
routes/api.test.ts
```
(all paths relative to `packages/service/src/`)

**Interfaces:**
- Consumes: `readConfig`, `writeConfig`, `appendUsageRecord`, `getOrCreateSecret`, `pruneOrphanUsage`, `initConfigDirs`, `migrateProjectConfigs`, `AuditEntry` (type, only via `audit/logger.ts`'s re-export, no direct external consumer) — all now at `modules/config/loader.js` / `modules/config/migrate.js`.
- Produces: nothing new — this task only changes import specifiers, zero logic changes.

- [ ] **Step 1: Mechanical substitution across all 51 files**

Every match in every one of these 51 files is the literal substring `config/loader.js` or `config/migrate.js`, always preceded by `./`, `../`, or `../../` (verified by full-repo grep — no other depth or form exists, and no file outside this set contains either substring). A plain substring replace is exact and safe:

```bash
cd packages/service/src
files="server.telemetry.test.ts server.test.ts server.ts middleware/guardrails.ts middleware/guardrails.test.ts core/tokens.ts plugins/jwt.ts plugins/jwt.test.ts plugins/auth.test.ts plugins/auth.ts catalog/sync.ts catalog/sync.test.ts cost/usageStore.ts cost/usageStore.test.ts cost/budget.test.ts cost/tracker.ts cost/tracker.test.ts integrations/runner.ts integrations/runner.test.ts integrations/metrics-snapshot.ts integrations/metrics-snapshot.test.ts audit/logger.ts audit/logger.test.ts routing/router.ts routing/router.test.ts routing/policies/budget-remaining.ts routing/policies/budget-remaining.test.ts routing/policies/semantic-intent.ts routing/policies/semantic-intent.test.ts routing/policies/fairness.test.ts routing/policies/rate-limit.test.ts routing/policies/performance.test.ts routing/policies/llm.ts routing/policies/llm.test.ts routing/policies/health.test.ts modules/ordering.test.ts modules/usage.test.ts routes/api.sessions.test.ts routes/metrics.test.ts routes/openai.ts routes/openai.test.ts routes/passthrough.ts routes/passthrough.test.ts routes/api.ts routes/metrics.ts notifications/emitter.ts notifications/emitter.test.ts reverse-proxy/pipeline.harness.test.ts reverse-proxy/lanes/openai.ts reverse-proxy/lanes/anthropic.ts routes/api.test.ts"
for f in $files; do
  sed -i '' 's/config\/loader\.js/modules\/config\/loader.js/g; s/config\/migrate\.js/modules\/config\/migrate.js/g' "$f"
done
```

- [ ] **Step 2: Verify no remaining old-path references and no accidental double-prefix**

```bash
grep -rn "[^/]config/loader\.js\|[^/]config/migrate\.js" --include="*.ts" . | grep -v "modules/config/loader\.js\|modules/config/migrate\.js"
```
Expected: empty output (every reference now goes through `modules/config/`).

```bash
grep -rln "modules/modules/config" --include="*.ts" .
```
Expected: empty output (confirms no file was already using the new path and got double-prefixed).

- [ ] **Step 3: Run the full suite and typecheck**

Run: `npx vitest run` (from `packages/service/`)
Expected: same pass/fail counts as the pre-Step-3 baseline (3 pre-existing unrelated failures only, no new failures).

Run: `npx tsc --noEmit` (or `npm run typecheck --workspace=packages/service`)
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add -A packages/service/src
git commit -m "refactor(config): repoint all consumers to modules/config"
```

---

## Self-Review

**1. Spec coverage:** overview doc's Step 3 = "modules/config/ full extraction." Task 1 does the physical move + fixes the 2 files' own broken relative import + the module wrapper's now-sibling import. Task 2 repoints every real external consumer (51 files, exhaustively grepped, not sampled). Nothing left importing the old `config/loader.js`/`config/migrate.js` paths.

**2. Placeholder scan:** none — every file list, line number, and exact old/new import text was taken from a live grep against the actual current repo state (via the Explore research pass), not reconstructed from memory.

**3. Type consistency:** exported names (`readConfig`, `writeConfig`, `appendUsageRecord`, `getOrCreateSecret`, `pruneOrphanUsage`, `initConfigDirs`, `migrateProjectConfigs`, `AuditEntry`) are unchanged — this plan only moves files and rewrites import specifiers, never touches a signature.

No gaps found. Plan ready.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-27-modular-step3-config-extraction.md`. Both tasks are fully mechanical (git mv + fixed relative imports + verified-safe substring substitution across an exhaustively-grepped file list) with a deterministic verify gate (grep for stragglers + full suite + tsc). Executing directly (no implementer/reviewer subagent split — matches this branch's established precedent for "mechanical, grep-gated" tasks, e.g. ledger entries for Plan 5 Tasks 10-11), with live verification via Bash before each commit.
