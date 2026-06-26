---
description: Run tests for the right workspace based on what files changed, then report results.
---

Detect which packages have changed files and run tests only for those packages.

Steps:
1. Check `git diff --name-only HEAD` to find changed files
2. Map to workspaces:
   - `packages/service/**` → `npm test --workspace=packages/service`
   - `packages/dashboard/**` → `npm test --workspace=packages/dashboard`
   - `packages/cli/**` → `npm test --workspace=packages/cli`
   - `packages/shared/**` → run tests for all packages that depend on shared
3. Also run `npm run typecheck` across all changed workspaces
4. Report: pass/fail per workspace, any test names that failed, coverage delta if available

If $ARGUMENTS is provided, run tests only for that workspace: `npm test --workspace=packages/$ARGUMENTS`
