---
description: Review the current branch diff against main using the Routerly reviewer checklist.
---

Review the changes on the current branch against main.

1. Run `git diff main...HEAD` to get the full diff
2. Apply the reviewer checklist in order:

**BLOCKING — Security**
- No secrets/tokens logged or in responses
- All user inputs validated with Zod
- No user-supplied file paths outside ROUTERLY_HOME
- Auth plugin on new protected routes
- Permission check before data mutations
- New passwords: bcrypt 12 rounds (not SHA-256)
- Refresh tokens stored as SHA-256 hash (not raw)
- Provider response not modified before forwarding to client

**BLOCKING — Constraints**
- TypeScript imports have `.js` extension
- Node builtins have `node:` prefix
- No `require()`
- Config writes via `writeConfig()` — not `fs.writeFile`
- Test files are `*.test.ts` — not `*.spec.ts`
- Wire format to client unchanged

**MAJOR — Correctness & quality**
- No implicit `any`
- Exported functions have explicit return types
- No silent error swallowing
- Fastify logger used (not `console.log`)
- New code paths covered by tests
- `afterEach(vi.clearAllMocks)` when using mocks

Output format per finding:
`[SEVERITY] file.ts:line — description`

List BLOCKING issues first, summarized at the top.
