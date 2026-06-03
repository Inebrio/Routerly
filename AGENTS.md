# AGENTS.md — AI Agent Entrypoint

This file is the entry point for any agent working on **Routerly**.
Read this file before anything else. For details, go to `ai/`.

> **Local environment**: if `AGENTS.local.md` exists in the repository root, read it
> immediately after this file. It contains developer-specific context (local paths,
> active providers, WIP branches, personal preferences) that overrides or extends
> what is documented here. The file is gitignored and may not be present.
>
> **Bootstrap (mandatory when `AGENTS.local.md` is absent)**: if the file does not
> exist, **create it automatically** before proceeding. Do not ask the developer —
> gather all required data autonomously:
>
> 1. Read `~/.routerly/config/users.json` — pick the first admin user as the local username.
> 2. Read `~/.routerly/config/projects.json` — pick the project named `Test` (or the
>    first project with `"test"` in the name) and extract its first token.
> 3. Read `~/.routerly/config/models.json` — list active providers and endpoints.
> 4. Detect OS (`uname -s`), Node version (`node -v`), and `ROUTERLY_HOME` (default `~/.routerly/`).
> 5. Use `AGENTS.local.example.md` as the template and write the populated file to
>    `AGENTS.local.md` in the repository root.
> 6. Confirm creation in the startup message.
>
> **Startup confirmation (mandatory)**: at the very start of every conversation,
> output a brief confirmation listing which context files were loaded, for example:
> `[Routerly] Custom configuration loaded — AGENTS.md ✓ | AGENTS.local.md ✓ (username: info@routerly.ai, test token: set)`
> If `AGENTS.local.md` was just bootstrapped, say so: `(bootstrapped automatically)`.
> If bootstrap failed, say why and proceed without it.

---

## What is Routerly

Self-hosted API gateway that acts as an intelligent proxy between LLM clients and providers (OpenAI, Anthropic, Gemini, Ollama, custom). It offers intelligent routing with 10 policies, cost tracking, per-project budgets, authentication and a web dashboard. Drop-in compatibility with OpenAI and Anthropic APIs.

- **Current version**: 0.1.5
- **Default port**: 3000
- **Docker image**: `inebrio/routerly:latest`
- **Formal spec**: `spec/LocalRouter_Specification_1.md`

---

## Monorepo structure

```
packages/
  shared/    ← shared TypeScript types (no runtime logic)
  service/   ← core: Fastify 5, routing engine, provider adapters, management API
  cli/       ← CLI interface (Commander 14 + Inquirer 13)
  dashboard/ ← web SPA (React 18 + Vite 6), served embedded by the service
```

Dependency order: `shared` ← `service`, `cli`, `dashboard`.

---

## Essential commands

```bash
npm run build               # shared → service → cli → dashboard
npm run dev                 # start service in watch mode (tsx watch)
npm test                    # vitest run across all workspaces
npm test --workspace=packages/service  # service only
npm run lint                # eslint packages/*/src
npm run format              # prettier --write
npm run typecheck           # typecheck all packages
```

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ROUTERLY_HOME` | `~/.routerly/` | directory for all config and data files |
| `NODE_ENV` | — | `production` disables pino-pretty in the logger |

No `.env.example` exists. Configuration is done via JSON files managed by the CLI.

---

## Non-negotiable rules

1. **No external database** — everything on JSON files in `ROUTERLY_HOME`
2. **TypeScript imports with `.js` extension** — required with `moduleResolution: Node16`
3. **`node:` prefix** for builtins — `node:fs`, `node:path`, `node:crypto`
4. **Tests: only `*.test.ts`** — never `*.spec.ts`
5. **Commits: conventional commits lowercase** — `feat(scope): description`
6. **Config writes**: always via `writeConfig()` with `proper-lockfile`
7. **OpenAI/Anthropic wire format**: never alter the response format sent to the client
8. **No new dependencies** without strong justification and ESM compatibility check
9. **Test before done**: every feature added, modified, or deleted must pass `npm test --workspace=packages/<affected>` + `npm run typecheck` before the task is declared complete. If tests fail, fix them before closing the task.
10. **Autoimprove**: run Hook 1 (pre-task review) before starting any multi-step task and Hook 2 (post-task capture) after completing it — see `ai/skills/autoimprove/SKILL.md`.

---

## Specialized agents

Use the agent that matches your scope. Each agent knows its own boundaries and handoff contracts.

| Scope | Agent file |
|-------|-----------|
| `packages/service/` — Fastify, routing, providers, auth | `ai/agents/service.md` |
| `packages/dashboard/` — React SPA | `ai/agents/frontend.md` |
| `packages/cli/` — Commander CLI | `ai/agents/cli.md` |
| `docs/` — Docusaurus documentation | `ai/agents/docs.md` |
| `.github/`, `Dockerfile`, `scripts/`, versioning | `ai/agents/cicd.md` |
| Generic feature development | `ai/agents/developer.md` |
| Code review | `ai/agents/reviewer.md` |
| Writing tests | `ai/agents/tester.md` |

---

## Canonical files

| Looking for | Where to look |
|-------------|---------------|
| Architecture and request flow | `ai/context/architecture.md` |
| All API endpoints | `ai/context/api.md` |
| Storage and JSON files | `ai/context/database.md` |
| Docker, CI/CD, deploy | `ai/context/infrastructure.md` |
| Code style | `ai/policies/coding-style.md` |
| Testing rules | `ai/policies/testing.md` |
| Security rules | `ai/policies/security.md` |
| Architectural decisions | `ai/memory/decisions.md` |
| Non-negotiable constraints (full) | `ai/memory/constraints.md` |
| How to develop a feature | `ai/workflows/feature-development.md` |
| How to fix a bug | `ai/workflows/bugfix.md` |
| Ready-to-use prompt templates | `ai/prompts/` |
| Skill: writing tests | `ai/skills/testing/SKILL.md` |
| Skill: code review | `ai/skills/code-review/SKILL.md` |
| Skill: continuous improvement | `ai/skills/autoimprove/SKILL.md` |
| Learnings staging area | `ai/learnings/` |
