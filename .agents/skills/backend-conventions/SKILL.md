---
name: backend-conventions
description: Rules for service, CLI, shared types and infrastructure code in this repository. Use when implementing anything behind the interface.
---

# Backend conventions

Binding detail lives in `.Codex/rules/service.md` and `.Codex/rules/cli.md`.
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

## Scripts against live external services

A script that creates a disposable GitHub repo, hits a real API, or runs a
live release tool is expensive to redo: minutes of wall-clock, a fresh
external resource, and a full agent turn budget, every time it fails on
something you could have caught for free.

- **Sanity-check before the first live run.** `bash -n` the script. Re-read
  it for shell portability this machine actually has — `grep -P`/`-Pq`
  silently misbehaves here because this is BSD grep, not GNU; prefer
  `gh api --jq` or POSIX-safe patterns. Check whether an early step
  (`npm install`, a build) leaves the tree dirty in a way a later
  `git checkout` in the same script will collide with. A live run that fails
  on a bug like this bought no evidence and cost a real repo.
- **Wait for it with one blocking call, not a loop of turns.** For a script
  that logs many lines over minutes, do not stream it with `Monitor`
  line-by-line and then fill turns with idle placeholder commands between
  notifications — each notification and each placeholder is a paid turn,
  and a chatty script can burn the whole budget before you ever reach the
  step that writes your report. Prefer a single foreground `Bash` call with
  a timeout that covers the expected wall-clock, or `run_in_background`
  plus one wait for the process to actually exit. Read the resulting log
  file once it is done, rather than watching it happen.

## Before you report done

- The package builds and its tests pass.
- The command you claim works has been run, and you have its output.
- Anything you could not verify is stated as unverified, not as done.
