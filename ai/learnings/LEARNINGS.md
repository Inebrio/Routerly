# LEARNINGS.md — Corrections, knowledge gaps, best practices

See `ai/skills/autoimprove/SKILL.md` for the log format.

<!-- Append new entries below this line -->

## [LRN-20260610-001] knowledge_gap

**Logged**: 2026-06-10T00:00:00Z
**Priority**: high
**Status**: promoted
**Promoted to**: ai/policies/coding-style.md (JSON imports section)
**Area**: service

### Summary
`vitest/config` does not export `loadEnv` in vitest 4.x — must import from `vite` instead.

### Details
Root `vitest.config.ts` used `import { defineConfig, loadEnv } from 'vitest/config'`. Starting with vitest 4.x, `loadEnv` was removed from vitest's re-exports. Import it from `vite` directly.

### Suggested Action
Always import `loadEnv` from `'vite'`, not `'vitest/config'`.

### Metadata
- Source: error
- Related Files: vitest.config.ts
- Tags: vitest, imports, testing

---

## [LRN-20260610-002] knowledge_gap

**Logged**: 2026-06-10T00:00:00Z
**Priority**: high
**Status**: promoted
**Promoted to**: ai/policies/coding-style.md, ai/memory/constraints.md
**Area**: service, shared

### Summary
`tsconfig.base.json` must use `module: NodeNext` (not `Node16`) to support JSON import attributes (`with { type: 'json' }`), required by Node 22+.

### Details
`module: "Node16"` predates import attribute support in TypeScript. Upgrading to `"NodeNext"` is backward-compatible for this project and unlocks the `with { type: 'json' }` syntax. After the change, delete all `*.tsbuildinfo` files to force a clean build.

### Suggested Action
Use `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` in `tsconfig.base.json`.

### Metadata
- Source: error
- Related Files: tsconfig.base.json, packages/shared/src/index.ts
- Tags: typescript, json-imports, node22, node25, docker

---

## [LRN-20260610-003] best_practice

**Logged**: 2026-06-10T00:00:00Z
**Priority**: medium
**Status**: pending
**Area**: service

### Summary
`GET /api/system/info` should be explicitly whitelisted in the JWT preHandler to be public; absence of an `if (!req.dashUser)` check in the route handler is not sufficient.

### Details
The JWT preHandler (line 178 in api.ts) blocks ALL `/api/*` routes by default. A route that omits the `req.dashUser` check still gets blocked by the middleware. If the intent is a public endpoint, it must be added to the whitelist explicitly.

### Suggested Action
When adding a new public `/api/*` endpoint, always add it to the preHandler whitelist alongside `/api/auth/login`, `/api/auth/refresh`, and `/api/setup/*`.

### Metadata
- Source: error
- Related Files: packages/service/src/routes/api.ts:178-183
- Tags: auth, middleware, api

---

## [LRN-20260613-001] best_practice

**Logged**: 2026-06-13T00:00:00Z
**Priority**: high
**Status**: pending
**Area**: service

### Summary
The `anthropic` provider adapter uses the official SDK and **reconstructs** the request body (`JSON.stringify(m.content)`), so it is NOT byte-faithful. Any feature that must forward a request verbatim (e.g. subscription/OAuth pass-through, preserving the `system` block / tool-use content) must **bypass the SDK adapter** and use raw `fetch`.

### Details
`/v1/messages` is handled by `routes/anthropic.ts` → `llmMessages` → `AnthropicAdapter.messages()`, which rebuilds params and stringifies structured message content (`packages/service/src/providers/anthropic.ts:324`). It does NOT go through `routes/passthrough.ts` (that's only the not-found handler for unhandled paths). An early assumption that "just tweak `buildUpstreamHeaders` in passthrough.ts" would suffice was wrong: passthrough is never reached for `/v1/messages`.

### Suggested Action
For verbatim forwarding on a first-class route, branch in the route after model resolution to a dedicated raw-`fetch` helper (see `routes/oauthForward.ts`). Re-stringifying the parsed JSON body is semantically faithful (Anthropic parses JSON server-side; only field values matter). Reuse `buildUpstreamUrl` from `passthrough.ts` and the hop-by-hop filtering pattern.

### Metadata
- Source: conversation
- Related Files: packages/service/src/providers/anthropic.ts:315-335, packages/service/src/routes/oauthForward.ts, packages/service/src/routes/anthropic.ts
- Tags: providers, anthropic, passthrough, oauth, wire-format

---

## 2026-06-24: Worktree node_modules isolation for @routerly/shared

When running TypeScript typecheck in a git worktree, `@routerly/shared` resolves through the main repo's node_modules symlink (pointing to main repo's `packages/shared`), not the worktree's copy. Running `npm install` in the worktree root creates a local `node_modules/@routerly/shared` symlink pointing to the worktree's own packages/shared, fixing the resolution. Always run `npm install` in the worktree before typechecking cross-package types.

## 2026-06-24: TF bag-of-words vectors need fixed vocab dimension

Per-text vocabulary (each text builds its own word list) makes vectors incomparable across different texts — two texts with the same frequency profile but different words produce identical numerical vectors, causing false cosine similarity hits. Use a fixed-dimension hash space (djb2 hash → bucket index) so vectors from different texts are in the same space and cosine similarity is meaningful.

## 2026-06-24: Git merge from worktree when target branch is checked out in main worktree

A worktree cannot check out a branch already checked out in the main worktree (`fatal: ... already used by worktree`). To merge the feature branch into the base branch: push the feature branch to origin, then perform the merge from the main worktree (`git -C /main/repo/path merge --no-ff feature-branch`).
