# Step 2 — lib/ Extraction (cost.ts, paths.ts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `packages/service/src/lib/`, the shared-primitives layer confirmed in the overview doc, containing the two functions that already have zero domain/state coupling: `calculateCost` and `CONFIG_PATHS`. Pure file moves + import-path updates, no behavior change.

**Architecture:** Move `cost/calculator.ts` → `lib/cost.ts` (and its test). Move `config/paths.ts` → `lib/paths.ts` (and its test). Update every real consumer's import path. `cost/tracker.ts` and `config/loader.ts` stay where they are — only their import of the moved function/constant changes.

**Tech Stack:** TypeScript ESM, Vitest.

## Global Constraints

- Wire-format transparency ABSOLUTE — not touched by this plan (no request/response code).
- Feature-parity ABSOLUTE — `calculateCost`'s signature and rounding behavior, and `CONFIG_PATHS`'s shape, must be byte-identical after the move. Every existing test for both must pass unchanged.
- Imports: `.js` extension on relative imports; `node:` prefix on builtins.
- Test files: `*.test.ts` co-located with the source file they test.
- No em dashes anywhere.
- Verify with `npx vitest run` and `npx tsc --noEmit` from `packages/service/`.

---

### Task 1: Move `calculateCost` to `lib/cost.ts`

**Files:**
- Create: `packages/service/src/lib/cost.ts`
- Create: `packages/service/src/lib/cost.test.ts`
- Delete: `packages/service/src/cost/calculator.ts`
- Delete: `packages/service/src/cost/calculator.test.ts`
- Modify: `packages/service/src/cost/tracker.ts:3`
- Modify: `packages/service/src/llm/executor.ts:30`
- Modify: `packages/service/src/llm/executor.cost.test.ts:14`

**Interfaces:**
- Consumes: `ModelConfig` type from `@routerly/shared` (unchanged).
- Produces: `calculateCost(inputTokens: number, outputTokens: number, model: ModelConfig, cachedInputTokens?: number, cacheCreationInputTokens?: number): number` — same signature, importable from `../lib/cost.js` (from `cost/tracker.ts`) or `../../lib/cost.js` (from `llm/*.ts`).

- [ ] **Step 1: Create `lib/cost.ts` with the exact current content of `cost/calculator.ts`**

```bash
mkdir -p packages/service/src/lib
git mv packages/service/src/cost/calculator.ts packages/service/src/lib/cost.ts
```

Content stays byte-identical (verify with `git show HEAD:packages/service/src/cost/calculator.ts` vs the new file — no changes needed, it has zero internal relative imports to fix):

```ts
import type { ModelConfig } from '@routerly/shared';

/**
 * Calculates the cost of a single API call in USD.
 *
 * Token pricing tiers (all optional):
 *  - inputTokens (minus cached and creation) → inputPerMillion
 *  - cachedInputTokens (cache read)          → cachePerMillion  (fallback: inputPerMillion)
 *  - cacheCreationInputTokens (cache write)  → cacheWritePerMillion (fallback: inputPerMillion)
 *  - outputTokens                            → outputPerMillion
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: ModelConfig,
  cachedInputTokens = 0,
  cacheCreationInputTokens = 0,
): number {
  const plainInput = inputTokens - cachedInputTokens - cacheCreationInputTokens;
  const inputCost        = (plainInput               / 1_000_000) * model.cost.inputPerMillion;
  const cachedCost       = (cachedInputTokens         / 1_000_000) * (model.cost.cachePerMillion       ?? model.cost.inputPerMillion);
  const cacheCreateCost  = (cacheCreationInputTokens  / 1_000_000) * (model.cost.cacheWritePerMillion  ?? model.cost.inputPerMillion);
  const outputCost       = (outputTokens              / 1_000_000) * model.cost.outputPerMillion;
  return Math.round((inputCost + cachedCost + cacheCreateCost + outputCost) * 1_000_000_000) / 1_000_000_000;
}
```

- [ ] **Step 2: Move the test file, updating only its own-module import**

```bash
git mv packages/service/src/cost/calculator.test.ts packages/service/src/lib/cost.test.ts
```

In `lib/cost.test.ts`, change line 2 from `import { calculateCost } from './calculator.js'` to `import { calculateCost } from './cost.js'`. Everything else in the file (all 8 `it` blocks, the `model()` helper) stays exactly as-is:

```ts
import { describe, it, expect } from 'vitest'
import { calculateCost } from './cost.js'
import type { ModelConfig } from '@routerly/shared'

function model(overrides: Partial<ModelConfig['cost']> = {}): ModelConfig {
  return {
    id: 'test-model',
    name: 'Test',
    provider: 'openai',
    endpoint: 'http://localhost',
    cost: {
      inputPerMillion: 1.0,
      outputPerMillion: 2.0,
      ...overrides,
    },
  } as ModelConfig
}

describe('calculateCost', () => {
  it('basic input + output cost', () => {
    const cost = calculateCost(1_000_000, 1_000_000, model())
    expect(cost).toBeCloseTo(3.0, 9)
  })

  it('zero tokens → zero cost', () => {
    expect(calculateCost(0, 0, model())).toBe(0)
  })

  it('cached input uses cachePerMillion when set', () => {
    const m = model({ cachePerMillion: 0.1 })
    const cost = calculateCost(1_000_000, 1_000_000, m, 1_000_000)
    expect(cost).toBeCloseTo(2.1, 9)
  })

  it('cached input falls back to inputPerMillion when cachePerMillion absent', () => {
    const cost = calculateCost(1_000_000, 1_000_000, model(), 1_000_000)
    expect(cost).toBeCloseTo(3.0, 9)
  })

  it('cache write uses cacheWritePerMillion when set', () => {
    const m = model({ cacheWritePerMillion: 0.5 })
    const cost = calculateCost(1_000_000, 1_000_000, m, 0, 1_000_000)
    expect(cost).toBeCloseTo(2.5, 9)
  })

  it('cache write falls back to inputPerMillion when cacheWritePerMillion absent', () => {
    const cost = calculateCost(1_000_000, 1_000_000, model(), 0, 1_000_000)
    expect(cost).toBeCloseTo(3.0, 9)
  })

  it('cached + write tokens are subtracted from plain input', () => {
    const cost = calculateCost(2_000_000, 0, model(), 500_000, 500_000)
    expect(cost).toBeCloseTo(2.0, 9)
  })

  it('small token count rounds correctly', () => {
    const cost = calculateCost(1, 1, model())
    expect(cost).toBeCloseTo(0.000003, 9)
  })
})
```

- [ ] **Step 3: Update the three real consumers**

In `packages/service/src/cost/tracker.ts:3`, change:
```ts
import { calculateCost } from './calculator.js';
```
to:
```ts
import { calculateCost } from '../lib/cost.js';
```

In `packages/service/src/llm/executor.ts:30`, change:
```ts
import { calculateCost } from '../cost/calculator.js';
```
to:
```ts
import { calculateCost } from '../lib/cost.js';
```

In `packages/service/src/llm/executor.cost.test.ts:14`, change:
```ts
import { calculateCost } from '../cost/calculator.js'
```
to:
```ts
import { calculateCost } from '../lib/cost.js'
```

- [ ] **Step 4: Run tests to verify**

Run: `npx vitest run src/lib/cost.test.ts src/cost/tracker.test.ts src/llm/executor.cost.test.ts` (from `packages/service/`; if `cost/tracker.test.ts` doesn't exist, drop it from the command)
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add -A packages/service/src/lib packages/service/src/cost packages/service/src/llm
git commit -m "refactor(lib): extract calculatecost into lib/cost.ts"
```

---

### Task 2: Move `CONFIG_PATHS` to `lib/paths.ts`

**Files:**
- Create: `packages/service/src/lib/paths.ts`
- Create: `packages/service/src/lib/paths.test.ts`
- Delete: `packages/service/src/config/paths.ts`
- Delete: `packages/service/src/config/paths.test.ts`
- Modify: `packages/service/src/config/loader.ts:6`
- Modify: `packages/service/src/config/loader.race.test.ts:4`
- Modify: `packages/service/src/config/loader.test.ts:7` (the `vi.mock` target path)
- Modify: `packages/service/src/routes/api.ts:11`

**Interfaces:**
- Consumes: `node:os`, `node:path` only (unchanged).
- Produces: `CONFIG_PATHS` (same shape: `base, config, data, settings, models, projects, users, roles, usage, notifications, audit, secret`), `type ConfigFile = keyof typeof CONFIG_PATHS` — importable from `../lib/paths.js` (from `config/*.ts`) or `../lib/paths.js` (from `routes/api.ts`, same depth).

- [ ] **Step 1: Move the source file (no internal changes needed, only builtin imports)**

```bash
git mv packages/service/src/config/paths.ts packages/service/src/lib/paths.ts
```

Content stays byte-identical:

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';

const base = process.env['ROUTERLY_HOME'] ?? join(homedir(), '.routerly');

export const CONFIG_PATHS = {
  base,
  config: join(base, 'config'),
  data: join(base, 'data'),
  settings: join(base, 'config', 'settings.json'),
  models: join(base, 'config', 'models.json'),
  projects: join(base, 'config', 'projects.json'),
  users: join(base, 'config', 'users.json'),
  roles: join(base, 'config', 'roles.json'),
  usage: join(base, 'data', 'usage.json'),
  notifications: join(base, 'data', 'notifications.json'),
  audit: join(base, 'data', 'audit.json'),
  secret: join(base, 'config', 'secret'),
} as const;

export type ConfigFile = keyof typeof CONFIG_PATHS;
```

- [ ] **Step 2: Move the test file**

```bash
git mv packages/service/src/config/paths.test.ts packages/service/src/lib/paths.test.ts
```

No content changes needed — it already uses the relative `./paths.js?v=...` dynamic-import cache-busting trick, and both source and test now live in the same `lib/` directory, so `./paths.js` still resolves correctly:

```ts
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { homedir } from 'node:os'

describe('CONFIG_PATHS', () => {
  it('uses ROUTERLY_HOME env var when set', async () => {
    const original = process.env['ROUTERLY_HOME']
    process.env['ROUTERLY_HOME'] = '/custom/path'
    const { CONFIG_PATHS } = await import('./paths.js?v=' + Date.now())
    expect(CONFIG_PATHS.base).toBe('/custom/path')
    if (original === undefined) delete process.env['ROUTERLY_HOME']
    else process.env['ROUTERLY_HOME'] = original
  })

  it('falls back to ~/.routerly when env var not set', async () => {
    const original = process.env['ROUTERLY_HOME']
    delete process.env['ROUTERLY_HOME']
    const { CONFIG_PATHS } = await import('./paths.js?v=' + Date.now() + '1')
    expect(CONFIG_PATHS.base).toBe(join(homedir(), '.routerly'))
    if (original !== undefined) process.env['ROUTERLY_HOME'] = original
  })

  it('has all required path keys', () => {
    const base = process.env['ROUTERLY_HOME'] ?? join(homedir(), '.routerly')
    expect(join(base, 'config')).toBeTruthy()
    expect(join(base, 'data')).toBeTruthy()
    expect(join(base, 'config', 'settings.json')).toBeTruthy()
    expect(join(base, 'config', 'models.json')).toBeTruthy()
    expect(join(base, 'config', 'projects.json')).toBeTruthy()
    expect(join(base, 'config', 'users.json')).toBeTruthy()
    expect(join(base, 'config', 'roles.json')).toBeTruthy()
    expect(join(base, 'data', 'usage.json')).toBeTruthy()
    expect(join(base, 'config', 'secret')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Update the three real consumers**

In `packages/service/src/config/loader.ts:6`, change:
```ts
import { CONFIG_PATHS } from './paths.js';
```
to:
```ts
import { CONFIG_PATHS } from '../lib/paths.js';
```

In `packages/service/src/config/loader.race.test.ts:4`, change:
```ts
import { CONFIG_PATHS } from './paths.js';
```
to:
```ts
import { CONFIG_PATHS } from '../lib/paths.js';
```

In `packages/service/src/routes/api.ts:11`, change:
```ts
import { CONFIG_PATHS } from '../config/paths.js';
```
to:
```ts
import { CONFIG_PATHS } from '../lib/paths.js';
```

- [ ] **Step 4: Update the mock target in `config/loader.test.ts`**

In `packages/service/src/config/loader.test.ts:7`, this file's `vi.mock` call must target the exact specifier `loader.ts` now uses. Change:
```ts
vi.mock('./paths.js', () => ({
```
to:
```ts
vi.mock('../lib/paths.js', () => ({
```
(the object body — `base`, `config`, `data`, `settings`, `models`, `projects`, `users`, `roles`, `usage`, `secret` — stays exactly as-is, only the mocked specifier string changes).

- [ ] **Step 5: Run tests to verify**

Run: `npx vitest run src/lib/paths.test.ts src/config/loader.test.ts src/config/loader.race.test.ts src/routes/api.test.ts` (from `packages/service/`; drop `routes/api.test.ts` from the command if it doesn't exist)
Expected: PASS, all tests. Pay particular attention to `loader.test.ts` — a mismatched mock specifier makes Vitest silently NOT mock the module (it would hit the real filesystem-backed `CONFIG_PATHS` instead), so a pass here must be a genuine pass, not a false green from an unrelated code path.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run` (from `packages/service/`) — expect the same pass count as before this plan (2144 passed, 3 pre-existing unrelated failures in `src/routes/oauthForward.test.ts` and `src/providers/anthropic.test.ts` — confirm no new failures).
Run: `npx tsc --noEmit` (from `packages/service/`) — 0 errors.

- [ ] **Step 7: Commit**

```bash
git add -A packages/service/src/lib packages/service/src/config packages/service/src/routes
git commit -m "refactor(lib): extract config_paths into lib/paths.ts"
```

---

## Self-Review

**1. Spec coverage:** Overview doc's target tree lists exactly `lib/cost.ts` and `lib/paths.ts` — both covered, one task each. No other file was claimed as a `lib/` candidate.

**2. Placeholder scan:** None — every step has the exact current file content (verified via direct reads of the real files) or an exact shell command.

**3. Type consistency:** `calculateCost`'s signature is copied verbatim from the actual current `cost/calculator.ts` (confirmed via read, not reconstructed from memory). `CONFIG_PATHS`'s shape is copied verbatim including the `notifications`/`audit` keys already present in the current file (these exist today even though `loader.test.ts`'s mock object omits them — that's a pre-existing test-double gap unrelated to this move, not something this plan should silently "fix" by adding scope).

No gaps found. Plan ready.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-27-modular-lib-extraction.md`. Executing Subagent-Driven per your standing direction to proceed through all sequencing steps.
