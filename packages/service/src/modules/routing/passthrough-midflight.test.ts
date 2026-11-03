import { describe, it, expect, vi, afterEach } from 'vitest'
import { PASSTHROUGH_MODEL_ID } from '@routerly/shared'
import type { ModelConfig, RouterConfig } from '@routerly/shared'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../budget/budget.js', () => ({ isAllowed: vi.fn(), getViolatedLimits: vi.fn() }))
vi.mock('./policies/cheapest.js', () => ({ cheapestPolicy: vi.fn() }))
vi.mock('../notifications/emitter.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))

import { readConfig } from '../config/loader.js'
import { isAllowed } from '../budget/budget.js'
import { cheapestPolicy } from './policies/cheapest.js'
import { routingModule } from './index.js'
import { openaiAttempt } from '../reverse-proxy/lanes/openai.js'
import { setProxyPipeline } from '../reverse-proxy/run.js'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import { splitModelsIntoInstancesConnections } from '../../test-support/effective-models.js'
import type { ProxyContext } from '../reverse-proxy/context.js'

const mockReadConfig = vi.mocked(readConfig)
const mockIsAllowed = vi.mocked(isAllowed)
const mockCheapestPolicy = vi.mocked(cheapestPolicy)

function mockModels(models: ModelConfig[]): void {
  const { instances, connections } = splitModelsIntoInstancesConnections(models)
  mockReadConfig.mockImplementation(async (key: string) => {
    if (key === 'connections') return connections as never
    if (key === 'instances') return instances as never
    return [] as never
  })
}

afterEach(() => { vi.clearAllMocks() })

function makeModel(id: string): ModelConfig {
  return { id, name: id, provider: 'openai', endpoint: 'https://api.openai.com/v1', cost: { inputPerMillion: 1, outputPerMillion: 3 } }
}

async function getPrepareProcessor() {
  const container = new ServiceContainer()
  const events = new EventBus()
  const pipeline = new ProcessorRegistry<ProxyContext>()
  container.register(PROXY_PIPELINE, pipeline)
  await routingModule.register({ container, events })
  return pipeline.orderedFor('routing.prepare').find((p) => p.id === 'routing.prepare')!
}

// PR-E EC2 — a real target model is removed from `router.models` while a request to it
// is in flight. The routing decision (ctx.candidates) is a value snapshot taken once at
// `routing.prepare`; later phases (`routing.execute`) read only `ctx.candidates` and the
// provider registry (`listEffectiveModels()`), never `ctx.router.models` again. This is
// already true for a plain router — no passthrough-specific mid-flight handling exists,
// and none is added here; this test only pins the existing guarantee down for a
// passthrough-kind router too.
describe('mid-flight router.models mutation does not corrupt an in-flight request (PR-E EC2)', () => {
  it('a request already routed to a model keeps working, and usage attributes to that same model, after the model is removed from router.models', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.9 }, { model: 'm2', point: 0.1 }],
    })

    const router: RouterConfig = {
      id: 'pt1', name: 'PT', kind: 'passthrough', tokens: [], members: [],
      models: [{ modelId: 'm1' }, { modelId: 'm2' }, { modelId: PASSTHROUGH_MODEL_ID }],
      policies: [{ type: 'cheapest', enabled: true }] as never,
    }

    const prepareProc = await getPrepareProcessor()
    const ctx = {
      protocol: 'openai', router, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      request: { model: 'auto', messages: [{ role: 'user', content: 'hi' }] },
      traceId: 't1', emit: vi.fn(),
    } as unknown as ProxyContext

    await prepareProc.run(ctx)
    expect(ctx.candidates?.map((c) => c.model)).toEqual(['m1', 'm2'])

    // Mid-flight: the operator removes the winning model (m1) from the router's config —
    // the same object `ctx.router` already carries into this in-flight request.
    router.models = router.models.filter((m) => m.modelId !== 'm1')
    expect(router.models.map((m) => m.modelId)).not.toContain('m1')

    // routing.execute must still complete on the already-decided candidate: it never
    // re-reads router.models, only ctx.candidates + the provider registry.
    const attemptPipeline = new ProcessorRegistry<ProxyContext>()
    attemptPipeline.contribute({
      id: 'fake:upstream', phase: 'upstream.execute',
      run(c: ProxyContext) { c.result = { kind: 'json', body: { model: c.attempt!.model.id } } },
    })
    setProxyPipeline(attemptPipeline)

    await openaiAttempt.run(ctx)

    expect(ctx.result).toEqual({ kind: 'json', body: { model: 'm1' } })
    expect(ctx.attempt?.model.id).toBe('m1') // usage attribution (ctx.attempt.model) is intact, not corrupted by the removal
  })
})
