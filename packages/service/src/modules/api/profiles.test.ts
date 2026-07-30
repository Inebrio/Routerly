import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(), writeConfig: vi.fn(), getOrCreateSecret: vi.fn() }))
vi.mock('../auth/jwt.js', () => ({
  createSessionToken: vi.fn(() => 'test-jwt'),
  verifyToken: vi.fn(),
  generateRawToken: vi.fn(() => 'raw-refresh-token-xxxx'),
}))
vi.mock('../audit/logger.js', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))
// scoreCandidates is the only runtime import profiles.ts pulls from router.js; mock it so the
// simulate profile-resolution logic (the unit under test) is exercised without the real
// budget/policy pipeline. resolveProfile/listProfiles/cloneProfile stay real (store.js/presets.js).
vi.mock('../routing/router.js', () => ({ scoreCandidates: vi.fn() }))

import { apiRoutes } from './api.js'
import { readConfig, writeConfig } from '../config/loader.js'
import { verifyToken } from '../auth/jwt.js'
import { scoreCandidates } from '../routing/router.js'
import { nextCursor } from '../routing/routingMemoryStore.js'

const mockReadConfig = vi.mocked(readConfig as (key: string) => Promise<any>)
const mockWriteConfig = vi.mocked(writeConfig as (key: string, value: any) => Promise<void>)
const mockVerifyToken = vi.mocked(verifyToken)
const mockScoreCandidates = vi.mocked(scoreCandidates)

afterEach(() => vi.clearAllMocks())

// Baseline so plugin registration never sees an un-mocked readConfig; per-test authWith replaces it.
beforeEach(() => {
  mockReadConfig.mockImplementation(async () => [])
  mockScoreCandidates.mockResolvedValue({
    scored: [{ model: 'm1', score: 0.9, cost: 1 }],
    allAbstained: false,
    successfulResults: [],
    scoringIds: new Set(['m1']),
    policyExcludes: new Set(),
    excludeReasons: new Map(),
    trace: [{ panel: 'router-request', message: 'router:intake', details: {} }],
  } as any)
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

const userProfile = { id: 'u1', version: 1, label: 'Mine', policies: [{ type: 'health', enabled: true }], selector: 'argmax', fallbackStrategy: 'next-best', builtin: false, baseId: 'balanced' }

// ─── GET /api/routing/profiles ───────────────────────────────────────────────

describe('GET /api/routing/profiles', () => {
  it('allows with profiles:read and returns built-ins + user overlays', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/routing/profiles', headers: authWith('profiles:read', { profiles: [userProfile] }) })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body)).toBe(true)
    expect(body.some((p: any) => p.id === 'balanced' && p.builtin === true)).toBe(true)
    expect(body.some((p: any) => p.id === 'u1')).toBe(true)
  })

  it('forbids without profiles:read', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/routing/profiles', headers: authWith('model:read') })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('blocks when routing-profiles module disabled', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/routing/profiles', headers: authWith('profiles:read', { modules: [{ id: 'routing-profiles', enabled: false }] }) })
    await app.close()
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error).toBe('module_disabled')
  })
})

// ─── POST /api/routing/profiles/clone ────────────────────────────────────────

describe('POST /api/routing/profiles/clone', () => {
  it('allows with profiles:manage and clones a built-in into a user overlay', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/routing/profiles/clone', headers: authWith('profiles:manage'), payload: { baseId: 'balanced', label: 'My Balanced' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.baseId).toBe('balanced')
    expect(body.builtin).toBe(false)
    expect(body.label).toBe('My Balanced')
    expect(mockWriteConfig).toHaveBeenCalledWith('profiles', expect.arrayContaining([expect.objectContaining({ label: 'My Balanced' })]))
  })

  it('forbids without profiles:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/routing/profiles/clone', headers: authWith('profiles:read'), payload: { baseId: 'balanced', label: 'X' } })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('returns 400 unknown_builtin_profile for an unknown baseId', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/routing/profiles/clone', headers: authWith('profiles:manage'), payload: { baseId: 'nope', label: 'X' } })
    await app.close()
    expect(res.statusCode).toBe(400)
    expect(String(JSON.parse(res.body).error)).toContain('unknown_builtin_profile')
  })

  it('rejects an empty label', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/routing/profiles/clone', headers: authWith('profiles:manage'), payload: { baseId: 'balanced', label: '  ' } })
    await app.close()
    expect(res.statusCode).toBe(400)
  })
})

// ─── PATCH /api/routing/profiles/:id ─────────────────────────────────────────

describe('PATCH /api/routing/profiles/:id', () => {
  it('allows with profiles:manage, applies partial update and bumps version', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: '/api/routing/profiles/u1', headers: authWith('profiles:manage', { profiles: [userProfile] }), payload: { label: 'Renamed' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.label).toBe('Renamed')
    expect(body.version).toBe(2)
  })

  it('forbids without profiles:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: '/api/routing/profiles/u1', headers: authWith('profiles:read'), payload: { label: 'X' } })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('returns 409 immutable_builtin_profile when targeting a built-in id', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: '/api/routing/profiles/balanced', headers: authWith('profiles:manage', { profiles: [] }), payload: { label: 'X' } })
    await app.close()
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('immutable_builtin_profile')
  })

  it('returns 404 for an unknown non-built-in id', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: '/api/routing/profiles/ghost', headers: authWith('profiles:manage', { profiles: [] }), payload: { label: 'X' } })
    await app.close()
    expect(res.statusCode).toBe(404)
  })

  it('rejects an all-undefined body', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PATCH', url: '/api/routing/profiles/u1', headers: authWith('profiles:manage', { profiles: [userProfile] }), payload: {} })
    await app.close()
    expect(res.statusCode).toBe(400)
  })
})

// ─── DELETE /api/routing/profiles/:id ────────────────────────────────────────

describe('DELETE /api/routing/profiles/:id', () => {
  it('allows with profiles:manage and deletes a user profile', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/routing/profiles/u1', headers: authWith('profiles:manage', { profiles: [userProfile], projects: [] }) })
    await app.close()
    expect(res.statusCode).toBe(204)
    expect(mockWriteConfig).toHaveBeenCalledWith('profiles', [])
  })

  it('forbids without profiles:manage', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/routing/profiles/u1', headers: authWith('profiles:read') })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('returns 409 immutable_builtin_profile for a built-in id', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/routing/profiles/balanced', headers: authWith('profiles:manage', { profiles: [] }) })
    await app.close()
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('immutable_builtin_profile')
  })

  it('returns 409 profile_in_use when a project references the profile', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/routing/profiles/u1', headers: authWith('profiles:manage', { profiles: [userProfile], projects: [{ id: 'p1', profileId: 'u1' }] }) })
    await app.close()
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('profile_in_use')
  })

  it('returns 404 for an unknown non-built-in id', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/routing/profiles/ghost', headers: authWith('profiles:manage', { profiles: [] }) })
    await app.close()
    expect(res.statusCode).toBe(404)
  })
})

// ─── PUT /api/projects/:id/profile ───────────────────────────────────────────

describe('PUT /api/projects/:id/profile', () => {
  const project = { id: 'p1', name: 'P1', tokens: [], members: [], models: [], policies: [] }

  it('allows with project:write and assigns a profileId', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profile', headers: authWith('project:write', { projects: [project], profiles: [userProfile] }), payload: { profileId: 'u1' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).profileId).toBe('u1')
  })

  it('clears the profileId when passed null', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profile', headers: authWith('project:write', { projects: [{ ...project, profileId: 'u1' }] }), payload: { profileId: null } })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).profileId).toBeUndefined()
  })

  it('forbids without project:write', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profile', headers: authWith('project:read'), payload: { profileId: 'u1' } })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('returns 404 for an unknown project', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/ghost/profile', headers: authWith('project:write', { projects: [project], profiles: [userProfile] }), payload: { profileId: 'u1' } })
    await app.close()
    expect(res.statusCode).toBe(404)
  })

  it('rejects an invalid body (profileId neither string nor null)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profile', headers: authWith('project:write', { projects: [project] }), payload: { profileId: 123 } })
    await app.close()
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 profile_not_found for a profileId that matches no built-in or user profile, and does not persist it', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profile', headers: authWith('project:write', { projects: [project], profiles: [userProfile] }), payload: { profileId: 'nonexistent-profile-id' } })
    await app.close()
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body).error).toBe('profile_not_found')
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('assigns a real built-in profileId', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profile', headers: authWith('project:write', { projects: [project] }), payload: { profileId: 'balanced' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).profileId).toBe('balanced')
  })

  it('strips raw token hashes from the response when the project has tokens', async () => {
    const projectWithTokens = { ...project, tokens: [{ id: 't1', name: 'Default', token: 'sha256-secret-hash', createdAt: '2024-01-01' }] }
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/api/projects/p1/profile', headers: authWith('project:write', { projects: [projectWithTokens], profiles: [userProfile] }), payload: { profileId: 'u1' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.tokens).toHaveLength(1)
    expect(body.tokens[0].token).toBeUndefined()
    expect(body.tokens[0].id).toBe('t1')
    expect(JSON.stringify(body)).not.toContain('sha256-secret-hash')
  })
})

// ─── POST /api/routing/simulate ──────────────────────────────────────────────

describe('POST /api/routing/simulate', () => {
  const project = { id: 'p1', name: 'P1', tokens: [], members: [], models: [], policies: [] }
  const request = { model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }

  it('allows with profiles:read and returns picked/ranked/trace (project default profile branch)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/routing/simulate', headers: authWith('profiles:read', { projects: [project] }), payload: { request, projectId: 'p1' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.picked).toBe('m1')
    expect(body.ranked).toEqual([{ model: 'm1', score: 0.9, cost: 1 }])
    expect(Array.isArray(body.trace)).toBe(true)
    // no profileId, no overrides -> ephemeral 'default' profile derived from project policies
    expect(mockScoreCandidates.mock.calls[0]![2]).toMatchObject({ id: 'default', selector: 'argmax' })
  })

  it('forbids without profiles:read', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/routing/simulate', headers: authWith('model:read'), payload: { request, projectId: 'p1' } })
    await app.close()
    expect(res.statusCode).toBe(403)
  })

  it('resolves an explicit built-in profileId (profileId branch)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/routing/simulate', headers: authWith('profiles:read', { projects: [project] }), payload: { request, projectId: 'p1', profileId: 'cheap' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    expect(mockScoreCandidates.mock.calls[0]![2]).toMatchObject({ id: 'cheap', selector: 'cheapest' })
  })

  it('applies inline policies/selector/fallbackStrategy overrides (ad-hoc branch)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/routing/simulate', headers: authWith('profiles:read', { projects: [project] }),
      payload: { request, projectId: 'p1', selector: 'cheapest', fallbackStrategy: 'abort', policies: [{ type: 'cheapest', enabled: true }] },
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    const profile = mockScoreCandidates.mock.calls[0]![2] as any
    expect(profile.selector).toBe('cheapest')
    expect(profile.fallbackStrategy).toBe('abort')
    expect(profile.policies).toEqual([{ type: 'cheapest', enabled: true }])
  })

  it('rejects an invalid body (missing projectId)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/routing/simulate', headers: authWith('profiles:read', { projects: [project] }), payload: { request } })
    await app.close()
    expect(res.statusCode).toBe(400)
  })

  it('blocks when routing-profiles module disabled', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/routing/simulate', headers: authWith('profiles:read', { projects: [project], modules: [{ id: 'routing-profiles', enabled: false }] }), payload: { request, projectId: 'p1' } })
    await app.close()
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).error).toBe('module_disabled')
  })

  it('returns 404 when the project is not found', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/routing/simulate', headers: authWith('profiles:read', { projects: [] }), payload: { request, projectId: 'ghost' } })
    await app.close()
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 when scoring throws (e.g. no_models_available)', async () => {
    mockScoreCandidates.mockRejectedValueOnce(new Error('no_models_available'))
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/routing/simulate', headers: authWith('profiles:read', { projects: [project] }), payload: { request, projectId: 'p1' } })
    await app.close()
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe('no_models_available')
  })

  it('returns picked=null / ranked=[] when scoring yields no candidates', async () => {
    mockScoreCandidates.mockResolvedValueOnce({
      scored: [], allAbstained: true, successfulResults: [], scoringIds: new Set(), policyExcludes: new Set(), excludeReasons: new Map(), trace: [],
    } as any)
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/routing/simulate', headers: authWith('profiles:read', { projects: [project] }), payload: { request, projectId: 'p1' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.picked).toBeNull()
    expect(body.ranked).toEqual([])
  })

  it('stringifies a non-Error scoring rejection into the 400 body', async () => {
    mockScoreCandidates.mockRejectedValueOnce('boom')
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/routing/simulate', headers: authWith('profiles:read', { projects: [project] }), payload: { request, projectId: 'p1' } })
    await app.close()
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe('boom')
  })

  it('returns the single-candidate bypass result verbatim', async () => {
    mockScoreCandidates.mockResolvedValueOnce({
      scored: [], allAbstained: false, successfulResults: [], scoringIds: new Set(), policyExcludes: new Set(), excludeReasons: new Map(),
      trace: [{ panel: 'router-response', message: 'router:result', details: {} }],
      bypass: { models: [{ model: 'only-model', weight: 1 }], trace: [{ panel: 'router-response', message: 'router:result', details: { note: 'single_candidate_bypass' } }] },
    } as any)
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/routing/simulate', headers: authWith('profiles:read', { projects: [project] }), payload: { request, projectId: 'p1' } })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.picked).toBe('only-model')
    expect(body.ranked).toEqual([{ model: 'only-model', score: 1 }])
  })

  it('reorders ranked to match the selector output order (picked is always ranked[0])', async () => {
    mockScoreCandidates.mockResolvedValueOnce({
      scored: [
        { model: 'expensive-but-high-score', score: 0.9, cost: 10 },
        { model: 'cheap-but-low-score', score: 0.2, cost: 1 },
      ],
      allAbstained: false, successfulResults: [], scoringIds: new Set(), policyExcludes: new Set(), excludeReasons: new Map(), trace: [],
    } as any)
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/api/routing/simulate', headers: authWith('profiles:read', { projects: [project] }),
      payload: { request, projectId: 'p1', selector: 'cheapest', policies: [{ type: 'cheapest', enabled: true }] },
    })
    await app.close()
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    // the cheapest selector picks the cheaper model even though it has the lower score
    expect(body.picked).toBe('cheap-but-low-score')
    expect(body.ranked[0].model).toBe(body.picked)
    expect(body.ranked.map((c: any) => c.model)).toEqual(['cheap-but-low-score', 'expensive-but-high-score'])
  })

  it('does not advance the live round-robin cursor for the project (namespaced simulate key)', async () => {
    const rrProject = { id: 'p-rr-cursor-test', name: 'RR', tokens: [], members: [], models: [], policies: [] }
    mockScoreCandidates.mockResolvedValue({
      scored: [{ model: 'm1', score: 0.9, cost: 1 }, { model: 'm2', score: 0.8, cost: 2 }],
      allAbstained: false, successfulResults: [], scoringIds: new Set(['m1', 'm2']), policyExcludes: new Set(), excludeReasons: new Map(), trace: [],
    } as any)
    const app = await buildApp()
    await app.inject({ method: 'POST', url: '/api/routing/simulate', headers: authWith('profiles:read', { projects: [rrProject] }), payload: { request, projectId: rrProject.id, selector: 'round-robin' } })
    await app.inject({ method: 'POST', url: '/api/routing/simulate', headers: authWith('profiles:read', { projects: [rrProject] }), payload: { request, projectId: rrProject.id, selector: 'round-robin' } })
    await app.close()
    // the live (unprefixed) cursor for this project must be untouched by the two simulate calls above:
    // its very first real call still starts at cursor 0.
    expect(nextCursor(rrProject.id, 2)).toBe(0)
  })
})
