import { describe, it, expect, vi, afterEach } from 'vitest'

// router.ts (and, through POLICY_MAP, every real policy module) reads models/usage/routers
// through these two modules — mock once, at the resolved-module level, for the whole file.
vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../budget/budget.js', () => ({
  isAllowed: vi.fn(),
  getViolatedLimits: vi.fn(),
  getLimitUsageSnapshot: vi.fn(),
}))

import { routeRequest } from './router.js'
import { readConfig } from '../config/loader.js'
import { isAllowed, getViolatedLimits } from '../budget/budget.js'
import { splitModelsIntoInstancesConnections } from '../../test-support/effective-models.js'
import type { ModelConfig, RouterConfig, RoutingPolicy, RoutingPolicyType } from '@routerly/shared'

// The 6 policies A1's scoring.ts extraction never touches — imported directly so their own
// fixtures/expectations (copied verbatim from their *.test.ts) can be re-asserted here as proof
// the extraction didn't leak into them.
import { cheapestPolicy } from './policies/cheapest.js'
import { contextPolicy } from './policies/context.js'
import { capabilityPolicy } from './policies/capability.js'
import { modelPreferencePolicy } from './policies/model-preference.js'
import { llmPolicy } from './policies/llm.js'
import { semanticIntentPolicy } from './policies/semantic-intent.js'

const mockReadConfig = vi.mocked(readConfig)
const mockIsAllowed = vi.mocked(isAllowed)
const mockGetViolatedLimits = vi.mocked(getViolatedLimits)

afterEach(() => { vi.clearAllMocks() })

function makeModel(id: string): ModelConfig {
  return {
    id, name: id, provider: 'openai', endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 1, outputPerMillion: 3 },
    contextWindow: 128_000,
  }
}

/** listEffectiveModels() reads instances+connections, not 'models' directly. */
function setupConfig(models: ModelConfig[], usage: unknown[] = []): void {
  const { instances, connections } = splitModelsIntoInstancesConnections(models)
  mockReadConfig.mockImplementation(async (key: string) => {
    if (key === 'connections') return connections as never
    if (key === 'instances') return instances as never
    if (key === 'usage') return usage as never
    return [] as never // 'routers', 'profiles', etc. — none of the 11 policies need real data for this test
  })
  mockIsAllowed.mockResolvedValue(true)
  mockGetViolatedLimits.mockResolvedValue([])
}

function makeRouter(modelIds: string[], policies: RoutingPolicy[]): RouterConfig {
  return {
    id: 'proj-regress', name: 'Regression', tokens: [], members: [],
    models: modelIds.map(id => ({ modelId: id })),
    policies,
  }
}

// request.model is the model-preference "virtual model" id — abstains (all candidates 0.5)
// instead of hard-excluding everyone whose id isn't literally 'auto', so every one of the 11
// types can run without any policy collapsing the candidate pool to zero by itself.
const request: any = { model: 'routerly/ada', messages: [{ role: 'user', content: 'Hello there' }] }

const ALL_POLICY_TYPES: RoutingPolicyType[] = [
  'health', 'rate-limit', 'fairness', 'performance', 'budget-remaining',
  'cheapest', 'context', 'capability', 'llm', 'semantic-intent', 'model-preference',
]

describe('policy regression: all 11 RoutingPolicyTypes through scoreCandidates (AC1, AC8)', () => {
  it.each(ALL_POLICY_TYPES)('resolves without throwing and returns a non-empty ranked list for "%s" alone', async (type) => {
    setupConfig([makeModel('m1'), makeModel('m2')])
    const router = makeRouter(['m1', 'm2'], [{ type, enabled: true, config: {} }])

    const result = await routeRequest(request, router)

    expect(result.models.length).toBeGreaterThan(0)
  })

  it('resolves without throwing and returns a non-empty ranked list with all 11 combined', async () => {
    setupConfig([makeModel('m1'), makeModel('m2'), makeModel('m3')])
    const policies: RoutingPolicy[] = ALL_POLICY_TYPES.map(type => ({ type, enabled: true, config: {} }))
    const router = makeRouter(['m1', 'm2', 'm3'], policies)

    const result = await routeRequest(request, router)

    expect(result.models.length).toBeGreaterThan(0)
  })

  it('resolves without throwing when only one candidate is eligible (single-candidate bypass)', async () => {
    setupConfig([makeModel('solo')])
    const policies: RoutingPolicy[] = ALL_POLICY_TYPES.map(type => ({ type, enabled: true, config: {} }))
    const router = makeRouter(['solo'], policies)

    const result = await routeRequest(request, router)

    expect(result.models.length).toBeGreaterThan(0)
  })
})

describe('the 6 policies scoring.ts never touches score exactly like their own fixtures expect', () => {
  // Each case below is copied verbatim (inputs + expectation) from that policy's own *.test.ts —
  // proof the A1 extraction imported nothing into these files and changed nothing about them.

  it('cheapestPolicy: 10x more expensive model gets ~0.1 score (cheapest.test.ts)', async () => {
    const result = await cheapestPolicy({
      request: { model: 'auto', messages: [] },
      candidates: [
        { model: { id: 'cheap', name: 'cheap', provider: 'openai', endpoint: 'https://api.openai.com/v1', cost: { inputPerMillion: 1, outputPerMillion: 1 } } },
        { model: { id: 'pricey', name: 'pricey', provider: 'openai', endpoint: 'https://api.openai.com/v1', cost: { inputPerMillion: 10, outputPerMillion: 10 } } },
      ],
    } as any)
    expect(result.routing.find(r => r.model === 'pricey')!.point).toBeCloseTo(0.1, 5)
  })

  it('contextPolicy: hard blocks model when estimatedTokens >= contextWindow (context.test.ts)', async () => {
    const msg = 'x'.repeat(4000) // ~1000 tokens == contextWindow of 1000
    const result = await contextPolicy({
      request: { model: 'auto', messages: [{ role: 'user', content: msg }] },
      candidates: [{ model: { id: 'm', name: 'm', provider: 'openai', endpoint: 'https://api.openai.com/v1', cost: { inputPerMillion: 1, outputPerMillion: 3 }, contextWindow: 1000 } }],
    } as any)
    expect(result.routing[0]!.point).toBe(0.0)
    expect(result.excludes).toContain('m')
  })

  it('capabilityPolicy: penalises models with vision === false when request contains images (capability.test.ts)', async () => {
    const result = await capabilityPolicy({
      request: { model: 'auto', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://x' } }] }] },
      candidates: [
        { model: { id: 'no-vision', name: 'no-vision', provider: 'openai', endpoint: 'https://api.openai.com/v1', cost: { inputPerMillion: 1, outputPerMillion: 3 }, capabilities: { vision: false } } },
        { model: { id: 'has-vision', name: 'has-vision', provider: 'openai', endpoint: 'https://api.openai.com/v1', cost: { inputPerMillion: 1, outputPerMillion: 3 }, capabilities: { vision: true } } },
      ],
    } as any)
    expect(result.routing.find(r => r.model === 'no-vision')!.point).toBe(0.0)
    expect(result.routing.find(r => r.model === 'has-vision')!.point).toBe(1.0)
    expect(result.excludes).toContain('no-vision')
  })

  it('modelPreferencePolicy: gives bonus to requested model, 0 to others (model-preference.test.ts)', async () => {
    const model = (id: string): ModelConfig => ({ id, name: id, provider: 'openai', endpoint: 'https://api.openai.com/v1', cost: { inputPerMillion: 1, outputPerMillion: 3 } })
    const result = await modelPreferencePolicy({
      request: { model: 'gpt-4o', messages: [] },
      candidates: [{ model: model('gpt-4o') }, { model: model('claude-3') }, { model: model('ollama') }],
    } as any)
    expect(result.routing.find(r => r.model === 'gpt-4o')!.point).toBe(1.0)
    expect(result.routing.find(r => r.model === 'claude-3')!.point).toBe(0.0)
    expect(result.routing.find(r => r.model === 'ollama')!.point).toBe(0.0)
  })

  it('llmPolicy: throws when routingModelId is not configured (llm.test.ts)', async () => {
    await expect(llmPolicy({
      request: { model: 'auto', messages: [{ role: 'user', content: 'What is 2+2?' }] },
      candidates: [],
      config: {},
      routerId: 'proj-1',
    } as any)).rejects.toThrow('routingModelId not configured')
  })

  it('semanticIntentPolicy: passes all candidates when config is missing required fields (semantic-intent.test.ts)', async () => {
    const result = await semanticIntentPolicy({
      request: { model: 'auto', messages: [{ role: 'user', content: 'hello' }] },
      candidates: [{ model: { id: 'any-model', name: 'any-model', provider: 'openai', endpoint: 'https://api.openai.com/v1', cost: { inputPerMillion: 1, outputPerMillion: 3 } } }],
      config: {},
    } as any)
    expect(result.routing).toHaveLength(1)
    expect(result.routing[0]!.point).toBe(1.0)
  })
})
