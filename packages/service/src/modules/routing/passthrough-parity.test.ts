import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../budget/budget.js', () => ({ isAllowed: vi.fn(), getViolatedLimits: vi.fn() }))
vi.mock('./policies/cheapest.js', () => ({ cheapestPolicy: vi.fn() }))

import { routeRequest } from './router.js'
import { readConfig } from '../config/loader.js'
import { isAllowed, getViolatedLimits } from '../budget/budget.js'
import { cheapestPolicy } from './policies/cheapest.js'
import { splitModelsIntoInstancesConnections } from '../../test-support/effective-models.js'
import { PASSTHROUGH_MODEL_ID, type ModelConfig, type RouterConfig } from '@routerly/shared'

const mockReadConfig = vi.mocked(readConfig)
const mockIsAllowed = vi.mocked(isAllowed)
const mockGetViolatedLimits = vi.mocked(getViolatedLimits)
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

/** Same real models, same policies — only `kind` and (for passthrough) a trailing
 * sentinel entry differ. AC8's exclusion means the sentinel never joins the
 * scoring input, so the two routers' inputs to routeRequest are identical. */
function makeRouter(kind: RouterConfig['kind'], modelIds: string[], policies: any[] = []): RouterConfig {
  const models = modelIds.map((id) => ({ modelId: id }))
  return {
    id: kind === 'passthrough' ? 'pt-router' : 'plain-router',
    name: 'Test', tokens: [], members: [],
    ...(kind ? { kind } : {}),
    models: kind === 'passthrough' ? [...models, { modelId: PASSTHROUGH_MODEL_ID }] : models,
    policies,
  }
}

const request: any = { model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }

// PR-E AC4/AC6 — a real model on a passthrough-kind router must be scored, limited
// and selected exactly like the same model behind a plain router.
describe('passthrough vs plain router parity (PR-E AC4/AC6)', () => {
  it('produces the identical selected model set for identical real models + policies', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.9 }, { model: 'm2', point: 0.3 }],
    })

    const plain = await routeRequest(request, makeRouter('router', ['m1', 'm2'], [{ type: 'cheapest', enabled: true }]))

    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.9 }, { model: 'm2', point: 0.3 }],
    })
    const passthrough = await routeRequest(request, makeRouter('passthrough', ['m1', 'm2'], [{ type: 'cheapest', enabled: true }]))

    expect(passthrough.models.map((m) => m.model)).toEqual(plain.models.map((m) => m.model))
    expect(passthrough.models.map((m) => m.model)).not.toContain(PASSTHROUGH_MODEL_ID)
  })

  it('applies the same isAllowed/budget gate: all-limited real models reject identically on both kinds', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(false)
    mockGetViolatedLimits.mockResolvedValue([])

    await expect(routeRequest(request, makeRouter('router', ['m1', 'm2']))).rejects.toThrow('all_models_limits_exceeded')
    await expect(routeRequest(request, makeRouter('passthrough', ['m1', 'm2']))).rejects.toThrow('all_models_limits_exceeded')
  })

  it('a single real model excluded by budget on a passthrough router is rejected exactly like the same model on a plain router', async () => {
    mockModels([makeModel('m1')])
    mockIsAllowed.mockResolvedValue(false)
    mockGetViolatedLimits.mockResolvedValue([])

    await expect(routeRequest(request, makeRouter('router', ['m1']))).rejects.toThrow('all_models_limits_exceeded')
    await expect(routeRequest(request, makeRouter('passthrough', ['m1']))).rejects.toThrow('all_models_limits_exceeded')
  })
})

// PR-E EC3 — two real models tied on every configured policy must break the tie the
// same way on a passthrough-kind router as on a plain router (no passthrough-specific
// tie-break rule; the sentinel is already excluded before this logic runs).
describe('tie-break parity (PR-E EC3)', () => {
  it('the same tie between two real models resolves identically on both router kinds', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    // Every policy assigns the exact same point to both candidates — a full tie.
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.5 }, { model: 'm2', point: 0.5 }],
    })
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    await routeRequest(request, makeRouter('router', ['m1', 'm2'], [{ type: 'cheapest', enabled: true }]), log)
    const plainTieCall = log.info.mock.calls.find((c) => (c[0] as any)?.tied)

    log.info.mockClear()
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.5 }, { model: 'm2', point: 0.5 }],
    })
    await routeRequest(request, makeRouter('passthrough', ['m1', 'm2'], [{ type: 'cheapest', enabled: true }]), log)
    const passthroughTieCall = log.info.mock.calls.find((c) => (c[0] as any)?.tied)

    expect(plainTieCall).toBeDefined()
    expect(passthroughTieCall).toBeDefined()
    expect((passthroughTieCall![0] as any).tied.sort()).toEqual((plainTieCall![0] as any).tied.sort())
    expect((passthroughTieCall![0] as any).tied).not.toContain(PASSTHROUGH_MODEL_ID)
  })
})
