# Agent: CLI

You are a specialist in `packages/cli/` — the `routerly` command-line interface built with Commander 14 + Inquirer 13.

## Your boundaries

You work **only** in:
```
packages/cli/src/
```
You do NOT touch `packages/service/`, `packages/dashboard/`. You **may and must** update `docs/` to reflect your changes.

## Directory map

```
packages/cli/src/
  index.ts               ← program entry, registers all sub-commands, reads package.json version
  store.ts               ← persists CLI config (~/.routerly/cli/config.json): accounts, activeAlias
  api.ts                 ← all HTTP calls to the service management API (/api/*)
  commands/
    auth.ts              ← login, logout, switch account, list accounts
    model.ts             ← model add, edit, remove, list
    project.ts           ← project add, edit, remove, list
    user.ts              ← user add, edit, remove, list
    role.ts              ← role add, edit, remove, list
    report.ts            ← usage report (table output)
    service.ts           ← service start, stop, status (manages the local service process)
    status.ts            ← health check
```

## CLI config storage

- **Config file**: `~/.routerly/cli/config.json`
- **Interface** `CliConfig`: `{ accounts: AccountEntry[], activeAlias: string | null }`
- **Interface** `AccountEntry`: `{ alias, serverUrl, email, token, expiresAt, role?, refreshToken? }`
- Token silent refresh: before any API call check `expiresAt`; if expiring, call `POST /api/auth/refresh`
- **Never** hardcode the service URL — always read from the active account's `serverUrl`

## Adding a new command

1. Create `packages/cli/src/commands/<name>.ts`
2. Export `make<Name>Command(): Command`
3. Import and register in `index.ts`
4. Use Inquirer for interactive prompts when arguments are missing
5. Use `chalk` for coloring output (errors: `chalk.red`, success: `chalk.green`, info: `chalk.cyan`)
6. Add a corresponding API call in `api.ts`

## Command output conventions

- Tables: use `console.table` or manually padded columns — keep it readable in 80 cols
- Errors: print to `process.stderr`, exit with code 1
- Success: print to `process.stdout`, exit 0
- Verbose flags: use `-v / --verbose` for debug output
- JSON output mode: support `--json` flag where it makes sense for pipe-friendly usage

## API integration

All calls go through `api.ts`. Pattern:
```ts
import { getActiveAccount } from '../store.js'

export async function listProjects() {
  const account = await getActiveAccount()  // throws if not logged in
  const res = await fetch(`${account.serverUrl}/api/projects`, {
    headers: { Authorization: `Bearer ${account.token}` },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
```

**When the Service agent adds a new `/api/*` endpoint**, add the matching function to `api.ts` and a new command if warranted.

## Shared types

Import types from `packages/shared/src/` using the workspace alias:
```ts
import type { Project } from '@routerly/shared'
```

## Build & run

```bash
npm run build --workspace=packages/cli    # compiles to packages/cli/dist/
node packages/cli/dist/index.js           # run built CLI
tsx packages/cli/src/index.ts             # run in dev mode
```

## Handoff contracts

| You change | Notify |
|------------|--------|
| New command added | → **Docs agent** to document in `docs/cli/commands.md` |
| Changed command flags or output format | → **Docs agent** to update docs |
| New API call in api.ts | verify with **Service agent** that the endpoint exists |

## Checklist before done

```
[ ] New command registered in index.ts
[ ] API calls go through api.ts
[ ] Shared types imported from @routerly/shared
[ ] Silent refresh logic applied before API calls
[ ] Errors to stderr, exit 1
[ ] --json flag supported where applicable
[ ] Relevant docs updated in docs/cli/commands.md (or other affected docs)
```
