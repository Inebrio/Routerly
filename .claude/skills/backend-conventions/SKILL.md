---
name: backend-conventions
description: Rules for service, CLI, shared types and infrastructure code in this repository. Use when implementing anything behind the interface.
---

# Backend conventions

Binding detail lives in `.claude/rules/service.md` and `.claude/rules/cli.md`.
Read the one covering what you touch. This is the short list you must not
get wrong.

## Everywhere

- TypeScript ESM. Relative imports carry the `.js` extension, Node builtins
  carry the `node:` prefix.
- Types come from the shared package. Never redeclare one locally.
- Tests are `*.test.ts` beside the source they cover.

## Service

- Config writes go through `writeConfig()`. Never `fs.writeFile` on config.
- A new management endpoint needs all four: Zod body validation, permission
  check, the route itself, and a `fastify.inject()` test proving allowed →
  200 and forbidden → 403.
- Bearer tokens are stored as SHA-256. Passwords are bcrypt, 12 rounds.
  Never log either, never return either.
- Runtime state is JSON under `ROUTERLY_HOME`. There is no database.

## CLI

- HTTP goes through `api.ts`. Never fetch directly.
- The service URL comes from the active account's `serverUrl` in `store.ts`.
  Never hardcode it.
- Refresh the token silently before every call when `expiresAt` has passed.
- Errors to stderr with exit code 1. Success to stdout with exit code 0.
- `--json` where piping makes sense, and its output must always parse.
- Register new commands in `index.ts`, or they do not exist.

## Before you report done

- The package builds and its tests pass.
- The command you claim works has been run, and you have its output.
- Anything you could not verify is stated as unverified, not as done.
