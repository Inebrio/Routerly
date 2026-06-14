import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../cost/budget.js', () => ({ isAllowed: vi.fn(), getViolatedLimits: vi.fn() }))
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
import { isAllowed, getViolatedLimits } from '../cost/budget.js'
import { cheapestPolicy } from './policies/cheapest.js'
import { capabilityPolicy } from './policies/capability.js'
import { llmPolicy } from './policies/llm.js'
import { fairnessPolicy } from './policies/fairness.js'
import type { ModelConfig, ProjectConfig } from '@routerly/shared'

const mockReadConfig = vi.mocked(readConfig)
const mockIsAllowed = vi.mocked(isAllowed)
const mockGetViolatedLimits = vi.mocked(getViolatedLimits)
const mockCheapestPolicy = vi.mocked(cheapestPolicy)
const mockCapabilityPolicy = vi.mocked(capabilityPolicy)
const mockLlmPolicy = vi.mocked(llmPolicy)
const mockFairnessPolicy = vi.mocked(fairnessPolicy)

afterEach(() => { vi.clearAllMocks() })

function makeModel(id: string): ModelConfig {
  return {
    id, name: id, provider: 'openai', endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 1, outputPerMillion: 3 },
  }
}

function makeProject(modelIds: string[], policies: any[] = []): ProjectConfig {
  return {
    id: 'proj-1', name: 'Test', tokens: [], members: [],
    models: modelIds.map(id => ({ modelId: id })),
    policies,
  }
}

const request: any = { model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }

describe('routeRequest', () => {
  it('throws when project has no models', async () => {
    mockReadConfig.mockResolvedValue([makeModel('gpt-4')])
    await expect(routeRequest(request, makeProject([]))).rejects.toThrow('no_models_available')
  })

  it('throws when referenced models not found in registry', async () => {
    mockReadConfig.mockResolvedValue([]) // no models in registry
    await expect(routeRequest(request, makeProject(['nonexistent']))).rejects.toThrow('no_models_available')
  })

  it('throws when all models exceed budget limits', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(false)
    mockGetViolatedLimits.mockResolvedValue([])
    await expect(routeRequest(request, makeProject(['m1', 'm2']))).rejects.toThrow('all_models_limits_exceeded')
  })

  it('bypasses policies when only one valid model exists', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed
      .mockResolvedValueOnce(false) // m1 excluded by limits
      .mockResolvedValueOnce(true)  // m2 valid
    mockGetViolatedLimits.mockResolvedValue([])

    const result = await routeRequest(request, makeProject(['m1', 'm2']))
    expect(result.models).toHaveLength(1)
    expect(result.models[0]!.model).toBe('m2')
    expect(result.models[0]!.weight).toBe(1)
  })

  it('runs cheapest policy and returns scored candidates', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [
        { model: 'm1', point: 0.9 },
        { model: 'm2', point: 0.3 },
      ],
    })

    const project = makeProject(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    const result = await routeRequest(request, project)
    expect(result.models).toHaveLength(2)
    expect(result.models[0]!.model).toBe('m1')
    expect(result.models[0]!.weight).toBeGreaterThan(result.models[1]!.weight)
  })

  it('excludes models hard-blocked by capability policy', async () => {
    mockReadConfig.mockResolvedValue([makeModel('no-vision'), makeModel('has-vision')])
    mockIsAllowed.mockResolvedValue(true)
    mockCapabilityPolicy.mockResolvedValue({
      routing: [{ model: 'has-vision', point: 1.0 }],
      excludes: ['no-vision'],
    })

    const project = makeProject(['no-vision', 'has-vision'], [
      { type: 'capability', enabled: true },
    ])
    const result = await routeRequest(request, project)
    expect(result.models.map(m => m.model)).not.toContain('no-vision')
    expect(result.models.map(m => m.model)).toContain('has-vision')
  })

  it('throws when all candidates are excluded by policies', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCapabilityPolicy.mockResolvedValue({
      routing: [],
      excludes: ['m1', 'm2'],
    })

    const project = makeProject(['m1', 'm2'], [{ type: 'capability', enabled: true }])
    await expect(routeRequest(request, project)).rejects.toThrow('all_models_excluded_by_policies')
  })

  it('skips disabled policies', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)

    const project = makeProject(['m1', 'm2'], [
      { type: 'cheapest', enabled: false },
    ])
    const result = await routeRequest(request, project)
    // No active policy → random selection among both models
    expect(result.models).toHaveLength(2)
  })

  it('skips unknown policy types gracefully', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)

    const project = makeProject(['m1', 'm2'], [
      { type: 'unknown-policy-xyz', enabled: true },
    ])
    const result = await routeRequest(request, project)
    expect(result.models).toHaveLength(2)
  })

  it('calls emit with trace entries when provided', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.8 }, { model: 'm2', point: 0.4 }],
    })

    const emit = vi.fn()
    const project = makeProject(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    await routeRequest(request, project, undefined, emit)
    expect(emit).toHaveBeenCalled()
    const messages = emit.mock.calls.map((c: any) => c[0].message)
    expect(messages).toContain('router:intake')
    expect(messages).toContain('router:result')
  })

  it('logs warning when project references missing model IDs', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1')]) // m2 missing
    mockIsAllowed.mockResolvedValue(true)

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const project = makeProject(['m1', 'missing-m2'])
    await routeRequest(request, project, log)
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ missingModelIds: ['missing-m2'] }),
      expect.any(String),
    )
  })

  it('handles policy that throws (graceful degradation)', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockLlmPolicy.mockRejectedValue(new Error('routingModelId required'))
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.7 }, { model: 'm2', point: 0.3 }],
    })

    const project = makeProject(['m1', 'm2'], [
      { type: 'llm', enabled: true, config: {} },
      { type: 'cheapest', enabled: true },
    ])
    // Should not throw — failed policies are logged and skipped
    const result = await routeRequest(request, project)
    expect(result.models).toHaveLength(2)
  })

  it('assigns positional weights to policies (first policy has highest weight)', async () => {
    mockReadConfig.mockResolvedValue([makeModel('cheap'), makeModel('expensive')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'cheap', point: 1.0 }, { model: 'expensive', point: 0.0 }],
    })
    mockFairnessPolicy.mockResolvedValue({
      routing: [{ model: 'cheap', point: 0.5 }, { model: 'expensive', point: 0.5 }],
    })

    const project = makeProject(['cheap', 'expensive'], [
      { type: 'cheapest', enabled: true },   // weight 2 (first of 2)
      { type: 'fairness', enabled: true },   // weight 1 (second of 2, all equal → abstain)
    ])

    const result = await routeRequest(request, project)
    expect(result.models[0]!.model).toBe('cheap')
  })

  it('includes trace entries for each successful policy', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.8 }, { model: 'm2', point: 0.4 }],
    })

    const project = makeProject(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    const result = await routeRequest(request, project)
    expect(result.trace).toBeDefined()
    expect(result.trace.length).toBeGreaterThan(0)
  })

  it('redacts sensitive keys in policy config (apiKey, secret, token, password)', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.8 }, { model: 'm2', point: 0.4 }],
    })

    const project = makeProject(['m1', 'm2'], [
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
    await routeRequest(request, project, undefined, emit)
    const policiesEntry = emit.mock.calls.find((c: any) => c[0].message === 'router:policies')
    expect(policiesEntry).toBeDefined()
    const config = policiesEntry![0].details.policies[0].config
    expect(config.apiKey).toBe('***')
    expect(config.nested.password).toBe('***')
    expect(config.plain).toBe('visible')
  })

  it('logs routing result when log is provided (covers log?.info path)', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.8 }, { model: 'm2', point: 0.2 }],
    })

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const project = makeProject(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    await routeRequest(request, project, log)
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ final: expect.any(Array) }),
      'routing: result',
    )
  })

  it('uses random selection when all policies abstain (no active policy)', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)

    // Force deterministic random: m1 gets 0.9, m2 gets 0.3 → m1 wins
    const spy = vi.spyOn(Math, 'random').mockReturnValueOnce(0.9).mockReturnValueOnce(0.3)
    const project = makeProject(['m1', 'm2'], [])
    const result = await routeRequest(request, project)

    expect(result.models).toHaveLength(2)
    expect(result.models[0]!.model).toBe('m1')

    spy.mockRestore()
  })

  it('logs excluded models when some are blocked by policy and log is provided', async () => {
    mockReadConfig.mockResolvedValue([makeModel('no-vision'), makeModel('has-vision')])
    mockIsAllowed.mockResolvedValue(true)
    mockCapabilityPolicy.mockResolvedValue({
      routing: [{ model: 'has-vision', point: 1.0 }],
      excludes: ['no-vision'],
    })

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const project = makeProject(['no-vision', 'has-vision'], [{ type: 'capability', enabled: true }])
    const result = await routeRequest(request, project, log)
    expect(result.models.map(m => m.model)).toContain('has-vision')
    // policyExcludes.size > 0 path exercised
    const resultCall = log.info.mock.calls.find((c: any) => c[1] === 'routing: result')
    expect(resultCall).toBeDefined()
  })

  // ── New tests targeting uncovered branches ─────────────────────────────────

  it('line 56: handles project with undefined policies field (uses ?? [])', async () => {
    // ProjectConfig.policies is undefined → falls back to []
    mockReadConfig.mockResolvedValue([makeModel('m1')])
    mockIsAllowed.mockResolvedValue(true)

    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [{ modelId: 'm1' }],
      // policies omitted / undefined
    } as any

    const result = await routeRequest(request, project)
    expect(result.models).toHaveLength(1)
    expect(result.models[0]!.model).toBe('m1')
  })

  it('line 81: model ref with prompt and thresholds populates candidate correctly', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.9 }, { model: 'm2', point: 0.1 }],
    })

    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [
        { modelId: 'm1', prompt: 'You are helpful.', thresholds: { daily: 10, monthly: 100 } },
        { modelId: 'm2' },
      ],
      policies: [{ type: 'cheapest', enabled: true }],
    }

    const result = await routeRequest(request, project)
    expect(result.models).toHaveLength(2)
    expect(result.models[0]!.model).toBe('m1')
  })

  it('line 141: intake entry messageCount defaults to 0 when messages is undefined', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1')])
    mockIsAllowed.mockResolvedValue(true)

    const requestNoMessages: any = { model: 'auto' } // no messages field
    const emit = vi.fn()

    // single model → bypass path, intake entry is emitted
    await routeRequest(requestNoMessages, makeProject(['m1']), undefined, emit)

    const intakeCall = emit.mock.calls.find((c: any) => c[0].message === 'router:intake')
    expect(intakeCall).toBeDefined()
    expect(intakeCall![0].details.messageCount).toBe(0)
  })

  it('line 168: single bypass includes prompt in result when candidate has prompt', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    // m1 excluded by limits, m2 allowed → single bypass with prompt
    mockIsAllowed
      .mockResolvedValueOnce(false) // m1 excluded
      .mockResolvedValueOnce(true)  // m2 allowed
    mockGetViolatedLimits.mockResolvedValue([])

    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [
        { modelId: 'm1' },
        { modelId: 'm2', prompt: 'Be concise.' },
      ],
      policies: [],
    }

    const result = await routeRequest(request, project)
    expect(result.models).toHaveLength(1)
    expect(result.models[0]!.model).toBe('m2')
    expect(result.models[0]!.prompt).toBe('Be concise.')
  })

  it('line 204: passes token, traceId, conversationId to policy fn', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.8 }, { model: 'm2', point: 0.4 }],
    })

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const emit = vi.fn()
    const token: any = { id: 'tok-1', name: 'Test Token' }
    const project = makeProject(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])

    await routeRequest(request, project, log, emit, token, 'trace-abc', 'conv-xyz')

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
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    // Throw a plain string (not an Error instance)
    mockCheapestPolicy.mockRejectedValue('plain string error')

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const project = makeProject(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])

    // Should not throw — failed policy is logged and skipped
    const result = await routeRequest(request, project, log)
    expect(result.models).toHaveLength(2)
    // The non-Error branch logs the string via String()
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'plain string error' }),
      expect.any(String),
    )
  })

  it('line 223-224: policy routing entry with NaN point is treated as 0.5 in emit', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    // Return NaN point for m1 and a normal point for m2 (so they differ, policy is not abstained)
    mockCheapestPolicy.mockResolvedValue({
      routing: [
        { model: 'm1', point: NaN },
        { model: 'm2', point: 0.0 },
      ],
    })

    const emit = vi.fn()
    const project = makeProject(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    await routeRequest(request, project, undefined, emit)

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
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2'), makeModel('m3')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm2', point: 0.8 }, { model: 'm3', point: 0.4 }],
      excludes: ['m1'],
    })

    const emit = vi.fn()
    const project = makeProject(['m1', 'm2', 'm3'], [{ type: 'cheapest', enabled: true }])
    await routeRequest(request, project, undefined, emit)

    const policyResultCall = emit.mock.calls.find(
      (c: any) => c[0].message === 'policy:result:cheapest',
    )
    expect(policyResultCall).toBeDefined()
    expect(policyResultCall![0].details).toHaveProperty('excludes')
    expect(policyResultCall![0].details.excludes).toContain('m1')
  })

  it('line 280: NaN point in scoring phase treated as 0.5 for min/max check', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    // m1 has NaN, m2 has 0.0 — after NaN→0.5 substitution, min=0 max=0.5 → not abstained
    mockCheapestPolicy.mockResolvedValue({
      routing: [
        { model: 'm1', point: NaN },
        { model: 'm2', point: 0.0 },
      ],
    })

    const project = makeProject(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    const result = await routeRequest(request, project)
    // m1 gets effective 0.5, m2 gets 0.0 → m1 should win
    expect(result.models[0]!.model).toBe('m1')
  })

  it('line 289-291: scoring accumulator defaults to 0 for unseen model (no point for model)', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2'), makeModel('m3')])
    mockIsAllowed.mockResolvedValue(true)
    // policy only returns scoring for m1 and m2; m3 is eligible but absent from routing array
    mockCheapestPolicy.mockResolvedValue({
      routing: [
        { model: 'm1', point: 0.9 },
        { model: 'm2', point: 0.1 },
      ],
      // m3 not in routing → no accumulation → defaults to 0
    })

    const project = makeProject(['m1', 'm2', 'm3'], [{ type: 'cheapest', enabled: true }])
    const result = await routeRequest(request, project)
    // m1 should win; m3 missing from policy → gets 0.5 fallback (weight=0 → score=0.5)
    expect(result.models).toHaveLength(3)
    expect(result.models[0]!.model).toBe('m1')
    const m3 = result.models.find(m => m.model === 'm3')
    expect(m3).toBeDefined()
    expect(m3!.weight).toBe(0.5)
  })

  it('line 308: finalCandidates include prompt when candidate has prompt set', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.9 }, { model: 'm2', point: 0.1 }],
    })

    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [
        { modelId: 'm1', prompt: 'You are a coder.' },
        { modelId: 'm2' },
      ],
      policies: [{ type: 'cheapest', enabled: true }],
    }

    const result = await routeRequest(request, project)
    expect(result.models[0]!.model).toBe('m1')
    expect(result.models[0]!.prompt).toBe('You are a coder.')
    expect(result.models[1]!.prompt).toBeUndefined()
  })

  it('line 314/343/363: hasTie branch when two models score identically', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    // Both models get the same point → cheapest abstains → allPoliciesAbstained → random fallback.
    // Force Math.random to return identical values so the router still detects a tie.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.7)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.7 }, { model: 'm2', point: 0.7 }],
    })

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const emit = vi.fn()
    const project = makeProject(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    const result = await routeRequest(request, project, log, emit)
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
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2'), makeModel('m3')])
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
    const project = makeProject(['m1', 'm2', 'm3'], [
      { type: 'cheapest', enabled: true },
      { type: 'capability', enabled: true },
    ])
    await routeRequest(request, project, undefined, emit)

    const recapCall = emit.mock.calls.find((c: any) => c[0].message === 'router:recap')
    expect(recapCall).toBeDefined()
    // The cheapest policy entry in recap should have winner: null
    // because its routing only had m1 which is excluded from scoring
    const cheapestRecap = recapCall![0].details.policies.find((p: any) => p.type === 'cheapest')
    expect(cheapestRecap).toBeDefined()
    expect(cheapestRecap!.winner).toBeNull()
  })

  it('excludedByLimits >0: logs info and includes in intake trace details', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2'), makeModel('m3')])
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
    const project = makeProject(['m1', 'm2', 'm3'], [{ type: 'cheapest', enabled: true }])

    await routeRequest(request, project, log, emit)

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
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockRejectedValue(new Error('policy crash'))

    const emit = vi.fn()
    const project = makeProject(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    await routeRequest(request, project, undefined, emit)

    const errorEmit = emit.mock.calls.find((c: any) => c[0].message === 'policy:error:cheapest')
    expect(errorEmit).toBeDefined()
    expect(errorEmit![0].details.error).toBe('policy crash')
  })

  it('abstained policies: emits router:abstained and logs when all policies return uniform scores', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    // Both candidates get identical score → policy abstains
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.5 }, { model: 'm2', point: 0.5 }],
    })

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const emit = vi.fn()
    const project = makeProject(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    await routeRequest(request, project, log, emit)

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
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2'), makeModel('m3')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm2', point: 0.8 }, { model: 'm3', point: 0.4 }],
      excludes: ['m1'],
    })

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const emit = vi.fn()
    const project = makeProject(['m1', 'm2', 'm3'], [{ type: 'cheapest', enabled: true }])
    await routeRequest(request, project, log, emit)

    const excludesEmit = emit.mock.calls.find((c: any) => c[0].message === 'router:excludes')
    expect(excludesEmit).toBeDefined()
    expect(excludesEmit![0].details.excluded).toHaveProperty('m1')

    const excludesLog = log.info.mock.calls.find(
      (c: any) => c[1] === 'routing: models excluded by policies',
    )
    expect(excludesLog).toBeDefined()
  })

  it('long prompt is truncated in result entry (>120 chars)', async () => {
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.9 }, { model: 'm2', point: 0.1 }],
    })

    const longPrompt = 'A'.repeat(130)
    const project: ProjectConfig = {
      id: 'proj-1', name: 'Test', tokens: [], members: [],
      models: [
        { modelId: 'm1', prompt: longPrompt },
        { modelId: 'm2' },
      ],
      policies: [{ type: 'cheapest', enabled: true }],
    }

    const emit = vi.fn()
    await routeRequest(request, project, undefined, emit)

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
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.8 }, { model: 'm2', point: 0.4 }],
    })

    const project = makeProject(['m1', 'm2'], [
      { type: 'cheapest', enabled: true, config: null },
    ])
    const emit = vi.fn()
    // Should not throw even with null config
    await expect(routeRequest(request, project, undefined, emit)).resolves.toBeDefined()
  })

  it('policy with routing for excluded models only → eligible.length === 0 → abstain (line 237 true branch)', async () => {
    // m1 and m2 are candidates. Policy excludes m1. Policy also returns routing for m1
    // only (not m2). After exclusion, scoringCandidates = [m2].
    // eligible = routing entries filtered by scoringIds = [m2]. Since policy returned
    // routing only for m1 (now excluded), eligible.length === 0 → policy abstains.
    mockReadConfig.mockResolvedValue([makeModel('m1'), makeModel('m2')])
    mockIsAllowed.mockResolvedValue(true)
    mockCheapestPolicy.mockResolvedValue({
      routing: [{ model: 'm1', point: 0.9 }], // m1 will be excluded by policy
      excludes: ['m1'],
    })

    const project = makeProject(['m1', 'm2'], [{ type: 'cheapest', enabled: true }])
    const emit = vi.fn()
    const result = await routeRequest(request, project, undefined, emit)

    // m1 excluded, m2 is the only scoring candidate
    // Policy routing was only for m1 (excluded) → eligible=[]] → abstain
    // m2 gets default score 0.5
    expect(result.models[0]!.model).toBe('m2')

    // abstained should be emitted
    const abstainEmit = emit.mock.calls.find((c: any) => c[0].message === 'router:abstained')
    expect(abstainEmit).toBeDefined()
  })
})
