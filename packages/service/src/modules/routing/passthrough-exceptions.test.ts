import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { createServer, type Server, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PASSTHROUGH_MODEL_ID, type ModelConfig, type RouterConfig } from '@routerly/shared'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { globMatch, matchException } from './passthrough-exceptions.js'

const trackUsageMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../usage/tracker.js', () => ({ trackUsage: (...args: unknown[]) => trackUsageMock(...args) }))
vi.mock('../notifications/emitter.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))

const forwardPassthroughRawMock = vi.fn()
vi.mock('../api-reverse-proxy/router-passthrough.js', () => ({
  forwardPassthroughRaw: (...args: unknown[]) => forwardPassthroughRawMock(...args),
}))

const { routingModule } = await import('./index.js')
const { openaiTransportProcessors } = await import('../reverse-proxy/lanes/openai.js')
const { anthropicTransportProcessors } = await import('../reverse-proxy/lanes/anthropic.js')
const { openaiRoutes } = await import('../api-reverse-proxy/openai.js')
const { anthropicRoutes } = await import('../api-reverse-proxy/anthropic.js')
const { setProxyPipeline } = await import('../reverse-proxy/run.js')
const { writeConfig } = await import('../config/loader.js')
const { splitModelsIntoInstancesConnections } = await import('../../test-support/effective-models.js')

describe('globMatch', () => {
  it.each([
    ['gpt-4o', 'gpt-4o', true],
    ['gpt-4o', 'gpt-4o-mini', false],
    ['gpt-4o', 'GPT-4O', false],
    ['gpt-*', 'gpt-4o', true],
    ['gpt-*', 'gpt-', true],
    ['gpt-*', 'gp', false],
    ['*', '', true],
    ['*-canary', 'claude-x-canary', true],
    ['*-canary', 'claude-x-canary2', false],
    ['claude-*-canary', 'claude-opus-4-canary', true],
    ['a*b*c', 'axxbxxc', true],
    ['a*b*c', 'axxbxx', false],
    ['**', 'anything', true],
    ['a.c', 'abc', false],
    ['a+', 'aa', false],
    ['(x)', '(x)', true],
  ])('%j vs %j -> %s', (pattern, text, expected) => {
    expect(globMatch(pattern, text)).toBe(expected)
  })

  it('does not blow up on a pathological pattern', () => {
    const started = Date.now()
    expect(globMatch('*a*a*a*a*a*a*a*a*a*b', 'a'.repeat(5000))).toBe(false)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

describe('matchException', () => {
  const router = {
    id: 'pt', kind: 'passthrough',
    models: [{ modelId: PASSTHROUGH_MODEL_ID }, { modelId: 'm1' }, { modelId: 'm2' }],
    exceptions: [
      { match: 'gpt-*', targetModelId: 'm1' },
      { match: 'gpt-4o', targetModelId: 'm2' },
      { match: 'stale', targetModelId: 'foreign' },
      { match: 'sentinel', targetModelId: PASSTHROUGH_MODEL_ID },
    ],
  } as unknown as RouterConfig

  it('first match wins, with its index', () => {
    expect(matchException(router, 'gpt-4o')).toEqual({ rule: router.exceptions![0], index: 0 })
  })

  it('returns undefined when nothing matches or the model is not a string', () => {
    expect(matchException(router, 'claude')).toBeUndefined()
    expect(matchException(router, undefined)).toBeUndefined()
    expect(matchException({ ...router, exceptions: undefined } as unknown as RouterConfig, 'gpt-4o')).toBeUndefined()
  })

  it('skips a rule whose target is foreign or the sentinel, and reports it', () => {
    const stale = vi.fn()
    expect(matchException(router, 'stale', stale)).toBeUndefined()
    expect(matchException(router, 'sentinel', stale)).toBeUndefined()
    expect(stale).toHaveBeenCalledTimes(2)
  })
})

// ── Lane-level proof: real routing.prepare + real lanes + a real local upstream ──

const CLIENT_CANARY = 'sk-client-canary-rout237'
const ROUTER_TOKEN = 'sk-rt-tok-a'
const OPENAI_KEY = 'sk-target-openai'
const ANTHROPIC_KEY = 'sk-target-anthropic'

interface Seen { url: string; headers: IncomingHttpHeaders; body: string }
let upstream: Server
let base: string
let seen: Seen[] = []

const openaiJson = JSON.stringify({
  id: 'chatcmpl-1', object: 'chat.completion', created: 1, model: 'x',
  choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
})
const openaiSse = [
  { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'x', choices: [{ index: 0, delta: { role: 'assistant', content: 'hello' }, finish_reason: null }] },
  { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'x', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
].map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
const anthropicJson = JSON.stringify({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'y', content: [{ type: 'text', text: 'hello' }],
  stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 3, output_tokens: 2 },
})
const anthropicSse = [
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'y', content: [], usage: { input_tokens: 3, output_tokens: 0 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }],
  ['message_stop', { type: 'message_stop' }],
].map(([ev, data]) => `event: ${ev as string}\ndata: ${JSON.stringify(data)}\n\n`).join('')

beforeAll(async () => {
  upstream = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      seen.push({ url: req.url ?? '', headers: req.headers, body: raw })
      const wantsStream = (JSON.parse(raw || '{}') as { stream?: boolean }).stream === true
      const isAnthropic = (req.url ?? '').includes('/messages')
      if (wantsStream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(isAnthropic ? anthropicSse : openaiSse)
      } else {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(isAnthropic ? anthropicJson : openaiJson)
      }
    })
  })
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
})
afterAll(() => upstream.close())

const zeroCost = { inputPerMillion: 0, outputPerMillion: 0 }
let router: RouterConfig
let app: ReturnType<typeof Fastify>

beforeEach(async () => {
  seen = []
  const models: ModelConfig[] = [
    { id: 'openai/x', name: 'x', provider: 'openai', endpoint: `${base}/v1`, apiKey: OPENAI_KEY, cost: zeroCost } as ModelConfig,
    { id: 'anthropic/y', name: 'y', provider: 'anthropic', endpoint: base, apiKey: ANTHROPIC_KEY, cost: zeroCost } as ModelConfig,
  ]
  const { instances, connections } = splitModelsIntoInstancesConnections(models)
  await writeConfig('connections', connections)
  await writeConfig('instances', instances)

  router = {
    id: 'pt-1', name: 'pt', kind: 'passthrough', slug: 'pt', tokens: [], members: [], policies: [],
    models: [{ modelId: PASSTHROUGH_MODEL_ID }, { modelId: 'openai/x' }, { modelId: 'anthropic/y' }],
    exceptions: [
      { match: 'gpt-4o', targetModelId: 'openai/x' },
      { match: 'claude-*-canary', targetModelId: 'anthropic/y' },
      { match: 'claude-via-openai', targetModelId: 'openai/x' },
    ],
  } as RouterConfig
  const token = { id: 'tok-a', token: ROUTER_TOKEN, tokenSnippet: 'sk-rt-tok-', createdAt: new Date().toISOString() }

  const container = new ServiceContainer()
  const pipeline = new ProcessorRegistry<ProxyContext>()
  container.register(PROXY_PIPELINE, pipeline)
  await routingModule.register({ container, events: new EventBus() })
  for (const p of [...openaiTransportProcessors, ...anthropicTransportProcessors]) pipeline.contribute(p)
  setProxyPipeline(pipeline)

  app = Fastify({ logger: false })
  app.decorateRequest('router', null as never)
  app.decorateRequest('token', null as never)
  app.addHook('preHandler', async (req: unknown) => {
    ;(req as unknown as { router: RouterConfig }).router = router
    ;(req as unknown as { token: unknown }).token = token
  })
  await app.register(openaiRoutes)
  await app.register(anthropicRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
  vi.clearAllMocks()
})

const clientHeaders = {
  'content-type': 'application/json',
  authorization: `Bearer ${CLIENT_CANARY}`,
  'x-api-key': CLIENT_CANARY,
}

/** The client credential must be nowhere in what left Routerly. */
function expectNoClientCredential(): void {
  expect(seen.length).toBeGreaterThan(0)
  for (const s of seen) {
    const wire = JSON.stringify({ headers: s.headers, body: s.body, url: s.url })
    expect(wire).not.toContain(CLIENT_CANARY)
    expect(wire).not.toContain(ROUTER_TOKEN)
  }
}

async function expectRoutedBy(modelId: string): Promise<void> {
  await vi.waitFor(() => {
    const call = trackUsageMock.mock.calls.map((c) => c[0] as { model: { id: string }; routedBy?: string; outcome: string })
      .find((p) => p.outcome === 'success')
    expect(call).toBeDefined()
    expect(call!.model.id).toBe(modelId)
    expect(call!.routedBy).toBe('exception')
  })
}

describe('passthrough exceptions on the token-authenticated lanes', () => {
  it.each([[false], [true]])('OpenAI lane -> OpenAI target (stream=%s): target key only, routedBy recorded', async (stream) => {
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions', headers: clientHeaders,
      payload: { model: 'gpt-4o', stream, messages: [{ role: 'user', content: `hi ${CLIENT_CANARY.length}` }] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('hello')
    expect(forwardPassthroughRawMock).not.toHaveBeenCalled()
    expect(seen).toHaveLength(1)
    expect(seen[0]!.url).toBe('/v1/chat/completions')
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`)
    expect(seen[0]!.headers['x-api-key']).toBeUndefined()
    expect(JSON.parse(seen[0]!.body).model).toBe('x')
    expectNoClientCredential()
    await expectRoutedBy('openai/x')
  })

  it.each([[false], [true]])('Anthropic lane -> Anthropic target, verbatim (stream=%s): target key only, routedBy recorded', async (stream) => {
    const res = await app.inject({
      method: 'POST', url: '/v1/messages', headers: { ...clientHeaders, 'anthropic-version': '2023-06-01' },
      payload: { model: 'claude-opus-canary', max_tokens: 16, stream, messages: [{ role: 'user', content: 'hi' }] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('hello')
    expect(forwardPassthroughRawMock).not.toHaveBeenCalled()
    expect(seen).toHaveLength(1)
    expect(seen[0]!.url).toBe('/v1/messages')
    expect(seen[0]!.headers['x-api-key']).toBe(ANTHROPIC_KEY)
    expect(seen[0]!.headers.authorization).toBeUndefined()
    expectNoClientCredential()
    await expectRoutedBy('anthropic/y')
  })

  it.each([[false], [true]])('Anthropic lane -> OpenAI target (stream=%s): translated, target key only, routedBy recorded', async (stream) => {
    const res = await app.inject({
      method: 'POST', url: '/v1/messages', headers: clientHeaders,
      payload: { model: 'claude-via-openai', max_tokens: 16, stream, messages: [{ role: 'user', content: 'hi' }] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('hello')
    expect(seen).toHaveLength(1)
    expect(seen[0]!.url).toBe('/v1/chat/completions')
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`)
    expectNoClientCredential()
    await expectRoutedBy('openai/x')
  })

  it('no match: the request is raw-forwarded exactly as before, nothing reaches a target', async () => {
    forwardPassthroughRawMock.mockImplementation(async (_r, _p, _m, _h, _b, reply: { code: (n: number) => { send: (b: string) => void } }) => {
      reply.code(200).send('raw')
    })
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions', headers: clientHeaders,
      payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    })
    expect(res.statusCode).toBe(200)
    expect(forwardPassthroughRawMock).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(0)
    expect(trackUsageMock.mock.calls.some((c) => (c[0] as { routedBy?: string }).routedBy)).toBe(false)
  })

  it('a router without exceptions is unchanged even for a model another router would divert', async () => {
    delete router.exceptions
    forwardPassthroughRawMock.mockImplementation(async (_r, _p, _m, _h, _b, reply: { code: (n: number) => { send: (b: string) => void } }) => {
      reply.code(200).send('raw')
    })
    await app.inject({
      method: 'POST', url: '/v1/chat/completions', headers: clientHeaders,
      payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    })
    expect(forwardPassthroughRawMock).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(0)
  })

  it('a matched request whose target fails answers with the target error, never raw-forwards', async () => {
    router.exceptions = [{ match: 'gpt-4o', targetModelId: 'openai/x' }]
    const models: ModelConfig[] = [
      { id: 'openai/x', name: 'x', provider: 'openai', endpoint: 'http://127.0.0.1:1/v1', apiKey: OPENAI_KEY, cost: zeroCost } as ModelConfig,
    ]
    const { instances, connections } = splitModelsIntoInstancesConnections(models)
    await writeConfig('connections', connections)
    await writeConfig('instances', instances)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions', headers: clientHeaders,
      payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(500)
    expect(forwardPassthroughRawMock).not.toHaveBeenCalled()
  })
})

describe('routing.prepare trace', () => {
  it('emits router:exception with the rule that matched', async () => {
    const container = new ServiceContainer()
    const pipeline = new ProcessorRegistry<ProxyContext>()
    container.register(PROXY_PIPELINE, pipeline)
    await routingModule.register({ container, events: new EventBus() })
    const prepare = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.prepare')!
    const emit = vi.fn()
    const ctx = {
      protocol: 'openai', router, routerId: router.id, traceId: 't', emit,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      original: { model: 'claude-x-canary' }, request: { model: 'claude-x-canary', messages: [] },
    } as unknown as ProxyContext
    await prepare.run(ctx)
    expect(ctx.candidates).toEqual([{ model: 'anthropic/y', weight: 1 }])
    expect(ctx.routedBy).toBe('exception')
    expect(emit).toHaveBeenCalledWith({
      panel: 'router-response', message: 'router:exception',
      details: { rule: 1, match: 'claude-*-canary', requestedModel: 'claude-x-canary', targetModelId: 'anthropic/y' },
    })
  })
})
