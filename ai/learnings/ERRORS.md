# ERRORS.md — Unexpected errors and failing commands

See `ai/skills/autoimprove/SKILL.md` for the log format.

<!-- Append new entries below this line -->

## [ERR-20260610-001] Docker build / packages/shared/dist not found

**Logged**: 2026-06-10T00:00:00Z
**Priority**: high
**Status**: resolved

### Summary
`docker build` fails with `"/app/packages/shared/dist": not found` in the production stage, despite the builder stage running `npm run build --workspace=packages/shared` successfully.

### Error
```
ERROR: failed to build: failed to solve: failed to compute cache key:
  "/app/packages/shared/dist": not found
```

### Context
- The `.dockerignore` excluded `**/dist/` (correct) but also excluded only `*.tsbuildinfo` at root level, not `**/*.tsbuildinfo`
- TypeScript `composite: true` uses incremental builds. When `tsconfig.tsbuildinfo` from the host is copied into the Docker context, `tsc` sees the build as up-to-date and skips generating `dist/`
- No error is reported by `tsc` — silent no-op

### Suggested Fix
Add `**/*.tsbuildinfo` to `.dockerignore`. Done in this session.

### Metadata
- Reproducible: yes
- Related Files: .dockerignore, packages/shared/tsconfig.json
- Resolution: 2026-06-10 — added `**/*.tsbuildinfo` to `.dockerignore`

---

## [ERR-20260610-002] Node 22+/25+ requires import attributes for JSON modules

**Logged**: 2026-06-10T00:00:00Z
**Priority**: high
**Status**: resolved

### Summary
Service fails to start in Docker (node:25-alpine) with `ERR_IMPORT_ATTRIBUTE_MISSING` for JSON imports in `@routerly/shared`.

### Error
```
TypeError [ERR_IMPORT_ATTRIBUTE_MISSING]: Module "file:///app/packages/shared/dist/conf/providers.json"
needs an import attribute of "type: json"
```

### Context
- `packages/shared/src/index.ts` and `browser.ts` imported JSON via bare `import x from './conf/providers.json'`
- Node.js 22+ / 25+ requires `with { type: 'json' }` attribute
- TypeScript `module: "Node16"` does not support import attributes syntax — must use `"NodeNext"`
- After upgrading to `NodeNext`, also need to delete `.tsbuildinfo` files for clean compilation

### Suggested Fix
1. Change `tsconfig.base.json`: `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`
2. Update JSON imports: `import x from './foo.json' with { type: 'json' }`
3. Delete `**/*.tsbuildinfo` before first build after tsconfig change

### Metadata
- Reproducible: yes
- Related Files: tsconfig.base.json, packages/shared/src/index.ts, packages/shared/src/browser.ts
- Resolution: 2026-06-10 — both fixes applied

---
