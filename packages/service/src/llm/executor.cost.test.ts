import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../providers/index.js', () => ({ getProviderAdapter: vi.fn() }))
vi.mock('../cost/budget.js', () => ({
  isAllowed: vi.fn().mockResolvedValue(true),
  isAllowedForRoutingModel: vi.fn().mockResolvedValue(true),
  getLimitUsageSnapshot: vi.fn().mockResolvedValue([]),
}))
vi.mock('../cost/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../notifications/emitter.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))

import { llmChat } from './executor.js'
import { getProviderAdapter } from '../providers/index.js'
import { calculateCost } from '../lib/cost.js'

const mockGetProvider = vi.mocked(getProviderAdapter)

afterEach(() => vi.clearAllMocks())

function makeModel() {
  return {
    id: 'm1', name: 'm1', provider: 'openai', endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 3, outputPerMillion: 15, cachePerMillion: 0.3, cacheWritePerMillion: 3.75 },
  } as any
}

function makeProject() {
  return { id: 'proj-1', name: 'Test', tokens: [], members: [], models: [{ modelId: 'm1' }], policies: [] } as any
}

function makeCtx(override: any = {}): any {
  return { projectId: 'proj-1', project: makeProject(), callType: 'completion' as const, ...override }
}

// If the old inline total (which omits cacheCreationInputTokens) were still present,
// the emitted totalCostUsd would differ from calculateCost and this test would fail.
describe('executor cost is computed by calculateCost (cache-creation aware)', () => {
  it('emits totalCostUsd equal to calculateCost for a cache-creation case', async () => {
    const model = makeModel()
    mockGetProvider.mockReturnValue({
      chatCompletion: vi.fn().mockResolvedValue({
        id: 'x', object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 100, cache_creation_tokens: 400 } },
      }),
    } as any)

    const emitted: any[] = []
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    await llmChat({ messages: [{ role: 'user', content: 'hi' }] } as any, model, ctx)

    const success = emitted.find((e) => e.message === 'model:success')
    const expected = calculateCost(1000, 200, model, 100, 400)
    expect(success?.details?.totalCostUsd).toBe(expected)
  })
})
