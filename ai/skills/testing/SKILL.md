# SKILL — Writing Vitest tests for Routerly

## When to use this skill
Use when asked to write, scaffold, or extend tests for any file in the Routerly monorepo.

## Quick setup

1. Determine the test type: **unit** (policy/utility) or **integration** (route handler)
2. Create the file as `<source-file>.test.ts` in the same directory
3. Import from vitest and from the source with `.js` extension
4. Add mocks at the top, `afterEach(vi.clearAllMocks)` inside the `describe` block

## Unit test template — routing policy

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cheapestPolicy } from './cheapest.js'
import type { PolicyContext } from '../../types/routing.js'

describe('cheapestPolicy', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns candidate with lowest input cost', () => {
    const ctx: PolicyContext = {
      candidates: [
        { modelId: 'gpt-4o', inputCostPer1k: 0.005 },
        { modelId: 'gpt-4o-mini', inputCostPer1k: 0.00015 },
      ],
      request: { messages: [{ role: 'user', content: 'hello' }] },
    }
    const result = cheapestPolicy(ctx)
    expect(result.selected?.modelId).toBe('gpt-4o-mini')
  })

  it('returns null when candidates list is empty', () => {
    const ctx: PolicyContext = { candidates: [], request: { messages: [] } }
    const result = cheapestPolicy(ctx)
    expect(result.selected).toBeNull()
  })
})
```

## Integration test template — Fastify route

```ts
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import Fastify from 'fastify'
import { projectsPlugin } from './projects.js'

vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn().mockResolvedValue({ projects: [] }),
  writeConfig: vi.fn().mockResolvedValue(undefined),
}))

describe('Projects API', () => {
  const app = Fastify({ logger: false })

  beforeAll(async () => {
    await app.register(projectsPlugin)
    await app.ready()
  })

  afterAll(() => app.close())
  afterEach(() => vi.clearAllMocks())

  it('GET /api/projects returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ projects: expect.any(Array) })
  })
})
```

## Auth edge case template

```ts
it('returns 401 when Authorization header is missing', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/projects' })
  expect(res.statusCode).toBe(401)
})

it('returns 403 when user lacks permission', async () => {
  const res = await app.inject({
    method: 'DELETE',
    url: '/api/projects/abc',
    headers: { authorization: 'Bearer viewer-token' },
  })
  expect(res.statusCode).toBe(403)
})
```

## Running tests

```bash
npm test                                              # all packages
npm test --workspace=packages/service                # service only
npx vitest run packages/service/src/routing/policies/cheapest.test.ts  # single file
npx vitest --coverage                                # with coverage
```
