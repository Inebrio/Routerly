import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { RouterConfig, ModelConfig, AppliedCallConfig } from '@routerly/shared'
import { buildOAuthForwardHeaders, forwardAnthropicOAuth, forwardAnthropicApiKey, upstreamModelName } from './oauthForward.js'

vi.mock('../../usage/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }))
import { trackUsage } from '../../usage/tracker.js'
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

const testRouter: RouterConfig = {
  id: 'proj-1',
  name: 'Test',
  tokens: [{ id: 't1', token: 'valid-token', createdAt: '2024-01-01' }],
  members: [],
  models: [{ modelId: 'claude-max' }],
}

// ─── subscription-unsupported betas ───────────────────────────────────────────

describe('buildOAuthForwardHeaders / betas', () => {
  it('drops the 1M-context beta a subscription credential cannot use, keeping the rest', () => {
    const h = buildOAuthForwardHeaders(oauthModel, {
      'anthropic-beta': 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14',
    })
    const betas = h['anthropic-beta']!.split(',')
    expect(betas).toContain('claude-code-20250219')
    expect(betas).toContain('interleaved-thinking-2025-05-14')
    expect(betas).toContain('oauth-2025-04-20')
    expect(betas.some((b) => b.startsWith('context-1m-'))).toBe(false)
  })
})

// ─── upstreamModelName ────────────────────────────────────────────────────────

describe('upstreamModelName', () => {
  const m = (id: string, upstreamModelId?: string): ModelConfig =>
    ({ ...oauthModel, id, ...(upstreamModelId ? { upstreamModelId } : {}) })

  it('strips the provider namespace from a namespaced upstreamModelId', () => {
    expect(upstreamModelName(m('anthropic/claude-haiku-4-5', 'anthropic/claude-haiku-4-5'))).toBe('claude-haiku-4-5')
  })

  it('keeps an upstreamModelId that is already bare', () => {
    expect(upstreamModelName(m('anthropic/claude-haiku-4-5', 'claude-haiku-4-5-20251001'))).toBe('claude-haiku-4-5-20251001')
  })

  it('keeps a slash that belongs to the model name itself', () => {
    expect(upstreamModelName(m('ollama/fauxpaslife/arch-router:1.5b', 'ollama/fauxpaslife/arch-router:1.5b')))
      .toBe('fauxpaslife/arch-router:1.5b')
  })

  it('falls back to the id when upstreamModelId is absent', () => {
    expect(upstreamModelName(m('anthropic/claude-haiku-4-5'))).toBe('claude-haiku-4-5')
  })

  it('never returns an empty name', () => {
    expect(upstreamModelName(m('anthropic/', 'anthropic/'))).toBe('anthropic/')
  })
})

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

async function buildApp(model: ModelConfig, setRouter = true) {
  const app = Fastify({ logger: false })
  app.decorateRequest('router', null as any)
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) =>
    done(null, body as string),
  )
  app.addHook('preHandler', async (req: any) => {
    if (setRouter) req.router = testRouter
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
    // Body forwarded verbatim except the `model` field, which is rewritten to
    // the upstream model id (commit a076266) — system block etc. preserved.
    expect(init.body).toBe(JSON.stringify({ ...payload, model: 'claude-max' }))
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ routerId: 'proj-1', outcome: 'success' }))
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
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ routerId: 'proj-1', outcome: 'error' }))
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

  it('logs without a routerId when request.router is absent', async () => {
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

  it('line 108: .catch(() => {}) swallows trackUsage rejection on fetch-throws path', async () => {
    mockTrackUsage.mockRejectedValueOnce(new Error('tracker down'))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED catch-swallow')))

    const app = await buildApp(oauthModel) // setRouter = true so routerId is present
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [], max_tokens: 1 }),
    })
    await app.close()
    vi.unstubAllGlobals()

    // The .catch() swallows the rejection; the outer 502 is still returned
    expect(res.statusCode).toBe(502)
    expect(mockTrackUsage).toHaveBeenCalledOnce()
  })

  it('line 137: .catch(() => {}) swallows trackUsage rejection on success path', async () => {
    mockTrackUsage.mockRejectedValueOnce(new Error('tracker down'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    ))

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
    expect(mockTrackUsage).toHaveBeenCalledOnce()
  })

  it('returns 502 and skips trackUsage when fetch throws and router is absent (line 107 false branch)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED no-router')))

    const app = await buildApp(oauthModel, false) // setRouter = false → routerId is absent
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [], max_tokens: 1 }),
    })
    await app.close()
    vi.unstubAllGlobals()

    expect(res.statusCode).toBe(502)
    expect(res.json().error.message).toContain('ECONNREFUSED no-router')
    expect(mockTrackUsage).not.toHaveBeenCalled()
  })
})

// ─── usage capture on the verbatim forward (ROUT-199) ─────────────────────────

describe('forwardAnthropicOAuth usage capture', () => {
  const post = async (upstreamBody: string, contentType: string) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(upstreamBody, { status: 200, headers: { 'content-type': contentType } }),
    ))
    const app = await buildApp(oauthModel)
    const res = await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'x', max_tokens: 1, messages: [] }),
    })
    await app.close()
    vi.unstubAllGlobals()
    return res
  }

  it('records usage of a non-stream response and returns the body byte-identical', async () => {
    const raw = JSON.stringify({ type: 'message', usage: { input_tokens: 9, output_tokens: 16 } })
    const res = await post(raw, 'application/json')
    expect(res.body).toBe(raw)
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 9, outputTokens: 16, outcome: 'success' }))
  })

  it('records usage of an SSE stream (message_start + message_delta, cache folded into input) byte-identical', async () => {
    const raw =
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5,"cache_read_input_tokens":3,"cache_creation_input_tokens":1,"output_tokens":1}}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":16}}\n\n'
    const res = await post(raw, 'text/event-stream')
    expect(res.body).toBe(raw)
    expect(mockTrackUsage).toHaveBeenCalledOnce()
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({
      inputTokens: 9, outputTokens: 16, cachedInputTokens: 3, cacheCreationInputTokens: 1,
    }))
  })

  it('does not fail the request on a non-JSON body', async () => {
    const res = await post('not json', 'application/json')
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('not json')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 0, outputTokens: 0 }))
  })
})

describe('forwardAnthropicApiKey anthropic-web', () => {
  const webModel: ModelConfig = {
    id: 'anthropic-web/claude-sonnet-4-5',
    name: 'web',
    provider: 'anthropic-web',
    endpoint: 'https://claude.ai',
    apiKey: 'sk-ant-sid-bad',
    cost: { inputPerMillion: 0, outputPerMillion: 0 },
  }

  async function call(upstream: Response) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream))
    const app = Fastify({ logger: false })
    app.route({ method: 'POST', url: '/v1/messages', handler: (req, reply) => forwardAnthropicApiKey(req, reply, webModel) })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, payload: '{"model":"x","messages":[]}' })
    await app.close()
    vi.unstubAllGlobals()
    return res
  }

  it('turns an empty upstream 404 into an Anthropic error and drops claude.ai headers/cookies', async () => {
    const res = await call(new Response(null, {
      status: 404,
      headers: { 'set-cookie': '__cf_bm=x; Domain=claude.ai', server: 'cloudflare', 'cf-ray': 'abc' },
    }))
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ type: 'error', error: { type: 'not_found_error' } })
    expect(res.headers['set-cookie']).toBeUndefined()
    expect(res.headers['cf-ray']).toBeUndefined()
    expect(res.headers['server']).toBeUndefined()
  })

  it('keeps a JSON upstream body and drops set-cookie on success', async () => {
    const res = await call(new Response('{"type":"message"}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': 'a=b' },
    }))
    expect(res.json().type).toBe('message')
    expect(res.headers['set-cookie']).toBeUndefined()
  })
})

// ─── non-2xx: recorded with a reason, deferred when another candidate remains ──

describe('forwardAnthropicApiKey upstream failure', () => {
  const keyModel: ModelConfig = { ...oauthModel, id: 'anthropic/claude-haiku-4-5', provider: 'anthropic' }
  const upstream400 = () => new Response(
    JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: 128000 > 64000' } }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  )

  async function run(deferFailure: boolean) {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => upstream400()))
    const app = Fastify({ logger: false })
    app.decorateRequest('router', null as any)
    app.addHook('preHandler', async (req: any) => { req.router = testRouter })
    let returned: unknown
    app.post('/v1/messages', async (req, reply) => {
      returned = await forwardAnthropicApiKey(req, reply, keyModel, undefined, deferFailure)
      return deferFailure ? reply.code(299).send('deferred') : returned
    })
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, payload: '{"model":"x","max_tokens":128000}' })
    await app.close()
    vi.unstubAllGlobals()
    return { res, returned }
  }

  it('sends the upstream error verbatim and records its message when it is the last candidate', async () => {
    const { res } = await run(false)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe('max_tokens: 128000 > 64000')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'error', errorMessage: 'Upstream returned 400: max_tokens: 128000 > 64000',
    }))
  })

  it('returns the failure without answering the client when another candidate remains', async () => {
    const { res, returned } = await run(true)
    expect(res.statusCode).toBe(299)
    expect(returned).toMatchObject({ status: 400, message: 'Upstream returned 400: max_tokens: 128000 > 64000' })
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: expect.stringContaining('128000') }))
  })
})

describe('forwardAnthropicOAuth call settings (ROUT-306)', () => {
  const payload = { model: 'claude-sonnet-4-5', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }

  const send = async (body: unknown, callSettings?: AppliedCallConfig) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"type":"message"}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = Fastify({ logger: false })
    app.decorateRequest('router', null as any)
    app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_r, b, done) => done(null, b as string))
    app.addHook('preHandler', async (req: any) => { req.router = testRouter })
    app.route({
      method: 'POST', url: '/v1/messages',
      handler: (req, reply) => forwardAnthropicOAuth(req, reply, oauthModel, undefined, false, callSettings),
    })
    await app.ready()
    await app.inject({
      method: 'POST', url: '/v1/messages',
      headers: { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' },
      payload: typeof body === 'string' ? body : JSON.stringify(body),
    })
    await app.close()
    vi.unstubAllGlobals()
    return (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
  }

  it('without settings the body is exactly today\'s (model rewrite only)', async () => {
    expect(await send(payload)).toBe(JSON.stringify({ ...payload, model: 'claude-max' }))
  })

  it('empty applied settings leave the body byte-identical', async () => {
    expect(await send(payload, { tier: 'low', source: 'router', applied: {} })).toBe(JSON.stringify({ ...payload, model: 'claude-max' }))
  })

  it('applied effort and max tokens are written in the documented fields, nothing else changes', async () => {
    const out = JSON.parse(await send(payload, { tier: 'high', source: 'router', applied: { effort: 'high', maxOutputTokens: 4000 } }))
    expect(out).toEqual({ ...payload, model: 'claude-max', max_tokens: 4000, output_config: { effort: 'high' } })
  })

  it('effort merges into an existing output_config instead of replacing it', async () => {
    const withCfg = { ...payload, output_config: { format: { type: 'json_schema' } } }
    const out = JSON.parse(await send(withCfg, { tier: 'high', source: 'router', applied: { effort: 'low' } }))
    expect(out.output_config).toEqual({ format: { type: 'json_schema' }, effort: 'low' })
  })

  it('a non-JSON body is forwarded verbatim even with settings', async () => {
    expect(await send('not json', { tier: 'high', source: 'router', applied: { effort: 'high' } })).toBe('not json')
  })

  it('usage record carries callConfig', async () => {
    const cc: AppliedCallConfig = { tier: 'low', source: 'profile', applied: { maxOutputTokens: 50 } }
    await send(payload, cc)
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ callConfig: cc }))
  })
})

describe('network failure with later candidates (deferFailure)', () => {
  const cases: Array<[string, typeof forwardAnthropicOAuth, ModelConfig]> = [
    ['forwardAnthropicOAuth', forwardAnthropicOAuth, oauthModel],
    ['forwardAnthropicApiKey', forwardAnthropicApiKey, { ...oauthModel, provider: 'anthropic' }],
  ]
  for (const [name, fn, model] of cases) {
    for (const defer of [true, false]) {
      it(`${name}: fetch rejection ${defer ? 'returns UpstreamFailure without replying' : 'answers 502 on the last candidate'}`, async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')))
        const app = Fastify({ logger: false })
        app.decorateRequest('router', null as any)
        app.addHook('preHandler', async (req: any) => { req.router = testRouter })
        let returned: unknown
        app.post('/v1/messages', async (req, reply) => {
          returned = await fn(req, reply, model, undefined, defer)
          return defer ? reply.code(299).send('deferred') : returned
        })
        await app.ready()
        const res = await app.inject({ method: 'POST', url: '/v1/messages', headers: { 'content-type': 'application/json' }, payload: '{"model":"x","max_tokens":1}' })
        await app.close()
        vi.unstubAllGlobals()
        if (defer) {
          expect(res.statusCode).toBe(299)
          expect(returned).toMatchObject({ status: 502, message: 'getaddrinfo ENOTFOUND' })
        } else {
          expect(res.statusCode).toBe(502)
          expect(res.json().error.type).toBe('api_error')
        }
      })
    }
  }
})
