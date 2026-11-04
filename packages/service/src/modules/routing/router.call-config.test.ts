import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../budget/budget.js', () => ({ isAllowed: vi.fn(), getViolatedLimits: vi.fn() }))
vi.mock('./policies/cheapest.js', () => ({ cheapestPolicy: vi.fn() }))

import { routeRequest } from './router.js'
import { readConfig } from '../config/loader.js'
import { isAllowed } from '../budget/budget.js'
import { cheapestPolicy } from './policies/cheapest.js'
import { splitModelsIntoInstancesConnections } from '../../test-support/effective-models.js'
import type { CallConfig, ModelConfig, RouterConfig } from '@routerly/shared'

const mockReadConfig = vi.mocked(readConfig)

function mockWorld(models: ModelConfig[], profiles: unknown[] = []): void {
  const { instances, connections } = splitModelsIntoInstancesConnections(models)
  mockReadConfig.mockImplementation(async (key: string) => {
    if (key === 'connections') return connections as never
    if (key === 'instances') return instances as never
    if (key === 'profiles') return profiles as never
    return [] as never
  })
}

afterEach(() => { vi.clearAllMocks() })

const model = (id: string, provider: ModelConfig['provider']): ModelConfig => ({
  id, name: id, provider, endpoint: 'https://example.test/v1',
  cost: { inputPerMillion: 1, outputPerMillion: 3 },
})

const CC: CallConfig = { enabled: true, tiers: { low: { effort: 'low', maxOutputTokens: 200 }, high: { effort: 'high' } } }

const router = (ids: string[], extra: Partial<RouterConfig> = {}): RouterConfig => ({
  id: 'r1', name: 'R', tokens: [], members: [],
  models: ids.map(modelId => ({ modelId })),
  policies: [{ type: 'cheapest', enabled: true }],
  ...extra,
}) as RouterConfig

const request: any = { model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }
const callEntries = (trace: { message: string }[]) => trace.filter(t => t.message === 'router:call-config')

describe('routeRequest call configuration', () => {
  it('absent config: no decision, no trace entry', async () => {
    mockWorld([model('openai/gpt-5', 'openai'), model('openai/gpt-4o', 'openai')])
    vi.mocked(isAllowed).mockResolvedValue(true)
    vi.mocked(cheapestPolicy).mockResolvedValue({ routing: [{ model: 'openai/gpt-5', point: 1 }, { model: 'openai/gpt-4o', point: 0.5 }] })
    const res = await routeRequest(request, router(['openai/gpt-5', 'openai/gpt-4o']))
    expect(res.callDecision).toBeUndefined()
    expect(callEntries(res.trace as never)).toHaveLength(0)
  })

  it('enabled:false: no decision, no trace entry', async () => {
    mockWorld([model('openai/gpt-5', 'openai'), model('openai/gpt-4o', 'openai')])
    vi.mocked(isAllowed).mockResolvedValue(true)
    vi.mocked(cheapestPolicy).mockResolvedValue({ routing: [{ model: 'openai/gpt-5', point: 1 }, { model: 'openai/gpt-4o', point: 0.5 }] })
    const res = await routeRequest(request, router(['openai/gpt-5', 'openai/gpt-4o'], { callConfig: { ...CC, enabled: false } }))
    expect(res.callDecision).toBeUndefined()
    expect(callEntries(res.trace as never)).toHaveLength(0)
  })

  it('scored path: decision plus trace entry with per-model preview in ranked order', async () => {
    mockWorld([model('openai/gpt-5', 'openai'), model('openai/gpt-4o', 'openai')])
    vi.mocked(isAllowed).mockResolvedValue(true)
    vi.mocked(cheapestPolicy).mockResolvedValue({ routing: [{ model: 'openai/gpt-4o', point: 0.9 }, { model: 'openai/gpt-5', point: 0.2 }] })
    const emitted: { message: string }[] = []
    const res = await routeRequest(request, router(['openai/gpt-5', 'openai/gpt-4o'], { callConfig: CC }), undefined, e => emitted.push(e as never))
    expect(res.callDecision).toMatchObject({ tier: 'low', source: 'router' })
    const [entry] = callEntries(res.trace as never) as any[]
    expect(entry.panel).toBe('router-response')
    expect(emitted.filter(e => e.message === 'router:call-config')).toHaveLength(1)
    expect(entry.details.perModel.map((p: any) => p.model)).toEqual(res.models.map(m => m.model))
    const byId = Object.fromEntries(entry.details.perModel.map((p: any) => [p.model, p]))
    expect(byId['openai/gpt-5'].applied).toEqual({ effort: 'low', maxOutputTokens: 200 })
    expect(byId['openai/gpt-4o'].applied).toEqual({ maxOutputTokens: 200 })
    expect(byId['openai/gpt-4o'].skipped).toEqual([{ setting: 'effort', reason: 'unsupported' }])
  })

  it('bypass path (single model): decision and trace entry too', async () => {
    mockWorld([model('openai/gpt-5', 'openai')])
    vi.mocked(isAllowed).mockResolvedValue(true)
    const res = await routeRequest(request, router(['openai/gpt-5'], { callConfig: CC }))
    expect(res.callDecision?.tier).toBe('low')
    expect(callEntries(res.trace as never)).toHaveLength(1)
  })

  it('tier follows the request: a long prompt selects high', async () => {
    mockWorld([model('openai/gpt-5', 'openai')])
    vi.mocked(isAllowed).mockResolvedValue(true)
    const big = { model: 'auto', messages: [{ role: 'user', content: 'x'.repeat(16000 * 4) }] } as any
    const res = await routeRequest(big, router(['openai/gpt-5'], { callConfig: CC }))
    expect(res.callDecision).toMatchObject({ tier: 'high', desired: { effort: 'high' } })
  })

  it('a bound profile wins entirely over the router config (no field merge)', async () => {
    const profile = {
      id: 'p1', kind: 'routing', version: 1, label: 'P', builtin: false, baseId: 'auto',
      policies: [{ type: 'cheapest', enabled: true }],
      callConfig: { enabled: true, tiers: { low: { verbosity: 'low' } } },
    }
    mockWorld([model('openai/gpt-5', 'openai')], [profile])
    vi.mocked(isAllowed).mockResolvedValue(true)
    const res = await routeRequest(request, router(['openai/gpt-5'], { callConfig: CC, routingProfileId: 'p1' }))
    expect(res.callDecision).toMatchObject({ source: 'profile', desired: { verbosity: 'low' } })
    expect(res.callDecision!.desired).not.toHaveProperty('effort')
  })

  it('a bound profile without callConfig disables it even if the router has one', async () => {
    const profile = { id: 'p2', kind: 'routing', version: 1, label: 'P', builtin: false, baseId: 'auto', policies: [] }
    mockWorld([model('openai/gpt-5', 'openai')], [profile])
    vi.mocked(isAllowed).mockResolvedValue(true)
    const res = await routeRequest(request, router(['openai/gpt-5'], { callConfig: CC, routingProfileId: 'p2' }))
    expect(res.callDecision).toBeUndefined()
  })

  it('never mutates the request', async () => {
    mockWorld([model('openai/gpt-5', 'openai')])
    vi.mocked(isAllowed).mockResolvedValue(true)
    const before = JSON.stringify(request)
    await routeRequest(request, router(['openai/gpt-5'], { callConfig: CC }))
    expect(JSON.stringify(request)).toBe(before)
  })
})
