---
name: codebase-map
description: Where things live in this repository and how to find them fast. Use before analysing, planning or implementing anything in this project.
---

# Codebase map

TypeScript ESM monorepo, Node >= 20, npm workspaces.

| Package | What it is | Stack |
|---|---|---|
| `packages/shared` | Types shared by every surface. Single source of truth. | TypeScript |
| `packages/service` | The gateway and the management API. | Fastify 5 |
| `packages/cli` | The command line surface. | Commander 14, Inquirer 13 |
| `packages/dashboard` | The web surface. | React 18, Vite 6 |

Binding rules per package live in `.claude/rules/service.md`,
`.claude/rules/cli.md` and `.claude/rules/dashboard.md`. Read the one that
covers what you are touching.

## Where to look first

- **A type**: `packages/shared/src/types/`. Never redefine one elsewhere.
- **An HTTP route**: `packages/service/src/routes/` and
  `packages/service/src/modules/*/`.
- **A CLI command**: `packages/cli/src/commands/`, registered in `index.ts`.
- **A page**: `packages/dashboard/src/pages/`, API calls only via `api.ts`.
- **Runtime state**: JSON files under `ROUTERLY_HOME` (`~/.routerly` by
  default), not a database. `config/settings.json` holds the port.
- **Tests**: `*.test.ts` beside the source they cover. Runner: vitest.

## How to search

Grep for the concrete string a user would see (an error message, a flag, a
label) before grepping for concepts. It lands on the real call site in one
hop.

To understand a feature end to end, follow one request: CLI command or
dashboard page, then `api.ts`, then the service route, then the module that
does the work, then the shared type it returns. Four files usually cover it.

## Traps

- A feature exists on three surfaces. Finding it in one does not mean the
  other two are done, and changing one without the others is a bug.
- `dist/` directories are build output. Never read them for truth and never
  edit them.
- The default branch is stale. Work branches from the current integration
  branch, never from the default one.
