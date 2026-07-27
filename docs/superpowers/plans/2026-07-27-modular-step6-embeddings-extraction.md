# Step 6: modules/embeddings/ Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `embeddings/` (index.ts, openai.ts, ollama.ts, types.ts + tests) into `modules/embeddings/`, add an `EMBEDDINGS` DI token exposing `getEmbeddingProvider`, and repoint every external consumer. Pure extraction, flat wrap of the existing directory — no hook-based redesign of the dispatch.

**Architecture:** Same pattern as Step 5 (`modules/catalog/`): move files unchanged, add a thin `modules/embeddings/index.ts` `defineModule` wrapper, register a new `EMBEDDINGS` token in `core/tokens.ts`, repoint external consumers. One naming wrinkle vs. catalog: `embeddings/index.ts` today already holds the dispatcher (`getEmbeddingProvider`'s type-switch), so that slot is needed for the new wrapper — the dispatcher is renamed to `dispatch.ts` on the move (content unchanged), exactly how Step 4 renamed `providers/index.ts`'s dispatcher into `registry.ts` to free up `index.ts` for its wrapper.

**Tech Stack:** TypeScript ESM, Vitest, Fastify 5.

## Global Constraints

- Wire-format transparency ABSOLUTE — no request/response payload code touched, only import paths and DI wiring.
- No em dashes anywhere (code, comments, commits).
- Imports: `.js` extension on relative imports; `node:` prefix on builtins.
- Public contract frozen: `getEmbeddingProvider(type, endpoint?, apiKey?): EmbeddingProvider`'s signature and behavior (including the `Unknown embedding provider type` throw) do not change.
- Dispatch mechanism stays a plain switch, NOT converted to `AlterableRegistry`. The overview's hook-based-dispatch mandate is stated explicitly and only for Step 4/`modules/provider/` (`getProviderAdapter`'s internal switch is called out by name). Step 6's own text is a bare `modules/embeddings/ (new)` with no equivalent call-out, and the overview's KB cross-check section says embeddings gets "flat wrap-the-existing-directory treatment" with "no KB opinion" adding scope. A 2-case switch (openai/ollama) converted to a registry with no second implementation requesting `.contribute()` would be unrequested abstraction (YAGNI) — deviate from Step 4's precedent deliberately here.
- Commit subjects must be all-lowercase (commitlint `subject-case`).
- Full suite + `tsc --noEmit` must stay at the established baseline (3 pre-existing failures, no new failures) before each commit.

---

### Task 1: Move embeddings files into modules/embeddings/, renaming the dispatcher to dispatch.ts

**Files:**
- Move + rename: `packages/service/src/embeddings/index.ts` -> `packages/service/src/modules/embeddings/dispatch.ts` (git mv, no content change)
- Move + rename: `packages/service/src/embeddings/index.test.ts` -> `packages/service/src/modules/embeddings/dispatch.test.ts` (git mv, then 1-line import fix)
- Move: `packages/service/src/embeddings/openai.ts` -> `packages/service/src/modules/embeddings/openai.ts` (git mv, no content change)
- Move: `packages/service/src/embeddings/openai.test.ts` -> `packages/service/src/modules/embeddings/openai.test.ts` (git mv, no content change)
- Move: `packages/service/src/embeddings/ollama.ts` -> `packages/service/src/modules/embeddings/ollama.ts` (git mv, no content change)
- Move: `packages/service/src/embeddings/ollama.test.ts` -> `packages/service/src/modules/embeddings/ollama.test.ts` (git mv, no content change)
- Move: `packages/service/src/embeddings/types.ts` -> `packages/service/src/modules/embeddings/types.ts` (git mv, no content change)

**Interfaces:**
- Consumes: nothing new (uses only what `embeddings/*.ts` already exports today).
- Produces: `modules/embeddings/dispatch.ts` exporting `getEmbeddingProvider(type: EmbeddingProviderType, endpoint?: string, apiKey?: string): EmbeddingProvider` (unchanged signature) plus re-exported types `EmbeddingProvider`, `EmbeddingProviderType`, `EmbeddingProviderConfig`; `modules/embeddings/types.ts` exporting `EmbeddingProviderType`, `EmbeddingProviderConfig`, `EmbedResult`, `EmbeddingProvider` (unchanged).

- [ ] **Step 1: Confirm zero relative imports break on the move**

All 4 source files (`index.ts`, `openai.ts`, `ollama.ts`, `types.ts`) only import from siblings (`./types.js`, `./openai.js`, `./ollama.js`), `openai` (npm), or nothing external — verified by grep during research. Same-depth move (`embeddings/` -> `modules/embeddings/`, both one level under a different immediate parent, siblings preserved), so no path depth changes are needed for any of the 4 files' own imports.

- [ ] **Step 2: Move the 7 files with git mv**

```bash
mkdir -p packages/service/src/modules/embeddings
git mv packages/service/src/embeddings/index.ts packages/service/src/modules/embeddings/dispatch.ts
git mv packages/service/src/embeddings/index.test.ts packages/service/src/modules/embeddings/dispatch.test.ts
git mv packages/service/src/embeddings/openai.ts packages/service/src/modules/embeddings/openai.ts
git mv packages/service/src/embeddings/openai.test.ts packages/service/src/modules/embeddings/openai.test.ts
git mv packages/service/src/embeddings/ollama.ts packages/service/src/modules/embeddings/ollama.ts
git mv packages/service/src/embeddings/ollama.test.ts packages/service/src/modules/embeddings/ollama.test.ts
git mv packages/service/src/embeddings/types.ts packages/service/src/modules/embeddings/types.ts
```

- [ ] **Step 3: Fix dispatch.test.ts's self-import**

In `packages/service/src/modules/embeddings/dispatch.test.ts`, change:
```ts
import { getEmbeddingProvider } from './index.js'
```
to:
```ts
import { getEmbeddingProvider } from './dispatch.js'
```

- [ ] **Step 4: Run the moved tests**

Run: `cd packages/service && npx vitest run src/modules/embeddings/dispatch.test.ts src/modules/embeddings/openai.test.ts src/modules/embeddings/ollama.test.ts`
Expected: all tests pass (same count as before the move).

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/modules/embeddings packages/service/src/embeddings
git status --short
git commit -m "refactor(embeddings): move dispatcher/openai/ollama into modules/embeddings/"
```

Verify with `git status --short` before committing that `packages/service/src/embeddings/` shows only deletions and `modules/embeddings/` shows the 7 new/modified files.

---

### Task 2: Add EMBEDDINGS token and modules/embeddings/index.ts wrapper

**Files:**
- Modify: `packages/service/src/core/tokens.ts`
- Create: `packages/service/src/modules/embeddings/index.ts`
- Create: `packages/service/src/modules/embeddings/index.test.ts`

**Interfaces:**
- Consumes: `getEmbeddingProvider`, `EmbeddingProviderType`, `EmbeddingProvider` from `./dispatch.js` (Task 1); `defineModule`, `token` from `../../core/index.js`.
- Produces: `EMBEDDINGS` token (importable from `core/tokens.ts`), `embeddingsModule` (importable from `modules/embeddings/index.js`).

- [ ] **Step 1: Add the EMBEDDINGS token**

In `packages/service/src/core/tokens.ts`, add near `CATALOG`:
```ts
import type { EmbeddingProvider, EmbeddingProviderType } from '../modules/embeddings/dispatch.js';
```
(add to the existing top-of-file relative-import block, alongside `ProviderAdapter`/`ProviderCatalog`/`RepoStatus`)

```ts
export const EMBEDDINGS = token<{
  getEmbeddingProvider(
    type: EmbeddingProviderType,
    endpoint?: string,
    apiKey?: string,
  ): EmbeddingProvider;
}>('embeddings.registry');
```

- [ ] **Step 2: Write the module wrapper**

Create `packages/service/src/modules/embeddings/index.ts`:
```ts
import { defineModule } from '../../core/index.js';
import { EMBEDDINGS } from '../../core/tokens.js';
import { getEmbeddingProvider } from './dispatch.js';

/**
 * Embeddings module: owns the real dispatcher (dispatch.ts, a flat
 * type-switch over openai.ts/ollama.ts, no hook-based override) and exposes
 * it behind the EMBEDDINGS DI token. Other files still import dispatch.ts
 * directly by path; this module additionally makes it reachable through the
 * container.
 */
export const embeddingsModule = defineModule({
  manifest: { id: 'embeddings', version: '0.4.0' },
  register({ container }) {
    container.register(EMBEDDINGS, { getEmbeddingProvider });
  },
});
```
`getEmbeddingProvider` is a plain exported function (not a class method), so it is passed by direct reference, preserving identity, matching the `PROVIDER_REGISTRY`/`getProviderAdapter` precedent. `embeddingsModule`'s manifest has no `dependsOn` — unlike `catalogModule` (needs `config` for `readConfig`/`writeConfig`) and `providerModule` (needs `config`), `dispatch.ts`/`openai.ts`/`ollama.ts` read no config at module scope; callers pass `endpoint`/`apiKey` as arguments.

- [ ] **Step 3: Write the module wrapper test**

Create `packages/service/src/modules/embeddings/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ServiceContainer, EventBus } from '../../core/index.js';
import { embeddingsModule } from './index.js';
import { EMBEDDINGS } from '../../core/tokens.js';
import { getEmbeddingProvider } from './dispatch.js';

describe('embeddings module', () => {
  it('has the frozen manifest', () => {
    expect(embeddingsModule.manifest.id).toBe('embeddings');
    expect(embeddingsModule.manifest.version).toBe('0.4.0');
    expect(embeddingsModule.manifest.dependsOn).toBeUndefined();
  });

  it('registers EMBEDDINGS exposing the real getEmbeddingProvider', async () => {
    const container = new ServiceContainer();
    const events = new EventBus();
    await embeddingsModule.register({ container, events });

    expect(container.has(EMBEDDINGS)).toBe(true);
    const registry = container.resolve(EMBEDDINGS);
    // Wrapper strategy: the token hands back the real function, not a copy.
    expect(registry.getEmbeddingProvider).toBe(getEmbeddingProvider);

    const provider = registry.getEmbeddingProvider('openai', 'https://api.openai.com/v1', 'sk-test');
    expect(typeof provider.embed).toBe('function');

    expect(() => registry.getEmbeddingProvider('unknown' as any)).toThrow(
      /Unknown embedding provider type/,
    );
  });
});
```

- [ ] **Step 4: Run the new test and tsc**

Run: `cd packages/service && npx vitest run src/modules/embeddings/index.test.ts && npx tsc --noEmit`
Expected: all tests pass. `tsc` will still show errors from Task 3's not-yet-repointed consumer files (`middleware/guardrails.ts`, `routing/intent/classifier.ts`, `routing/intent/cache.ts`) — that is expected at this point and resolved by Task 3, not a regression in this task's own files.

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/tokens.ts packages/service/src/modules/embeddings/index.ts packages/service/src/modules/embeddings/index.test.ts
git commit -m "feat(embeddings): add embeddings di token and module wrapper"
```

---

### Task 3: Repoint external consumers

**Files:**
- Modify: `packages/service/src/middleware/guardrails.ts`
- Modify: `packages/service/src/middleware/guardrails.test.ts`
- Modify: `packages/service/src/routing/intent/classifier.ts`
- Modify: `packages/service/src/routing/intent/classifier.test.ts`
- Modify: `packages/service/src/routing/intent/cache.ts`
- Modify: `packages/service/src/routing/intent/cache.test.ts`
- Modify: `packages/service/src/routing/policies/semantic-intent.test.ts`

**Interfaces:**
- Consumes: `modules/embeddings/dispatch.js` exporting `getEmbeddingProvider` (Task 1); `modules/embeddings/types.js` exporting `EmbeddingProvider` (Task 1).
- Produces: nothing new for later tasks — this is the last task of Step 6. Note: unlike Steps 3-5, no `server.ts`/kernel wiring is added in this step — `embeddingsModule` is not yet added to the `buildKernel([...])` array, matching the fact that no `dependsOn`-driven ordering requirement exists yet and no later-landed module currently resolves `EMBEDDINGS` via the container (all real consumers call `getEmbeddingProvider` directly by path, same as `providerModule`/`catalogModule`'s direct-import consumers). Re-evaluate wiring `embeddingsModule` into `server.ts`'s `buildKernel([...])` array when a later step's module actually needs to `resolve(EMBEDDINGS)` through the container — do not add unused kernel wiring speculatively.

- [ ] **Step 1: Repoint middleware/guardrails.ts**

In `packages/service/src/middleware/guardrails.ts`, change:
```ts
import { getEmbeddingProvider } from '../embeddings/index.js';
```
to:
```ts
import { getEmbeddingProvider } from '../modules/embeddings/dispatch.js';
```

- [ ] **Step 2: Repoint middleware/guardrails.test.ts's vi.mock target**

In `packages/service/src/middleware/guardrails.test.ts`, change:
```ts
vi.mock('../embeddings/index.js', () => ({ getEmbeddingProvider: vi.fn() }));
```
to:
```ts
vi.mock('../modules/embeddings/dispatch.js', () => ({ getEmbeddingProvider: vi.fn() }));
```

- [ ] **Step 3: Repoint routing/intent/classifier.ts**

In `packages/service/src/routing/intent/classifier.ts`, change:
```ts
import { getEmbeddingProvider } from '../../embeddings/index.js';
```
to:
```ts
import { getEmbeddingProvider } from '../../modules/embeddings/dispatch.js';
```

- [ ] **Step 4: Repoint routing/intent/classifier.test.ts's vi.mock target**

In `packages/service/src/routing/intent/classifier.test.ts`, change:
```ts
vi.mock('../../embeddings/index.js', () => ({
```
to:
```ts
vi.mock('../../modules/embeddings/dispatch.js', () => ({
```

- [ ] **Step 5: Repoint routing/intent/cache.ts**

In `packages/service/src/routing/intent/cache.ts`, change:
```ts
import type { EmbeddingProvider } from '../../embeddings/types.js';
```
to:
```ts
import type { EmbeddingProvider } from '../../modules/embeddings/types.js';
```

- [ ] **Step 6: Repoint routing/intent/cache.test.ts**

In `packages/service/src/routing/intent/cache.test.ts`, change:
```ts
import type { EmbeddingProvider } from '../../embeddings/types.js'
```
to:
```ts
import type { EmbeddingProvider } from '../../modules/embeddings/types.js'
```

- [ ] **Step 7: Repoint routing/policies/semantic-intent.test.ts's vi.mock target**

In `packages/service/src/routing/policies/semantic-intent.test.ts`, change:
```ts
vi.mock('../../embeddings/index.js', () => ({
```
to:
```ts
vi.mock('../../modules/embeddings/dispatch.js', () => ({
```

- [ ] **Step 8: Run the blanket stale-reference grep**

Run: `cd packages/service/src && grep -rn "embeddings/" . --include="*.ts" | grep -v "^./modules/embeddings/"`
Expected: zero results (everything left should already point at `modules/embeddings/`).

- [ ] **Step 9: Run the full suite and tsc**

Run: `cd packages/service && npx vitest run && npx tsc --noEmit`
Expected: same baseline as before Step 6 (3 pre-existing failures: `modules/provider/anthropic.test.ts` line ~324, `routes/oauthForward.test.ts` x2), no new failures, tsc clean.

- [ ] **Step 10: Commit**

```bash
git add packages/service/src/middleware/guardrails.ts packages/service/src/middleware/guardrails.test.ts packages/service/src/routing/intent/classifier.ts packages/service/src/routing/intent/classifier.test.ts packages/service/src/routing/intent/cache.ts packages/service/src/routing/intent/cache.test.ts packages/service/src/routing/policies/semantic-intent.test.ts
git commit -m "refactor(embeddings): repoint external consumers to modules/embeddings/"
```

---

## Self-Review

**1. Spec coverage:** Overview's Step 6 text ("modules/embeddings/ (new)") plus its KB cross-check ("flat wrap-the-existing-directory treatment") are covered by Task 1 (pure move, zero behavior change), Task 2 (additive DI token, no existing call site touched, dispatch stays a switch), Task 3 (repoint only, no logic change). The Global Constraints section documents, with reasoning, why this step deliberately does not repeat Step 4's `AlterableRegistry` conversion.

**2. Placeholder scan:** No TBD/TODO, no "add appropriate X", no "similar to Task N" without code. All 3 tasks contain full, exact code.

**3. Type consistency:** `EMBEDDINGS` token's shape (Task 2, Step 1) matches exactly what `embeddingsModule`'s `register()` (Task 2, Step 2) constructs, which matches exactly what the test (Task 2, Step 3) asserts against. `EmbeddingProvider`/`EmbeddingProviderType` names match `types.ts`'s actual exports (verified by reading the file in full during research). `getEmbeddingProvider`'s signature (`(type, endpoint?, apiKey?) => EmbeddingProvider`) is unchanged and matches all 3 real call sites' usage (Task 3 only repoints imports, doesn't touch call arguments).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-27-modular-step6-embeddings-extraction.md`. Per established precedent for Steps 2-5 (fully-mechanical, completely-pre-specified extraction tasks with no design judgment left to make), this plan is executed directly via Bash/Edit rather than dispatching implementer/reviewer subagent pairs.
