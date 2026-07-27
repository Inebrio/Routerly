# Step 9: modules/guardrails/ + modules/pii/ Full Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `middleware/guardrails.ts` and `middleware/piiScrubber.ts` (plus their tests) into `modules/guardrails/` and `modules/pii/` respectively, and absorb the pre-existing flat module wrappers (`modules/guardrails.ts`, `modules/pii.ts`) into `modules/guardrails/index.ts` / `modules/pii/index.ts`, repointing every consumer. `middleware/` becomes empty after this step.

**Architecture:** Pure relocation, no logic changes. Same pattern as Steps 6-8: pre-existing flat wrapper file occupies the new directory's `index.ts` slot (no naming collision — the logic files keep their own names, `guardrails.ts`/`piiScrubber.ts`, as siblings of `index.ts`, matching `modules/budget/budget.ts` and `modules/usage/tracker.ts` precedent).

**Tech Stack:** TypeScript ESM, Vitest, `git mv` for history-preserving renames.

## Global Constraints

- No logic changes — pure import-path fixes only, verified against the actual current file contents (captured verbatim below).
- Imports: `.js` extension on all relative imports (existing convention, unchanged).
- After every `git add`, run `git status --short` before committing — a multi-pathspec `git add` silently drops ALL listed paths if even one pathspec doesn't match (e.g. because a prior `git mv` already renamed it away). This bit Step 8; do not repeat it.
- Run a blanket stale-reference grep (including `import(` for dynamic imports) before each commit.
- Full suite (`cd packages/service && npx vitest run`) and `npm run typecheck --workspace=packages/service` must both stay at the established pre-existing baseline (3 failures: `oauthForward.test.ts` x2, `modules/provider/anthropic.test.ts` x1) after each task.
- Commit subjects: all-lowercase (commitlint `subject-case`).
- No em-dashes anywhere.

---

### Task 1: `middleware/guardrails.ts` → `modules/guardrails/guardrails.ts`

**Files:**
- Move: `packages/service/src/middleware/guardrails.ts` → `packages/service/src/modules/guardrails/guardrails.ts`
- Move: `packages/service/src/middleware/guardrails.test.ts` → `packages/service/src/modules/guardrails/guardrails.test.ts`

**Steps:**

- [ ] **Step 1: Move the files**

```bash
mkdir -p packages/service/src/modules/guardrails
git mv packages/service/src/middleware/guardrails.ts packages/service/src/modules/guardrails/guardrails.ts
git mv packages/service/src/middleware/guardrails.test.ts packages/service/src/modules/guardrails/guardrails.test.ts
```

- [ ] **Step 2: Fix `guardrails.ts`'s imports (file moved one level deeper than `middleware/`)**

Replace (lines 12-17):
```ts
import { classifyIntent } from '../modules/routing/intent/classifier.js';
import { getEmbeddingProvider } from '../modules/embeddings/dispatch.js';
import { llmChat, checkBudget, BudgetExceededError } from '../llm/executor.js';
import type { LLMCallContext } from '../llm/executor.js';
import { readConfig } from '../modules/config/loader.js';
import { trackUsage } from '../modules/usage/tracker.js';
```
with:
```ts
import { classifyIntent } from '../routing/intent/classifier.js';
import { getEmbeddingProvider } from '../embeddings/dispatch.js';
import { llmChat, checkBudget, BudgetExceededError } from '../../llm/executor.js';
import type { LLMCallContext } from '../../llm/executor.js';
import { readConfig } from '../config/loader.js';
import { trackUsage } from '../usage/tracker.js';
```

(`llm/executor.js` gets an EXTRA `../` since `llm/` is not yet under `modules/` — same situation as `routing/policies/llm.ts` from Step 8; will be fixed again at Step 13.)

- [ ] **Step 3: Fix `guardrails.test.ts`'s mocks + imports**

Replace (lines 3-21):
```ts
vi.mock('../modules/config/loader.js', () => ({ readConfig: vi.fn(), appendUsageRecord: vi.fn() }));
vi.mock('../llm/executor.js', () => ({
  llmChat: vi.fn(),
  checkBudget: vi.fn(() => Promise.resolve()),
  BudgetExceededError: class BudgetExceededError extends Error {
    override name = 'BudgetExceededError';
    modelId: string;
    constructor(modelId: string) { super('budget_exceeded'); this.modelId = modelId; }
  },
}));
vi.mock('../modules/usage/tracker.js', () => ({ trackUsage: vi.fn(() => Promise.resolve()) }));
vi.mock('../modules/routing/intent/classifier.js', () => ({ classifyIntent: vi.fn() }));
vi.mock('../modules/embeddings/dispatch.js', () => ({ getEmbeddingProvider: vi.fn() }));

import { checkGuardrails, buildRequestInjection, type GuardrailProjectCtx } from './guardrails.js';
import { readConfig } from '../modules/config/loader.js';
import { llmChat, checkBudget, BudgetExceededError } from '../llm/executor.js';
import { trackUsage } from '../modules/usage/tracker.js';
import { classifyIntent } from '../modules/routing/intent/classifier.js';
```
with:
```ts
vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(), appendUsageRecord: vi.fn() }));
vi.mock('../../llm/executor.js', () => ({
  llmChat: vi.fn(),
  checkBudget: vi.fn(() => Promise.resolve()),
  BudgetExceededError: class BudgetExceededError extends Error {
    override name = 'BudgetExceededError';
    modelId: string;
    constructor(modelId: string) { super('budget_exceeded'); this.modelId = modelId; }
  },
}));
vi.mock('../usage/tracker.js', () => ({ trackUsage: vi.fn(() => Promise.resolve()) }));
vi.mock('../routing/intent/classifier.js', () => ({ classifyIntent: vi.fn() }));
vi.mock('../embeddings/dispatch.js', () => ({ getEmbeddingProvider: vi.fn() }));

import { checkGuardrails, buildRequestInjection, type GuardrailProjectCtx } from './guardrails.js';
import { readConfig } from '../config/loader.js';
import { llmChat, checkBudget, BudgetExceededError } from '../../llm/executor.js';
import { trackUsage } from '../usage/tracker.js';
import { classifyIntent } from '../routing/intent/classifier.js';
```

(`@routerly/shared` import and rest of the 1515-line test file body are unchanged — only these mock/import lines reference moved paths.)

- [ ] **Step 4: Verify + commit**

```bash
cd packages/service && npx vitest run src/modules/guardrails/guardrails.test.ts && cd ../..
git status --short   # confirm both new paths staged as renames, nothing left behind
git add packages/service/src/modules/guardrails/guardrails.ts packages/service/src/modules/guardrails/guardrails.test.ts
git status --short   # re-check before commit
git commit -m "refactor(guardrails): move middleware/guardrails.ts into modules/guardrails/"
```

---

### Task 2: `middleware/piiScrubber.ts` → `modules/pii/piiScrubber.ts`

**Files:**
- Move: `packages/service/src/middleware/piiScrubber.ts` → `packages/service/src/modules/pii/piiScrubber.ts`
- Move: `packages/service/src/middleware/piiScrubber.test.ts` → `packages/service/src/modules/pii/piiScrubber.test.ts`

**Steps:**

- [ ] **Step 1: Move the files (no import fixes needed)**

```bash
mkdir -p packages/service/src/modules/pii
git mv packages/service/src/middleware/piiScrubber.ts packages/service/src/modules/pii/piiScrubber.ts
git mv packages/service/src/middleware/piiScrubber.test.ts packages/service/src/modules/pii/piiScrubber.test.ts
```

`piiScrubber.ts` imports only `type { PiiEntity, PiiPolicy } from '@routerly/shared'` (no relative imports) — self-contained, no changes needed. `piiScrubber.test.ts` imports only from `./piiScrubber.js` (sibling, unchanged) and `@routerly/shared`. Confirm `middleware/` is now empty:

```bash
ls packages/service/src/middleware/   # expect: no such file or directory
```

- [ ] **Step 2: Verify + commit**

```bash
cd packages/service && npx vitest run src/modules/pii/piiScrubber.test.ts && cd ../..
git status --short
git add packages/service/src/modules/pii/piiScrubber.ts packages/service/src/modules/pii/piiScrubber.test.ts
git status --short
git commit -m "refactor(pii): move middleware/piiScrubber.ts into modules/pii/"
```

---

### Task 3: Wrapper absorption + external consumer repoints

**Files:**
- Move: `packages/service/src/modules/guardrails.ts` → `packages/service/src/modules/guardrails/index.ts`
- Move: `packages/service/src/modules/guardrails.test.ts` → `packages/service/src/modules/guardrails/index.test.ts`
- Move: `packages/service/src/modules/pii.ts` → `packages/service/src/modules/pii/index.ts`
- Move: `packages/service/src/modules/pii.test.ts` → `packages/service/src/modules/pii/index.test.ts`
- Modify: `packages/service/src/modules/index.ts`
- Modify: `packages/service/src/reverse-proxy/helpers.ts`
- Modify: `packages/service/src/reverse-proxy/helpers.test.ts`
- Modify: `packages/service/src/reverse-proxy/context.ts`
- Modify: `packages/service/src/routes/openaiOAuthForward.ts`

**Steps:**

- [ ] **Step 1: Move the wrapper files**

```bash
git mv packages/service/src/modules/guardrails.ts packages/service/src/modules/guardrails/index.ts
git mv packages/service/src/modules/guardrails.test.ts packages/service/src/modules/guardrails/index.test.ts
git mv packages/service/src/modules/pii.ts packages/service/src/modules/pii/index.ts
git mv packages/service/src/modules/pii.test.ts packages/service/src/modules/pii/index.test.ts
```

- [ ] **Step 2: Fix `modules/guardrails/index.ts`**

Replace:
```ts
import { defineModule, shortCircuit, type Processor, type RouterlyModule } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { checkGuardrails, buildRequestInjection } from '../middleware/guardrails.js'
import { appendTrace } from '../routing/traceStore.js'
import { BudgetExceededError } from '../llm/executor.js'
import {
  buildContentFilterBlock,
  writeOpenAIStreamingBlock,
  primaryText,
  conversationText,
  assembledResponseText,
  wrapWithResponseGuardrail,
} from '../reverse-proxy/helpers.js'
```
with:
```ts
import { defineModule, shortCircuit, type Processor, type RouterlyModule } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { checkGuardrails, buildRequestInjection } from './guardrails.js'
import { appendTrace } from '../../routing/traceStore.js'
import { BudgetExceededError } from '../../llm/executor.js'
import {
  buildContentFilterBlock,
  writeOpenAIStreamingBlock,
  primaryText,
  conversationText,
  assembledResponseText,
  wrapWithResponseGuardrail,
} from '../../reverse-proxy/helpers.js'
```

(Rest of the file — the `request`/`response` processors, `guardrailsModule` — unchanged.)

- [ ] **Step 3: Fix `modules/guardrails/index.test.ts`**

Replace:
```ts
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { BudgetExceededError } from '../llm/executor.js'

const checkGuardrailsMock = vi.fn()
vi.mock('../middleware/guardrails.js', () => ({
  checkGuardrails: (...args: unknown[]) => checkGuardrailsMock(...args),
  buildRequestInjection: () => null,
}))

const { guardrailsModule } = await import('./guardrails.js')
```
with:
```ts
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { BudgetExceededError } from '../../llm/executor.js'

const checkGuardrailsMock = vi.fn()
vi.mock('./guardrails.js', () => ({
  checkGuardrails: (...args: unknown[]) => checkGuardrailsMock(...args),
  buildRequestInjection: () => null,
}))

const { guardrailsModule } = await import('./index.js')
```

(Rest of the file — `harness()`, `fakeReply()`, `baseCtx()`, all `describe`/`it` bodies — unchanged.)

- [ ] **Step 4: Fix `modules/pii/index.ts`**

Replace:
```ts
import { defineModule, type Processor, type RouterlyModule } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import type { ChatCompletionRequest } from '@routerly/shared'
import { mergePolicies, scrubMessages } from '../middleware/piiScrubber.js'
import { appendTrace } from '../routing/traceStore.js'
import { applyResponseScrub, wrapWithStreamingScrubber } from '../reverse-proxy/helpers.js'
```
with:
```ts
import { defineModule, type Processor, type RouterlyModule } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import type { ChatCompletionRequest } from '@routerly/shared'
import { mergePolicies, scrubMessages } from './piiScrubber.js'
import { appendTrace } from '../../routing/traceStore.js'
import { applyResponseScrub, wrapWithStreamingScrubber } from '../../reverse-proxy/helpers.js'
```

(Rest of the file — `input`/`output` processors, `piiModule` — unchanged.)

- [ ] **Step 5: Fix `modules/pii/index.test.ts`**

Replace:
```ts
import { ServiceContainer, EventBus, ProcessorRegistry } from '../core/index.js'
import { PROXY_PIPELINE } from '../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { piiModule } from './pii.js'
```
with:
```ts
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { piiModule } from './index.js'
```

(Rest of the file — `harness()`, both `it` bodies — unchanged.)

- [ ] **Step 6: Fix `modules/index.ts`**

Replace:
```ts
import { guardrailsModule } from './guardrails.js'
import { piiModule } from './pii.js'
```
with:
```ts
import { guardrailsModule } from './guardrails/index.js'
import { piiModule } from './pii/index.js'
```

(Rest of the file — other imports, `coreModules` array — unchanged.)

- [ ] **Step 7: Fix `reverse-proxy/helpers.ts`**

Replace:
```ts
import { StreamingScrubber, scrubText } from '../middleware/piiScrubber.js'
import type { EffectivePii } from '../middleware/piiScrubber.js'
import { checkGuardrails } from '../middleware/guardrails.js'
```
with:
```ts
import { StreamingScrubber, scrubText } from '../modules/pii/piiScrubber.js'
import type { EffectivePii } from '../modules/pii/piiScrubber.js'
import { checkGuardrails } from '../modules/guardrails/guardrails.js'
```

- [ ] **Step 8: Fix `reverse-proxy/helpers.test.ts`**

Replace both occurrences:
```ts
vi.mock('../middleware/guardrails.js', () => ({ checkGuardrails: vi.fn() }))
```
```ts
import { checkGuardrails } from '../middleware/guardrails.js'
```
with:
```ts
vi.mock('../modules/guardrails/guardrails.js', () => ({ checkGuardrails: vi.fn() }))
```
```ts
import { checkGuardrails } from '../modules/guardrails/guardrails.js'
```

(This test file does not import `piiScrubber.js` directly — no PII-path change needed here.)

- [ ] **Step 9: Fix `reverse-proxy/context.ts`**

Replace:
```ts
import type { EffectivePii } from '../middleware/piiScrubber.js'
```
with:
```ts
import type { EffectivePii } from '../modules/pii/piiScrubber.js'
```

- [ ] **Step 10: Fix `routes/openaiOAuthForward.ts`**

Replace:
```ts
import { mergePolicies, StreamingScrubber } from '../middleware/piiScrubber.js';
```
with:
```ts
import { mergePolicies, StreamingScrubber } from '../modules/pii/piiScrubber.js';
```

(`routes/openaiOAuthForward.test.ts` does not mock `piiScrubber.js` — it only mocks `usage/tracker.js` and `node:fs/promises` — no change needed there.)

- [ ] **Step 11: Blanket stale-reference grep**

```bash
cd packages/service/src
grep -rn "middleware/guardrails\|middleware/piiScrubber" --include="*.ts" .
grep -rn "'\.\./modules/guardrails\.js'\|'\./guardrails\.js'\|'\./pii\.js'\|'\.\./modules/pii\.js'" --include="*.ts" . | grep -v "modules/guardrails/guardrails.js\|modules/pii/piiScrubber.js"
grep -rn "import(" --include="*.ts" . | grep -i "guardrail\|pii"
ls middleware/ 2>&1   # expect: no such file or directory
cd ../../..
```

Expect all clean (no stale `middleware/` refs, no dynamic imports referencing old paths).

- [ ] **Step 12: Full verification + commit**

```bash
cd packages/service && npx vitest run src/modules/guardrails src/modules/pii src/reverse-proxy src/routes/openaiOAuthForward.test.ts src/modules/index.test.ts 2>&1 | tail -30
npm run typecheck --workspace=packages/service
cd ..
```

```bash
git status --short   # inspect every path before staging
git add packages/service/src/modules/guardrails/index.ts packages/service/src/modules/guardrails/index.test.ts \
        packages/service/src/modules/pii/index.ts packages/service/src/modules/pii/index.test.ts \
        packages/service/src/modules/index.ts \
        packages/service/src/reverse-proxy/helpers.ts packages/service/src/reverse-proxy/helpers.test.ts \
        packages/service/src/reverse-proxy/context.ts \
        packages/service/src/routes/openaiOAuthForward.ts
git status --short   # re-check every path landed as staged, nothing left modified
git commit -m "refactor(guardrails,pii): absorb module wrappers and repoint external consumers"
```

- [ ] **Step 13: Full-suite regression check**

```bash
cd packages/service && npx vitest run 2>&1 | tail -15
```

Expect exactly the pre-existing baseline: 3 failed (`oauthForward.test.ts` x2, `modules/provider/anthropic.test.ts` x1), rest passing. Any other failure is a regression from this step and must be fixed before moving to Step 10.

---

## Self-Review

**1. Spec coverage:** Step 9's overview line ("modules/guardrails/, modules/pii/ full extraction (guardrails needs embeddings + provider)") is covered: guardrails.ts's dependency on `embeddings/dispatch.js` (already modularized in Step 6) and its transitive dependency on `routing/intent/classifier.js` (modularized in Step 8) are both confirmed already-satisfied — no blocking dependency gaps.

**2. Placeholder scan:** No TBD/TODO. Every replace block shows exact before/after code copied from the files actually read this session.

**3. Type consistency:** `GuardrailProjectCtx`, `RuleEval`, `GuardrailResult`, `checkGuardrails`, `buildRequestInjection` (guardrails) and `EffectivePii`, `mergePolicies`, `scrubMessages`, `scrubText`, `StreamingScrubber`, `scrubPii` (pii) are untouched exports — only their import paths change across consumers. `guardrailsModule`/`piiModule` names and `defineModule` manifests are unchanged.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-27-modular-step9-guardrails-pii-extraction.md`. Per the standing session instruction to execute all steps continuously via Subagent-Driven methodology where opportune, and per established Steps 3-8 precedent: this task's specs are fully pre-specified mechanical moves (transcription plus testing) — executing directly via `git mv`/`Edit`/`Bash` in this session, no subagent dispatch needed.
