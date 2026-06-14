import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { ProjectConfig, ModelConfig } from '@routerly/shared'
import { buildOAuthForwardHeaders, forwardAnthropicOAuth } from './oauthForward.js'

vi.mock('../cost/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }))
import { trackUsage } from '../cost/tracker.js'
const mockTrackUsage = vi.mocked(trackUsage)

afterEach(() => vi.clearAllMocks())

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const oauthModel: ModelConfig = {
  id: 'claude-max',
  name: 'Claude Max (subscription)',
  provider: 'anthropic-oauth',
  endpoint: 'https://api.anthropic.com',
  apiKey: 'sk-ant-oat-stored-token',
  cost: { inputPerMillion: 0, outputPerMillion: 0 },
}

const testProject: ProjectConfig = {
  id: 'proj-1',
  name: 'Test',
  tokens: [{ id: 't1', token: 'valid-token', createdAt: '2024-01-01' }],
  members: [],
  models: [{ modelId: 'claude-max' }],
}

// ─── buildOAuthForwardHeaders ─────────────────────────────────────────────────

describe('buildOAuthForwardHeaders', () => {
  it('injects the stored OAuth token as Authorization and never sets x-api-key', () => {
    const h = buildOAuthForwardHeaders(oauthModel, {
      authorization: 'Bearer rly-tenant-token',
      'x-api-key': 'leftover',
      'content-type': 'application/json',
    })
    expect(h['authorization']).toBe('Bearer sk-ant-oat-stored-token')
    expect(h['x-api-key']).toBeUndefined()
    expect(h['content-type']).toBe('application/json')
  })

  it('adds the dangerous-direct-browser-access header', () => {
    const h = buildOAuthForwardHeaders(oauthModel, {})
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true')
  })

  it('adds the oauth beta when the client sent none', () => {
    const h = buildOAuthForwardHeaders(oauthModel, {})
    expect(h['anthropic-beta']).toBe('oauth-2025-04-20')
  })

  it("merges the oauth beta with the client's betas without clobbering", () => {
    const h = buildOAuthForwardHeaders(oauthModel, {
      'anthropic-beta': 'fine-grained-tool-streaming-2025-05-14',
    })
    expect(h['anthropic-beta']).toBe(
      'fine-grained-tool-streaming-2025-05-14,oauth-2025-04-20',
    )
  })

  it('does not duplicate the oauth beta when already present', () => {
    const h = buildOAuthForwardHeaders(oauthModel, { 'anthropic-beta': 'oauth-2025-04-20' })
    expect(h['anthropic-beta']).toBe('oauth-2025-04-20')
  })

  it('ignores empty segments in the client betas', () => {
    const h = buildOAuthForwardHeaders(oauthModel, { 'anthropic-beta': 'a,,b' })
    expect(h['anthropic-beta']).toBe('a,b,oauth-2025-04-20')
  })

  it('defaults anthropic-version when absent', () => {
    const h = buildOAuthForwardHeaders(oauthModel, {})
    expect(h['anthropic-version']).toBe('2023-06-01')
  })

  it("preserves the client's anthropic-version when present", () => {
    const h = buildOAuthForwardHeaders(oauthModel, { 'anthropic-version': '2099-01-01' })
    expect(h['anthropic-version']).toBe('2099-01-01')
  })

  it('drops hop-by-hop and inbound auth headers', () => {
    const h = buildOAuthForwardHeaders(oauthModel, {
      host: 'localhost:3000',
      'content-length': '42',
      connection: 'keep-alive',
      'transfer-encoding': 'chunked',
      'content-type': 'application/json',
    })
    expect(h['host']).toBeUndefined()
    expect(h['content-length']).toBeUndefined()
    expect(h['connection']).toBeUndefined()
    expect(h['transfer-encoding']).toBeUndefined()
    expect(h['content-type']).toBe('application/json')
  })

  it('joins array-valued headers with ", "', () => {
    const h = buildOAuthForwardHeaders(oauthModel, { 'x-multi': ['a', 'b'] })
    expect(h['x-multi']).toBe('a, b')
  })

  it('skips headers with an undefined value', () => {
    const h = buildOAuthForwardHeaders(oauthModel, { 'x-skip': undefined })
    expect(h['x-skip']).toBeUndefined()
  })

  it('injects an empty Bearer when the model has no apiKey', () => {
    const h = buildOAuthForwardHeaders({ ...oauthModel, apiKey: undefined }, {})
    expect(h['authorization']).toBe('Bearer ')
  })
})

// ─── forwardAnthropicOAuth (integration via Fastify inject) ───────────────────

async function buildApp(model: ModelConfig, setProject = true) {
  const app = Fastify({ logger: false })
  app.decorateRequest('project', null as any)
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) =>
    done(null, body as string),
  )
  app.addHook('preHandler', async (req: any) => {
    if (setProject) req.project = testProject
  })
  app.route({
    method: ['GET', 'POST'],
    url: '/v1/messages',
    handler: (req, reply) => forwardAnthropicOAuth(req, reply, model),
  })
  await app.ready()
  return app
}

describe('forwardAnthropicOAuth', () => {
  it('forwards verbatim to the upstream with the OAuth credential', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: 'message', id: 'msg_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const payload = {
      model: 'claude-sonnet-4-5',
      max_tokens: 100,
      system: 'You are Claude Code, built by Anthropic.',
      messages: [{ role: 'user', content: 'hi' }],
    }
    const app = await buildApp(oauthModel)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer rly-tenant-token',
        'anthropic-version': '2023-06-01',
      },
      payload: JSON.stringify(payload),
    })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(200)
    expect(res.json().type).toBe('message')
    expect(mockFetch).toHaveBeenCalledOnce()

    const [url, init] = mockFetch.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['authorization']).toBe('Bearer sk-ant-oat-stored-token')
    expect(init.headers['x-api-key']).toBeUndefined()
    expect(init.headers['anthropic-beta']).toContain('oauth-2025-04-20')
    // Faithful body: the Claude Code system block is preserved byte-equivalently.
    expect(init.body).toBe(JSON.stringify(payload))
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-1', outcome: 'success' }))
  })

  it('pipes a streamed SSE response back and preserves content-type', async () => {
    const sse = new ReadableStream({
      start(c) {
        c.enqueue(
          new TextEncoder().encode('event: message_start\ndata: {"type":"message_start"}\n\n'),
        )
        c.close()
      },
    })
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const app = await buildApp(oauthModel)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [], max_tokens: 1 }),
    })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.body).toContain('message_start')
  })

  it('forwards upstream non-2xx status transparently', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const app = await buildApp(oauthModel)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [], max_tokens: 1 }),
    })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(401)
    expect(res.json().error.type).toBe('authentication_error')
  })

  it('returns 502 with an Anthropic-shaped error when fetch throws', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', mockFetch)

    const app = await buildApp(oauthModel)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [], max_tokens: 1 }),
    })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(502)
    const body = res.json()
    expect(body.type).toBe('error')
    expect(body.error.message).toContain('ECONNREFUSED')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-1', outcome: 'error' }))
  })

  it('falls back to a generic message when fetch rejects with a non-Error', async () => {
    const mockFetch = vi.fn().mockRejectedValue('socket hang up')
    vi.stubGlobal('fetch', mockFetch)

    const app = await buildApp(oauthModel)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [], max_tokens: 1 }),
    })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(502)
    expect(res.json().error.message).toBe('upstream request failed')
  })

  it('logs without a projectId when request.project is absent', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const app = await buildApp(oauthModel, false)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [], max_tokens: 1 }),
    })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(200)
  })

  it('handles an empty (204) upstream response body', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', mockFetch)

    const app = await buildApp(oauthModel)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [], max_tokens: 1 }),
    })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(204)
  })

  it('forwards normal headers but strips hop-by-hop response headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-anthropic-foo': 'bar',
          'content-encoding': 'identity',
        },
      }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const app = await buildApp(oauthModel)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [], max_tokens: 1 }),
    })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.headers['x-anthropic-foo']).toBe('bar')
    expect(res.headers['content-encoding']).toBeUndefined()
  })

  it('forwards a GET request without a body', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const app = await buildApp(oauthModel)
    const res = await app.inject({
      method: 'GET',
      url: '/v1/messages',
      headers: { authorization: 'Bearer rly-tenant-token' },
    })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(200)
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.body).toBeUndefined()
  })

  it('forwards a string body verbatim', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const app = await buildApp(oauthModel)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'text/plain' },
      payload: 'raw-passthrough-string',
    })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(200)
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.body).toBe('raw-passthrough-string')
  })
})
