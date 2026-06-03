# Non-negotiable constraints

These constraints are not up for debate. Violating them requires an explicit team decision and an update to `ai/memory/decisions.md`.

---

## Storage

- **NEVER** introduce an external database (PostgreSQL, Redis, MongoDB, SQLite, etc.)
- **NEVER** change the structure of JSON config files without updating `packages/shared/src/types/config.ts`
- **ALWAYS** use `writeConfig(key, data)` from `config/loader.ts` to write config files
- **ALWAYS** use `proper-lockfile` indirectly via `writeConfig` — do not write config files with direct `fs.writeFile`
- **NEVER** hardcode `ROUTERLY_HOME` in code — always read from `config/paths.ts`

## TypeScript / Imports

- **ALWAYS** use `.js` extension in TypeScript imports (e.g. `import { foo } from './bar.js'`)
- **ALWAYS** use `node:` prefix for builtins (e.g. `node:fs`, `node:path`, `node:crypto`, `node:os`)
- **NEVER** use `require()` — the project is ESM-only
- **NEVER** use `import type` for runtime values (use a regular `import`)
- **ALWAYS** extend `tsconfig.base.json` from the root in every new package

## Documentation

- **NEVER** declare a task complete without updating the relevant docs in `docs/`; use the trigger table in `ai/agents/docs.md` (or the one in `ai/workflows/feature-development.md` Step 5) to determine which files to update
- **ALWAYS** update docs in the same commit as the code change — a docs-only follow-up commit is acceptable only when the scope is large

## Testing

- **NEVER** use `*.spec.ts` — the pattern is `*.test.ts`
- **ALWAYS** use Vitest 3 — do not introduce Jest, Mocha, Jasmine or other frameworks
- **ALWAYS** call `afterEach(() => vi.clearAllMocks())` in tests that use mocks
- **ALWAYS** place test files in the same directory as the file under test
- **NEVER** declare a task complete without running `npm test --workspace=packages/<affected>` and `npm run typecheck`; if any test fails, fix it before closing the task
- **Service changes require E2E tests** — start `npm run dev`, then run `npm run test:e2e`; both suites must pass; requires `.env` populated from `.env.example`
- **Dashboard changes require browser verification** — start the dev server, open the dashboard in a real browser, exercise the changed functionality, and capture a screenshot before declaring the task complete

## Security

- **NEVER** log Bearer tokens, JWT secrets or passwords (even truncated)
- **NEVER** expose the raw refresh token value after saving
- **ALWAYS** store only the SHA-256 hash of the refresh token in `users.json`
- **ALWAYS** use bcrypt (12 rounds) for new passwords — never direct SHA-256
- **NEVER** generate the JWT secret inline — use `getOrCreateSecret()` from `config/loader.ts`
- **NEVER** accept user-supplied paths without validating they are inside `ROUTERLY_HOME` (path traversal prevention)

## Wire format

- **NEVER** alter the response format sent to clients (`/v1/chat/completions`, `/v1/messages`) — clients expect OpenAI/Anthropic compatibility
- **ALWAYS** preserve streaming in streaming responses — do not buffer and reply in one block
- **NEVER** add extra fields in proxy responses without the `x-routerly-*` prefix

## Provider adapters

- **ALWAYS** implement the `ProviderAdapter` interface for every new provider
- **NEVER** call a provider SDK directly from the executor or routes — always go through the provider adapter

## Dependencies

- **NEVER** add new npm dependencies without: (1) ESM compatibility check, (2) bundle size review, (3) documented rationale
- **NEVER** add runtime dependencies to the `shared` package (only `uuid` is allowed)
- **NEVER** add test dependencies outside `devDependencies`

## Commits

- **ALWAYS** use conventional commits: `feat(scope): lowercase description`
- **NEVER** commit with `--no-verify` unless commitlint rejects the message solely because of uppercase characters **inside a technical identifier** (e.g. a type name, an acronym, a field name) that cannot be written differently — document the reason in the commit body
- Allowed types: `feat | fix | docs | style | refactor | perf | test | build | ci | chore | revert`

## Git / Branch workflow

- **`develop` is a protected branch** — direct push is always rejected; a PR is required
- **ALWAYS** implement changes on a dedicated feature branch — never commit directly on `develop` or `main`
- Feature branch naming convention: `feature/<scope>-<brief-description>` (kebab-case, e.g. `feature/service-retry-logic`)
- **ALWAYS** open a PR from the feature branch to `develop` using the `gh` CLI (pre-authenticated in this repo):
  ```bash
  gh pr create --base develop --head feature/<name> \
    --title "<conventional-commit-title>" \
    --body "<summary of changes + test evidence>"
  ```
- PR title must follow conventional commits format (same as the main commit)
- PR body must include: summary of changes, packages affected, test commands run, and their outcome
- **CI check "Build & Typecheck" must pass** before the PR can be merged — if it fails, fix the code and push additional commits to the same branch
- **NEVER** merge a PR while CI is red

## Non-functional requirements (from spec)

> **Implementation status** noted where the codebase diverges from the spec.

| Code | Constraint | Status |
|------|------------|--------|
| RNF-01 | Credentials and API keys encrypted at rest (AES-256) via `ROUTERLY_SECRET_KEY` | ⚠️ **Not implemented** — API keys are stored in plain text in `models.json`. Spec intent; not yet built. |
| RNF-02 | Proxy overhead < 200 ms (excluding routing model + provider latency) | No measurement enforcement in code — aspirational target |
| RNF-03 | Fallback loop completes within project timeout; each candidate has its own per-model timeout | Fallback loop exists in executor; per-model timeout not yet configurable |
| RNF-04 | Runs on Linux, macOS, Windows — no OS-specific dependencies | ✅ Node.js + JSON files, no OS-specific code |
| RNF-05 | Structured JSON logs (pino) for all significant events | ✅ pino used throughout; `NODE_ENV=production` disables pretty-print |
| RNF-06 | Env vars take priority over file config (`ROUTERLY_HOME`, port) | ✅ `ROUTERLY_HOME` in `config/paths.ts`; port in `settings.json` (no env override yet) |

## Docker / Deploy

- **NEVER** run the container as root — the user is `routerly:routerly`
- **NEVER** hardcode secrets in the Docker image or in committed config files
- The Docker volume is `/data` — maps to `ROUTERLY_HOME=/data`

## Known TODOs (unverified information)

- `TODO: verify exact content of eslint.config.*` — not explored during analysis
- `TODO: verify setup of vitest.integration.config.ts` — not explored during analysis
