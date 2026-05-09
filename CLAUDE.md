# CLAUDE.md — Routerly

Routerly is a self-hosted LLM API gateway. TypeScript ESM monorepo, Node ≥20, Fastify 5, React 18 + Vite 6, Commander 14. No external database — all state in JSON files under `ROUTERLY_HOME`.

**Start here**: read `AGENTS.md`, then the agent file for your scope.

## Agent files by scope

| Scope | File |
|-------|------|
| `packages/service/` — Fastify, routing, providers | `ai/agents/service.md` |
| `packages/dashboard/` — React SPA | `ai/agents/frontend.md` |
| `packages/cli/` — Commander CLI | `ai/agents/cli.md` |
| `docs/` — Docusaurus | `ai/agents/docs.md` |
| `.github/`, `Dockerfile`, `scripts/`, versioning | `ai/agents/cicd.md` |
| Generic feature | `ai/agents/developer.md` |
| Code review | `ai/agents/reviewer.md` |
| Writing tests | `ai/agents/tester.md` |

## Essential commands

```bash
npm run build          # build all packages in dependency order
npm run dev            # service in watch mode on :3000
npm test               # vitest across all workspaces
npm run typecheck
npm run lint
```

## Hard constraints — never violate

1. Imports use `.js` extension — `import { x } from './foo.js'`
2. Node builtins use `node:` prefix — `node:fs`, `node:path`, `node:crypto`
3. No `require()`
4. Config writes via `writeConfig()` only — uses `proper-lockfile`
5. Test files `*.test.ts` — never `*.spec.ts`
6. `afterEach(() => vi.clearAllMocks())` whenever mocks are present
7. OpenAI/Anthropic proxy response format never altered
8. No new npm dependencies without ESM check
9. **Test before done** — run `npm test --workspace=packages/<affected>` + `npm run typecheck` after every change. A task is not complete until all tests pass. Fix failures before declaring done.

## Workflow files

- Feature development: `ai/workflows/feature-development.md`
- Bug fix: `ai/workflows/bugfix.md`

## Commits

Conventional commits, lowercase: `feat(scope): description`
