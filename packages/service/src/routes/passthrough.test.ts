import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { ProjectConfig, ModelConfig } from '@routerly/shared'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../plugins/auth.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../plugins/auth.js')>()
  return {
    ...original,
    resolveProjectByToken: vi.fn(),
  }
})

import { readConfig } from '../config/loader.js'
import { resolveProjectByToken } from '../plugins/auth.js'
import {
  pickUpstreamModel,
  buildUpstreamUrl,
  buildUpstreamHeaders,
  passthroughHandler,
} from './passthrough.js'

const mockReadConfig = vi.mocked(readConfig)
const mockResolveToken = vi.mocked(resolveProjectByToken)

afterEach(() => vi.clearAllMocks())

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const openaiModel: ModelConfig = {
  id: 'openai/gpt-4o',
  name: 'GPT-4o',
  provider: 'openai',
  endpoint: 'https://api.openai.com/v1',
  apiKey: 'sk-openai',
  cost: { inputPerMillion: 5, outputPerMillion: 15 },
}

const anthropicModel: ModelConfig = {
  id: 'anthropic/claude-3-5-sonnet',
  name: 'Claude 3.5 Sonnet',
  provider: 'anthropic',
  endpoint: 'https://api.anthropic.com',
  apiKey: 'sk-ant',
  cost: { inputPerMillion: 3, outputPerMillion: 15 },
}

const testProject: ProjectConfig = {
  id: 'proj-1',
  name: 'Test',
  tokens: [{ id: 't1', token: 'valid-token', tokenSnippet: 'valid-tok', createdAt: '2024-01-01' }],
  members: [],
  models: [{ modelId: 'openai/gpt-4o' }],
}

// ─── pickUpstreamModel ────────────────────────────────────────────────────────

describe('pickUpstreamModel', () => {
  const allModels = [openaiModel, anthropicModel]

  it('returns first model when body has no model field', () => {
    const result = pickUpstreamModel(testProject, allModels, null)
    expect(result?.id).toBe('openai/gpt-4o')
  })

  it('matches body.model by exact id', () => {
    const project: ProjectConfig = {
      ...testProject,
      models: [{ modelId: 'openai/gpt-4o' }, { modelId: 'anthropic/claude-3-5-sonnet' }],
    }
    const result = pickUpstreamModel(project, allModels, { model: 'anthropic/claude-3-5-sonnet' })
    expect(result?.id).toBe('anthropic/claude-3-5-sonnet')
  })

  it('matches body.model by id suffix after /', () => {
    const result = pickUpstreamModel(testProject, allModels, { model: 'gpt-4o' })
    expect(result?.id).toBe('openai/gpt-4o')
  })

  it('matches body.model by upstreamModelId', () => {
    const modelWithUpstream: ModelConfig = {
      ...openaiModel,
      upstreamModelId: 'gpt-4o-mini',
    }
    const result = pickUpstreamModel(
      testProject,
      [modelWithUpstream, anthropicModel],
      { model: 'gpt-4o-mini' },
    )
    expect(result?.upstreamModelId).toBe('gpt-4o-mini')
  })

  it('falls back to first model when body.model is not found', () => {
    const result = pickUpstreamModel(testProject, allModels, { model: 'unknown-model' })
    expect(result?.id).toBe('openai/gpt-4o')
  })

  it('returns null when project has no resolvable models', () => {
    const result = pickUpstreamModel(
      { ...testProject, models: [{ modelId: 'nonexistent' }] },
      allModels,
      null,
    )
    expect(result).toBeNull()
  })

  it('returns null when project.models is empty', () => {
    const result = pickUpstreamModel({ ...testProject, models: [] }, allModels, null)
    expect(result).toBeNull()
  })

  it('ignores Buffer body (no model field)', () => {
    const result = pickUpstreamModel(testProject, allModels, Buffer.from('raw bytes'))
    expect(result?.id).toBe('openai/gpt-4o')
  })
})

// ─── buildUpstreamUrl ─────────────────────────────────────────────────────────

describe('buildUpstreamUrl', () => {
  it('builds URL from OpenAI v1 endpoint + path', () => {
    expect(buildUpstreamUrl(openaiModel, '/v1/embeddings'))
      .toBe('https://api.openai.com/v1/embeddings')
  })

  it('builds URL from Anthropic endpoint (no path suffix)', () => {
    expect(buildUpstreamUrl(anthropicModel, '/v1/messages'))
      .toBe('https://api.anthropic.com/v1/messages')
  })

  it('preserves query string', () => {
    expect(buildUpstreamUrl(openaiModel, '/v1/models?limit=10'))
      .toBe('https://api.openai.com/v1/models?limit=10')
  })

  it('strips path from endpoint and uses only origin', () => {
    const modelWithPath: ModelConfig = { ...openaiModel, endpoint: 'https://api.openai.com/v1' }
    expect(buildUpstreamUrl(modelWithPath, '/v1/audio/transcriptions'))
      .toBe('https://api.openai.com/v1/audio/transcriptions')
  })
})

// ─── buildUpstreamHeaders ─────────────────────────────────────────────────────

describe('buildUpstreamHeaders', () => {
  it('injects Authorization: Bearer for OpenAI provider', () => {
    const headers = buildUpstreamHeaders(openaiModel, {
      'content-type': 'application/json',
      'authorization': 'Bearer sk-incoming',
    })
    expect(headers['authorization']).toBe('Bearer sk-openai')
    expect(headers['content-type']).toBe('application/json')
  })

  it('injects x-api-key for Anthropic provider', () => {
    const headers = buildUpstreamHeaders(anthropicModel, {
      'content-type': 'application/json',
      'x-api-key': 'old-key',
    })
    expect(headers['x-api-key']).toBe('sk-ant')
    expect(headers['authorization']).toBeUndefined()
  })

  it('preserves anthropic-version header', () => {
    const headers = buildUpstreamHeaders(anthropicModel, {
      'anthropic-version': '2023-06-01',
    })
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['x-api-key']).toBe('sk-ant')
  })

  it('drops host, content-length, connection', () => {
    const headers = buildUpstreamHeaders(openaiModel, {
      'host': 'localhost:3000',
      'content-length': '42',
      'connection': 'keep-alive',
      'content-type': 'application/json',
    })
    expect(headers['host']).toBeUndefined()
    expect(headers['content-length']).toBeUndefined()
    expect(headers['connection']).toBeUndefined()
    expect(headers['content-type']).toBe('application/json')
  })

  it('joins array header values with ", "', () => {
    const headers = buildUpstreamHeaders(openaiModel, {
      'accept': ['application/json', 'text/plain'],
    })
    expect(headers['accept']).toBe('application/json, text/plain')
  })

  it('handles missing apiKey by injecting empty Bearer', () => {
    const modelNoKey: ModelConfig = { ...openaiModel, apiKey: undefined }
    const headers = buildUpstreamHeaders(modelNoKey, {})
    expect(headers['authorization']).toBe('Bearer ')
  })

  it('injects x-api-key for anthropic-web provider', () => {
    const model: ModelConfig = { ...anthropicModel, provider: 'anthropic-web' }
    const headers = buildUpstreamHeaders(model, {})
    expect(headers['x-api-key']).toBe('sk-ant')
    expect(headers['authorization']).toBeUndefined()
  })
})

// ─── passthroughHandler (integration via Fastify inject) ──────────────────────

async function buildApp(project?: ProjectConfig | null) {
  const app = Fastify({ logger: false })
  app.decorateRequest('project', null as any)
  app.decorateRequest('token', null as any)
  if (project !== undefined) {
    app.addHook('preHandler', async (req: any) => {
      req.project = project
    })
  }
  app.setNotFoundHandler(passthroughHandler)
  await app.ready()
  return app
}

describe('passthroughHandler', () => {
  it('proxies unhandled /v1/embeddings to upstream and returns response', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ object: 'list', data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', mockFetch)

    mockReadConfig.mockResolvedValue([openaiModel])
    const app = await buildApp(testProject)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'gpt-4o', input: 'hello' }),
    })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(200)
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://api.openai.com/v1/embeddings')
    expect(init.headers['authorization']).toBe('Bearer sk-openai')
  })

  it('returns 404 for /api/* without calling fetch', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const app = await buildApp(testProject)
    const res = await app.inject({ method: 'GET', url: '/api/unknown' })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(404)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 404 for /health without calling fetch', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const app = await buildApp(testProject)
    const res = await app.inject({ method: 'GET', url: '/health' })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(404)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 404 for /dashboard/* without calling fetch', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const app = await buildApp(testProject)
    const res = await app.inject({ method: 'GET', url: '/dashboard/settings' })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(404)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 401 when no Authorization header and no project on request', async () => {
    const app = await buildApp(null)
    const res = await app.inject({ method: 'POST', url: '/v1/embeddings' })
    await app.close()

    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('unauthorized')
  })

  it('returns 401 when token is invalid', async () => {
    mockResolveToken.mockResolvedValue(null)
    const app = await buildApp(null)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: { authorization: 'Bearer bad-token' },
    })
    await app.close()

    expect(res.statusCode).toBe(401)
  })

  it('resolves project from token when request.project is null', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', mockFetch)

    mockResolveToken.mockResolvedValue({ project: testProject, token: testProject.tokens[0]! })
    mockReadConfig.mockResolvedValue([openaiModel])

    const app = await buildApp(null)
    const res = await app.inject({
      method: 'GET',
      url: '/v1/audio/speech',
      headers: { authorization: 'Bearer valid-token' },
    })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(200)
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('returns 502 no_upstream when project has no resolvable models', async () => {
    const emptyProject: ProjectConfig = { ...testProject, models: [] }
    mockReadConfig.mockResolvedValue([openaiModel])
    const app = await buildApp(emptyProject)
    const res = await app.inject({ method: 'GET', url: '/v1/files' })
    await app.close()

    expect(res.statusCode).toBe(502)
    expect(res.json().error).toBe('no_upstream')
  })

  it('returns 502 upstream_error when fetch throws', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', mockFetch)

    mockReadConfig.mockResolvedValue([openaiModel])
    const app = await buildApp(testProject)
    const res = await app.inject({ method: 'GET', url: '/v1/files' })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(502)
    expect(res.json().error).toBe('upstream_error')
    expect(res.json().message).toContain('ECONNREFUSED')
  })

  it('forwards upstream non-200 status transparently', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', mockFetch)

    mockReadConfig.mockResolvedValue([openaiModel])
    const app = await buildApp(testProject)
    const res = await app.inject({ method: 'POST', url: '/v1/embeddings' })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(429)
  })
})
