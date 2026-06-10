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
