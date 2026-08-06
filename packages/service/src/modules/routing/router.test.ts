import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../budget/budget.js', () => ({ isAllowed: vi.fn(), getViolatedLimits: vi.fn() }))
vi.mock('./policies/cheapest.js', () => ({ cheapestPolicy: vi.fn() }))
vi.mock('./policies/context.js', () => ({ contextPolicy: vi.fn() }))
vi.mock('./policies/health.js', () => ({ healthPolicy: vi.fn() }))
vi.mock('./policies/performance.js', () => ({ performancePolicy: vi.fn() }))
vi.mock('./policies/llm.js', () => ({ llmPolicy: vi.fn() }))
vi.mock('./policies/capability.js', () => ({ capabilityPolicy: vi.fn() }))
vi.mock('./policies/rate-limit.js', () => ({ rateLimitPolicy: vi.fn() }))
vi.mock('./policies/fairness.js', () => ({ fairnessPolicy: vi.fn() }))
vi.mock('./policies/budget-remaining.js', () => ({ budgetRemainingPolicy: vi.fn() }))
vi.mock('./policies/semantic-intent.js', () => ({ semanticIntentPolicy: vi.fn() }))

import { routeRequest } from './router.js'
import { readConfig } from '../config/loader.js'
import { isAllowed, getViolatedLimits } from '../budget/budget.js'
import { cheapestPolicy } from './policies/cheapest.js'
import { capabilityPolicy } from './policies/capability.js'
import { llmPolicy } from './policies/llm.js'
import { fairnessPolicy } from './policies/fairness.js'
import { InMemoryResilienceStore } from '../resilience/store.js'
import { splitModelsIntoInstancesConnections } from '../../test-support/effective-models.js'
import type { ModelConfig, RouterConfig } from '@routerly/shared'

const mockReadConfig = vi.mocked(readConfig)

/** listEffectiveModels() reads instances+connections, not 'models' directly (task A3). */
function mockModels(models: ModelConfig[]): void {
  const { instances, connections } = splitModelsIntoInstancesConnections(models)
  mockReadConfig.mockImplementation(async (key: string) => {
    if (key === 'connections') return connections as never
    if (key === 'instances') return instances as never
    return [] as never
  })
}
const mockIsAllowed = vi.mocked(isAllowed)
const mockGetViolatedLimits = vi.mocked(getViolatedLimits)
const mockCheapestPolicy = vi.mocked(cheapestPolicy)
const mockCapabilityPolicy = vi.mocked(capabilityPolicy)
const mockLlmPolicy = vi.mocked(llmPolicy)
const mockFairnessPolicy = vi.mocked(fairnessPolicy)

afterEach(() => { vi.clearAllMocks() })

function makeModel(id: string, provider: ModelConfig['provider'] = 'openai'): ModelConfig {
  return {
    id, name: id, provider, endpoint: `https://api.${provider}.com/v1`,
    cost: { inputPerMillion: 1, outputPerMillion: 3 },
  }
}

function makeRouter(modelIds: string[], policies: any[] = []): RouterConfig {
  return {
    id: 'proj-1', name: 'Test', tokens: [], members: [],
    models: modelIds.map(id => ({ modelId: id })),
    policies,
  }
}

const request: any = { model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }

describe('routeRequest', () => {
  it('throws when router has no models', async () => {
    mockModels([makeModel('gpt-4')])
    await expect(routeRequest(request, makeRouter([]))).rejects.toThrow('no_models_available')
  })

  it('throws when referenced models not found in registry', async () => {
    mockModels([]) // no models in registry
    await expect(routeRequest(request, makeRouter(['nonexistent']))).rejects.toThrow('no_models_available')
  })

  it('throws when all models exceed budget limits', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(false)
    mockGetViolatedLimits.mockResolvedValue([])
    await expect(routeRequest(request, makeRouter(['m1', 'm2']))).rejects.toThrow('all_models_limits_exceeded')
  })

  it('bypasses policies when only one valid model exists', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed
      .mockResolvedValueOnce(false) // m1 excluded by limits
      .mockResolvedValueOnce(true)  // m2 valid
    mockGetViolatedLimits.mockResolvedValue([])

    const result = await routeRequest(request, makeRouter(['m1', 'm2']))
    expect(result.models).toHaveLength(1)
    expect(result.models[0]!.model).toBe('m2')
    expect(result.models[0]!.weight).toBe(1)
  })

  it('runs cheapest policy and returns scored candidates', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [
        { model: 'm1', point: 0.9 },
        { model: 'm2', point: 0.3 },
      ],
    })

    const router = makeRouter(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    const result = await routeRequest(request, router)
    expect(result.models).toHaveLength(2)
    expect(result.models[0]!.model).toBe('m1')
    expect(result.models[0]!.weight).toBeGreaterThan(result.models[1]!.weight)
  })

  it('excludes models hard-blocked by capability policy', async () => {
    mockModels([makeModel('no-vision'), makeModel('has-vision')])
    mockIsAllowed.mockResolvedValue(true)
    mockCapabilityPolicy.mockResolvedValue({
      routing: [{ model: 'has-vision', point: 1.0 }],
      excludes: ['no-vision'],
    })

    const router = makeRouter(['no-vision', 'has-vision'], [
      { type: 'capability', enabled: true },
    ])
    const result = await routeRequest(request, router)
    expect(result.models.map(m => m.model)).not.toContain('no-vision')
    expect(result.models.map(m => m.model)).toContain('has-vision')
  })

  it('throws when all candidates are excluded by policies', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCapabilityPolicy.mockResolvedValue({
      routing: [],
      excludes: ['m1', 'm2'],
    })

    const router = makeRouter(['m1', 'm2'], [{ type: 'capability', enabled: true }])
    await expect(routeRequest(request, router)).rejects.toThrow('all_models_excluded_by_policies')
  })

  it('skips disabled policies', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)

    const router = makeRouter(['m1', 'm2'], [
      { type: 'cheapest', enabled: false },
    ])
    const result = await routeRequest(request, router)
    // No active policy → random selection among both models
    expect(result.models).toHaveLength(2)
  })

  it('skips unknown policy types gracefully', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)

    const router = makeRouter(['m1', 'm2'], [
      { type: 'unknown-policy-xyz', enabled: true },
    ])
    const result = await routeRequest(request, router)
    expect(result.models).toHaveLength(2)
  })

  it('calls emit with trace entries when provided', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.8 }, { model: 'm2', point: 0.4 }],
    })

    const emit = vi.fn()
    const router = makeRouter(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    await routeRequest(request, router, undefined, emit)
    expect(emit).toHaveBeenCalled()
    const messages = emit.mock.calls.map((c: any) => c[0].message)
    expect(messages).toContain('router:intake')
    expect(messages).toContain('router:result')
  })

  it('logs warning when router references missing model IDs', async () => {
    mockModels([makeModel('m1')]) // m2 missing
    mockIsAllowed.mockResolvedValue(true)

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const router = makeRouter(['m1', 'missing-m2'])
    await routeRequest(request, router, log)
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ missingModelIds: ['missing-m2'] }),
      expect.any(String),
    )
  })

  it('handles policy that throws (graceful degradation)', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockLlmPolicy.mockRejectedValue(new Error('routingModelId required'))
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.7 }, { model: 'm2', point: 0.3 }],
    })

    const router = makeRouter(['m1', 'm2'], [
      { type: 'llm', enabled: true, config: {} },
      { type: 'cheapest', enabled: true },
    ])
    // Should not throw — failed policies are logged and skipped
    const result = await routeRequest(request, router)
    expect(result.models).toHaveLength(2)
  })

  it('assigns positional weights to policies (first policy has highest weight)', async () => {
    mockModels([makeModel('cheap'), makeModel('expensive')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'cheap', point: 1.0 }, { model: 'expensive', point: 0.0 }],
    })
    mockFairnessPolicy.mockResolvedValue({
      routing: [{ model: 'cheap', point: 0.5 }, { model: 'expensive', point: 0.5 }],
    })

    const router = makeRouter(['cheap', 'expensive'], [
      { type: 'cheapest', enabled: true },   // weight 2 (first of 2)
      { type: 'fairness', enabled: true },   // weight 1 (second of 2, all equal → abstain)
    ])

    const result = await routeRequest(request, router)
    expect(result.models[0]!.model).toBe('cheap')
  })

  it('includes trace entries for each successful policy', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.8 }, { model: 'm2', point: 0.4 }],
    })

    const router = makeRouter(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    const result = await routeRequest(request, router)
    expect(result.trace).toBeDefined()
    expect(result.trace.length).toBeGreaterThan(0)
  })

  it('redacts sensitive keys in policy config (apiKey, secret, token, password)', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.8 }, { model: 'm2', point: 0.4 }],
    })

    const router = makeRouter(['m1', 'm2'], [
      {
        type: 'cheapest', enabled: true,
        config: {
          apiKey: 'super-secret',
          nested: { password: 'hidden', value: 42 },
          plain: 'visible',
        },
      },
    ])
    const emit = vi.fn()
    await routeRequest(request, router, undefined, emit)
    const policiesEntry = emit.mock.calls.find((c: any) => c[0].message === 'router:policies')
    expect(policiesEntry).toBeDefined()
    const config = policiesEntry![0].details.policies[0].config
    expect(config.apiKey).toBe('***')
    expect(config.nested.password).toBe('***')
    expect(config.plain).toBe('visible')
  })

  it('logs routing result when log is provided (covers log?.info path)', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.8 }, { model: 'm2', point: 0.2 }],
    })

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const router = makeRouter(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    await routeRequest(request, router, log)
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ final: expect.any(Array) }),
      'routing: result',
    )
  })

  it('uses argmax uniform-random pick when all policies abstain (no active policy)', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)

    // argmaxSelector's allAbstained branch: idx = floor(rng() * n). rng=0.9, n=2 -> idx=1 -> m2 picked first.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const router = makeRouter(['m1', 'm2'], [])
    const result = await routeRequest(request, router)

    expect(result.models).toHaveLength(2)
    expect(result.models[0]!.model).toBe('m2')

    spy.mockRestore()
  })

  it('logs excluded models when some are blocked by policy and log is provided', async () => {
    mockModels([makeModel('no-vision'), makeModel('has-vision')])
    mockIsAllowed.mockResolvedValue(true)
    mockCapabilityPolicy.mockResolvedValue({
      routing: [{ model: 'has-vision', point: 1.0 }],
      excludes: ['no-vision'],
    })

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const router = makeRouter(['no-vision', 'has-vision'], [{ type: 'capability', enabled: true }])
    const result = await routeRequest(request, router, log)
    expect(result.models.map(m => m.model)).toContain('has-vision')
    // policyExcludes.size > 0 path exercised
    const resultCall = log.info.mock.calls.find((c: any) => c[1] === 'routing: result')
    expect(resultCall).toBeDefined()
  })

  // ── New tests targeting uncovered branches ─────────────────────────────────

  it('line 56: handles router with undefined policies field (uses ?? [])', async () => {
    // RouterConfig.policies is undefined → falls back to []
    mockModels([makeModel('m1')])
    mockIsAllowed.mockResolvedValue(true)

    const router: RouterConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm1' }],
      // policies omitted / undefined
    } as any

    const result = await routeRequest(request, router)
    expect(result.models).toHaveLength(1)
    expect(result.models[0]!.model).toBe('m1')
  })

  it('line 81: model ref with prompt and thresholds populates candidate correctly', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.9 }, { model: 'm2', point: 0.1 }],
    })

    const router: RouterConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [
        { modelId: 'm1', prompt: 'You are helpful.', thresholds: { daily: 10, monthly: 100 } },
        { modelId: 'm2' },
      ],
      policies: [{ type: 'cheapest', enabled: true }],
    }

    const result = await routeRequest(request, router)
    expect(result.models).toHaveLength(2)
    expect(result.models[0]!.model).toBe('m1')
  })

  it('line 141: intake entry messageCount defaults to 0 when messages is undefined', async () => {
    mockModels([makeModel('m1')])
    mockIsAllowed.mockResolvedValue(true)

    const requestNoMessages: any = { model: 'auto' } // no messages field
    const emit = vi.fn()

    // single model → bypass path, intake entry is emitted
    await routeRequest(requestNoMessages, makeRouter(['m1']), undefined, emit)

    const intakeCall = emit.mock.calls.find((c: any) => c[0].message === 'router:intake')
    expect(intakeCall).toBeDefined()
    expect(intakeCall![0].details.messageCount).toBe(0)
  })

  it('line 168: single bypass includes prompt in result when candidate has prompt', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    // m1 excluded by limits, m2 allowed → single bypass with prompt
    mockIsAllowed
      .mockResolvedValueOnce(false) // m1 excluded
      .mockResolvedValueOnce(true)  // m2 allowed
    mockGetViolatedLimits.mockResolvedValue([])

    const router: RouterConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [
        { modelId: 'm1' },
        { modelId: 'm2', prompt: 'Be concise.' },
      ],
      policies: [],
    }

    const result = await routeRequest(request, router)
    expect(result.models).toHaveLength(1)
    expect(result.models[0]!.model).toBe('m2')
    expect(result.models[0]!.prompt).toBe('Be concise.')
  })

  it('line 204: passes token, traceId, conversationId to policy fn', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.8 }, { model: 'm2', point: 0.4 }],
    })

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const emit = vi.fn()
    const token: any = { id: 'tok-1', name: 'Test Token' }
    const router = makeRouter(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])

    await routeRequest(request, router, log, emit, token, 'trace-abc', 'conv-xyz')

    // Policy should have been called with token, traceId, conversationId spread in
    expect(mockCheapestPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        token,
        traceId: 'trace-abc',
        conversationId: 'conv-xyz',
        log,
        emit,
      }),
    )
  })

  it('line 207: policy that throws a non-Error value uses String() fallback', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    // Throw a plain string (not an Error instance)
    mockCheapestPolicy.mockRejectedValue('plain string error')

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const router = makeRouter(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])

    // Should not throw — failed policy is logged and skipped
    const result = await routeRequest(request, router, log)
    expect(result.models).toHaveLength(2)
    // The non-Error branch logs the string via String()
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'plain string error' }),
      expect.any(String),
    )
  })

  it('line 223-224: policy routing entry with NaN point is treated as 0.5 in emit', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    // Return NaN point for m1 and a normal point for m2 (so they differ, policy is not abstained)
    mockCheapestPolicy.mockResolvedValue({
      routing: [
        { model: 'm1', point: NaN },
        { model: 'm2', point: 0.0 },
      ],
    })

    const emit = vi.fn()
    const router = makeRouter(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    await routeRequest(request, router, undefined, emit)

    // Find the policy:result emit entry for cheapest
    const policyResultCall = emit.mock.calls.find(
      (c: any) => c[0].message === 'policy:result:cheapest',
    )
    expect(policyResultCall).toBeDefined()
    const m1Entry = policyResultCall![0].details.routing.find((e: any) => e.model === 'm1')
    expect(m1Entry).toBeDefined()
    // NaN point → normalised to 0.5
    expect(m1Entry!.point).toBe(0.5)
  })

  it('line 226: emit includes excludes array when policy returns excludes', async () => {
    mockModels([makeModel('m1'), makeModel('m2'), makeModel('m3')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm2', point: 0.8 }, { model: 'm3', point: 0.4 }],
      excludes: ['m1'],
    })

    const emit = vi.fn()
    const router = makeRouter(['m1', 'm2', 'm3'], [{ type: 'cheapest', enabled: true }])
    await routeRequest(request, router, undefined, emit)

    const policyResultCall = emit.mock.calls.find(
      (c: any) => c[0].message === 'policy:result:cheapest',
    )
    expect(policyResultCall).toBeDefined()
    expect(policyResultCall![0].details).toHaveProperty('excludes')
    expect(policyResultCall![0].details.excludes).toContain('m1')
  })

  it('line 280: NaN point in scoring phase treated as 0.5 for min/max check', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    // m1 has NaN, m2 has 0.0 — after NaN→0.5 substitution, min=0 max=0.5 → not abstained
    mockCheapestPolicy.mockResolvedValue({
      routing: [
        { model: 'm1', point: NaN },
        { model: 'm2', point: 0.0 },
      ],
    })

    const router = makeRouter(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    const result = await routeRequest(request, router)
    // m1 gets effective 0.5, m2 gets 0.0 → m1 should win
    expect(result.models[0]!.model).toBe('m1')
  })

  it('line 289-291: scoring accumulator defaults to 0 for unseen model (no point for model)', async () => {
    mockModels([makeModel('m1'), makeModel('m2'), makeModel('m3')])
    mockIsAllowed.mockResolvedValue(true)
    // policy only returns scoring for m1 and m2; m3 is eligible but absent from routing array
    mockCheapestPolicy.mockResolvedValue({
      routing: [
        { model: 'm1', point: 0.9 },
        { model: 'm2', point: 0.1 },
      ],
      // m3 not in routing → no accumulation → defaults to 0
    })

    const router = makeRouter(['m1', 'm2', 'm3'], [{ type: 'cheapest', enabled: true }])
    const result = await routeRequest(request, router)
    // m1 (score 0.9) ranks first, m3 (missing → 0.5 fallback) ranks second, m2 (0.1) ranks last.
    // Post-selector weight is rank-based (n - idx), not the raw score.
    expect(result.models).toHaveLength(3)
    expect(result.models[0]!.model).toBe('m1')
    const m3 = result.models.find(m => m.model === 'm3')
    expect(m3).toBeDefined()
    expect(m3!.weight).toBe(2)
  })

  it('router:recap final[].score stays 0..1 weighted-mean while router:result weight is rank-based', async () => {
    mockModels([makeModel('m1'), makeModel('m2'), makeModel('m3')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [
        { model: 'm1', point: 0.9 },
        { model: 'm2', point: 0.1 },
      ],
      // m3 not in routing → no accumulation → defaults to 0.5 fallback score
    })

    const emit = vi.fn()
    const router = makeRouter(['m1', 'm2', 'm3'], [{ type: 'cheapest', enabled: true }])
    await routeRequest(request, router, undefined, emit)

    const recapCall = emit.mock.calls.find((c: any) => c[0].message === 'router:recap')
    expect(recapCall).toBeDefined()
    const recapFinal = recapCall![0].details.final as Array<{ model: string; score: number }>
    // Every recap score must remain a 0..1 probability, never a rank integer (n, n-1, ...).
    for (const entry of recapFinal) {
      expect(entry.score).toBeGreaterThanOrEqual(0)
      expect(entry.score).toBeLessThanOrEqual(1)
    }
    expect(recapFinal.find(e => e.model === 'm1')!.score).toBeCloseTo(0.9)
    expect(recapFinal.find(e => e.model === 'm2')!.score).toBeCloseTo(0.1)
    expect(recapFinal.find(e => e.model === 'm3')!.score).toBeCloseTo(0.5)

    const resultCall = emit.mock.calls.filter((c: any) => c[0].message === 'router:result')
    const finalResultCall = resultCall[resultCall.length - 1]
    const resultFinal = finalResultCall![0].details.final as Array<{ model: string; weight: number }>
    // In contrast, router:result's weight IS the selector's rank-based integer.
    expect(resultFinal.find(e => e.model === 'm1')!.weight).toBe(3)
    expect(resultFinal.find(e => e.model === 'm2')!.weight).toBe(1)
    expect(resultFinal.find(e => e.model === 'm3')!.weight).toBe(2)
  })

  it('line 308: finalCandidates include prompt when candidate has prompt set', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.9 }, { model: 'm2', point: 0.1 }],
    })

    const router: RouterConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [
        { modelId: 'm1', prompt: 'You are a coder.' },
        { modelId: 'm2' },
      ],
      policies: [{ type: 'cheapest', enabled: true }],
    }

    const result = await routeRequest(request, router)
    expect(result.models[0]!.model).toBe('m1')
    expect(result.models[0]!.prompt).toBe('You are a coder.')
    expect(result.models[1]!.prompt).toBeUndefined()
  })

  it('line 314/343/363: hasTie branch when two models score identically', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    // Both models get the same point → cheapest abstains → allPoliciesAbstained → random fallback.
    // Force Math.random to return identical values so the router still detects a tie.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.7)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.7 }, { model: 'm2', point: 0.7 }],
    })

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const emit = vi.fn()
    const router = makeRouter(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    const result = await routeRequest(request, router, log, emit)
    spy.mockRestore()

    // log.info for 'routing: result' should include tied
    const resultCall = log.info.mock.calls.find((c: any) => c[1] === 'routing: result')
    expect(resultCall).toBeDefined()
    expect(resultCall![0]).toHaveProperty('tied')

    // recap entry should have tie property
    const recapCall = emit.mock.calls.find((c: any) => c[0].message === 'router:recap')
    expect(recapCall).toBeDefined()
    expect(recapCall![0].details).toHaveProperty('tie')

    // result entry should have tiedWinners
    const resultEmit = emit.mock.calls.filter((c: any) => c[0].message === 'router:result')
    // last router:result is the final one
    const finalResultEmit = resultEmit[resultEmit.length - 1]
    expect(finalResultEmit).toBeDefined()
    expect(finalResultEmit![0].details).toHaveProperty('tiedWinners')

    // Both models are returned
    expect(result.models).toHaveLength(2)
  })

  it('line 343: recap winner is null when no scorable routing entries for a policy', async () => {
    // All policy routing entries are for excluded models → scorable set is empty
    mockModels([makeModel('m1'), makeModel('m2'), makeModel('m3')])
    mockIsAllowed.mockResolvedValue(true)
    // cheapest excludes m1; its routing only covers m1 (not in scoringIds for recap)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.9 }],
      excludes: ['m1'],
    })
    // Use capability for a second differentiating signal on m2/m3
    mockCapabilityPolicy.mockResolvedValue({
      routing: [{ model: 'm2', point: 0.8 }, { model: 'm3', point: 0.2 }],
    })

    const emit = vi.fn()
    const router = makeRouter(['m1', 'm2', 'm3'], [
      { type: 'cheapest', enabled: true },
      { type: 'capability', enabled: true },
    ])
    await routeRequest(request, router, undefined, emit)

    const recapCall = emit.mock.calls.find((c: any) => c[0].message === 'router:recap')
    expect(recapCall).toBeDefined()
    // The cheapest policy entry in recap should have winner: null
    // because its routing only had m1 which is excluded from scoring
    const cheapestRecap = recapCall![0].details.policies.find((p: any) => p.type === 'cheapest')
    expect(cheapestRecap).toBeDefined()
    expect(cheapestRecap!.winner).toBeNull()
  })

  it('excludedByLimits >0: logs info and includes in intake trace details', async () => {
    mockModels([makeModel('m1'), makeModel('m2'), makeModel('m3')])
    mockIsAllowed
      .mockResolvedValueOnce(false)  // m1 excluded
      .mockResolvedValueOnce(true)   // m2 allowed
      .mockResolvedValueOnce(true)   // m3 allowed
    mockGetViolatedLimits.mockResolvedValue([
      { metric: 'cost' as any, window: 'daily', value: 5, current: 7, remaining: -2 },
    ])
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm2', point: 0.8 }, { model: 'm3', point: 0.4 }],
    })

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const emit = vi.fn()
    const router = makeRouter(['m1', 'm2', 'm3'], [{ type: 'cheapest', enabled: true }])

    await routeRequest(request, router, log, emit)

    // log.info should have been called for the excluded model
    const excludedInfoCall = log.info.mock.calls.find(
      (c: any) => c[1] === 'routing: model excluded — limit exceeded',
    )
    expect(excludedInfoCall).toBeDefined()
    expect(excludedInfoCall![0]).toHaveProperty('modelId', 'm1')

    // intake entry should include excludedByLimits
    const intakeCall = emit.mock.calls.find((c: any) => c[0].message === 'router:intake')
    expect(intakeCall).toBeDefined()
    expect(intakeCall![0].details).toHaveProperty('excludedByLimits')
    expect(intakeCall![0].details.excludedByLimits).toHaveLength(1)
    expect(intakeCall![0].details.excludedByLimits[0].model).toBe('m1')
  })

  it('policy error emit: emits policy:error:<type> entry when policy throws', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockRejectedValue(new Error('policy crash'))

    const emit = vi.fn()
    const router = makeRouter(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    await routeRequest(request, router, undefined, emit)

    const errorEmit = emit.mock.calls.find((c: any) => c[0].message === 'policy:error:cheapest')
    expect(errorEmit).toBeDefined()
    expect(errorEmit![0].details.error).toBe('policy crash')
  })

  it('abstained policies: emits router:abstained and logs when all policies return uniform scores', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    // Both candidates get identical score → policy abstains
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.5 }, { model: 'm2', point: 0.5 }],
    })

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const emit = vi.fn()
    const router = makeRouter(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    await routeRequest(request, router, log, emit)

    // emit should include router:abstained
    const abstainedEmit = emit.mock.calls.find((c: any) => c[0].message === 'router:abstained')
    expect(abstainedEmit).toBeDefined()
    expect(abstainedEmit![0].details.policies).toContain('cheapest')

    // log.info should include abstained
    const abstainedLog = log.info.mock.calls.find(
      (c: any) => c[1] === 'routing: policies abstained (no discriminating signal)',
    )
    expect(abstainedLog).toBeDefined()
    expect(abstainedLog![0].abstained).toContain('cheapest')
  })

  it('router:excludes emit: emitted and log.info called when policies exclude models', async () => {
    mockModels([makeModel('m1'), makeModel('m2'), makeModel('m3')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm2', point: 0.8 }, { model: 'm3', point: 0.4 }],
      excludes: ['m1'],
    })

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const emit = vi.fn()
    const router = makeRouter(['m1', 'm2', 'm3'], [{ type: 'cheapest', enabled: true }])
    await routeRequest(request, router, log, emit)

    const excludesEmit = emit.mock.calls.find((c: any) => c[0].message === 'router:excludes')
    expect(excludesEmit).toBeDefined()
    expect(excludesEmit![0].details.excluded).toHaveProperty('m1')

    const excludesLog = log.info.mock.calls.find(
      (c: any) => c[1] === 'routing: models excluded by policies',
    )
    expect(excludesLog).toBeDefined()
  })

  it('long prompt is truncated in result entry (>120 chars)', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.9 }, { model: 'm2', point: 0.1 }],
    })

    const longPrompt = 'A'.repeat(130)
    const router: RouterConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [
        { modelId: 'm1', prompt: longPrompt },
        { modelId: 'm2' },
      ],
      policies: [{ type: 'cheapest', enabled: true }],
    }

    const emit = vi.fn()
    await routeRequest(request, router, undefined, emit)

    const resultCalls = emit.mock.calls.filter((c: any) => c[0].message === 'router:result')
    const finalResultCall = resultCalls[resultCalls.length - 1]
    expect(finalResultCall).toBeDefined()
    const m1entry = finalResultCall![0].details.final.find((e: any) => e.model === 'm1')
    expect(m1entry).toBeDefined()
    // prompt should be truncated to 120 chars + ellipsis
    expect(m1entry!.prompt).toHaveLength(121) // 120 + '…'
    expect(m1entry!.prompt).toMatch(/…$/)
  })

  it('redactConfig handles null/primitive config values without crashing', async () => {
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.8 }, { model: 'm2', point: 0.4 }],
    })

    const router = makeRouter(['m1', 'm2'], [
      { type: 'cheapest', enabled: true, config: null },
    ])
    const emit = vi.fn()
    // Should not throw even with null config
    await expect(routeRequest(request, router, undefined, emit)).resolves.toBeDefined()
  })

  it('same model excluded by two policies → excludeReasons has(id) already (line 237 if branch=1)', async () => {
    // m1 excluded by both cheapest and capability → second exclusion hits line 237 false branch
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({ routing: [], excludes: ['m1'] })
    mockCapabilityPolicy.mockResolvedValue({ routing: [], excludes: ['m1'] })

    const router = makeRouter(['m1', 'm2'], [
      { type: 'cheapest', enabled: true },
      { type: 'capability', enabled: true },
    ])
    const result = await routeRequest(request, router)
    // m1 excluded, m2 is only candidate
    expect(result.models[0]!.model).toBe('m2')
  })

  it('policy with routing for excluded models only → eligible.length === 0 → abstain (line 237 true branch)', async () => {
    // m1 and m2 are candidates. Policy excludes m1. Policy also returns routing for m1
    // only (not m2). After exclusion, scoringCandidates = [m2].
    // eligible = routing entries filtered by scoringIds = [m2]. Since policy returned
    // routing only for m1 (now excluded), eligible.length === 0 → policy abstains.
    mockModels([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.9 }], // m1 will be excluded by policy
      excludes: ['m1'],
    })

    const router = makeRouter(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    const emit = vi.fn()
    const result = await routeRequest(request, router, undefined, emit)

    // m1 excluded, m2 is the only scoring candidate
    // Policy routing was only for m1 (excluded) → eligible=[]] → abstain
    // m2 gets default score 0.5
    expect(result.models[0]!.model).toBe('m2')

    // abstained should be emitted
    const abstainEmit = emit.mock.calls.find((c: any) => c[0].message === 'router:abstained')
    expect(abstainEmit).toBeDefined()
  })

  describe('resilience pre-filter', () => {
    it('never returns a candidate whose provider circuit is open while another candidate is available', async () => {
      mockModels([makeModel('m1', 'openai'), makeModel('m2', 'anthropic')])
      mockIsAllowed.mockResolvedValue(true)

      const store = new InMemoryResilienceStore()
      for (let i = 0; i < 5; i++) store.record({ level: 'provider', id: 'openai' }, { category: 'server' })

      const router = makeRouter(['m1', 'm2'])
      const result = await routeRequest(request, router, undefined, undefined, undefined, undefined, undefined, store)

      expect(result.models.map(m => m.model)).not.toContain('m1')
      expect(result.models.map(m => m.model)).toContain('m2')
    })

    it('records the resilience exclusion in the trace (both via emit and the returned trace array)', async () => {
      mockModels([makeModel('m1', 'openai'), makeModel('m2', 'anthropic')])
      mockIsAllowed.mockResolvedValue(true)

      const store = new InMemoryResilienceStore()
      for (let i = 0; i < 5; i++) store.record({ level: 'provider', id: 'openai' }, { category: 'server' })

      const emit = vi.fn()
      const router = makeRouter(['m1', 'm2'])
      const result = await routeRequest(request, router, undefined, emit, undefined, undefined, undefined, store)

      const emittedEntry = emit.mock.calls.map((c: any) => c[0]).find((e: any) => e.message === 'resilience:excluded')
      expect(emittedEntry).toBeDefined()
      expect(emittedEntry.details.excluded).toEqual([
        { modelId: 'm1', level: 'provider', until: expect.any(Number) },
      ])

      const tracedEntry = result.trace.find(e => e.message === 'resilience:excluded')
      expect(tracedEntry).toBeDefined()
    })

    it('does not filter or emit a resilience trace entry when no store is passed (backward compatible)', async () => {
      mockModels([makeModel('m1', 'openai'), makeModel('m2', 'anthropic')])
      mockIsAllowed.mockResolvedValue(true)

      const emit = vi.fn()
      const router = makeRouter(['m1', 'm2'])
      const result = await routeRequest(request, router, undefined, emit)

      expect(result.models.map(m => m.model)).toContain('m1')
      expect(emit.mock.calls.map((c: any) => c[0].message)).not.toContain('resilience:excluded')
    })

    it('falls back to the single least-bad candidate instead of throwing when the store excludes every candidate', async () => {
      mockModels([makeModel('m1', 'openai'), makeModel('m2', 'anthropic')])
      mockIsAllowed.mockResolvedValue(true)

      const store = new InMemoryResilienceStore()
      for (let i = 0; i < 5; i++) store.record({ level: 'provider', id: 'openai' }, { category: 'server' })
      for (let i = 0; i < 5; i++) store.record({ level: 'provider', id: 'anthropic' }, { category: 'server' })

      const router = makeRouter(['m1', 'm2'])
      const result = await routeRequest(request, router, undefined, undefined, undefined, undefined, undefined, store)

      expect(result.models).toHaveLength(1)
    })

    it('passes candidates through unchanged when a store is provided but nothing is excluded', async () => {
      mockModels([makeModel('m1', 'openai'), makeModel('m2', 'anthropic')])
      mockIsAllowed.mockResolvedValue(true)
      mockCheapestPolicy.mockResolvedValue({
        routing: [{ model: 'm1', point: 0.8 }, { model: 'm2', point: 0.4 }],
      })

      const store = new InMemoryResilienceStore() // no faults recorded — everything available
      const emit = vi.fn()
      const router = makeRouter(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
      const result = await routeRequest(request, router, undefined, emit, undefined, undefined, undefined, store)

      expect(result.models.map(m => m.model).sort()).toEqual(['m1', 'm2'])
      expect(emit.mock.calls.map((c: any) => c[0].message)).not.toContain('resilience:excluded')
    })

    it('includes the resilience trace entry in the full policy-scoring path (not just the single-candidate bypass)', async () => {
      mockModels([makeModel('m1', 'openai'), makeModel('m2', 'anthropic'), makeModel('m3', 'anthropic')])
      mockIsAllowed.mockResolvedValue(true)
      mockCheapestPolicy.mockResolvedValue({
        routing: [{ model: 'm2', point: 0.8 }, { model: 'm3', point: 0.4 }],
      })

      const store = new InMemoryResilienceStore()
      for (let i = 0; i < 5; i++) store.record({ level: 'provider', id: 'openai' }, { category: 'server' })

      const router = makeRouter(['m1', 'm2', 'm3'], [{ type: 'cheapest', enabled: true }])
      const result = await routeRequest(request, router, undefined, undefined, undefined, undefined, undefined, store)

      // m1 excluded by resilience, m2/m3 remain → full policy-scoring path (2+ candidates), not the bypass.
      expect(result.models.map(m => m.model).sort()).toEqual(['m2', 'm3'])
      expect(result.trace.find(e => e.message === 'resilience:excluded')).toBeDefined()
    })
  })

  describe('profile resolution + selector wiring', () => {
    it('(a) differentiating policies: the model with the highest weighted-mean policy score still wins, weights are rank-based', async () => {
      mockModels([makeModel('m1'), makeModel('m2'), makeModel('m3')])
      mockIsAllowed.mockResolvedValue(true)
      mockCheapestPolicy.mockResolvedValue({
        routing: [
          { model: 'm1', point: 0.9 },
          { model: 'm2', point: 0.5 },
          { model: 'm3', point: 0.1 },
        ],
      })

      const router = makeRouter(['m1', 'm2', 'm3'], [{ type: 'cheapest', enabled: true }])
      const result = await routeRequest(request, router)

      // Default profile has no profileId set → ephemeral default (selector: 'argmax'), ordering by score desc.
      expect(result.models.map(m => m.model)).toEqual(['m1', 'm2', 'm3'])
      // Rank-based weight: winner N, runner-up N-1, ... for N=3 scoring candidates.
      expect(result.models[0]!.weight).toBe(3)
      expect(result.models[1]!.weight).toBe(2)
      expect(result.models[2]!.weight).toBe(1)
    })

    it('(b) all-abstain: winner is picked by argmaxSelector\'s uniform-random branch, deterministic under a mocked Math.random', async () => {
      mockModels([makeModel('m1'), makeModel('m2'), makeModel('m3')])
      mockIsAllowed.mockResolvedValue(true)

      // argmaxSelector's allAbstained branch: idx = floor(rng() * n). rng=0.5, n=3 -> idx=1 -> m2 picked first.
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
      const router = makeRouter(['m1', 'm2', 'm3'], [{ type: 'cheapest', enabled: false }])
      const result = await routeRequest(request, router)
      spy.mockRestore()

      expect(result.models).toHaveLength(3)
      expect(result.models[0]!.model).toBe('m2')
    })

    it('(c) single-candidate bypass short-circuits before any profile/selector trace is emitted', async () => {
      mockModels([makeModel('m1')])
      mockIsAllowed.mockResolvedValue(true)

      const emit = vi.fn()
      const router = makeRouter(['m1'])
      const result = await routeRequest(request, router, undefined, emit)

      expect(result.models).toEqual([{ model: 'm1', weight: 1 }])
      const messages = emit.mock.calls.map((c: any) => c[0].message)
      expect(messages).not.toContain('router:profile')
    })

    it('emits router:profile trace entry with the resolved custom profile id/selector/fallbackStrategy', async () => {
      mockModels([makeModel('m1'), makeModel('m2')])
      mockIsAllowed.mockResolvedValue(true)
      mockCheapestPolicy.mockResolvedValue({
        routing: [{ model: 'm1', point: 0.8 }, { model: 'm2', point: 0.4 }],
      })

      const emit = vi.fn()
      const router = makeRouter(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
      const result = await routeRequest(request, router, undefined, emit)

      const profileCall = emit.mock.calls.find((c: any) => c[0].message === 'router:profile')
      expect(profileCall).toBeDefined()
      expect(profileCall![0].details).toEqual({
        profileId: 'custom',
        selector: 'argmax',
        fallbackStrategy: 'next-best',
      })
      // Also present in the returned trace array (not just via emit).
      expect(result.trace.find(e => e.message === 'router:profile')).toBeDefined()
    })
  })
})
