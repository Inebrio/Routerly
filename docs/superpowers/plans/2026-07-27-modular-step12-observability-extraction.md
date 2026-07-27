# Step 12: modules/observability/ Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `packages/service/src/integrations/` (datadog, otel, influxdb, grafana, webhook, metrics-snapshot, runner + tests) into `packages/service/src/modules/observability/`, add an `OBSERVABILITY` DI token and a flat-wrap `modules/observability/index.ts`, repoint the two real external consumers (`routes/metrics.ts`, `server.ts`), and fix internal import depth. No behavior change; wire format, route paths, and metrics/runner output stay byte-identical.

**Architecture:** Same flat-wrap pattern used for Steps 5/6/11 (catalog, embeddings, audit/auth/notifications): move files as-is, register real functions under a new token via a small `defineModule` wrapper. The wrapper is NOT added to `coreModules`/`buildKernel` — no existing consumer resolves through the container for audit/auth/notifications/embeddings either (confirmed precedent), so observability follows the same rule until an actual container-resolution consumer exists.

**Tech Stack:** TypeScript ESM, Vitest, existing `core/tokens.ts` token pattern (`core/index.ts`'s `token()` + `defineModule()`).

## Global Constraints

- Wire-format transparency ABSOLUTE — no request/response payload or header changes (this step touches no route handler logic, only import paths and file locations).
- Feature-parity ABSOLUTE — `/api/metrics`, `/api/integrations*` routes, and the background integration runner must behave identically before/after.
- No em-dashes anywhere (code/comments/docs/commits).
- Imports: `.js` extension on relative imports; `node:` prefix on builtins (already followed in source files, preserve on edit).
- Commit subjects: all-lowercase (commitlint `subject-case`), body lines ≤100 chars (commitlint `body-max-line-length`).
- `vi.mock('...')` string targets must be grepped and fixed explicitly — they are invisible to `tsc` and were the root cause of two missed-consumer bugs in Step 11 (`server.test.ts`, `server.telemetry.test.ts`). Do not rely on a static-import-only grep pass.
- Confirmed via research: `routes/api.ts`'s `/api/integrations/:id/test` handler does NOT import any file under `integrations/` — its per-type test logic (`prometheus`/`otel`/`datadog`/`grafana`/`influxdb`/`webhook`) is implemented inline with raw `fetch()` calls, independent of `integrations/{otel,datadog,grafana,influxdb,webhook}.ts`'s `push*` functions (which are used only by `integrations/runner.ts` for scheduled pushes). `routes/api.ts` and `routes/api.test.ts` need NO import changes in this step — verified by grep, no `integrations/` import lines present in either file (only `/api/integrations` URL path strings, which are unrelated string literals).

---

### Task 1: Move `integrations/` to `modules/observability/` and fix internal import depth

**Files:**
- Move (git mv): `integrations/datadog.ts`, `integrations/datadog.test.ts`, `integrations/otel.ts`, `integrations/otel.test.ts`, `integrations/influxdb.ts`, `integrations/influxdb.test.ts`, `integrations/grafana.ts`, `integrations/grafana.test.ts`, `integrations/webhook.ts`, `integrations/webhook.test.ts`, `integrations/metrics-snapshot.ts`, `integrations/metrics-snapshot.test.ts`, `integrations/runner.ts`, `integrations/runner.test.ts` → same basenames under `modules/observability/`.
- Modify: `modules/observability/runner.ts`, `modules/observability/runner.test.ts`, `modules/observability/metrics-snapshot.test.ts` (depth fixes below).

**Interfaces:**
- Consumes: nothing new — these files are self-contained plus `../modules/config/loader.js` (`readConfig`) and `../modules/budget/budget.js` (`getLimitUsageSnapshot`), both already extracted in Steps 3/7.
- Produces: `modules/observability/{datadog,otel,influxdb,grafana,webhook,metrics-snapshot,runner}.ts`, importable by Task 3's consumer repoint and Task 2's token wrapper.

Research (already done, do not re-derive): grep of every file under `integrations/` for `^import` shows exactly two families of external reference needing depth fixes after the move (one directory level deeper, `../` → `../../`):
- `runner.ts` line 1: `import { readConfig } from '../modules/config/loader.js';` → `'../../modules/config/loader.js'`
- `metrics-snapshot.ts` line 2: `import { readConfig } from '../modules/config/loader.js';` → `'../../modules/config/loader.js'`
- `metrics-snapshot.ts` line 3: `import { getLimitUsageSnapshot } from '../modules/budget/budget.js';` → `'../../modules/budget/budget.js'`
- `runner.test.ts` line 16: `vi.mock('../modules/config/loader.js', ...)` → `vi.mock('../../modules/config/loader.js', ...)`
- `metrics-snapshot.test.ts` line 9: `vi.mock('../modules/config/loader.js', ...)` → `vi.mock('../../modules/config/loader.js', ...)`
- `metrics-snapshot.test.ts` line 10: `vi.mock('../modules/budget/budget.js', ...)` → `vi.mock('../../modules/budget/budget.js', ...)`

All other internal references (`./metrics-snapshot.js`, `./otel.js`, `./datadog.js`, `./grafana.js`, `./influxdb.js`, `./webhook.js`, `./runner.js`) are sibling-to-sibling within the moved set and need NO change (same relative depth after the move — confirmed, all 7 non-test + 7 test files move together into the same new directory).

- [ ] **Step 1: Create the directory and move files**

```bash
cd packages/service/src
mkdir -p modules/observability
git mv integrations/datadog.ts modules/observability/datadog.ts
git mv integrations/datadog.test.ts modules/observability/datadog.test.ts
git mv integrations/otel.ts modules/observability/otel.ts
git mv integrations/otel.test.ts modules/observability/otel.test.ts
git mv integrations/influxdb.ts modules/observability/influxdb.ts
git mv integrations/influxdb.test.ts modules/observability/influxdb.test.ts
git mv integrations/grafana.ts modules/observability/grafana.ts
git mv integrations/grafana.test.ts modules/observability/grafana.test.ts
git mv integrations/webhook.ts modules/observability/webhook.ts
git mv integrations/webhook.test.ts modules/observability/webhook.test.ts
git mv integrations/metrics-snapshot.ts modules/observability/metrics-snapshot.ts
git mv integrations/metrics-snapshot.test.ts modules/observability/metrics-snapshot.test.ts
git mv integrations/runner.ts modules/observability/runner.ts
git mv integrations/runner.test.ts modules/observability/runner.test.ts
rmdir integrations
```

- [ ] **Step 2: Fix internal import depth (sed, then verify with grep)**

```bash
sed -i '' "s#'\\.\\./modules/config/loader\\.js'#'../../modules/config/loader.js'#" \
  modules/observability/runner.ts modules/observability/runner.test.ts \
  modules/observability/metrics-snapshot.ts modules/observability/metrics-snapshot.test.ts
sed -i '' "s#'\\.\\./modules/budget/budget\\.js'#'../../modules/budget/budget.js'#" \
  modules/observability/metrics-snapshot.ts modules/observability/metrics-snapshot.test.ts
grep -n "modules/config/loader\|modules/budget/budget" modules/observability/runner.ts modules/observability/runner.test.ts modules/observability/metrics-snapshot.ts modules/observability/metrics-snapshot.test.ts
```

Expected: every match shows `../../modules/...` (never bare `../modules/...`).

- [ ] **Step 3: Run typecheck and the moved test files**

```bash
npm run typecheck --workspace=packages/service
npx vitest run src/modules/observability/ --root packages/service
```

Expected: typecheck clean; all observability tests pass (same counts as before the move — no logic changed, only paths).

- [ ] **Step 4: Commit**

```bash
git add -A modules/observability
git commit -m "refactor(observability): move integrations/ into modules/observability/"
```

---

### Task 2: Add `OBSERVABILITY` DI token and `modules/observability/index.ts` wrapper

**Files:**
- Modify: `core/tokens.ts` (add `OBSERVABILITY` token, inserted after `NOTIFICATIONS`, before `ROUTER`).
- Create: `modules/observability/index.ts`.

**Interfaces:**
- Consumes: `getMetricsSnapshot` (from `./metrics-snapshot.js`), `startIntegrationRunner` (from `./runner.js`) — the two functions actually used outside this module (by `routes/metrics.ts` and `server.ts` respectively). Do NOT include `push*`/`percentile`/`escapeLabel`/etc private helpers — precedent (`AUDIT`, `AUTH`, `NOTIFICATIONS` tokens) exposes only the functions real external consumers need, not every export.
- Produces: `OBSERVABILITY` token importable from `../../core/tokens.js`; `observabilityModule` export from `modules/observability/index.ts` (unused/unregistered, matching `embeddingsModule`/`auditModule` precedent — do not add to `coreModules` or `buildKernel`).

- [ ] **Step 1: Add the token**

In `core/tokens.ts`, insert immediately after the existing `NOTIFICATIONS` token block (before `ROUTER`):

```ts
export const OBSERVABILITY = token<{
  getMetricsSnapshot: typeof import('../modules/observability/metrics-snapshot.js').getMetricsSnapshot;
  startIntegrationRunner: typeof import('../modules/observability/runner.js').startIntegrationRunner;
}>('observability.registry');
```

- [ ] **Step 2: Create the wrapper module**

Create `modules/observability/index.ts`:

```ts
import { defineModule } from '../../core/index.js';
import { OBSERVABILITY } from '../../core/tokens.js';
import { getMetricsSnapshot } from './metrics-snapshot.js';
import { startIntegrationRunner } from './runner.js';

/**
 * Observability module: owns the real integrations implementation
 * (metrics-snapshot.ts, runner.ts, datadog/otel/influxdb/grafana/webhook
 * push functions) and exposes it behind the OBSERVABILITY DI token. Other
 * files still import metrics-snapshot.ts/runner.ts directly by path; this
 * module additionally makes it reachable through the container.
 */
export const observabilityModule = defineModule({
  manifest: { id: 'observability', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container }) {
    container.register(OBSERVABILITY, {
      getMetricsSnapshot,
      startIntegrationRunner,
    });
  },
});
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck --workspace=packages/service
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add core/tokens.ts modules/observability/index.ts
git commit -m "feat(observability): add observability di token and module wrapper"
```

---

### Task 3: Repoint external consumers (`routes/metrics.ts`, `server.ts`)

**Files:**
- Modify: `routes/metrics.ts` (line 11: `'../integrations/metrics-snapshot.js'` → `'../modules/observability/metrics-snapshot.js'`).
- Modify: `server.ts` (line 17: `'./integrations/runner.js'` → `'./modules/observability/runner.js'`).

**Interfaces:**
- Consumes: `modules/observability/metrics-snapshot.js`'s and `runner.js`'s existing exports (unchanged signatures — this task only changes the import path string, not what is imported).

Research (already done): grep of `import.*integrations/` and `vi.mock(.*integrations` across all of `src` (excluding the moved directory itself) found exactly these two live references. `routes/api.ts`/`routes/api.test.ts` have zero `integrations/` import or `vi.mock` lines (confirmed in Task 1's constraints note — only unrelated `/api/integrations` URL-path string literals). `routes/metrics.test.ts` and `server.test.ts`/`server.telemetry.test.ts` have zero `vi.mock('...integrations...')` lines (confirmed by grep — `routes/metrics.test.ts` uses real `metrics-snapshot.ts` under mocked `config/loader.js`/`budget/budget.js`, already covered by Task 1's depth fix; `server.test.ts`/`server.telemetry.test.ts` never mock `runner.js` at all, `startIntegrationRunner()` runs for real against mocked config in both).

- [ ] **Step 1: Repoint with sed, verify with grep**

```bash
sed -i '' "s#'\\.\\./integrations/metrics-snapshot\\.js'#'../modules/observability/metrics-snapshot.js'#" routes/metrics.ts
sed -i '' "s#'\\./integrations/runner\\.js'#'./modules/observability/runner.js'#" server.ts
grep -n "integrations/" routes/metrics.ts server.ts
grep -rln "integrations/" --include='*.ts' . | grep -v node_modules
```

Expected: first grep shows both lines now pointing at `modules/observability/`; second grep (repo-wide) returns nothing (all `integrations/` references gone — the directory no longer exists and no import string references it).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck --workspace=packages/service
```

Expected: clean, zero `TS2307` (unresolved module) errors.

- [ ] **Step 3: Run targeted tests**

```bash
npx vitest run src/routes/metrics.test.ts src/server.test.ts src/server.telemetry.test.ts src/modules/observability/ --root packages/service
```

Expected: all pass, same counts as pre-move baseline.

- [ ] **Step 4: Full-suite regression**

```bash
npx vitest run --root packages/service
```

Expected: identical pre-existing baseline (3 failed / matching passed count: `oauthForward.test.ts` x2, `modules/provider/anthropic.test.ts` x1) — zero new failures.

- [ ] **Step 5: Commit**

```bash
git add routes/metrics.ts server.ts
git commit -m "refactor(observability): repoint external consumers to modules/observability/"
```

---

### Task 4: Update progress ledger

**Files:**
- Modify (gitignored, not committed): `.superpowers/sdd/progress.md`.

- [ ] **Step 1:** Append a Step 12 completion entry (commit hashes from Tasks 1-3, plan doc path, task summary, final regression numbers), replacing the "Next: Step 12..." pointer with "Next: Step 13 (modules/reverse-proxy/, absorbs llm/executor.ts as execute.ts)".
