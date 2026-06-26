import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import Fastify from 'fastify'

vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn().mockResolvedValue(undefined),
}))

import authPlugin, { extractProjectToken } from './auth.js'
import { readConfig, writeConfig } from '../config/loader.js'
import type { ProjectConfig } from '@routerly/shared'

const mockReadConfig = vi.mocked(readConfig)
const mockWriteConfig = vi.mocked(writeConfig)

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

describe('extractProjectToken', () => {
  it('reads Bearer token', () => {
    expect(extractProjectToken({ authorization: 'Bearer abc' })).toBe('abc')
  })
  it('reads x-api-key', () => {
    expect(extractProjectToken({ 'x-api-key': 'key123' })).toBe('key123')
  })
  it('Bearer precedence over x-api-key', () => {
    expect(extractProjectToken({ authorization: 'Bearer a', 'x-api-key': 'b' })).toBe('a')
  })
  it('handles array-valued x-api-key', () => {
    expect(extractProjectToken({ 'x-api-key': ['k1', 'k2'] })).toBe('k1')
  })
  it('empty Bearer falls through to x-api-key', () => {
    expect(extractProjectToken({ authorization: 'Bearer    ', 'x-api-key': 'k' })).toBe('k')
  })
  it('returns null when neither present', () => {
    expect(extractProjectToken({})).toBeNull()
    expect(extractProjectToken({ authorization: 'Basic x' })).toBeNull()
    expect(extractProjectToken({ 'x-api-key': '   ' })).toBeNull()
  })
})

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

  it('authenticates via x-api-key header (Anthropic SDK style)', async () => {
    mockReadConfig.mockResolvedValue([testProject])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/chat/completions',
      headers: { 'x-api-key': 'valid-token-123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().project).toBe('proj-1')
    expect(res.json().token).toBe('valid-token-123')
    await app.close()
  })

  it('returns 401 for invalid x-api-key', async () => {
    mockReadConfig.mockResolvedValue([testProject])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/chat/completions',
      headers: { 'x-api-key': 'nope' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().message).toContain('Invalid project token')
    await app.close()
  })

  it('Bearer takes precedence over x-api-key when both present', async () => {
    mockReadConfig.mockResolvedValue([testProject])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer valid-token-123', 'x-api-key': 'another-token' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().token).toBe('valid-token-123')
    await app.close()
  })

  it('falls back to x-api-key when Authorization is not Bearer', async () => {
    mockReadConfig.mockResolvedValue([testProject])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/chat/completions',
      headers: { authorization: 'Basic abc', 'x-api-key': 'valid-token-123' },
    })
    expect(res.statusCode).toBe(200)
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

  it('returns 401 when token is expired', async () => {
    const expired = new Date(Date.now() - 1000).toISOString()
    const projectWithExpired: ProjectConfig = {
      id: 'proj-exp', name: 'Exp',
      tokens: [{ token: 'expired-token', name: 'T', permissions: ['completion'], expiresAt: expired } as any],
      members: [], models: [],
    }
    mockReadConfig.mockResolvedValue([projectWithExpired])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer expired-token' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Token expired')
    await app.close()
  })

  it('allows valid token with future expiresAt', async () => {
    const future = new Date(Date.now() + 86400000).toISOString()
    const projectWithFuture: ProjectConfig = {
      id: 'proj-fut', name: 'Fut',
      tokens: [{ token: 'future-token', name: 'T', permissions: ['completion'], expiresAt: future } as any],
      members: [], models: [],
    }
    mockReadConfig.mockResolvedValue([projectWithFuture])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer future-token' },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('updates lastUsedAt and calls writeConfig on valid auth', async () => {
    const projects = [testProject]
    // readConfig called twice: once in resolveProjectByToken, once in preHandler for lastUsedAt update
    mockReadConfig.mockResolvedValue(JSON.parse(JSON.stringify(projects)))
    const app = await buildApp()
    await app.inject({
      method: 'GET',
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer valid-token-123' },
    })
    // writeConfig should have been called to persist lastUsedAt
    expect(mockWriteConfig).toHaveBeenCalledWith('projects', expect.any(Array))
    await app.close()
  })
})
