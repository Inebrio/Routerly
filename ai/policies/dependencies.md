# Dependencies

## Rules

1. **No new dependency** without: (1) ESM compatibility check, (2) bundle size justification, (3) documented rationale in `ai/memory/decisions.md`
2. **No runtime dependencies in `shared`** — only `uuid` is allowed
3. **Test/dev tools** go in root `devDependencies` only, never in package-level `dependencies`
4. **Check ESM compatibility**: does the package ship `"type": "module"` or an `exports` field with `import` condition? If not, it likely won't work without special handling
5. **Prefer built-in Node.js modules** when the standard library covers the need

## Current dependencies by package

### Root (dev)
- `typescript`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `eslint`, `prettier`
- `husky`, `@commitlint/cli`, `@commitlint/config-conventional`
- `@changesets/cli`
- `vitest`

### `packages/shared`
- **Runtime**: `uuid`
- **Dev**: `typescript`

### `packages/service`
- **Runtime**:
  - `fastify` ^5 — HTTP server
  - `@fastify/cors` — CORS plugin
  - `@fastify/static` — static file serving (dashboard)
  - `zod` ^4 — schema validation
  - `bcrypt` — password hashing (12 rounds)
  - `proper-lockfile` — file-level locking for config writes
  - `pino-pretty` — log formatting (dev only, disabled in production)
  - `openai` ^4 — OpenAI provider SDK
  - `@anthropic-ai/sdk` ^0.39 — Anthropic provider SDK
- **Dev**: `typescript`, `@types/node`, `@types/bcrypt`, `tsx` (watch mode)

### `packages/cli`
- **Runtime**:
  - `commander` ^14 — CLI argument parsing
  - `inquirer` ^13 — interactive prompts
  - `chalk` or similar — terminal colors (TODO: verify exact dep)
- **Dev**: `typescript`, `@types/node`

### `packages/dashboard`
- **Runtime**:
  - `react` ^18, `react-dom` ^18
  - `react-router-dom` ^6
  - Various UI component deps (TODO: verify exact list)
- **Dev**: `vite` ^6, `@vitejs/plugin-react`, `typescript`

## Adding a new dependency — checklist

```
[ ] Is it ESM-compatible? (check package.json "type" or "exports")
[ ] Is there a built-in Node.js alternative?
[ ] Is it actively maintained? (last publish < 1 year)
[ ] Does it add significant value vs writing 20 lines of code?
[ ] Added to the correct package's package.json (not root for runtime deps)
[ ] Documented in ai/memory/decisions.md if it changes the architecture
```
