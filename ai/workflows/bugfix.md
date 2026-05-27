# Workflow: Bug Fix

## Before you start — autoimprove pre-task review

Run Hook 1 from `ai/skills/autoimprove/SKILL.md`:
1. Check `ai/learnings/ERRORS.md` — has this error or a similar one been seen before?
2. Read matching entries before diagnosing to avoid re-tracing the same path
3. If `ai/learnings/` is empty or absent, skip and proceed

---

## Step 0 — Reproduce

Before touching any code, reproduce the bug:

1. Identify the exact input / sequence of events that triggers it
2. Note the actual vs. expected behavior
3. Identify which package and file(s) are involved

## Step 1 — Locate the root cause

Use the context files to navigate:

| Symptom | Where to look |
|---------|---------------|
| Wrong routing decision | `packages/service/src/routing/router.ts`, relevant policy file |
| Provider error / malformed request | `packages/service/src/providers/<name>.ts` |
| 401 / 403 on valid token | `packages/service/src/plugins/auth.ts` or `jwt.ts` |
| Wrong data returned by `/api/*` | `packages/service/src/routes/api.ts` |
| Config not persisted | `packages/service/src/config/` — check `writeConfig()` call |
| Dashboard shows stale or wrong data | `packages/dashboard/src/api.ts` → check fetch call + response mapping |
| CLI command crashes or returns wrong output | `packages/cli/src/commands/<name>.ts`, `packages/cli/src/api.ts` |
| Type mismatch across packages | `packages/shared/src/types/` |

Read `ai/context/architecture.md` to trace the full request path if the symptom is ambiguous.

## Step 2 — Write a failing test first

Before fixing, write a `*.test.ts` that reproduces the bug. This confirms:
- You understand the root cause
- The fix will be verifiable
- The bug cannot regress

```bash
npx vitest run packages/service/src/<path>.test.ts
# Must fail before fix, pass after fix
```

## Step 3 — Fix

Apply the minimal change that makes the failing test pass without breaking existing tests.

Constraints:
- Do NOT alter the wire format sent to the client (OpenAI / Anthropic proxy responses)
- Config writes must use `writeConfig()` — never raw `fs.writeFile`
- Do not introduce new dependencies to fix a bug

## Step 4 — Verify

```bash
npm test --workspace=packages/<affected-package>   # full suite must be green
npm run typecheck
npm run lint
```

If the bug spans multiple packages, run the full suite:
```bash
npm test
```

## Step 4.5 — Autoimprove post-task capture

Run Hook 2 from `ai/skills/autoimprove/SKILL.md` before handoffs:
- Log the root cause pattern to `ai/learnings/ERRORS.md` (even if resolved — it prevents recurrence)
- Was the bug caused by an outdated doc in `ai/`? → update doc + log knowledge_gap
- Did you find a better diagnostic approach? → log best_practice
- Promote if the bug reveals a gap in `ai/memory/constraints.md` or `ai/context/`

---

## Step 5 — Handoffs

If the bug was in a documented behavior (wrong endpoint response, wrong CLI output, wrong dashboard behavior):

```
HANDOFF → Docs agent
Bug fixed: <description>
Check: <docs file> may need updating if it described the incorrect behavior
```

## Step 6 — Commit

```
fix(service): correct budget-remaining policy when project has no usage
fix(cli): handle expired refresh token gracefully in api.ts
```

One commit per package. Reference the issue number if applicable:
```
fix(service): prevent duplicate usage records on stream abort (#123)
```
