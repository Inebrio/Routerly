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

## Testing

- **NEVER** use `*.spec.ts` — the pattern is `*.test.ts`
- **ALWAYS** use Vitest 3 — do not introduce Jest, Mocha, Jasmine or other frameworks
- **ALWAYS** call `afterEach(() => vi.clearAllMocks())` in tests that use mocks
- **ALWAYS** place test files in the same directory as the file under test

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
- **NEVER** commit with `--no-verify` (bypasses husky + commitlint)
- Allowed types: `feat | fix | docs | style | refactor | perf | test | build | ci | chore | revert`

## Docker / Deploy

- **NEVER** run the container as root — the user is `routerly:routerly`
- **NEVER** hardcode secrets in the Docker image or in committed config files
- The Docker volume is `/data` — maps to `ROUTERLY_HOME=/data`

## Known TODOs (unverified information)

- `TODO: verify exact content of eslint.config.*` — not explored during analysis
- `TODO: verify setup of vitest.integration.config.ts` — not explored during analysis
