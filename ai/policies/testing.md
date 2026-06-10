# Testing

## Framework and runner

- **Vitest 3** — the only allowed test framework
- **Pattern**: `*.test.ts` — never `*.spec.ts`
- **Location**: same directory as the file under test
- **Run all tests**: `npm test`
- **Run package tests**: `npm test --workspace=packages/service`
- **Run single file**: `npx vitest run packages/service/src/routing/router.test.ts`
- **Watch mode**: `npx vitest`
- **Coverage**: `npx vitest run --coverage`

## Test structure

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { myFunction } from './my-module.js'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('./config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn().mockResolvedValue(undefined),
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('myFunction', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should do X when Y', async () => {
    // Arrange
    const input = { ... }
    // Act
    const result = await myFunction(input)
    // Assert
    expect(result).toEqual({ ... })
  })
})
```

## Mocking rules

- **Always** call `afterEach(() => vi.clearAllMocks())` when using mocks
- Mock at the module level with `vi.mock(path, factory)` — not inside individual tests
- Use `vi.fn()` for function mocks, `vi.spyOn()` to spy on existing module exports
- Mock file paths must use `.js` extension: `vi.mock('./config/loader.js', ...)`
- **Never** mock `node:crypto` for security tests — use real crypto functions

## E2E tests

E2E regression tests live in `test/e2e.test.ts` and run against a live Routerly instance.
They are part of the standard test suite and **must pass** before a task that touches the service is declared complete.

### Prerequisites

1. Copy `.env.example` → `.env` and fill in the credentials (gitignored)
2. Start the service: `npm run dev`
3. Credentials loaded automatically from `.env` by `vitest.config.ts`

### How to run

```bash
# Start the service in one terminal
npm run dev

# In another terminal — run only E2E tests
npm run test:e2e
```

### What they cover

| Suite | Activated when |
|-------|----------------|
| `E2E · LLM Proxy` | `ROUTERLY_TEST_TOKEN` is set (required) |
| `E2E · Management API` | `ROUTERLY_TEST_TOKEN` + `ROUTERLY_TEST_ADMIN_PASSWORD` are both set |

Suites skip silently when the required env vars are absent — the unit/integration suite still runs normally.

### When to run

Run E2E tests for every change that touches:
- `packages/service/src/routes/` — any proxy or management endpoint
- `packages/service/src/routing/` — routing policies or executor
- `packages/service/src/providers/` — any provider adapter
- `packages/service/src/config/` — config loader or schema changes

## What to test (service)

- **Unit tests**: routing policies, config loader, JWT functions, provider adapters (mock the SDK calls)
- **Integration tests**: Fastify route handlers using `fastify.inject()` — no real HTTP server needed
- **E2E tests**: `test/e2e.test.ts` against a live instance — required for service changes (see above)

## Fastify route test template

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { myPlugin } from './my-plugin.js'

describe('GET /api/resource', () => {
  const app = Fastify({ logger: false })

  beforeAll(async () => {
    await app.register(myPlugin)
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns 200 with valid token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/resource',
      headers: { authorization: 'Bearer test-token' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ... })
  })
})
```

## Dashboard browser verification

Dashboard changes **must** be verified in a real browser before the task is declared complete.
This is an interactive verification step — not an automated test suite — and is **blocking**.

### Workflow

1. Start the service in dev mode: `npm run dev` (serves the dashboard at `http://localhost:3000/dashboard/`)
2. Open `http://localhost:3000/dashboard/` in a browser
3. Navigate to the relevant page and exercise the changed functionality:
   - Fill forms, click buttons, trigger validation errors, submit
   - Verify data loads and displays correctly
   - Check error states and empty states
4. Capture a screenshot (or equivalent evidence) to document the result
5. Stop the dev server

### What to verify per change type

| Change | Verification |
|--------|--------------|
| New page | renders without crash · navigation link works · data loads |
| New form | fields visible · validation shown on empty submit · success state after save |
| New component | visible in DOM · interactions (click, input) behave correctly |
| Visual / CSS change | before/after appearance matches intent · no regressions on other pages |
| Routing change | correct page shown for each URL · protected routes redirect unauthenticated |

---

## Coverage targets

- Routing policies: 100% branch coverage
- Config loader (`readConfig`, `writeConfig`, `getOrCreateSecret`): 100%
- Auth plugin (JWT verify, login, refresh): 100%
- Provider adapters: mock SDK, test error paths and streaming
