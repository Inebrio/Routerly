# Step 5: modules/catalog/ Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `catalog/fetcher.ts` and `catalog/sync.ts` into a new `modules/catalog/` directory, add a `CATALOG` DI token exposing the same surface real consumers already use, and repoint every external consumer. Pure extraction — no shape change (catalog stays remote-fetch-into-local-cache, per the overview's already-closed decision).

**Architecture:** Same pattern as Steps 3 (`modules/config/`) and 4 (`modules/provider/`): `git mv` the source + test files unchanged where possible, fix the two relative imports inside `sync.ts` that break on the depth change, add a thin `modules/catalog/index.ts` `defineModule` wrapper (new — unlike config/provider, catalog has no pre-existing wrapper from the prior 0.4.0 refactory), register a new `CATALOG` token in `core/tokens.ts`, repoint the 3 real external consumer files plus their `vi.mock()` targets.

**Tech Stack:** TypeScript ESM, Vitest, Fastify 5.

## Global Constraints

- Wire-format transparency ABSOLUTE — this step touches no request/response payload code, only import paths and DI wiring.
- No em dashes anywhere (code, comments, commits).
- Imports: `.js` extension on relative imports; `node:` prefix on builtins (already followed in the moved files).
- Public contracts frozen: `catalogFetcher`'s method signatures (`get`, `setRepos`, `invalidate`, `getStatus`) and `syncModelsFromCatalog`'s signature do not change.
- Catalog shape frozen: remote fetch -> local cache, exactly as today. No layering, no redesign.
- Commit subjects must be all-lowercase (commitlint `subject-case`).
- Full suite + `tsc --noEmit` must stay at the established baseline (3 pre-existing failures, no new failures) before each commit.

---

### Task 1: Move catalog files into modules/catalog/, fix sync.ts's broken import

**Files:**
- Move: `packages/service/src/catalog/fetcher.ts` -> `packages/service/src/modules/catalog/fetcher.ts` (git mv, no content change)
- Move: `packages/service/src/catalog/fetcher.test.ts` -> `packages/service/src/modules/catalog/fetcher.test.ts` (git mv, no content change)
- Move: `packages/service/src/catalog/sync.ts` -> `packages/service/src/modules/catalog/sync.ts` (git mv, then edit 2 import lines)
- Move: `packages/service/src/catalog/sync.test.ts` -> `packages/service/src/modules/catalog/sync.test.ts` (git mv, then edit 2 `vi.mock`/import lines)

**Interfaces:**
- Consumes: nothing new (uses only what `catalog/fetcher.ts` and `catalog/sync.ts` already export today).
- Produces: `modules/catalog/fetcher.ts` exporting `ProviderCatalog`, `RepoStatus`, `catalogFetcher` (unchanged); `modules/catalog/sync.ts` exporting `syncModelsFromCatalog(pkgVersion: string): Promise<boolean>` (unchanged signature).

- [ ] **Step 1: Confirm zero other relative imports break on the move**

`fetcher.ts` imports only `node:crypto`, `semver`, and `@routerly/shared` — no relative imports, so it needs zero edits after moving.

`sync.ts` currently has (at `packages/service/src/catalog/sync.ts`):
```ts
import { catalogFetcher } from '../catalog/fetcher.js';
import { readConfig, writeConfig } from '../modules/config/loader.js';
```
The first line is a pre-existing self-referential quirk (from `catalog/`, `../catalog/fetcher.js` resolves back into `catalog/` — equivalent to `./fetcher.js`). After the move to `modules/catalog/sync.ts`, `fetcher.ts` is a direct sibling, so this must become `./fetcher.js`.

The second line currently resolves (from `catalog/`) to `src/modules/config/loader.js` — correct today. After the move to `modules/catalog/sync.ts`, `modules/config/` becomes a *sibling* directory under `modules/`, so this must become `../config/loader.js`.

- [ ] **Step 2: Move the 4 files with git mv**

```bash
mkdir -p packages/service/src/modules/catalog
git mv packages/service/src/catalog/fetcher.ts packages/service/src/modules/catalog/fetcher.ts
git mv packages/service/src/catalog/fetcher.test.ts packages/service/src/modules/catalog/fetcher.test.ts
git mv packages/service/src/catalog/sync.ts packages/service/src/modules/catalog/sync.ts
git mv packages/service/src/catalog/sync.test.ts packages/service/src/modules/catalog/sync.test.ts
```

- [ ] **Step 3: Fix sync.ts's two import lines**

In `packages/service/src/modules/catalog/sync.ts`, change:
```ts
import { catalogFetcher } from '../catalog/fetcher.js';
import { readConfig, writeConfig } from '../modules/config/loader.js';
```
to:
```ts
import { catalogFetcher } from './fetcher.js';
import { readConfig, writeConfig } from '../config/loader.js';
```

- [ ] **Step 4: Fix sync.test.ts's mock targets and imports**

In `packages/service/src/modules/catalog/sync.test.ts`, change:
```ts
vi.mock('../catalog/fetcher.js', () => ({
```
to:
```ts
vi.mock('./fetcher.js', () => ({
```
and change:
```ts
vi.mock('../modules/config/loader.js', () => ({
```
to:
```ts
vi.mock('../config/loader.js', () => ({
```
and change:
```ts
import { catalogFetcher } from '../catalog/fetcher.js';
import { readConfig, writeConfig } from '../modules/config/loader.js';
```
to:
```ts
import { catalogFetcher } from './fetcher.js';
import { readConfig, writeConfig } from '../config/loader.js';
```

- [ ] **Step 5: Run the moved tests**

Run: `cd packages/service && npx vitest run src/modules/catalog/fetcher.test.ts src/modules/catalog/sync.test.ts`
Expected: all tests pass (same count as before the move).

- [ ] **Step 6: Commit**

```bash
git add packages/service/src/modules/catalog packages/service/src/catalog
git status --short
git commit -m "refactor(catalog): move fetcher/sync into modules/catalog/"
```

Verify with `git status --short` before committing that `packages/service/src/catalog/` shows only deletions and `modules/catalog/` shows the 4 new/modified files — a multi-pathspec `git add` after `git rm`-equivalent moves can silently drop paths if one pathspec no longer exists (known gotcha from Step 4).

---

### Task 2: Add CATALOG token and modules/catalog/index.ts wrapper

**Files:**
- Modify: `packages/service/src/core/tokens.ts`
- Create: `packages/service/src/modules/catalog/index.ts`
- Create: `packages/service/src/modules/catalog/index.test.ts`

**Interfaces:**
- Consumes: `ProviderCatalog`, `RepoStatus` from `./fetcher.js` (Task 1); `catalogFetcher` from `./fetcher.js`; `syncModelsFromCatalog` from `./sync.js`; `ProviderRepo` from `@routerly/shared`; `defineModule`, `token` from `../../core/index.js`.
- Produces: `CATALOG` token (importable from `core/tokens.ts`), `catalogModule` (importable from `modules/catalog/index.js`), both consumed by Task 3's `server.ts` wiring.

- [ ] **Step 1: Add the CATALOG token**

In `packages/service/src/core/tokens.ts`, add near `PROVIDER_REGISTRY` (after it):
```ts
import type { ProviderCatalog, RepoStatus } from '../modules/catalog/fetcher.js';
import type { ProviderRepo } from '@routerly/shared';
```
(add these two lines to the existing top-of-file import block, alongside the existing `ModelConfig`/`ProjectConfig`/etc import from `@routerly/shared` — merge `ProviderRepo` into that same import statement rather than adding a second one from the same module)

```ts
export const CATALOG = token<{
  get(routerlyVersion: string): Promise<ProviderCatalog>;
  setRepos(repos: ProviderRepo[]): void;
  invalidate(): void;
  getStatus(): RepoStatus[];
  syncModelsFromCatalog: typeof import('../modules/catalog/sync.js').syncModelsFromCatalog;
}>('catalog.registry');
```

- [ ] **Step 2: Write the module wrapper**

Create `packages/service/src/modules/catalog/index.ts`:
```ts
import { defineModule } from '../../core/index.js';
import { CATALOG } from '../../core/tokens.js';
import { catalogFetcher } from './fetcher.js';
import { syncModelsFromCatalog } from './sync.js';

/**
 * Catalog module: owns the real remote-fetch-into-local-cache implementation
 * (fetcher.ts, sync.ts) and exposes it behind the CATALOG DI token. Other
 * files still import fetcher.ts/sync.ts directly by path; this module
 * additionally makes them reachable through the container.
 */
export const catalogModule = defineModule({
  manifest: { id: 'catalog', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container }) {
    container.register(CATALOG, {
      get: (routerlyVersion: string) => catalogFetcher.get(routerlyVersion),
      setRepos: (repos) => catalogFetcher.setRepos(repos),
      invalidate: () => catalogFetcher.invalidate(),
      getStatus: () => catalogFetcher.getStatus(),
      syncModelsFromCatalog,
    });
  },
});
```
The 4 `catalogFetcher` methods are wrapped in arrow functions (not passed as bare references) because they are prototype methods on the `catalogFetcher` singleton instance and lose their `this` binding if destructured directly. `syncModelsFromCatalog` is a plain exported function, so it is passed by direct reference (preserves identity, matches the `PROVIDER_REGISTRY`/`getProviderAdapter` precedent).

- [ ] **Step 3: Write the module wrapper test**

Create `packages/service/src/modules/catalog/index.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { ServiceContainer, EventBus } from '../../core/index.js';
import { catalogModule } from './index.js';
import { CATALOG } from '../../core/tokens.js';
import { catalogFetcher } from './fetcher.js';
import { syncModelsFromCatalog } from './sync.js';

describe('catalog module', () => {
  it('has the frozen manifest', () => {
    expect(catalogModule.manifest.id).toBe('catalog');
    expect(catalogModule.manifest.version).toBe('0.4.0');
    expect(catalogModule.manifest.dependsOn).toEqual({ config: '^0.4.0' });
  });

  it('registers CATALOG exposing the real catalogFetcher/syncModelsFromCatalog surface', async () => {
    const container = new ServiceContainer();
    const events = new EventBus();
    await catalogModule.register({ container, events });

    expect(container.has(CATALOG)).toBe(true);
    const registry = container.resolve(CATALOG);

    // syncModelsFromCatalog is passed by direct reference (plain function export).
    expect(registry.syncModelsFromCatalog).toBe(syncModelsFromCatalog);

    // catalogFetcher methods are delegated (bound via arrow wrapper), not re-implemented.
    const getSpy = vi.spyOn(catalogFetcher, 'get').mockResolvedValue({});
    await registry.get('1.0.0');
    expect(getSpy).toHaveBeenCalledWith('1.0.0');
    getSpy.mockRestore();

    const setReposSpy = vi.spyOn(catalogFetcher, 'setRepos').mockImplementation(() => {});
    registry.setRepos([]);
    expect(setReposSpy).toHaveBeenCalledWith([]);
    setReposSpy.mockRestore();

    const invalidateSpy = vi.spyOn(catalogFetcher, 'invalidate').mockImplementation(() => {});
    registry.invalidate();
    expect(invalidateSpy).toHaveBeenCalled();
    invalidateSpy.mockRestore();

    const getStatusSpy = vi.spyOn(catalogFetcher, 'getStatus').mockReturnValue([]);
    expect(registry.getStatus()).toEqual([]);
    expect(getStatusSpy).toHaveBeenCalled();
    getStatusSpy.mockRestore();
  });
});
```

- [ ] **Step 4: Run the new test and tsc**

Run: `cd packages/service && npx vitest run src/modules/catalog/index.test.ts && npx tsc --noEmit`
Expected: all tests pass, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/tokens.ts packages/service/src/modules/catalog/index.ts packages/service/src/modules/catalog/index.test.ts
git commit -m "feat(catalog): add catalog di token and module wrapper"
```

---

### Task 3: Repoint external consumers and server.ts wiring

**Files:**
- Modify: `packages/service/src/routing/policies/semantic-intent.ts`
- Modify: `packages/service/src/routes/api.ts`
- Modify: `packages/service/src/routes/api.test.ts`
- Modify: `packages/service/src/server.ts`

**Interfaces:**
- Consumes: `modules/catalog/fetcher.js` exporting `catalogFetcher` (Task 1); `modules/catalog/sync.js` exporting `syncModelsFromCatalog` (Task 1); `catalogModule` from `modules/catalog/index.js` (Task 2).
- Produces: nothing new for later tasks — this is the last task of Step 5.

- [ ] **Step 1: Repoint semantic-intent.ts**

In `packages/service/src/routing/policies/semantic-intent.ts`, change:
```ts
import { catalogFetcher } from '../../catalog/fetcher.js';
```
to:
```ts
import { catalogFetcher } from '../../modules/catalog/fetcher.js';
```

- [ ] **Step 2: Repoint routes/api.ts**

In `packages/service/src/routes/api.ts`, change:
```ts
import { catalogFetcher } from '../catalog/fetcher.js';
import { syncModelsFromCatalog } from '../catalog/sync.js';
```
to:
```ts
import { catalogFetcher } from '../modules/catalog/fetcher.js';
import { syncModelsFromCatalog } from '../modules/catalog/sync.js';
```

- [ ] **Step 3: Repoint routes/api.test.ts's vi.mock target**

In `packages/service/src/routes/api.test.ts`, change:
```ts
vi.mock('../catalog/fetcher.js', () => ({
```
to:
```ts
vi.mock('../modules/catalog/fetcher.js', () => ({
```
and change:
```ts
import { catalogFetcher } from '../catalog/fetcher.js'
```
to:
```ts
import { catalogFetcher } from '../modules/catalog/fetcher.js'
```

- [ ] **Step 4: Wire catalogModule into server.ts's kernel bootstrap**

In `packages/service/src/server.ts`, add the import (after the `providerModule` import, line 20):
```ts
import { catalogModule } from './modules/catalog/index.js';
```
and add `catalogModule` to the `buildKernel([...])` array (after `providerModule`, before `reverseProxyModule`):
```ts
  const kernel = await buildKernel([
    configModule,       // Plan 2
    providerModule,     // Plan 3  (manifest id 'provider')
    catalogModule,      // Step 5 (manifest id 'catalog')
    reverseProxyModule, // Plan 4  (owns PROXY_PIPELINE, transport-only, dark)
    ...coreModules,     // Plan 5  (concern processors)
    ...CONTRIB_MODULES, // Plan 6  (inert extension point, empty this phase)
  ]);
```
and update the nearby comment (currently reading `// modules/config/loader.ts and modules/provider/registry.ts are reachable via CONFIG_STORE and`) to also mention catalog:
```ts
  // Boots alongside Fastify; registers the config, provider, and catalog modules
  // so modules/config/loader.ts, modules/provider/registry.ts, and
  // modules/catalog/fetcher.ts+sync.ts are reachable via CONFIG_STORE,
  // PROVIDER_REGISTRY, and CATALOG for later plans. loadSecret()/
  // initConfigDirs() already ran in startServer() before buildServer(); none
  // of the three modules does IO at register time, so this is order-safe.
  // Additive only, no existing registration is touched.
```

- [ ] **Step 5: Run the blanket stale-reference grep**

Run: `cd packages/service/src && grep -rn "catalog/" . --include="*.ts" | grep -v "^./modules/catalog/"`
Expected: zero results (everything left should already point at `modules/catalog/`).

Also run: `grep -rn "vi.mock('.*catalog" . --include="*.ts"`
Expected: only `routes/api.test.ts`'s now-updated mock target and `modules/catalog/sync.test.ts`'s own two mocks (already fixed in Task 1).

- [ ] **Step 6: Run the full suite and tsc**

Run: `cd packages/service && npx vitest run && npx tsc --noEmit`
Expected: same baseline as before Step 5 (3 pre-existing failures: `modules/provider/anthropic.test.ts` line ~324, `routes/oauthForward.test.ts`), no new failures, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add packages/service/src/routing/policies/semantic-intent.ts packages/service/src/routes/api.ts packages/service/src/routes/api.test.ts packages/service/src/server.ts
git commit -m "refactor(catalog): repoint external consumers to modules/catalog/"
```

---

## Self-Review

**1. Spec coverage:** Overview's Step 5 text ("modules/catalog/ (new)... extraction should preserve [remote-fetch-into-local-cache] behavior as-is") is covered by Task 1 (pure move, zero behavior change) + Task 2 (additive DI token, no existing call site touched) + Task 3 (repoint only, no logic change). The "Decisions closed" note ("Step 5 is a pure extraction, no redesign") is honored: no new layering, no shape change to `ProviderCatalog`/`RepoStatus`/`syncModelsFromCatalog`'s signature.

**2. Placeholder scan:** No TBD/TODO, no "add appropriate X", no "similar to Task N" without code. All 3 tasks contain full, exact code.

**3. Type consistency:** `CATALOG` token's shape (Task 2, Step 1) matches exactly what `catalogModule`'s `register()` (Task 2, Step 2) constructs, which matches exactly what the test (Task 2, Step 3) asserts against. `ProviderCatalog`/`RepoStatus` names match `fetcher.ts`'s actual exports (verified by reading the file in full during research). `syncModelsFromCatalog`'s signature (`(pkgVersion: string) => Promise<boolean>`) is unchanged and matches its two call sites in `routes/api.ts` (Task 3, Step 2 only repoints the import, doesn't touch the call sites' arguments).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-27-modular-step5-catalog-extraction.md`. Per established precedent for Steps 2-4 (fully-mechanical, completely-pre-specified extraction tasks with no design judgment left to make), this plan is executed directly via Bash/Edit rather than dispatching implementer/reviewer subagent pairs — consistent with the same judgment call recorded in `.superpowers/sdd/progress.md` for the prior 3 steps.
