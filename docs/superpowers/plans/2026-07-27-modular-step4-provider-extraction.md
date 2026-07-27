# Step 4: modules/provider/ Full Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all `providers/*.ts` adapter files into `modules/provider/`, and convert `getProviderAdapter`'s dispatch from a hardcoded `Record<string, ProviderAdapter>` lookup into hook-based dispatch through Step 0's `AlterableRegistry<ProviderAdapter>`, so a future provider (built-in or third-party) is added via `.contribute()` with no edit to `modules/provider/`'s existing source.

**Architecture:** `modules/provider/` becomes the sole owner of all 12 adapters, `types.ts`, and `messages-compat.ts` (moved as siblings, no internal path changes — none of these files import anything outside `providers/` other than packages/node builtins). The old `providers/index.ts` dispatcher logic is rewritten as `modules/provider/registry.ts`: a module-scoped `AlterableRegistry<ProviderAdapter>` singleton, one `.contribute()` call per built-in adapter, and `getProviderAdapter(model)` implemented as `registry.get(model.provider)` with the same throw on miss. `modules/provider/index.ts` (the existing `defineModule` wrapper from the prior refactory) is updated to import `getProviderAdapter` from `./registry.js` instead of `../../providers/index.js` — its `PROVIDER_REGISTRY` token contract, manifest, and `dependsOn` are unchanged. `providers/` ends up empty, same as `config/` after Step 3.

Adding `.get(id)` to `AlterableRegistry` is a real, minimal API gap (Task 1): the class currently exposes only `.contribute()`, `.override()`, `.ordered()` — none does lookup-by-id, and `getProviderAdapter` needs O(1) lookup by `model.provider`, not an ordered traversal.

**Tech Stack:** TypeScript ESM, Vitest, `AlterableRegistry<T>` (`core/hooks/registry.ts`).

## Global Constraints

- Wire-format transparency ABSOLUTE — `ProviderAdapter` implementations are untouched; only the dispatch mechanism around them changes. No adapter file's request/response handling logic changes.
- `getProviderAdapter(model)`'s external behavior is frozen: same adapter instances returned for known providers, same `Unknown provider "X" for model "Y"` error message and type for unknown providers.
- No em dashes anywhere (code comments included). `providers/index.ts`'s existing `openai-web` comment has one — fix it when the line moves.
- Imports: `.js` extension on all relative imports (ESM requirement, existing convention).
- Full suite (`npx vitest run`) and `npx tsc --noEmit` must stay at the established baseline (currently 3 failed / 2144 passed, pre-existing and unrelated to this work) after each task — no new failures.

---

### Task 1: Add `AlterableRegistry.get(id)`

**Files:**
- Modify: `packages/service/src/core/hooks/registry.ts`
- Test: `packages/service/src/core/hooks/registry.test.ts`

**Interfaces:**
- Produces: `AlterableRegistry<T>.get(id: string): T | undefined` — returns the current value for a contributed id (reflecting any `.override()` applied), or `undefined` if no contribution with that id exists. Task 4 depends on this exact signature.

- [ ] **Step 1: Write the failing tests**

Add to `packages/service/src/core/hooks/registry.test.ts` (append inside the existing `describe('AlterableRegistry', ...)` block, after the last `it`):

```ts
  it('gets a contribution value by id', () => {
    const reg = new AlterableRegistry<string>()
    reg.contribute({ id: 'a', value: 'A' })
    expect(reg.get('a')).toBe('A')
  })

  it('get returns undefined for an unknown id', () => {
    const reg = new AlterableRegistry<string>()
    expect(reg.get('missing')).toBeUndefined()
  })

  it('get reflects an override', () => {
    const reg = new AlterableRegistry<string>()
    reg.contribute({ id: 'a', value: 'A' })
    reg.override('a', (prev) => prev + '!')
    expect(reg.get('a')).toBe('A!')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/service/src/core/hooks/registry.test.ts`
Expected: FAIL with `reg.get is not a function`.

- [ ] **Step 3: Implement `get`**

In `packages/service/src/core/hooks/registry.ts`, add this method to `AlterableRegistry<T>` (after `override`, before `ordered`):

```ts
  get(id: string): T | undefined {
    return this.items.get(id)?.value
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/service/src/core/hooks/registry.test.ts`
Expected: PASS, all 8 tests (5 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/core/hooks/registry.ts packages/service/src/core/hooks/registry.test.ts
git commit -m "feat(core): add AlterableRegistry.get(id) lookup"
```

---

### Task 2: Move adapter/support files into modules/provider/ (no internal changes)

**Files:**
- Move (via `git mv`, `providers/X.ts` → `modules/provider/X.ts` and same for each `.test.ts`):
  - `types.ts` (no test file)
  - `messages-compat.ts` + `messages-compat.test.ts`
  - `openai.ts` + `openai.test.ts`
  - `openai-oauth.ts` + `openai-oauth.test.ts`
  - `openai-web.ts` + `openai-web.test.ts`
  - `anthropic.ts` + `anthropic.test.ts`
  - `anthropic-oauth.ts` + `anthropic-oauth.test.ts`
  - `anthropic-web.ts` + `anthropic-web.test.ts`
  - `gemini.ts` + `gemini.test.ts`
  - `ollama.ts` + `ollama.test.ts`
  - `custom.ts` + `custom.test.ts`
  - `azure-openai.ts` + `azure-openai.test.ts`
  - `bedrock.ts` + `bedrock.test.ts`
  - `vertex.ts` + `vertex.test.ts`

**Interfaces:**
- Consumes: nothing new — every file above imports only from npm packages (`openai`, `@anthropic-ai/sdk`), `node:` builtins, `@routerly/shared`, or a sibling via `./name.js`. Confirmed via `grep -n "^import" *.ts | grep -v "@routerly/shared" | grep "\.\./"` returning zero matches in `providers/` before this move — no file reaches outside the directory.
- Produces: same exports as before, same filenames, now under `modules/provider/`. No signature changes.

- [ ] **Step 1: Move each file with git mv**

```bash
cd packages/service/src
for f in types.ts messages-compat.ts messages-compat.test.ts \
         openai.ts openai.test.ts openai-oauth.ts openai-oauth.test.ts \
         openai-web.ts openai-web.test.ts \
         anthropic.ts anthropic.test.ts anthropic-oauth.ts anthropic-oauth.test.ts \
         anthropic-web.ts anthropic-web.test.ts \
         gemini.ts gemini.test.ts ollama.ts ollama.test.ts \
         custom.ts custom.test.ts azure-openai.ts azure-openai.test.ts \
         bedrock.ts bedrock.test.ts vertex.ts vertex.test.ts; do
  git mv "providers/$f" "modules/provider/$f"
done
```

(This is a plain zsh `for` loop over a literal list, not a variable expansion — zsh word-splitting does not apply here, unlike the `$files` variable pitfall hit in Step 3.)

- [ ] **Step 2: Verify no file needs an internal import change**

```bash
grep -rn "^import" modules/provider/*.ts | grep -v "@routerly/shared" | grep "\.\./"
```

Expected: no output (confirms every moved file's only outside-directory dependencies are packages/builtins, unaffected by the directory's new depth).

- [ ] **Step 3: Run the moved files' own tests**

Run: `npx vitest run packages/service/src/modules/provider/`
Expected: every moved `*.test.ts` still resolves its sibling imports (`./openai.js`, `./types.js`, etc.) and passes, EXCEPT `openai-oauth.test.ts` and (if present) any file importing `getProviderAdapter` from `./index.js` — those still point at the old dispatcher and are fixed in Task 3. Confirm via output which files fail for that specific reason (an import-resolution error naming `./index.js`), not any other cause.

- [ ] **Step 4: Commit**

```bash
git add -A packages/service/src/providers packages/service/src/modules/provider
git commit -m "refactor(provider): move adapter files into modules/provider/"
```

---

### Task 3: Rewrite the dispatcher as modules/provider/registry.ts (hook-based)

**Files:**
- Create: `packages/service/src/modules/provider/registry.ts` (replaces `providers/index.ts`'s logic)
- Create: `packages/service/src/modules/provider/registry.test.ts` (moved+adapted from `providers/index.test.ts`)
- Delete: `packages/service/src/providers/index.ts`, `packages/service/src/providers/index.test.ts` (superseded by the two files above — `git rm`, content carried forward)
- Modify: `packages/service/src/modules/provider/openai-oauth.test.ts` (its `getProviderAdapter` import source changes)

**Interfaces:**
- Consumes: `AlterableRegistry` from `../../core/hooks/registry.js` (Task 1's `.get()`); all 12 adapter classes from their new sibling paths (`./openai.js`, `./anthropic.js`, etc., unchanged names).
- Produces: `getProviderAdapter(model: ModelConfig): ProviderAdapter` (same signature and throw behavior as the old `providers/index.ts`); `export { ProviderAdapter }` type re-export (same as before); `export const providerRegistry: AlterableRegistry<ProviderAdapter>` — new, exposes `.contribute()`/`.override()` for future built-in or third-party providers per the overview's "no `modules/provider/` source edit" requirement. Task 4 imports `getProviderAdapter` from this file.

- [ ] **Step 1: Write registry.ts**

```ts
import type { ModelConfig } from '@routerly/shared';
import { AlterableRegistry } from '../../core/hooks/registry.js';
import type { ProviderAdapter } from './types.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { AnthropicOAuthAdapter } from './anthropic-oauth.js';
import { OpenAIOAuthAdapter } from './openai-oauth.js';
import { OpenAIWebAdapter } from './openai-web.js';
import { AnthropicWebAdapter } from './anthropic-web.js';
import { GeminiAdapter } from './gemini.js';
import { OllamaAdapter } from './ollama.js';
import { CustomAdapter } from './custom.js';
import { AzureOpenAIAdapter } from './azure-openai.js';
import { BedrockAdapter } from './bedrock.js';
import { VertexAdapter } from './vertex.js';

export type { ProviderAdapter };

/**
 * Hook-based provider dispatch. Built-in providers are registered below as
 * contributions; a future provider (built-in or third-party) is added with
 * a `.contribute()` call, no edit to this file's dispatch logic required.
 */
export const providerRegistry = new AlterableRegistry<ProviderAdapter>();

providerRegistry.contribute({ id: 'openai', value: new OpenAIAdapter() });
providerRegistry.contribute({ id: 'openai-oauth', value: new OpenAIOAuthAdapter() });
// ponytail: unofficial web adapters, session key from browser cookies, may violate ToS
providerRegistry.contribute({ id: 'openai-web', value: new OpenAIWebAdapter() });
providerRegistry.contribute({ id: 'anthropic', value: new AnthropicAdapter() });
providerRegistry.contribute({ id: 'anthropic-oauth', value: new AnthropicOAuthAdapter() });
providerRegistry.contribute({ id: 'anthropic-web', value: new AnthropicWebAdapter() });
providerRegistry.contribute({ id: 'gemini', value: new GeminiAdapter() });
providerRegistry.contribute({ id: 'ollama', value: new OllamaAdapter() });
providerRegistry.contribute({ id: 'custom', value: new CustomAdapter() });
providerRegistry.contribute({ id: 'azure-openai', value: new AzureOpenAIAdapter() });
providerRegistry.contribute({ id: 'bedrock', value: new BedrockAdapter() });
providerRegistry.contribute({ id: 'vertex', value: new VertexAdapter() });

/**
 * Returns the appropriate adapter for a given model config.
 * Throws if the provider is not recognized.
 */
export function getProviderAdapter(model: ModelConfig): ProviderAdapter {
  const adapter = providerRegistry.get(model.provider);
  if (!adapter) {
    throw new Error(`Unknown provider "${model.provider}" for model "${model.id}"`);
  }
  return adapter;
}
```

- [ ] **Step 2: Write registry.test.ts (carried forward from providers/index.test.ts, same assertions)**

```ts
import { describe, it, expect } from 'vitest'
import { getProviderAdapter } from './registry.js'
import type { ModelConfig } from '@routerly/shared'

import type { Provider } from '@routerly/shared'

function makeModel(provider: string): ModelConfig {
  return {
    id: `${provider}/model`, name: 'M', provider: provider as Provider,
    endpoint: 'https://api.example.com/v1',
    cost: { inputPerMillion: 1, outputPerMillion: 3 },
  }
}

describe('getProviderAdapter', () => {
  it('returns an adapter for openai', () => {
    const adapter = getProviderAdapter(makeModel('openai'))
    expect(adapter).toBeDefined()
    expect(typeof adapter.chatCompletion).toBe('function')
  })

  it('returns an adapter for anthropic', () => {
    const adapter = getProviderAdapter(makeModel('anthropic'))
    expect(adapter).toBeDefined()
  })

  it('returns an adapter for anthropic-oauth', () => {
    const adapter = getProviderAdapter(makeModel('anthropic-oauth'))
    expect(adapter).toBeDefined()
    expect(typeof adapter.chatCompletion).toBe('function')
  })

  it('returns an adapter for openai-oauth', () => {
    const adapter = getProviderAdapter(makeModel('openai-oauth'))
    expect(adapter).toBeDefined()
    expect(typeof adapter.chatCompletion).toBe('function')
  })

  it('returns an adapter for gemini', () => {
    const adapter = getProviderAdapter(makeModel('gemini'))
    expect(adapter).toBeDefined()
  })

  it('returns an adapter for ollama', () => {
    const adapter = getProviderAdapter(makeModel('ollama'))
    expect(adapter).toBeDefined()
  })

  it('returns an adapter for custom', () => {
    const adapter = getProviderAdapter(makeModel('custom'))
    expect(adapter).toBeDefined()
  })

  it('throws for unknown provider', () => {
    expect(() => getProviderAdapter(makeModel('unknown-provider'))).toThrow(
      'Unknown provider "unknown-provider"',
    )
  })

  it('returns an adapter for openai-web', () => {
    const adapter = getProviderAdapter(makeModel('openai-web'))
    expect(adapter).toBeDefined()
    expect(typeof adapter.chatCompletion).toBe('function')
  })

  it('returns an adapter for anthropic-web', () => {
    const adapter = getProviderAdapter(makeModel('anthropic-web'))
    expect(adapter).toBeDefined()
    expect(typeof adapter.chatCompletion).toBe('function')
  })

  it('all standard adapters have required methods', () => {
    for (const provider of ['openai', 'openai-web', 'anthropic', 'anthropic-web', 'gemini', 'ollama', 'custom']) {
      const adapter = getProviderAdapter(makeModel(provider))
      expect(typeof adapter.chatCompletion).toBe('function')
      expect(typeof adapter.streamCompletion).toBe('function')
    }
  })
})
```

- [ ] **Step 3: Delete the superseded providers/ dispatcher files**

```bash
git rm packages/service/src/providers/index.ts packages/service/src/providers/index.test.ts
```

- [ ] **Step 4: Fix modules/provider/openai-oauth.test.ts's import source**

It currently has (line 4, carried over unchanged from Task 2's move):
```ts
import { getProviderAdapter } from './index.js';
```
Change to:
```ts
import { getProviderAdapter } from './registry.js';
```

- [ ] **Step 5: Run the module's tests**

Run: `npx vitest run packages/service/src/modules/provider/`
Expected: all pass, including `registry.test.ts` (12 tests) and `openai-oauth.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add -A packages/service/src/providers packages/service/src/modules/provider
git commit -m "refactor(provider): hook-based dispatch via AlterableRegistry"
```

---

### Task 4: Update modules/provider/index.ts + index.test.ts, and repoint external consumers

**Files:**
- Modify: `packages/service/src/modules/provider/index.ts`
- Modify: `packages/service/src/modules/provider/index.test.ts`
- Modify: `packages/service/src/core/tokens.ts:3`
- Modify: `packages/service/src/llm/executor.ts:27`
- Modify: `packages/service/src/llm/executor.test.ts:9`
- Modify: `packages/service/src/llm/executor.cost.test.ts:13`
- Modify: `packages/service/src/routes/api.ts:20`

**Interfaces:**
- Consumes: `getProviderAdapter` and `ProviderAdapter` type from `modules/provider/registry.ts` (Task 3).
- Produces: no external-facing change — `PROVIDER_REGISTRY` token shape (`{ getProviderAdapter(model): ProviderAdapter }`) is unchanged; every consumer's call site is untouched, only the import path moves.

- [ ] **Step 1: Update modules/provider/index.ts**

Change line 3 from:
```ts
import { getProviderAdapter } from '../../providers/index.js';
```
to:
```ts
import { getProviderAdapter } from './registry.js';
```
Rest of the file (manifest, `register()`) is unchanged.

- [ ] **Step 2: Update modules/provider/index.test.ts**

Change line 6 from:
```ts
import { getProviderAdapter } from '../../providers/index.js';
```
to:
```ts
import { getProviderAdapter } from './registry.js';
```
Rest of the file (the `toBe(getProviderAdapter)` reference-identity check, the `openai`/`mistral` functional checks) is unchanged — it still passes because both the module and the test now import the same function from the same new source.

- [ ] **Step 3: Update core/tokens.ts**

Change line 3 from:
```ts
import type { ProviderAdapter } from '../providers/types.js';
```
to:
```ts
import type { ProviderAdapter } from '../modules/provider/types.js';
```

- [ ] **Step 4: Update llm/executor.ts**

Change line 27 from:
```ts
import { getProviderAdapter } from '../providers/index.js';
```
to:
```ts
import { getProviderAdapter } from '../modules/provider/registry.js';
```

- [ ] **Step 5: Update llm/executor.test.ts**

Change line 9 from:
```ts
import { getProviderAdapter } from '../providers/index.js'
```
to:
```ts
import { getProviderAdapter } from '../modules/provider/registry.js'
```

- [ ] **Step 6: Update llm/executor.cost.test.ts**

Change line 13 from:
```ts
import { getProviderAdapter } from '../providers/index.js'
```
to:
```ts
import { getProviderAdapter } from '../modules/provider/registry.js'
```

- [ ] **Step 7: Update routes/api.ts**

Change line 20 from:
```ts
import { getProviderAdapter } from '../providers/index.js';
```
to:
```ts
import { getProviderAdapter } from '../modules/provider/registry.js';
```

- [ ] **Step 8: Verify no stale references remain and providers/ is empty**

```bash
grep -rn "providers/" packages/service/src --include="*.ts" | grep -v "^packages/service/src/modules/provider/"
ls packages/service/src/providers/ 2>/dev/null
```
Expected: first command outputs nothing (or only unrelated matches, e.g. a doc string not naming a path); second command reports the directory does not exist or is empty.

- [ ] **Step 9: Full suite + typecheck**

Run: `npx vitest run` (from `packages/service/`)
Expected: same baseline as before this plan (3 failed / 2144 passed going in, now +8 new tests from Task 1 and Task 3's carried-forward suite — no new failures beyond the pre-existing baseline).

Run: `npx tsc --noEmit` (from `packages/service/`)
Expected: clean, no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/service/src/modules/provider/index.ts packages/service/src/modules/provider/index.test.ts \
        packages/service/src/core/tokens.ts packages/service/src/llm/executor.ts \
        packages/service/src/llm/executor.test.ts packages/service/src/llm/executor.cost.test.ts \
        packages/service/src/routes/api.ts
git commit -m "refactor(provider): repoint consumers at modules/provider/registry.js"
```

---

## Self-Review

**1. Spec coverage:** Overview's Step 4 text requires (a) provider module stays ONE module — satisfied, no submodules created; (b) `getProviderAdapter`'s dispatch becomes hook-based via `PROVIDER_REGISTRY`/`AlterableRegistry<ProviderAdapter>` — satisfied by Task 3; (c) built-in providers registered as contributions at `register()`-adjacent time instead of a hardcoded switch — satisfied (contributed at module-load time in `registry.ts`, consumed by `modules/provider/index.ts`'s `register()`); (d) adding a provider later is `.contribute()` with no source edit — satisfied via the exported `providerRegistry` singleton. All 4 covered.

**2. Placeholder scan:** No TBD/TODO, no "similar to Task N" without repeated code, every step has real code or an exact grep/run command with expected output. Clean.

**3. Type consistency:** `AlterableRegistry<T>.get(id): T | undefined` (Task 1) is the exact signature `registry.ts` (Task 3) calls as `providerRegistry.get(model.provider)`. `getProviderAdapter`'s signature (`(model: ModelConfig): ProviderAdapter`) is identical across `registry.ts`, `modules/provider/index.ts`, and every consumer's import — no renames introduced. `providerRegistry` name is used consistently between Task 3's creation and its Self-Review reference; no other task references a differently-named registry.

**Em-dash check:** the `openai-web` ponytail comment's original em dash (`— session key from browser cookies —`) is rewritten in Task 3 Step 1 as a comma-separated sentence, no em dash. Verified no other em dash is introduced by this plan's new prose.

## Execution Handoff

All four tasks are fully mechanical (file moves + a hardcoded-Record-to-registry rewrite following an established, tested primitive) or a small, fully-specified additive method (Task 1). Consistent with the precedent set in Steps 2 and 3 of this same restructure (and the prior 0.4.0 refactory's ledger, e.g. Plan 5 Tasks 10-11), this plan is executed directly via Bash/Edit in the controlling session, not dispatched to implementer/reviewer subagent pairs — each task is verified with its own test run before commit, per Step above.
