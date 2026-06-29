---
globs: packages/cli/**
---

Working in `packages/cli/` — Commander 14 + Inquirer 13.

- All HTTP calls through `api.ts` — never fetch directly
- Service URL: always read from active account's `serverUrl` in `store.ts` — never hardcode
- Silent token refresh before every API call (check `expiresAt`)
- Errors → `process.stderr`, exit code 1; success → `process.stdout`, exit 0
- Support `--json` flag on commands where pipe-friendly output makes sense
- New commands must be registered in `index.ts`
