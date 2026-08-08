import { describe, it, expect, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { RouterConfig } from '@routerly/shared'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }))

import { openaiRoutes } from './openai.js'
import { readConfig } from '../config/loader.js'
import { splitModelsIntoInstancesConnections } from '../../test-support/effective-models.js'

const mockReadConfig = vi.mocked(readConfig)

afterEach(() => vi.clearAllMocks())

function mockModels(models: any[]) {
  const { instances, connections } = splitModelsIntoInstancesConnections(models)
  mockReadConfig.mockImplementation(async (key: string) => {
    if (key === 'connections') return connections as any
    if (key === 'instances') return instances as any
    return [] as any
  })
}

const testModel: any = {
  id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai',
  endpoint: 'https://api.openai.com/v1', apiKey: 'sk-test',
  cost: { inputPerMillion: 5, outputPerMillion: 15 },
}

const testRouter: RouterConfig = {
  id: 'proj-1', name: 'Test', tokens: [], members: [],
  models: [{ modelId: 'openai/gpt-4o' }],
}

async function buildApp(router = testRouter) {
  const app = Fastify({ logger: false })
  app.decorateRequest('router', null as any)
  app.decorateRequest('token', null as any)
  app.addHook('preHandler', async (req: any) => {
    req.router = router
    req.token = undefined
  })
  await app.register(openaiRoutes)
  await app.ready()
  return app
}

// POST /v1/chat/completions and POST /v1/responses are now pipeline-dispatch
// one-liners (buildOpenAIContext + runProxy); their behavior is covered by
// reverse-proxy/lanes/openai.test.ts (wire format) and the Plan 5 module tests
// (guardrails/pii/budget/routing). GET /v1/models* are untouched by the flip and
// keep their route-level tests here.
describe('GET /v1/models', () => {
  it('returns router model list with ada placeholder', async () => {
    mockModels([testModel])

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/v1/models' })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.object).toBe('list')
    expect(body.data.some((m: any) => m.id === 'routerly/ada')).toBe(true)
    expect(body.data.some((m: any) => m.id === 'openai/gpt-4o')).toBe(true)
  })
})

describe('GET /v1/models/:model', () => {
  it('returns a specific model', async () => {
    mockModels([testModel])

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/v1/models/openai%2Fgpt-4o' })
    await app.close()

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.id).toBe('openai/gpt-4o')
    expect(body.object).toBe('model')
  })

  it('returns 404 for model not in router', async () => {
    mockModels([testModel])

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/v1/models/not-in-router' })
    await app.close()

    expect(res.statusCode).toBe(404)
  })

  it('returns 404 when model is in router but not in allModels', async () => {
    const routerWithMissing: RouterConfig = { ...testRouter, models: [{ modelId: 'missing-model' }] }
    mockModels([]) // no models in allModels

    const app = await buildApp(routerWithMissing)
    const res = await app.inject({ method: 'GET', url: '/v1/models/missing-model' })
    await app.close()

    expect(res.statusCode).toBe(404)
  })
})
