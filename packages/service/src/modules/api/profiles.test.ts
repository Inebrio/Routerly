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

// Baseline so plugin registration never sees an un-mocked readConfig; per-test authWith replaces it.
beforeEach(() => {
  mockReadConfig.mockImplementation(async () => [])
})

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(apiRoutes)
  await app.ready()
  return app
}

const testUser = { id: 'test-user-id', email: 'test@example.com', roleId: 'test-role', projectIds: [] }

/** Grants exactly one permission via a custom role; `data` seeds the remaining config reads. */
function authWith(perm: string, data: Record<string, any[]> = {}) {
  mockVerifyToken.mockReturnValue({ sub: 'test-user-id' } as any)
  mockReadConfig.mockImplementation(async (type: string) => {
    if (type === 'users') return [testUser]
    if (type === 'roles') return [{ id: 'test-role', name: 'Test', permissions: [perm] }]
    return data[type] ?? []
  })
  return { authorization: 'Bearer valid-jwt-token' }
}

const userProfile = { id: 'u1', kind: 'routing', version: 1, label: 'Mine', policies: [{ type: 'health', enabled: true }], selector: 'argmax', fallbackStrategy: 'next-best', builtin: false, baseId: 'auto' }
const optimizerProfile = { id: 'o1', kind: 'optimizer', version: 1, label: 'Mine', optimizers: { steps: [{ id: 'ccr', enabled: true }] }, builtin: false, baseId: 'optimizer-safe' }
const securityProfile = { id: 's1', kind: 'security', version: 1, label: 'Mine', guardrails: { rules: [] }, pii: { policies: [] }, builtin: false, baseId: 'security-standard' }

// ─── GET /api/profiles ───────────────────────────────────────────────────────

describe('GET /api/profiles', () => {
  it('allows with profiles:read and returns built-ins + user overlays', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/profiles', headers: authWith('profiles:read', { profiles: [userProfile] }) })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.some((p: any) => p.id === 'auto' && p.builtin === true)).toBe(true)
    expect(body.some((p: any) => p.id === 'optimizer-safe')).toBe(true)
    // No security preset ships any more: the kind only ever holds user overlays.
    expect(body.some((p: any) => p.kind === 'security' && p.builtin === true)).toBe(false)
    expect(body.some((p: any) => p.id === 'u1')).toBe(true)
  })

  it('narrows to a single kind via ?kind=', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/profiles?kind=security', headers: authWith('profiles:read', { profiles: [userProfile, securityProfile] }) })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.every((p: any) => p.kind === 'security')).toBe(true)
    expect(body.map((p: any) => p.id)).toContain('s1')
  })

  it('rejects an unknown kind', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/profiles?kind=nope', headers: authWith('profiles:read') })
    await app.close()
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe('invalid_kind')
  })

  it('forbids without profiles:read', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/profiles', headers: authWith('model:read') })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('blocks when the profiles module is disabled', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/profiles', headers: authWith('profiles:read', { modules: [{ id: 'profiles', enabled: false }] }) })
    await app.close()
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error).toBe('module_disabled')
  })
})

// ─── POST /api/profiles ──────────────────────────────────────────────────────

describe('POST /api/profiles', () => {
  it('creates a routing profile from a full body', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/profiles', headers: authWith('profiles:manage'),
      payload: { kind: 'routing', label: 'From scratch', policies: [{ type: 'cheapest', enabled: true }], selector: 'cheapest', fallbackStrategy: 'abort' },
    })
    await app.close()
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.kind).toBe('routing')
    expect(body.label).toBe('From scratch')
    expect(body.selector).toBe('cheapest')
    expect(body.builtin).toBe(false)
    expect(body.version).toBe(1)
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.baseId).toBeUndefined()
    expect(mockWriteConfig).toHaveBeenCalledWith('profiles', [expect.objectContaining({ id: body.id })])
  })

  it('fills routing defaults when only kind and label are sent', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/profiles', headers: authWith('profiles:manage'), payload: { kind: 'routing', label: 'Empty' } })
    await app.close()
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.policies).toEqual([])
    expect(body.selector).toBe('argmax')
    expect(body.fallbackStrategy).toBe('next-best')
  })

  it('creates an optimizer profile', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/profiles', headers: authWith('profiles:manage'),
      payload: { kind: 'optimizer', label: 'Opt', optimizers: { steps: [{ id: 'session-dedup', enabled: true }] } },
    })
    await app.close()
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.kind).toBe('optimizer')
    expect(body.optimizers.steps).toHaveLength(1)
  })

  it('creates a security profile with empty defaults', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/profiles', headers: authWith('profiles:manage'), payload: { kind: 'security', label: 'Sec' } })
    await app.close()
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.guardrails).toEqual({ rules: [] })
    expect(body.pii).toEqual({ policies: [] })
  })

  it('appends to the existing user profiles instead of replacing them', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/profiles', headers: authWith('profiles:manage', { profiles: [userProfile] }), payload: { kind: 'routing', label: 'Second' } })
    await app.close()
    expect(res.statusCode).toBe(201)
    expect(mockWriteConfig).toHaveBeenCalledWith('profiles', [
      expect.objectContaining({ id: 'u1' }),
      expect.objectContaining({ label: 'Second' }),
    ])
  })

  it('rejects an unknown kind', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/profiles', headers: authWith('profiles:manage'), payload: { kind: 'nope', label: 'X' } })
    await app.close()
    expect(res.statusCode).toBe(400)
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('rejects an empty label', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/profiles', headers: authWith('profiles:manage'), payload: { kind: 'routing', label: '  ' } })
    await app.close()
    expect(res.statusCode).toBe(400)
  })

  it('rejects a field that belongs to another kind', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/profiles', headers: authWith('profiles:manage'), payload: { kind: 'security', label: 'X', selector: 'argmax' } })
    await app.close()
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).selector).toBeUndefined()
  })

  it('forbids without profiles:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/profiles', headers: authWith('profiles:read'), payload: { kind: 'routing', label: 'X' } })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('blocks when the profiles module is disabled', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/profiles', headers: authWith('profiles:manage', { modules: [{ id: 'profiles', enabled: false }] }), payload: { kind: 'routing', label: 'X' } })
    await app.close()
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error).toBe('module_disabled')
  })
})

// ─── POST /api/profiles/clone ────────────────────────────────────────────────

describe('POST /api/profiles/clone', () => {
  it('allows with profiles:manage and clones a built-in into a user overlay', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/profiles/clone', headers: authWith('profiles:manage'), payload: { baseId: 'auto', label: 'My Auto' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.baseId).toBe('auto')
    expect(body.kind).toBe('routing')
    expect(body.builtin).toBe(false)
    expect(body.label).toBe('My Auto')
    expect(mockWriteConfig).toHaveBeenCalledWith('profiles', expect.arrayContaining([expect.objectContaining({ label: 'My Auto' })]))
  })

  it('clones an optimizer preset, keeping its steps', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/profiles/clone', headers: authWith('profiles:manage'), payload: { baseId: 'optimizer-balanced', label: 'Mine' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.kind).toBe('optimizer')
    expect(body.optimizers.steps.length).toBeGreaterThan(0)
  })

  it('forbids without profiles:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/profiles/clone', headers: authWith('profiles:read'), payload: { baseId: 'auto', label: 'X' } })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('returns 400 unknown_base_profile for an unknown baseId', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/profiles/clone', headers: authWith('profiles:manage'), payload: { baseId: 'nope', label: 'X' } })
    await app.close()
    expect(res.statusCode).toBe(400)
    expect(String(JSON.parse(res.body).error)).toContain('unknown_base_profile')
  })

  it('rejects an empty label', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/profiles/clone', headers: authWith('profiles:manage'), payload: { baseId: 'auto', label: '  ' } })
    await app.close()
    expect(res.statusCode).toBe(400)
  })
})

// ─── PATCH /api/profiles/:id ─────────────────────────────────────────────────

describe('PATCH /api/profiles/:id', () => {
  it('allows with profiles:manage, applies partial update and bumps version', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: '/api/profiles/u1', headers: authWith('profiles:manage', { profiles: [userProfile] }), payload: { label: 'Renamed' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.label).toBe('Renamed')
    expect(body.version).toBe(2)
  })

  it('updates an optimizer profile payload', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: '/api/profiles/o1', headers: authWith('profiles:manage', { profiles: [optimizerProfile] }), payload: { optimizers: { steps: [{ id: 'rtk', enabled: true }] } } })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).optimizers.steps).toEqual([{ id: 'rtk', enabled: true }])
  })

  it('updates a security profile payload', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: '/api/profiles/s1', headers: authWith('profiles:manage', { profiles: [securityProfile] }), payload: { pii: { policies: [{ target: 'both', entities: ['EMAIL'] }] } } })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).pii.policies).toHaveLength(1)
  })

  it('rejects a field that belongs to another kind', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: '/api/profiles/o1', headers: authWith('profiles:manage', { profiles: [optimizerProfile] }), payload: { selector: 'cheapest' } })
    await app.close()
    expect(res.statusCode).toBe(400)
  })

  it('forbids without profiles:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: '/api/profiles/u1', headers: authWith('profiles:read'), payload: { label: 'X' } })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('returns 409 immutable_builtin_profile when targeting a built-in id', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: '/api/profiles/auto', headers: authWith('profiles:manage', { profiles: [] }), payload: { label: 'X' } })
    await app.close()
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('immutable_builtin_profile')
  })

  it('returns 404 for an unknown non-built-in id', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: '/api/profiles/ghost', headers: authWith('profiles:manage', { profiles: [] }), payload: { label: 'X' } })
    await app.close()
    expect(res.statusCode).toBe(404)
  })

  it('rejects an empty body', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: '/api/profiles/u1', headers: authWith('profiles:manage', { profiles: [userProfile] }), payload: {} })
    await app.close()
    expect(res.statusCode).toBe(400)
  })
})

// ─── DELETE /api/profiles/:id ────────────────────────────────────────────────

describe('DELETE /api/profiles/:id', () => {
  it('allows with profiles:manage and deletes a user profile', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/profiles/u1', headers: authWith('profiles:manage', { profiles: [userProfile], projects: [] }) })
    await app.close()
    expect(res.statusCode).toBe(204)
    expect(mockWriteConfig).toHaveBeenCalledWith('profiles', [])
  })

  it('forbids without profiles:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/profiles/u1', headers: authWith('profiles:read') })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('returns 409 immutable_builtin_profile for a built-in id', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/profiles/auto', headers: authWith('profiles:manage', { profiles: [] }) })
    await app.close()
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('immutable_builtin_profile')
  })

  it.each([
    ['routingProfileId', 'u1'],
    ['optimizerProfileId', 'u1'],
    ['securityProfileId', 'u1'],
    ['profileId', 'u1'],
  ])('returns 409 profile_in_use when a project references it through %s', async (field, id) => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: `/api/profiles/${id}`, headers: authWith('profiles:manage', { profiles: [userProfile], projects: [{ id: 'p1', [field]: id }] }) })
    await app.close()
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('profile_in_use')
  })

  it('returns 404 for an unknown non-built-in id', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/profiles/ghost', headers: authWith('profiles:manage', { profiles: [] }) })
    await app.close()
    expect(res.statusCode).toBe(404)
  })
})

// ─── PUT /api/projects/:id/profiles ──────────────────────────────────────────

describe('PUT /api/projects/:id/profiles', () => {
  const project = { id: 'p1', name: 'P1', tokens: [], members: [], models: [], policies: [] }

  it('allows with project:write and assigns a routing profile', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profiles', headers: authWith('project:write', { projects: [project], profiles: [userProfile] }), payload: { routing: 'u1' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).routingProfileId).toBe('u1')
  })

  it('assigns all three kinds in one call', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'PUT', url: '/api/projects/p1/profiles',
      headers: authWith('project:write', { projects: [project], profiles: [userProfile, optimizerProfile, securityProfile] }),
      payload: { routing: 'u1', optimizer: 'o1', security: 's1' },
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ routingProfileId: 'u1', optimizerProfileId: 'o1', securityProfileId: 's1' })
  })

  it('clears one kind with null and leaves the others untouched', async () => {
    const bound = { ...project, routingProfileId: 'u1', optimizerProfileId: 'o1' }
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profiles', headers: authWith('project:write', { projects: [bound] }), payload: { routing: null } })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.routingProfileId).toBeUndefined()
    expect(body.optimizerProfileId).toBe('o1')
  })

  it('drops the legacy profileId on any assignment', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profiles', headers: authWith('project:write', { projects: [{ ...project, profileId: 'fast' }], profiles: [userProfile] }), payload: { routing: 'u1' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).profileId).toBeUndefined()
  })

  it('forbids without project:write', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profiles', headers: authWith('project:read'), payload: { routing: 'u1' } })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('returns 404 for an unknown project', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/ghost/profiles', headers: authWith('project:write', { projects: [project], profiles: [userProfile] }), payload: { routing: 'u1' } })
    await app.close()
    expect(res.statusCode).toBe(404)
  })

  it('rejects an invalid body (id neither string nor null)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profiles', headers: authWith('project:write', { projects: [project] }), payload: { routing: 123 } })
    await app.close()
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 profile_not_found for an id that matches nothing, and does not persist it', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profiles', headers: authWith('project:write', { projects: [project], profiles: [userProfile] }), payload: { routing: 'nonexistent-profile-id' } })
    await app.close()
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'profile_not_found', kind: 'routing' })
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('rejects an id belonging to another kind', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profiles', headers: authWith('project:write', { projects: [project], profiles: [optimizerProfile] }), payload: { routing: 'o1' } })
    await app.close()
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body).error).toBe('profile_not_found')
  })

  it('assigns a real built-in id', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profiles', headers: authWith('project:write', { projects: [project] }), payload: { routing: 'cheap', optimizer: 'optimizer-safe' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ routingProfileId: 'cheap', optimizerProfileId: 'optimizer-safe' })
  })

  it('strips raw token hashes from the response when the project has tokens', async () => {
    const projectWithTokens = { ...project, tokens: [{ id: 't1', name: 'Default', token: 'sha256-secret-hash', createdAt: '2024-01-01' }] }
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profiles', headers: authWith('project:write', { projects: [projectWithTokens], profiles: [userProfile] }), payload: { routing: 'u1' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.tokens).toHaveLength(1)
    expect(body.tokens[0].token).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('sha256-secret-hash')
  })

  it('blocks when the profiles module is disabled', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profiles', headers: authWith('project:write', { projects: [project], modules: [{ id: 'profiles', enabled: false }] }), payload: { routing: 'auto' } })
    await app.close()
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error).toBe('module_disabled')
  })
})
