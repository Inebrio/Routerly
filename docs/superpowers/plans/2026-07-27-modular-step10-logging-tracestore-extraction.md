# Step 10: modules/logging/ Extraction + traceStore Absorption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `src/routing/traceStore.ts` (+test) into `src/modules/logging/traceStore.ts`, absorb the pre-existing flat wrapper `src/modules/logging.ts` (+test) into `src/modules/logging/index.ts`, and repoint every external consumer. `src/routing/` becomes empty and is removed.

**Architecture:** Pure mechanical extraction, no logic changes. Same three-task shape as Steps 7/8/9: (1) move the logic file + test into the new module dir with import-depth fixes, (2) absorb the flat `defineModule` wrapper into `index.ts`/`index.test.ts` beside it (sibling-slot precedent, no naming collision), (3) repoint every external consumer file.

**Tech Stack:** TypeScript ESM, Vitest.

## Global Constraints

- Wire-format transparency ABSOLUTE — no behavior change, pure file moves + import path fixes.
- No em-dashes anywhere (code/comments/docs).
- Imports: `.js` extension; builtins `node:` prefix (per `.claude/rules/service.md`).
- Commit subjects: all-lowercase (commitlint `subject-case`); never embed a camelCase filename verbatim in a commit subject (lesson from Step 9's `piiScrubber` failure — lowercase the identifier or omit the filename).
- `git add` pathspecs: only list paths that exist post-move; a single unmatched pathspec silently drops the whole `git add` call. Run `git status --short` immediately after every `git add` and again before every `git commit`.
- No dedicated core/tokens.ts token needed — `loggingModule` registers processors directly onto `PROXY_PIPELINE`, same as guardrails/pii.

---

### Task 1: Move `traceStore.ts` + test into `modules/logging/`

**Files:**
- Move: `src/routing/traceStore.ts` → `src/modules/logging/traceStore.ts`
- Move: `src/routing/traceStore.test.ts` → `src/modules/logging/traceStore.test.ts`

**Interfaces:**
- Consumes: nothing (traceStore.ts has zero imports — only exports `TracePanel`, `TraceEntry`, `setTrace`, `appendTrace`, `getTrace`).
- Produces: same exports, now importable from `modules/logging/traceStore.js`.

- [ ] **Step 1: Move the files**

```bash
git mv src/routing/traceStore.ts src/modules/logging/traceStore.ts
git mv src/routing/traceStore.test.ts src/modules/logging/traceStore.test.ts
```

No content edits needed — the file has no imports and the test's only import is the sibling `./traceStore.js` (unchanged after the move, since both land in the same new directory).

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/modules/logging/traceStore.test.ts`
Expected: 7/7 PASS (same 7 tests as before the move).

- [ ] **Step 3: Confirm `src/routing/` is now empty**

```bash
ls -la src/routing/
```
Expected: only `.` and `..` (plus the pre-existing empty `intent/`, `policies/` leftover dirs from Step 8, which git does not track).

- [ ] **Step 4: Commit**

```bash
git add src/modules/logging/traceStore.ts src/modules/logging/traceStore.test.ts
git status --short
git commit -m "refactor(logging): move routing tracestore into modules/logging/"
```

---

### Task 2: Absorb the flat `modules/logging.ts` wrapper into `modules/logging/index.ts`

**Files:**
- Move: `src/modules/logging.ts` → `src/modules/logging/index.ts`
- Move: `src/modules/logging.test.ts` → `src/modules/logging/index.test.ts`

**Interfaces:**
- Consumes: `setTrace`, `getTrace` from the sibling `./traceStore.js` (moved in Task 1); `defineModule`, `Processor`, `RouterlyModule` from `../../core/index.js`; `PROXY_PIPELINE` from `../../core/tokens.js`; `ProxyContext` from `../../reverse-proxy/context.js`.
- Produces: `loggingModule: RouterlyModule` (unchanged export name/shape — manifest `{ id: 'logging', version: '0.4.0', dependsOn: { 'reverse-proxy': '^0.4.0' } }`, contributes `logging.ingress` (phase `ingress`, weight -100) and `logging.finalize` (phase `finalize`, after `usage.finalize`)).

- [ ] **Step 1: Move the files**

```bash
git mv src/modules/logging.ts src/modules/logging/index.ts
git mv src/modules/logging.test.ts src/modules/logging/index.test.ts
```

- [ ] **Step 2: Fix the import in `src/modules/logging/index.ts`**

Before:
```ts
import { defineModule, type Processor, type RouterlyModule } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { setTrace, getTrace } from '../routing/traceStore.js'
```

After:
```ts
import { defineModule, type Processor, type RouterlyModule } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { setTrace, getTrace } from './traceStore.js'
```

(One extra `../` for `core`/`reverse-proxy` since the file is now one directory deeper; the traceStore import collapses to a sibling import since Task 1 landed it in the same new directory.)

- [ ] **Step 3: Fix the import in `src/modules/logging/index.test.ts`**

Before:
```ts
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { getTrace } from '../routing/traceStore.js'
import { loggingModule } from './logging.js'
```

After:
```ts
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { getTrace } from './traceStore.js'
import { loggingModule } from './index.js'
```

- [ ] **Step 4: Fix `modules/index.ts` barrel**

`src/modules/index.ts`, before:
```ts
import { loggingModule } from './logging.js'
```
After:
```ts
import { loggingModule } from './logging/index.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/modules/logging src/modules/index.test.ts`
Expected: all PASS (2 logging-module tests + 7 traceStore tests + barrel test).

- [ ] **Step 6: Commit**

```bash
git add src/modules/logging/index.ts src/modules/logging/index.test.ts src/modules/index.ts
git status --short
git commit -m "refactor(logging): absorb flat module wrapper into modules/logging/"
```

---

### Task 3: Repoint every external consumer of `routing/traceStore.js`

**Files (exact before/after import line):**

1. `src/llm/executor.ts:32`
   Before: `import type { TraceEntry, TracePanel } from '../routing/traceStore.js';`
   After: `import type { TraceEntry, TracePanel } from '../modules/logging/traceStore.js';`

2. `src/modules/guardrails/index.ts:6`
   Before: `import { appendTrace } from '../../routing/traceStore.js'`
   After: `import { appendTrace } from '../logging/traceStore.js'`

3. `src/modules/pii/index.ts:6`
   Before: `import { appendTrace } from '../../routing/traceStore.js'`
   After: `import { appendTrace } from '../logging/traceStore.js'`

4. `src/modules/routing/index.ts:6-7`
   Before:
   ```ts
   import { appendTrace } from '../../routing/traceStore.js'
   import type { TraceEntry } from '../../routing/traceStore.js'
   ```
   After:
   ```ts
   import { appendTrace } from '../logging/traceStore.js'
   import type { TraceEntry } from '../logging/traceStore.js'
   ```

5. `src/modules/routing/router.ts:18`
   Before: `import type { TraceEntry, TracePanel } from '../../routing/traceStore.js';`
   After: `import type { TraceEntry, TracePanel } from '../logging/traceStore.js';`

6. `src/modules/routing/policies/types.ts:2`
   Before: `import type { TraceEntry } from '../../../routing/traceStore.js';`
   After: `import type { TraceEntry } from '../../logging/traceStore.js';`

7. `src/modules/usage/tracker.ts:4`
   Before: `import { getTrace } from '../../routing/traceStore.js';`
   After: `import { getTrace } from '../logging/traceStore.js';`

8. `src/modules/usage/tracker.test.ts:4,9`
   Before:
   ```ts
   vi.mock('../../routing/traceStore.js', () => ({ getTrace: vi.fn() }))
   ...
   import { getTrace } from '../../routing/traceStore.js'
   ```
   After:
   ```ts
   vi.mock('../logging/traceStore.js', () => ({ getTrace: vi.fn() }))
   ...
   import { getTrace } from '../logging/traceStore.js'
   ```

9. `src/reverse-proxy/context.ts:11`
   Before: `import type { TraceEntry } from '../routing/traceStore.js'`
   After: `import type { TraceEntry } from '../modules/logging/traceStore.js'`

10. `src/reverse-proxy/lanes/anthropic.ts:10-11`
    Before:
    ```ts
    import { appendTrace } from '../../routing/traceStore.js'
    import type { TraceEntry } from '../../routing/traceStore.js'
    ```
    After:
    ```ts
    import { appendTrace } from '../../modules/logging/traceStore.js'
    import type { TraceEntry } from '../../modules/logging/traceStore.js'
    ```

11. `src/reverse-proxy/lanes/openai.ts:8-9`
    Before:
    ```ts
    import { appendTrace } from '../../routing/traceStore.js'
    import type { TraceEntry } from '../../routing/traceStore.js'
    ```
    After:
    ```ts
    import { appendTrace } from '../../modules/logging/traceStore.js'
    import type { TraceEntry } from '../../modules/logging/traceStore.js'
    ```

12. `src/routes/api.ts:19`
    Before: `import { getTrace } from '../routing/traceStore.js';`
    After: `import { getTrace } from '../modules/logging/traceStore.js';`

13. `src/routes/api.test.ts:15,54`
    Before:
    ```ts
    vi.mock('../routing/traceStore.js', () => ({ getTrace: vi.fn() }))
    ...
    import { getTrace } from '../routing/traceStore.js'
    ```
    After:
    ```ts
    vi.mock('../modules/logging/traceStore.js', () => ({ getTrace: vi.fn() }))
    ...
    import { getTrace } from '../modules/logging/traceStore.js'
    ```

14. `src/routes/api.sessions.test.ts:14`
    Before: `vi.mock('../routing/traceStore.js', () => ({ getTrace: vi.fn() }))`
    After: `vi.mock('../modules/logging/traceStore.js', () => ({ getTrace: vi.fn() }))`

- [ ] **Step 1-14: Apply each edit above.**

- [ ] **Step 15: Blanket stale-reference grep**

```bash
grep -rn "routing/traceStore" src --include="*.ts"
```
Expected: no matches (confirms every consumer repointed and `routing/` fully vacated).

```bash
grep -rn "import(.*routing/traceStore" src --include="*.ts"
```
Expected: no matches (no dynamic imports of the old path).

```bash
ls src/routing/ 2>&1
```
Expected: directory gone or fully empty (`intent/`, `policies/` empty leftover dirs are fine, untracked by git).

- [ ] **Step 16: Run full verification**

```bash
npx vitest run src/modules/logging src/modules/guardrails src/modules/pii src/modules/routing src/modules/usage src/reverse-proxy src/routes/api.test.ts src/routes/api.sessions.test.ts src/modules/index.test.ts
npm run typecheck --workspace=packages/service
```
Expected: all PASS, tsc clean.

- [ ] **Step 17: Stage and commit**

```bash
git add src/llm/executor.ts src/modules/guardrails/index.ts src/modules/pii/index.ts \
  src/modules/routing/index.ts src/modules/routing/router.ts src/modules/routing/policies/types.ts \
  src/modules/usage/tracker.ts src/modules/usage/tracker.test.ts src/reverse-proxy/context.ts \
  src/reverse-proxy/lanes/anthropic.ts src/reverse-proxy/lanes/openai.ts src/routes/api.ts \
  src/routes/api.test.ts src/routes/api.sessions.test.ts
git status --short
git commit -m "refactor(logging): repoint external consumers to modules/logging/tracestore"
```

- [ ] **Step 18: Full-suite regression check**

```bash
npx vitest run
```
Expected: same pre-existing 3-failure baseline (`oauthForward.test.ts` x2, `modules/provider/anthropic.test.ts` x1), no new failures.

---

## Self-Review

**Spec coverage:** Task 1 covers the traceStore move (overview's explicit Step 10 scope). Task 2 covers the flat-wrapper absorption (same precedent as Steps 7/8/9). Task 3 covers all 14 files found by the exhaustive `grep -rln "routing/traceStore"` — no consumer left unaddressed.

**Placeholder scan:** none — every edit shows exact before/after text.

**Type consistency:** `TraceEntry`, `TracePanel`, `setTrace`, `appendTrace`, `getTrace` names unchanged throughout; `loggingModule` export name unchanged.

## Execution Handoff

Mechanical, fully pre-specified extraction (identical shape to Steps 7-9). Per this session's standing methodology, execute directly via Bash/Edit in the main thread — no subagent dispatch needed for fully-mechanical pre-specified extraction tasks.
