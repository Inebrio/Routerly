# Coding style

## File naming

- **All files**: `kebab-case` (e.g. `routing-memory-store.ts`, `auth-plugin.ts`)
- **Test files**: same name as the file under test + `.test.ts` (e.g. `loader.test.ts`)
- **No `*.spec.ts`**

## Identifier naming

| Category | Convention | Example |
|----------|-----------|---------|
| Types, interfaces, classes | `PascalCase` | `ProviderAdapter`, `RoutingResult` |
| Functions, variables, parameters | `camelCase` | `readConfig`, `projectId` |
| Constants (module-level, immutable) | `UPPER_SNAKE_CASE` | `DEFAULT_PORT`, `MAX_RETRIES` |
| Enum members | `PascalCase` | `RoutingPolicy.Cheapest` |
| File names | `kebab-case` | `jwt-plugin.ts` |

## TypeScript

- **Strict mode**: `"strict": true` in `tsconfig.base.json` — no exceptions
- **No `any`**: use `unknown` and narrow, or `never` for exhaustive checks
- **Import extensions**: always `.js` (required by NodeNext resolution)
  ```ts
  // ✅ correct
  import { readConfig } from './config/loader.js'
  // ❌ wrong
  import { readConfig } from './config/loader'
  ```
- **JSON imports**: always use `with { type: 'json' }` attribute (required by Node 22+)
  ```ts
  // ✅ correct
  import data from './conf/data.json' with { type: 'json' }
  // ❌ wrong — ERR_IMPORT_ATTRIBUTE_MISSING on Node 22+
  import data from './conf/data.json'
  ```
- **Node builtins**: always `node:` prefix
  ```ts
  import { createHash } from 'node:crypto'
  import { readFile } from 'node:fs/promises'
  ```
- **No `require()`** — ESM only
- **Explicit return types** on exported functions
- **`type` imports** only for types that are never used as values:
  ```ts
  import type { ModelConfig } from '@routerly/shared'
  ```

## Section comments

Use section dividers to group related code within a file:

```ts
// ─── Types ────────────────────────────────────────────────────────────────────

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Main ─────────────────────────────────────────────────────────────────────
```

## Error handling

- Use `FastifyError` or `new Error(message)` — no custom error classes unless adding structured fields
- Always include context in error messages: `throw new Error(\`Model \${modelId} not found\`)`
- Never swallow errors silently: either rethrow or log + rethrow

## Async / await

- Always use `async/await` — no raw `.then()/.catch()` chains
- Use `Promise.all()` for independent parallel operations
- Never `await` inside a loop when operations are independent — use `Promise.all(arr.map(...))`

## Logging

- Use the Fastify logger (`request.log`, `fastify.log`) — not `console.log`
- Log levels: `error` for failures, `warn` for degraded paths, `info` for lifecycle events, `debug` for detail
- Never log secrets, tokens or passwords (even truncated)
