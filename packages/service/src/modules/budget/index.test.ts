import { describe, it, expect, vi, afterEach } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { BUDGET, PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'

vi.mock('./budget.js', () => ({
  isAllowed: vi.fn(),
  getViolatedLimits: vi.fn(),
  getLimitUsageSnapshot: vi.fn(),
}))

import { isAllowed, getViolatedLimits, getLimitUsageSnapshot } from './budget.js'
import { budgetModule } from './index.js'

const mockIsAllowed = vi.mocked(isAllowed)
const mockGetViolatedLimits = vi.mocked(getViolatedLimits)

afterEach(() => vi.resetAllMocks())

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  return { container, events }
}

async function upstreamProcessor() {
  const { container, events } = harness()
  await budgetModule.register({ container, events })
  return container.resolve(PROXY_PIPELINE).orderedFor('upstream.prepare')[0]!
}

function ctxOf(emit: ReturnType<typeof vi.fn>): ProxyContext {
  return {
    router: { id: 'p1', models: [] },
    attempt: { model: { id: 'gpt-4o' } },
    emit,
  } as unknown as ProxyContext
}

describe('budget module', () => {
  it('registers BUDGET with the real functions', async () => {
    const { container, events } = harness()
    await budgetModule.register({ container, events })
    const b = container.resolve(BUDGET)
    expect(b.isAllowed).toBe(isAllowed)
    expect(b.getViolatedLimits).toBe(getViolatedLimits)
    expect(b.getLimitUsageSnapshot).toBe(getLimitUsageSnapshot)
  })

  it('contributes budget.upstream to the upstream.prepare phase', async () => {
    const { container, events } = harness()
    await budgetModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    expect(pipeline.orderedFor('upstream.prepare').map((p) => p.id)).toEqual(['budget.upstream'])
  })

  it('traces an allowed candidate without paying for the violated-limit lookup', async () => {
    mockIsAllowed.mockResolvedValue(true)
    const proc = await upstreamProcessor()
    const emit = vi.fn()
    const ctx = ctxOf(emit)
    await proc.run(ctx)
    expect(mockGetViolatedLimits).not.toHaveBeenCalled()
    expect(ctx.attempt).toBeDefined()
    expect(emit.mock.calls[0]![0]).toMatchObject({
      panel: 'request', message: 'budget:checked', details: { model: 'gpt-4o', allowed: true },
    })
    expect(emit.mock.calls[0]![0].details.violated).toBeUndefined()
  })

  it('says which limit dropped a candidate, instead of dropping it silently', async () => {
    mockIsAllowed.mockResolvedValue(false)
    mockGetViolatedLimits.mockResolvedValue([
      { metric: 'cost', window: 'daily', value: 10, current: 12.5, remaining: -2.5 },
    ])
    const proc = await upstreamProcessor()
    const emit = vi.fn()
    const ctx = ctxOf(emit)
    await proc.run(ctx)
    expect(ctx.attempt).toBeUndefined()
    expect(emit.mock.calls[0]![0]).toMatchObject({
      message: 'budget:checked',
      details: {
        model: 'gpt-4o', allowed: false,
        violated: [{ metric: 'cost', window: 'daily', limit: 10, current: 12.5 }],
      },
    })
  })

  it('emits nothing when there is no candidate to check', async () => {
    const proc = await upstreamProcessor()
    const emit = vi.fn()
    await proc.run({ emit } as unknown as ProxyContext)
    expect(emit).not.toHaveBeenCalled()
  })
})
