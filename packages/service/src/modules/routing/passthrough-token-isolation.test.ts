import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import { PASSTHROUGH_MODEL_ID } from '@routerly/shared'
import type { RouterConfig, ModelConfig } from '@routerly/shared'

vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../budget/budget.js', () => ({
  isAllowed: vi.fn().mockResolvedValue(true),
  getViolatedLimits: vi.fn().mockResolvedValue([]),
}))

const forwardPassthroughRawMock = vi.fn()
vi.mock('../api-reverse-proxy/router-passthrough.js', () => ({
  forwardPassthroughRaw: (...args: unknown[]) => forwardPassthroughRawMock(...args),
}))

import authPlugin from '../auth/auth.js'
import { readConfig } from '../config/loader.js'
import { routingModule } from './index.js'
import { buildOpenAIContext } from '../reverse-proxy/lanes/openai.js'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import { splitModelsIntoInstancesConnections } from '../../test-support/effective-models.js'
import type { ProxyContext } from '../reverse-proxy/context.js'

const mockReadConfig = vi.mocked(readConfig)

afterEach(() => { vi.clearAllMocks() })

function makeModel(id: string): ModelConfig {
  return { id, name: id, provider: 'openai', endpoint: 'https://api.openai.com/v1', cost: { inputPerMillion: 1, outputPerMillion: 3 } }
}

// Router A: passthrough kind, two real models plus the sentinel positioned LAST
// (never index 0) — real models score/route normally, the sentinel is reachable
// only as the last-resort fallback (AC9), never by a client naming it as `model`.
const routerA: RouterConfig = {
  id: 'rA', name: 'Router A', kind: 'passthrough', slug: 'router-a', members: [],
  models: [{ modelId: 'ma1' }, { modelId: 'ma2' }, { modelId: PASSTHROUGH_MODEL_ID }],
  tokens: [{ id: 'ta', token: 'tok-a', tokenSnippet: 'tok-a'.slice(0, 10), createdAt: new Date().toISOString() }],
}
// Router B: a different passthrough-kind router with its own real model.
const routerB: RouterConfig = {
  id: 'rB', name: 'Router B', kind: 'passthrough', slug: 'router-b', members: [],
  models: [{ modelId: PASSTHROUGH_MODEL_ID }, { modelId: 'mb1' }],
  tokens: [{ id: 'tb', token: 'tok-b', tokenSnippet: 'tok-b'.slice(0, 10), createdAt: new Date().toISOString() }],
}
// Router C: a plain (non-passthrough) router with its own real model.
const routerC: RouterConfig = {
  id: 'rC', name: 'Router C', members: [],
  models: [{ modelId: 'mc1' }],
  tokens: [{ id: 'tc', token: 'tok-c', tokenSnippet: 'tok-c'.slice(0, 10), createdAt: new Date().toISOString() }],
}

async function buildApp() {
  const container = new ServiceContainer()
  const events = new EventBus()
  const pipeline = new ProcessorRegistry<ProxyContext>()
  container.register(PROXY_PIPELINE, pipeline)
  await routingModule.register({ container, events })
  const prepareProc = pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.prepare')!

  const { instances, connections } = splitModelsIntoInstancesConnections([
    makeModel('ma1'), makeModel('ma2'), makeModel('mb1'), makeModel('mc1'),
  ])
  mockReadConfig.mockImplementation(async (key: string) => {
    if (key === 'routers') return [routerA, routerB, routerC] as never
    if (key === 'connections') return connections as never
    if (key === 'instances') return instances as never
    return [] as never
  })

  const app = Fastify({ logger: false })
  await app.register(authPlugin)
  app.post('/v1/chat/completions', async (req: any, reply) => {
    const ctx = buildOpenAIContext(req, reply as never)
    await prepareProc.run(ctx)
    return {
      routerId: ctx.router.id,
      candidates: (ctx.candidates ?? []).map((c) => c.model),
      resultKind: ctx.result?.kind ?? null,
    }
  })
  await app.ready()
  return app
}

// PR-E AC3/EC5 — mandatory security-review checklist item 1: a token issued for
// router A must never resolve/reach another router's models, another passthrough
// router's models, or its own pass-through entry treated as a model. Verified by
// actually attempting each of these three requests through the real Fastify auth
// preHandler + the real (unmocked) routing.prepare processor, not just by asserting
// on resolveRouterByToken in isolation.
describe('cross-router token isolation (PR-E AC3/EC5)', () => {
  it('router A\'s token cannot reach router C (a plain router)\'s model, even when it is named in the body', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: 'Bearer tok-a', 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'mc1', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.routerId).toBe('rA')
    expect(body.candidates.length).toBeGreaterThan(0)
    for (const m of body.candidates) expect(['ma1', 'ma2']).toContain(m)
    expect(body.candidates).not.toContain('mc1')
  })

  it('router A\'s token cannot reach router B (another passthrough router)\'s model, even when it is named in the body', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: 'Bearer tok-a', 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'mb1', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.routerId).toBe('rA')
    for (const m of body.candidates) expect(['ma1', 'ma2']).toContain(m)
    expect(body.candidates).not.toContain('mb1')
  })

  it('router A\'s token cannot reach its own pass-through entry by naming it as the model — never triggers raw-forward', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: 'Bearer tok-a', 'content-type': 'application/json' },
      payload: JSON.stringify({ model: PASSTHROUGH_MODEL_ID, messages: [{ role: 'user', content: 'hi' }] }),
    })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.routerId).toBe('rA')
    expect(body.resultKind).toBeNull() // never raw-forwarded (no ctx.result set)
    expect(forwardPassthroughRawMock).not.toHaveBeenCalled()
    for (const m of body.candidates) expect(['ma1', 'ma2']).toContain(m)
  })

  it('an unknown/foreign token is rejected outright, never matched to any router', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: 'Bearer tok-does-not-exist', 'content-type': 'application/json' },
      payload: JSON.stringify({ model: 'ma1', messages: [] }),
    })
    await app.close()

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized', message: 'Invalid router token.' })
  })
})
