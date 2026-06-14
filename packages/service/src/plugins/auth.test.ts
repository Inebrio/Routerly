import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
}))

import authPlugin from './auth.js'
import { readConfig } from '../config/loader.js'
import type { ProjectConfig } from '@routerly/shared'

const mockReadConfig = vi.mocked(readConfig)

afterEach(() => { vi.clearAllMocks() })

const testProject: ProjectConfig = {
  id: 'proj-1',
  name: 'Test Project',
  tokens: [
    { token: 'valid-token-123', name: 'Main', permissions: ['completion'] } as any,
    { token: 'another-token', name: 'Alt', permissions: ['completion'] } as any,
  ],
  members: [],
  models: [],
}

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(authPlugin)
  app.get('/v1/chat/completions', async (req, _reply) => {
    return { project: req.project.id, token: req.token.token }
  })
  await app.ready()
  return app
}

describe('authPlugin', () => {
  it('allows requests to /health without auth', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/health' })
    // Route not registered but no 401 — auth didn't block it
    expect(res.statusCode).not.toBe(401)
    await app.close()
  })

  it('allows requests to / without auth', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).not.toBe(401)
    await app.close()
  })

  it('allows requests to /dashboard/* without auth', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/dashboard/something' })
    expect(res.statusCode).not.toBe(401)
    await app.close()
  })

  it('allows requests to /api/* without auth', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/models' })
    expect(res.statusCode).not.toBe(401)
    await app.close()
  })

  it('returns 401 when Authorization header is missing', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/v1/chat/completions' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('unauthorized')
    await app.close()
  })

  it('returns 401 when Authorization header does not start with Bearer', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/chat/completions',
      headers: { authorization: 'Basic abc123' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns 401 when token is invalid', async () => {
    mockReadConfig.mockResolvedValue([testProject])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer invalid-token' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().message).toContain('Invalid project token')
    await app.close()
  })

  it('allows request with valid token and decorates request with project and token', async () => {
    mockReadConfig.mockResolvedValue([testProject])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer valid-token-123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().project).toBe('proj-1')
    expect(res.json().token).toBe('valid-token-123')
    await app.close()
  })

  it('matches token from second project in list', async () => {
    const project2: ProjectConfig = {
      id: 'proj-2', name: 'P2',
      tokens: [{ token: 'p2-token', name: 'T', permissions: [] } as any],
      members: [], models: [],
    }
    mockReadConfig.mockResolvedValue([testProject, project2])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer p2-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().project).toBe('proj-2')
    await app.close()
  })

  it('handles project with no tokens array', async () => {
    const projectNoTokens: ProjectConfig = {
      id: 'proj-empty', name: 'Empty',
      tokens: [],
      members: [], models: [],
    }
    mockReadConfig.mockResolvedValue([projectNoTokens])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer anything' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('handles project with undefined tokens (line 35 || [] branch)', async () => {
    const projectUndefinedTokens: any = {
      id: 'proj-undef', name: 'Undef',
      tokens: undefined,
      members: [], models: [],
    }
    mockReadConfig.mockResolvedValue([projectUndefinedTokens])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer anything' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
