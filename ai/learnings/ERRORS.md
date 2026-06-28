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

## [ERR-20260628-001] SSE trace events pollute OpenAI-compatible streaming output

**Logged**: 2026-06-28T00:31:00Z
**Priority**: high
**Status**: resolved (PR pending — issue #110)

### Summary
Routerly's `emit()` in `packages/service/src/routes/openai.ts` unconditionally wrote
`{"type":"trace",...}` SSE frames into the wire stream, breaking strict
OpenAI-compatible clients (`@ai-sdk/openai-compatible`, openai strict mode, etc.)
that validate the first `data:` line as a `ChatCompletionChunk` with a `choices[]`
array. The `x-routerly-no-trace` request header was documented but not honoured.

### Root cause
`emit()` (line ~230) called `reply.raw.write(...)` directly with no header check.
The `x-routerly-no-trace` header existed in the docs but was never read from
`request.headers`.

### Fix
Read the header near the other header reads (line ~120) and gate the `reply.raw.write`
call. Trace entries are still recorded in the in-memory trace store via
`appendTrace(traceId, [entry])` so the dashboard / debug surface is unaffected.

### Regression coverage
- `it('suppresses trace events from SSE stream when x-routerly-no-trace: 1 is sent')`
- `it('emits trace events on SSE stream when x-routerly-no-trace header is absent')`
Both tests use the all-candidates-exhausted path which calls `emit()` directly
from the route handler, guaranteeing a trace event hits the wire.

### Lesson
When a header is documented as a feature, the implementation must read it. Add a
failing test that exercises the documented behaviour BEFORE adding the
implementation, so the missing wire-up is caught at the same time as the bug.
