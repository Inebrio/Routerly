---
globs: packages/cli/**
---

You are working in `packages/cli/` — the Commander 14 + Inquirer 13 CLI for Routerly.

Key reminders for this scope:
- All HTTP calls to the management API go through `api.ts`
- Never hardcode the service URL — always read from the active account's `serverUrl` in store.ts
- Apply silent token refresh before every API call (check `expiresAt`)
- Errors → `process.stderr`, exit code 1; success → `process.stdout`, exit 0
- Support `--json` flag on commands where pipe-friendly output makes sense
- New commands must be registered in `index.ts`
- Run `npm test --workspace=packages/cli` + `npm run typecheck` before declaring done
