import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(), writeConfig: vi.fn(), getOrCreateSecret: vi.fn() }))
vi.mock('../auth/jwt.js', () => ({
  createSessionToken: vi.fn(() => 'test-jwt'),
  verifyToken: vi.fn(),
  generateRawToken: vi.fn(() => 'raw-refresh-token-xxxx'),
}))
vi.mock('../audit/logger.js', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))

import { apiRoutes } from './api.js'
import { readConfig, writeConfig } from '../config/loader.js'
import { verifyToken } from '../auth/jwt.js'

const mockReadConfig = vi.mocked(readConfig as (key: string) => Promise<any>)
const mockWriteConfig = vi.mocked(writeConfig as (key: string, value: any) => Promise<void>)
const mockVerifyToken = vi.mocked(verifyToken)

afterEach(() => vi.clearAllMocks())
beforeEach(() => { mockReadConfig.mockImplementation(async () => []) })

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(apiRoutes)
  await app.ready()
  return app
}

const testUser = { id: 'test-user-id', email: 'test@example.com', roleId: 'test-role', projectIds: [] }

function authWith(perm: string, data: Record<string, any[]> = {}) {
  mockVerifyToken.mockReturnValue({ sub: 'test-user-id' } as any)
  mockReadConfig.mockImplementation(async (type: string) => {
    if (type === 'users') return [testUser]
    if (type === 'roles') return [{ id: 'test-role', name: 'Test', permissions: [perm] }]
    return data[type] ?? []
  })
  return { authorization: 'Bearer valid-jwt-token' }
}

const projects = [
  { id: 'proj-a', name: 'A', tokens: [], members: [], models: [] },
  { id: 'proj-b', name: 'B', tokens: [], members: [], models: [] },
]

function experiment(over: Record<string, any> = {}) {
  return {
    id: 'exp-1',
    name: 'Prompt A vs B',
    status: 'draft',
    rotation: 'sticky',
    variants: [{ id: 'v-a', projectId: 'proj-a' }, { id: 'v-b', projectId: 'proj-b' }],
    tokens: [{ id: 'tok-1', token: 'sk-rt-secret', tokenSnippet: 'sk-rt-secr', createdAt: '2026-08-01T00:00:00.000Z' }],
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

/** The experiments array as it was written back, for any route that persists. */
function written(): any[] {
  const call = mockWriteConfig.mock.calls.find(c => c[0] === 'experiments')
  return call![1]
}

describe('GET /api/experiments', () => {
  it('lists experiments with experiments:read and never returns the raw token', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/experiments', headers: authWith('experiments:read', { experiments: [experiment()] }) })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveLength(1)
    expect(body[0].tokens[0].token).toBeUndefined()
    expect(body[0].tokens[0].tokenSnippet).toBe('sk-rt-secr')
  })

  it('forbids without experiments:read', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/experiments', headers: authWith('report:read') })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('answers 403 when the experiments module is disabled', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET', url: '/api/experiments',
      headers: authWith('experiments:read', { modules: [{ id: 'experiments', enabled: false }] }),
    })
    await app.close()
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error).toBe('module_disabled')
  })
})

describe('GET /api/experiments/:id', () => {
  it('returns one experiment', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/experiments/exp-1', headers: authWith('experiments:read', { experiments: [experiment()] }) })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).name).toBe('Prompt A vs B')
  })

  it('404s on an unknown id', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/experiments/nope', headers: authWith('experiments:read', { experiments: [experiment()] }) })
    await app.close()
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/experiments', () => {
  it('creates a draft with its own token, returned once', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/experiments',
      headers: authWith('experiments:manage', { projects }),
      payload: { name: 'New test', rotation: 'weighted', variants: [{ projectId: 'proj-a', weight: 50 }, { projectId: 'proj-b', weight: 50 }] },
    })
    await app.close()
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('draft')
    expect(body.token).toMatch(/^sk-rt-[0-9a-f]{64}$/)
    expect(body.tokens[0].token).toBeUndefined()
    expect(body.variants.every((v: any) => typeof v.id === 'string' && v.id.length > 0)).toBe(true)
    expect(written()[0].name).toBe('New test')
  })

  it('defaults the rotation to sticky', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/experiments',
      headers: authWith('experiments:manage', { projects }),
      payload: { name: 'Minimal' },
    })
    await app.close()
    expect(JSON.parse(res.body).rotation).toBe('sticky')
  })

  it('rejects a duplicate name', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/experiments',
      headers: authWith('experiments:manage', { projects, experiments: [experiment()] }),
      payload: { name: 'prompt a vs b' },
    })
    await app.close()
    expect(res.statusCode).toBe(409)
  })

  it('rejects a variant pointing at an unknown project', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/experiments',
      headers: authWith('experiments:manage', { projects }),
      payload: { name: 'Bad', variants: [{ projectId: 'ghost' }] },
    })
    await app.close()
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toEqual({ error: 'project_not_found', projectIds: ['ghost'] })
  })

  it('rejects an empty name', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/experiments',
      headers: authWith('experiments:manage', { projects }),
      payload: { name: '  ' },
    })
    await app.close()
    expect(res.statusCode).toBe(400)
  })

  it('forbids without experiments:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/experiments',
      headers: authWith('experiments:read', { projects }),
      payload: { name: 'Nope' },
    })
    await app.close()
    expect(res.statusCode).toBe(403)
  })
})

describe('PATCH /api/experiments/:id', () => {
  it('edits a draft in full', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH', url: '/api/experiments/exp-1',
      headers: authWith('experiments:manage', { projects, experiments: [experiment()] }),
      payload: { rotation: 'round-robin', variants: [{ projectId: 'proj-a' }] },
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).rotation).toBe('round-robin')
    expect(written()[0].variants).toHaveLength(1)
  })

  it('freezes the design of a running experiment', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH', url: '/api/experiments/exp-1',
      headers: authWith('experiments:manage', { projects, experiments: [experiment({ status: 'running' })] }),
      payload: { rotation: 'weighted' },
    })
    await app.close()
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('experiment_frozen')
  })

  it('still renames a running experiment', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH', url: '/api/experiments/exp-1',
      headers: authWith('experiments:manage', { projects, experiments: [experiment({ status: 'running' })] }),
      payload: { name: 'Renamed' },
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).name).toBe('Renamed')
  })

  it('rejects an empty body and an unknown id', async () => {
    const app = await buildApp()
    const headers = authWith('experiments:manage', { projects, experiments: [experiment()] })
    const empty = await app.inject({ method: 'PATCH', url: '/api/experiments/exp-1', headers, payload: {} })
    const missing = await app.inject({ method: 'PATCH', url: '/api/experiments/ghost', headers, payload: { name: 'x' } })
    await app.close()
    expect(empty.statusCode).toBe(400)
    expect(missing.statusCode).toBe(404)
  })

  it('rejects a variant pointing at an unknown project', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PATCH', url: '/api/experiments/exp-1',
      headers: authWith('experiments:manage', { projects, experiments: [experiment()] }),
      payload: { variants: [{ projectId: 'ghost' }] },
    })
    await app.close()
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/experiments/:id/start', () => {
  it('moves a draft to running and stamps startedAt', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/experiments/exp-1/start',
      headers: authWith('experiments:manage', { experiments: [experiment()] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('running')
    expect(body.startedAt).toBeTruthy()
  })

  it('refuses an experiment that is already running', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/experiments/exp-1/start',
      headers: authWith('experiments:manage', { experiments: [experiment({ status: 'running' })] }),
    })
    await app.close()
    expect(res.statusCode).toBe(409)
  })

  it('refuses to start with fewer than two variants', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/experiments/exp-1/start',
      headers: authWith('experiments:manage', { experiments: [experiment({ variants: [{ id: 'v-a', projectId: 'proj-a' }] })] }),
    })
    await app.close()
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe('too_few_variants')
  })

  it('refuses to start with no token to call', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/experiments/exp-1/start',
      headers: authWith('experiments:manage', { experiments: [experiment({ tokens: [] })] }),
    })
    await app.close()
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe('no_token')
  })
})

describe('POST /api/experiments/:id/close', () => {
  it('closes a running experiment and records the winner', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/experiments/exp-1/close',
      headers: authWith('experiments:manage', { experiments: [experiment({ status: 'running' })] }),
      payload: { winnerVariantId: 'v-b' },
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('closed')
    expect(body.winnerVariantId).toBe('v-b')
    expect(body.closedAt).toBeTruthy()
  })

  it('closes without naming a winner', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/experiments/exp-1/close',
      headers: authWith('experiments:manage', { experiments: [experiment({ status: 'running' })] }),
      payload: {},
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).winnerVariantId).toBeUndefined()
  })

  it('refuses a winner that is not one of the variants', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/experiments/exp-1/close',
      headers: authWith('experiments:manage', { experiments: [experiment({ status: 'running' })] }),
      payload: { winnerVariantId: 'ghost' },
    })
    await app.close()
    expect(res.statusCode).toBe(404)
  })

  it('refuses to close a draft', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/experiments/exp-1/close',
      headers: authWith('experiments:manage', { experiments: [experiment()] }),
      payload: {},
    })
    await app.close()
    expect(res.statusCode).toBe(409)
  })
})

describe('experiment tokens', () => {
  it('issues an extra token, shown once', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/experiments/exp-1/tokens',
      headers: authWith('experiments:manage', { experiments: [experiment()] }),
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.token).toMatch(/^sk-rt-[0-9a-f]{64}$/)
    expect(body.tokenInfo.token).toBeUndefined()
    expect(written()[0].tokens).toHaveLength(2)
  })

  it('revokes a token', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE', url: '/api/experiments/exp-1/tokens/tok-1',
      headers: authWith('experiments:manage', { experiments: [experiment()] }),
    })
    await app.close()
    expect(res.statusCode).toBe(204)
    expect(written()[0].tokens).toHaveLength(0)
  })

  it('404s on an unknown token and an unknown experiment', async () => {
    const app = await buildApp()
    const headers = authWith('experiments:manage', { experiments: [experiment()] })
    const token = await app.inject({ method: 'DELETE', url: '/api/experiments/exp-1/tokens/ghost', headers })
    const exp = await app.inject({ method: 'POST', url: '/api/experiments/ghost/tokens', headers })
    await app.close()
    expect(token.statusCode).toBe(404)
    expect(exp.statusCode).toBe(404)
  })
})

describe('DELETE /api/experiments/:id', () => {
  it('deletes a draft', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE', url: '/api/experiments/exp-1',
      headers: authWith('experiments:manage', { experiments: [experiment()] }),
    })
    await app.close()
    expect(res.statusCode).toBe(204)
    expect(written()).toHaveLength(0)
  })

  it('refuses to delete a running experiment', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE', url: '/api/experiments/exp-1',
      headers: authWith('experiments:manage', { experiments: [experiment({ status: 'running' })] }),
    })
    await app.close()
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('experiment_running')
  })

  it('deletes a closed experiment', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE', url: '/api/experiments/exp-1',
      headers: authWith('experiments:manage', { experiments: [experiment({ status: 'closed' })] }),
    })
    await app.close()
    expect(res.statusCode).toBe(204)
  })

  it('forbids without experiments:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'DELETE', url: '/api/experiments/exp-1',
      headers: authWith('experiments:read', { experiments: [experiment()] }),
    })
    await app.close()
    expect(res.statusCode).toBe(403)
  })
})
