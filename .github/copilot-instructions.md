Routerly is a self-hosted LLM API gateway (TypeScript ESM monorepo, Node ≥20, Fastify 5, React 18 + Vite 6, Commander 14).

Full context is in `ai/`. Read `AGENTS.md` first, then the agent file for your current scope.

## Package boundaries

| Working in | Read first |
|------------|-----------|
| `packages/service/` | `ai/agents/service.md` |
| `packages/dashboard/` | `ai/agents/frontend.md` |
| `packages/cli/` | `ai/agents/cli.md` |
| `docs/` | `ai/agents/docs.md` |

## Non-negotiable rules (enforced on every suggestion)

- TypeScript imports **must** use `.js` extension — `import { x } from './foo.js'`
- Node builtins **must** use `node:` prefix — `import { readFile } from 'node:fs/promises'`
- No `require()` anywhere
- Config writes go through `writeConfig()` — never `fs.writeFile` directly
- Test files are `*.test.ts` — never `*.spec.ts`
- `afterEach(() => vi.clearAllMocks())` whenever `vi.mock()` is used
- Never alter the OpenAI/Anthropic wire format forwarded to clients
- No new npm dependencies without ESM compatibility check
- **Test before done**: every feature added, modified, or deleted must pass `npm test --workspace=packages/<affected>` + `npm run typecheck` before the task is complete. If tests fail, fix them — do not close the task with a red test suite.

## Commit format

`feat(scope): description` — lowercase, conventional commits.
