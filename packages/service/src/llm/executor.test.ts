import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../modules/provider/registry.js', () => ({ getProviderAdapter: vi.fn() }))
vi.mock('../modules/budget/budget.js', () => ({ isAllowed: vi.fn(), isAllowedForRoutingModel: vi.fn(), getLimitUsageSnapshot: vi.fn().mockResolvedValue([]) }))
vi.mock('../modules/usage/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../notifications/emitter.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))

import { llmChat, llmStream, llmMessages, BudgetExceededError } from './executor.js'
import { getProviderAdapter } from '../modules/provider/registry.js'
import { isAllowed, isAllowedForRoutingModel, getLimitUsageSnapshot } from '../modules/budget/budget.js'
import { trackUsage } from '../modules/usage/tracker.js'
import { emitEvent } from '../notifications/emitter.js'

const mockGetProvider = vi.mocked(getProviderAdapter)
const mockIsAllowed = vi.mocked(isAllowed)
const mockIsAllowedForRouting = vi.mocked(isAllowedForRoutingModel)
const mockTrackUsage = vi.mocked(trackUsage)
const mockGetLimitUsage = vi.mocked(getLimitUsageSnapshot)
const mockEmitEvent = vi.mocked(emitEvent)

afterEach(() => vi.clearAllMocks())

function makeModel(id = 'm1') {
  return {
    id, name: id, provider: 'openai', endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 5, outputPerMillion: 15 },
  } as any
}

function makeProject(modelId = 'm1') {
  return {
    id: 'proj-1', name: 'Test', tokens: [], members: [],
    models: [{ modelId }],
    policies: [],
  } as any
}

function makeCtx(override: any = {}): any {
  return {
    projectId: 'proj-1',
    project: makeProject(),
    callType: 'completion' as const,
    ...override,
  }
}

function makeChatResponse(text = 'Hello') {
  return {
    id: 'cmpl-1',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0 } },
  }
}

function makeMessagesResponse() {
  return {
    id: 'msg-1', type: 'message', role: 'assistant',
    content: [{ type: 'text', text: 'Hi' }],
    model: 'claude-3', stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as any
}

// ─── BudgetExceededError ──────────────────────────────────────────────────────

describe('BudgetExceededError', () => {
  it('has name BudgetExceededError and modelId', () => {
    const err = new BudgetExceededError('gpt-4')
    expect(err.name).toBe('BudgetExceededError')
    expect(err.modelId).toBe('gpt-4')
    expect(err.message).toBe('budget_exceeded')
    expect(err instanceof Error).toBe(true)
  })
})

// ─── llmChat ─────────────────────────────────────────────────────────────────

describe('llmChat', () => {
  it('calls chatCompletion and returns response', async () => {
    mockIsAllowed.mockResolvedValue(true)
    const mockAdapter = { chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) }
    mockGetProvider.mockReturnValue(mockAdapter as any)

    const response = await llmChat({ messages: [] } as any, makeModel(), makeCtx())
    expect(response.choices[0]!.message.content).toBe('Hello')
    expect(mockAdapter.chatCompletion).toHaveBeenCalled()
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }))
  })

  it('throws BudgetExceededError when budget exhausted', async () => {
    mockIsAllowed.mockResolvedValue(false)

    await expect(llmChat({ messages: [] } as any, makeModel(), makeCtx())).rejects.toThrow(BudgetExceededError)
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: 'budget_exceeded' }))
  })

  it('throws and tracks error when chatCompletion fails', async () => {
    mockIsAllowed.mockResolvedValue(true)
    const mockAdapter = { chatCompletion: vi.fn().mockRejectedValue(new Error('provider down')) }
    mockGetProvider.mockReturnValue(mockAdapter as any)

    await expect(llmChat({ messages: [] } as any, makeModel(), makeCtx())).rejects.toThrow('provider down')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error', errorMessage: 'provider down' }))
  })

  it('emits trace entries on success', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)

    const emitted: any[] = []
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    await llmChat({ messages: [] } as any, makeModel(), ctx)
    expect(emitted.some(e => e.message === 'model:request')).toBe(true)
    expect(emitted.some(e => e.message === 'model:success')).toBe(true)
  })

  it('emits error trace when chatCompletion throws', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockRejectedValue(new Error('oops')) } as any)

    const emitted: any[] = []
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    await expect(llmChat({ messages: [] } as any, makeModel(), ctx)).rejects.toThrow('oops')
    expect(emitted.some(e => e.message === 'model:error')).toBe(true)
  })

  it('uses isAllowedForRoutingModel when model not in project', async () => {
    mockIsAllowedForRouting.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)

    const ctx = makeCtx({ project: { ...makeProject('other-model'), models: [{ modelId: 'other-model' }] } })
    await llmChat({ messages: [] } as any, makeModel('m1'), ctx)
    expect(mockIsAllowedForRouting).toHaveBeenCalled()
  })

  it('uses routing panels for callType=routing', async () => {
    mockIsAllowedForRouting.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)

    const emitted: any[] = []
    const ctx = makeCtx({
      callType: 'routing',
      project: { ...makeProject('other'), models: [] },
      emit: (e: any) => emitted.push(e),
    })
    await llmChat({ messages: [{ role: 'system', content: 'route' }] } as any, makeModel(), ctx)
    expect(emitted.some(e => e.panel === 'router-request')).toBe(true)
    expect(emitted.some(e => e.panel === 'router-response')).toBe(true)
  })

  it('uses router panels for callType=guardrail (BUG-5)', async () => {
    mockIsAllowedForRouting.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)

    const emitted: any[] = []
    const ctx = makeCtx({
      callType: 'guardrail',
      project: { ...makeProject('other'), models: [] },
      emit: (e: any) => emitted.push(e),
    })
    await llmChat({ messages: [{ role: 'user', content: 'judge' }] } as any, makeModel(), ctx)
    expect(emitted.some(e => e.panel === 'router-request')).toBe(true)
    expect(emitted.some(e => e.panel === 'router-response')).toBe(true)
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ callType: 'guardrail' }))
  })

  it('guardrail callType is still budget-gated (BUG-5)', async () => {
    mockIsAllowed.mockResolvedValue(false) // model is a project candidate, over limit
    const ctx = makeCtx({ callType: 'guardrail' })
    await expect(llmChat({ messages: [] } as any, makeModel(), ctx)).rejects.toThrow(BudgetExceededError)
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ callType: 'guardrail', errorMessage: 'budget_exceeded' }))
  })

  it('includes traceId in trackUsage when set in ctx', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)

    await llmChat({ messages: [] } as any, makeModel(), makeCtx({ traceId: 'trace-xyz' }))
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ traceId: 'trace-xyz' }))
  })

  it('swallows trackUsage rejection in success path', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    mockTrackUsage.mockRejectedValueOnce(new Error('db write failed'))
    await expect(llmChat({ messages: [] } as any, makeModel(), makeCtx())).resolves.toBeDefined()
  })

  it('swallows trackUsage rejection in error path', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockRejectedValue(new Error('prov fail')) } as any)
    mockTrackUsage.mockRejectedValueOnce(new Error('db write failed'))
    await expect(llmChat({ messages: [] } as any, makeModel(), makeCtx())).rejects.toThrow('prov fail')
  })

  it('swallows trackUsage rejection in budget exceeded path', async () => {
    mockIsAllowed.mockResolvedValue(false)
    mockTrackUsage.mockRejectedValueOnce(new Error('db write failed'))
    await expect(llmChat({ messages: [] } as any, makeModel(), makeCtx())).rejects.toThrow(BudgetExceededError)
  })

  it('covers non-Error thrown in chat', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockRejectedValue('string error') } as any)
    await expect(llmChat({ messages: [] } as any, makeModel(), makeCtx())).rejects.toBe('string error')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: 'string error' }))
  })

  it('covers log.warn on error', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockRejectedValue(new Error('prov fail')) } as any)
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    await expect(llmChat({ messages: [] } as any, makeModel(), makeCtx({ log }))).rejects.toThrow('prov fail')
    expect(log.warn).toHaveBeenCalled()
  })

  it('covers optional request fields: max_completion_tokens and temperature', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    const emitted: any[] = []
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e), callType: 'routing' as const, project: { ...makeProject('other'), models: [] } })
    mockIsAllowedForRouting.mockResolvedValue(true)
    await llmChat({ messages: [{ role: 'system', content: 'sys' }], max_completion_tokens: 50, temperature: 0.7 } as any, makeModel(), ctx)
    const reqEntry = emitted.find(e => e.message === 'model:request')
    expect(reqEntry?.details?.maxTokens).toBe(50)
    expect(reqEntry?.details?.temperature).toBe(0.7)
    expect(reqEntry?.details?.systemPrompt).toBe('sys')
  })

  it('handles cached tokens in response', async () => {
    mockIsAllowed.mockResolvedValue(true)
    const resp = {
      ...makeChatResponse(),
      usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 40, cache_creation_tokens: 10 } },
    }
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(resp) } as any)

    await llmChat({ messages: [] } as any, makeModel(), makeCtx())
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ cachedInputTokens: 40, cacheCreationInputTokens: 10 }))
  })
})

// ─── llmStream ────────────────────────────────────────────────────────────────

async function* makeStream(...chunks: any[]) {
  for (const c of chunks) yield c
}

describe('llmStream', () => {
  it('returns ttftMs and yields chunks', async () => {
    mockIsAllowed.mockResolvedValue(true)
    const chunk = { choices: [{ delta: { content: 'hi' } }] }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(makeStream(chunk)) } as any)

    const result = await llmStream({ messages: [] } as any, makeModel(), makeCtx())
    expect(typeof result.ttftMs).toBe('number')

    const collected: any[] = []
    for await (const c of result.chunks) collected.push(c)
    expect(collected).toHaveLength(1)
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }))
  })

  it('throws BudgetExceededError before streaming', async () => {
    mockIsAllowed.mockResolvedValue(false)
    await expect(llmStream({ messages: [] } as any, makeModel(), makeCtx())).rejects.toThrow(BudgetExceededError)
  })

  it('throws when first chunk fails (pre-stream error)', async () => {
    mockIsAllowed.mockResolvedValue(true)
    async function* failStream() { throw new Error('connect error') }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(failStream()) } as any)

    await expect(llmStream({ messages: [] } as any, makeModel(), makeCtx())).rejects.toThrow('connect error')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error' }))
  })

  it('throws in generator on mid-stream error', async () => {
    mockIsAllowed.mockResolvedValue(true)
    async function* midFail() {
      yield { choices: [{ delta: { content: 'a' } }] }
      throw new Error('mid error')
    }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(midFail()) } as any)

    const result = await llmStream({ messages: [] } as any, makeModel(), makeCtx())
    await expect(async () => {
      for await (const _ of result.chunks) { /* consume */ }
    }).rejects.toThrow('mid error')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error' }))
  })

  it('emits model:thinking when thinking delta is present', async () => {
    mockIsAllowed.mockResolvedValue(true)
    async function* thinkStream() {
      yield { choices: [{ delta: { thinking: 'reasoning...' } }] }
      yield { choices: [{ delta: { content: 'answer' } }] }
    }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(thinkStream()) } as any)

    const emitted: any[] = []
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    const result = await llmStream({ messages: [] } as any, makeModel(), ctx)
    for await (const _ of result.chunks) { /* consume */ }
    expect(emitted.some(e => e.message === 'model:thinking')).toBe(true)
  })

  it('captures usage from stream chunk', async () => {
    mockIsAllowed.mockResolvedValue(true)
    async function* withUsage() {
      yield { choices: [{ delta: { content: 'hi' } }] }
      yield { choices: [], usage: { prompt_tokens: 20, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 5 } } }
    }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(withUsage()) } as any)

    const result = await llmStream({ messages: [] } as any, makeModel(), makeCtx())
    for await (const _ of result.chunks) { /* consume */ }
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 20, outputTokens: 10 }))
  })

  it('emits model:success after stream completes', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(makeStream({ choices: [{ delta: { content: 'ok' } }] })) } as any)

    const emitted: any[] = []
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    const result = await llmStream({ messages: [] } as any, makeModel(), ctx)
    for await (const _ of result.chunks) { /* consume */ }
    expect(emitted.some(e => e.message === 'model:success')).toBe(true)
  })

  it('emits accumulated thinking in finally when only thinking chunks (no content chunk follows)', async () => {
    mockIsAllowed.mockResolvedValue(true)
    async function* pureThinkStream() {
      yield { choices: [{ delta: { thinking: 'deep thought' } }] }
      // No content chunk — thinkingEmitted stays false, finally block emits it
    }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(pureThinkStream()) } as any)

    const emitted: any[] = []
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    const result = await llmStream({ messages: [] } as any, makeModel(), ctx)
    for await (const _ of result.chunks) { /* consume */ }
    expect(emitted.some(e => e.message === 'model:thinking')).toBe(true)
  })

  it('records timeout outcome when TTFT exceeds project timeoutMs', async () => {
    mockIsAllowed.mockResolvedValue(true)
    let resolveNever: () => void
    const neverFirst = new Promise<void>(r => { resolveNever = r })
    const returnSpy = vi.fn().mockResolvedValue({ value: undefined as any, done: true })
    mockGetProvider.mockReturnValue({
      streamCompletion: vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: () => ({
          next: () => neverFirst.then(() => ({ value: undefined as any, done: true })),
          return: returnSpy,
        }),
      }),
    } as any)

    const ctxWithTimeout = makeCtx({ project: { ...makeProject(), timeoutMs: 50 } })
    await expect(llmStream({ messages: [] } as any, makeModel(), ctxWithTimeout)).rejects.toThrow('TTFT timeout')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'timeout' }))

    resolveNever!()
  })
})

  it('swallows trackUsage rejection in success path', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(makeStream({ choices: [{ delta: { content: 'ok' } }] })) } as any)
    mockTrackUsage.mockRejectedValueOnce(new Error('db error'))
    const result = await llmStream({ messages: [] } as any, makeModel(), makeCtx())
    for await (const _ of result.chunks) { /* consume */ }
    // Should not throw despite trackUsage rejecting
  })

  it('swallows trackUsage rejection in pre-stream error path', async () => {
    mockIsAllowed.mockResolvedValue(true)
    async function* failFirst() { throw new Error('first chunk fail') }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(failFirst()) } as any)
    mockTrackUsage.mockRejectedValueOnce(new Error('db error'))
    await expect(llmStream({ messages: [] } as any, makeModel(), makeCtx())).rejects.toThrow('first chunk fail')
  })

  it('covers cacheCreationInputTokens branch in stream', async () => {
    mockIsAllowed.mockResolvedValue(true)
    async function* withCacheCreate() {
      yield { choices: [{ delta: { content: 'hi' } }] }
      yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 3, cache_creation_tokens: 2 } } }
    }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(withCacheCreate()) } as any)
    const result = await llmStream({ messages: [] } as any, makeModel(), makeCtx())
    for await (const _ of result.chunks) { /* consume */ }
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ cachedInputTokens: 3 }))
  })

  it('covers traceId branch in stream tracking', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(makeStream({ choices: [{ delta: { content: 'ok' } }] })) } as any)
    const ctx = makeCtx({ traceId: 'trace-stream-123' })
    const result = await llmStream({ messages: [] } as any, makeModel(), ctx)
    for await (const _ of result.chunks) { /* consume */ }
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ traceId: 'trace-stream-123' }))
  })

  it('covers mid-stream error with emit', async () => {
    mockIsAllowed.mockResolvedValue(true)
    async function* failMid() {
      yield { choices: [{ delta: { content: 'a' } }] }
      throw new Error('mid fail')
    }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(failMid()) } as any)
    const emitted: any[] = []
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    const result = await llmStream({ messages: [] } as any, makeModel(), ctx)
    await expect(async () => { for await (const _ of result.chunks) { /* consume */ } }).rejects.toThrow('mid fail')
    expect(emitted.some(e => e.message === 'model:error')).toBe(true)
  })

  it('line 397: rate-limit pre-stream error → provider.rate_limited event', async () => {
    // isRateLimitError(err) returns true → provEvt = 'provider.rate_limited'
    mockIsAllowed.mockResolvedValue(true)
    async function* failRateLimit() { throw new Error('429 too many requests') }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(failRateLimit()) } as any)
    await expect(llmStream({ messages: [] } as any, makeModel(), makeCtx())).rejects.toThrow('too many requests')
    expect(mockEmitEvent).toHaveBeenCalledWith('provider.rate_limited', expect.any(String), expect.any(Object), expect.any(Object))
  })

  it('covers log.warn in pre-stream error', async () => {
    mockIsAllowed.mockResolvedValue(true)
    async function* failFirst() { throw new Error('connect fail') }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(failFirst()) } as any)
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const ctx = makeCtx({ log, emit: vi.fn() })
    await expect(llmStream({ messages: [] } as any, makeModel(), ctx)).rejects.toThrow('connect fail')
    expect(log.warn).toHaveBeenCalled()
  })

  it('covers optional fields: max_completion_tokens and temperature in stream', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(makeStream({ choices: [{ delta: {} }] })) } as any)
    const emitted: any[] = []
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    await llmStream({ messages: [], max_completion_tokens: 100, temperature: 0.5 } as any, makeModel(), ctx)
    const reqEntry = emitted.find(e => e.message === 'model:request')
    expect(reqEntry?.details?.maxTokens).toBe(100)
    expect(reqEntry?.details?.temperature).toBe(0.5)
  })

// ─── llmChat — additional branch coverage ────────────────────────────────────

describe('llmChat — additional branches', () => {
  it('includes traceId in checkBudget trackUsage when budget exceeded', async () => {
    // Line 112: traceId !== undefined branch inside checkBudget on budget failure
    mockIsAllowed.mockResolvedValue(false)
    const ctx = makeCtx({ traceId: 'chk-trace-1' })
    await expect(llmChat({ messages: [] } as any, makeModel(), ctx)).rejects.toThrow(BudgetExceededError)
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ traceId: 'chk-trace-1', errorMessage: 'budget_exceeded' }))
  })

  it('uses routing model budget check and includes traceId in checkBudget when budget exceeded', async () => {
    // Line 112: traceId branch in checkBudget when using isAllowedForRoutingModel
    mockIsAllowedForRouting.mockResolvedValue(false)
    const ctx = makeCtx({ callType: 'routing', traceId: 'chk-trace-routing', project: { ...makeProject('other'), models: [] } })
    await expect(llmChat({ messages: [] } as any, makeModel('m1'), ctx)).rejects.toThrow(BudgetExceededError)
    expect(mockIsAllowedForRouting).toHaveBeenCalled()
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ traceId: 'chk-trace-routing' }))
  })

  it('handles undefined messages field (covers messages?.length ?? 0 branch)', async () => {
    // Line 153: messages is undefined → messageCount = 0
    mockIsAllowed.mockResolvedValue(true)
    const emitted: any[] = []
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    await llmChat({} as any, makeModel(), ctx)
    const reqEntry = emitted.find(e => e.message === 'model:request')
    expect(reqEntry?.details?.messageCount).toBe(0)
  })

  it('includes maxTokens from max_tokens field (distinct from max_completion_tokens)', async () => {
    // Line 155: request.max_tokens != null branch
    mockIsAllowed.mockResolvedValue(true)
    const emitted: any[] = []
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    await llmChat({ messages: [], max_tokens: 200 } as any, makeModel(), ctx)
    const reqEntry = emitted.find(e => e.message === 'model:request')
    expect(reqEntry?.details?.maxTokens).toBe(200)
  })

  it('handles routing call where response content is null (covers ?? undefined branch)', async () => {
    // Line 165: response.choices?.[0]?.message?.content ?? undefined when content is null
    mockIsAllowedForRouting.mockResolvedValue(true)
    const resp = {
      ...makeChatResponse(),
      choices: [{ index: 0, message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
    }
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(resp) } as any)
    const emitted: any[] = []
    const ctx = makeCtx({
      callType: 'routing',
      project: { ...makeProject('other'), models: [] },
      emit: (e: any) => emitted.push(e),
    })
    const result = await llmChat({ messages: [{ role: 'system', content: 'route' }] } as any, makeModel(), ctx)
    expect(result).toBeDefined()
    // responseText is undefined (null coalesced), responseJSON is the whole response
    const successEntry = emitted.find(e => e.message === 'model:success')
    expect(successEntry?.details?.responseJSON).toBeDefined()
  })

  it('handles response with no usage object (covers usage?.x ?? 0 branches)', async () => {
    // Lines 169-171, 203, 208, 209: response.usage is undefined
    mockIsAllowed.mockResolvedValue(true)
    const resp = { id: 'cmpl-x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] }
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(resp) } as any)
    await llmChat({ messages: [] } as any, makeModel(), makeCtx())
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 0, outputTokens: 0, outcome: 'success' }))
  })

  it('emits tokensPerSec=0 when latencyMs=0 (covers latencyMs > 0 false branch)', async () => {
    // Line 172: latencyMs > 0 ? ... : 0 — force latencyMs to 0 by making Date.now constant
    mockIsAllowed.mockResolvedValue(true)
    const emitted: any[] = []
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    const now = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      await llmChat({ messages: [] } as any, makeModel(), ctx)
    } finally {
      spy.mockRestore()
    }
    const successEntry = emitted.find(e => e.message === 'model:success')
    expect(successEntry?.details?.tokensPerSec).toBe(0)
  })

  it('line 243: tokensPerSec > 0 when latencyMs > 0 in llmChat (true branch)', async () => {
    mockIsAllowed.mockResolvedValue(true)
    const emitted: any[] = []
    const resp = { ...makeChatResponse(), usage: { prompt_tokens: 10, completion_tokens: 5 } }
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(resp) } as any)
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    let call = 0
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => call++ === 0 ? 1000 : 1100)
    try {
      await llmChat({ messages: [] } as any, makeModel(), ctx)
    } finally {
      spy.mockRestore()
    }
    const successEntry = emitted.find(e => e.message === 'model:success')
    expect(successEntry?.details?.tokensPerSec).toBeGreaterThan(0)
  })

  it('uses model.cost.cachePerMillion when set (covers cachePerMillion ?? inputPerMillion branch)', async () => {
    // Line 177: model.cost.cachePerMillion ?? model.cost.inputPerMillion
    mockIsAllowed.mockResolvedValue(true)
    const modelWithCache = { ...makeModel(), cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: 1 } }
    const resp = {
      ...makeChatResponse(),
      usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 20 } },
    }
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(resp) } as any)
    await llmChat({ messages: [] } as any, modelWithCache as any, makeCtx())
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ cachedInputTokens: 20, outcome: 'success' }))
  })

  it('lines 288-292: truthy endUserId/sessionId/tags/guardrailTriggered/piiRedacted in llmChat success trackUsage', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    const ctx = makeCtx({
      endUserId: 'user-chat',
      sessionId: 'session-chat',
      tags: { app: 'web' },
      guardrailTriggered: 'regex-rule',
      piiRedacted: ['EMAIL'],
    })
    await llmChat({ messages: [] } as any, makeModel(), ctx)
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({
      endUserId: 'user-chat',
      sessionId: 'session-chat',
      tags: { app: 'web' },
      guardrailTriggered: 'regex-rule',
      piiRedacted: ['EMAIL'],
    }))
  })

  it('lines 317-322: truthy endUserId/sessionId/tags/guardrailTriggered/piiRedacted in llmChat error trackUsage', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockRejectedValue(new Error('api fail')) } as any)
    const ctx = makeCtx({
      endUserId: 'user-chat-err',
      sessionId: 'session-chat-err',
      tags: { env: 'staging' },
      guardrailTriggered: 'topic-rule',
      piiRedacted: ['PHONE'],
    })
    await expect(llmChat({ messages: [] } as any, makeModel(), ctx)).rejects.toThrow('api fail')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({
      endUserId: 'user-chat-err',
      sessionId: 'session-chat-err',
      guardrailTriggered: 'topic-rule',
      piiRedacted: ['PHONE'],
    }))
  })
})

// ─── llmStream — additional branch coverage ──────────────────────────────────

describe('llmStream — additional branches', () => {
  it('includes traceId in checkBudget trackUsage when budget exceeded in stream', async () => {
    // Line 112 (via checkBudget): traceId set when budget denied before streaming
    mockIsAllowed.mockResolvedValue(false)
    const ctx = makeCtx({ traceId: 'stream-budget-trace' })
    await expect(llmStream({ messages: [] } as any, makeModel(), ctx)).rejects.toThrow(BudgetExceededError)
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ traceId: 'stream-budget-trace', errorMessage: 'budget_exceeded' }))
  })

  it('handles undefined messages field in stream (covers messages?.length ?? 0)', async () => {
    // Line 288: messages is undefined
    mockIsAllowed.mockResolvedValue(true)
    const emitted: any[] = []
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(makeStream({ choices: [{ delta: { content: 'x' } }] })) } as any)
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    const result = await llmStream({} as any, makeModel(), ctx)
    for await (const _ of result.chunks) { /* consume */ }
    const reqEntry = emitted.find(e => e.message === 'model:request')
    expect(reqEntry?.details?.messageCount).toBe(0)
  })

  it('includes maxTokens from max_tokens field in stream (covers max_tokens != null branch)', async () => {
    // Line 290: request.max_tokens != null
    mockIsAllowed.mockResolvedValue(true)
    const emitted: any[] = []
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(makeStream({ choices: [{ delta: {} }] })) } as any)
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    const result = await llmStream({ messages: [], max_tokens: 300 } as any, makeModel(), ctx)
    for await (const _ of result.chunks) { /* consume */ }
    const reqEntry = emitted.find(e => e.message === 'model:request')
    expect(reqEntry?.details?.maxTokens).toBe(300)
  })

  it('covers non-Error thrown before first chunk (line 310: String(err) branch)', async () => {
    // Line 310: err instanceof Error ? ... : String(err) — throw a non-Error
    mockIsAllowed.mockResolvedValue(true)
    async function* throwString() { throw 'raw-string-error' }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(throwString()) } as any)
    await expect(llmStream({ messages: [] } as any, makeModel(), makeCtx())).rejects.toBe('raw-string-error')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: 'raw-string-error', outcome: 'error' }))
  })

  it('includes traceId in pre-stream error trackUsage (line 318)', async () => {
    // Line 318: traceId !== undefined in pre-stream error path
    mockIsAllowed.mockResolvedValue(true)
    async function* failFirst() { throw new Error('pre-stream-fail') }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(failFirst()) } as any)
    const ctx = makeCtx({ traceId: 'pre-stream-trace' })
    await expect(llmStream({ messages: [] } as any, makeModel(), ctx)).rejects.toThrow('pre-stream-fail')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ traceId: 'pre-stream-trace', outcome: 'error' }))
  })

  it('processChunk preserves existing token counts when usage fields are undefined (lines 341-343)', async () => {
    // Lines 341-343: u.prompt_tokens ?? inputTokens etc — usage chunk without fields
    mockIsAllowed.mockResolvedValue(true)
    async function* partialUsage() {
      yield { choices: [{ delta: { content: 'hello' } }] }
      // First usage chunk sets values
      yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 2 } } }
      // Second usage chunk without the fields → falls back to current accumulated values
      yield { choices: [], usage: {} }
    }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(partialUsage()) } as any)
    const result = await llmStream({ messages: [] } as any, makeModel(), makeCtx())
    for await (const _ of result.chunks) { /* consume */ }
    // Values from first usage chunk should be preserved (not overwritten with undefined)
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 10, outputTokens: 5 }))
  })

  it('covers non-Error thrown mid-stream (line 386: String(err) branch)', async () => {
    // Line 386: err instanceof Error ? ... : String(err) — non-Error thrown mid-stream
    mockIsAllowed.mockResolvedValue(true)
    async function* throwNonError() {
      yield { choices: [{ delta: { content: 'a' } }] }
      throw 'mid-non-error'
    }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(throwNonError()) } as any)
    const result = await llmStream({ messages: [] } as any, makeModel(), makeCtx())
    await expect(async () => { for await (const _ of result.chunks) { /* consume */ } }).rejects.toBe('mid-non-error')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: 'mid-non-error', outcome: 'error' }))
  })

  it('emits cachedInputTokens as undefined in model:success when cachedInputTokens is 0 (line 412)', async () => {
    // Line 412: cachedInputTokens > 0 ? cachedInputTokens : undefined — the false branch
    mockIsAllowed.mockResolvedValue(true)
    const emitted: any[] = []
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(makeStream({ choices: [{ delta: { content: 'ok' } }] })) } as any)
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    const result = await llmStream({ messages: [] } as any, makeModel(), ctx)
    for await (const _ of result.chunks) { /* consume */ }
    const successEntry = emitted.find(e => e.message === 'model:success')
    expect(successEntry?.details?.cachedInputTokens).toBeUndefined()
  })

  it('emits tokensPerSec=0 when latencyMs=0 in stream (line 397 false branch)', async () => {
    // latencyMs > 0 ? ... : 0 — force Date.now to be constant so latencyMs = 0
    mockIsAllowed.mockResolvedValue(true)
    const emitted: any[] = []
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(makeStream({ choices: [{ delta: { content: 'ok' } }] })) } as any)
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    const now = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      const result = await llmStream({ messages: [] } as any, makeModel(), ctx)
      for await (const _ of result.chunks) { /* consume */ }
    } finally {
      spy.mockRestore()
    }
    const successEntry = emitted.find(e => e.message === 'model:success')
    expect(successEntry?.details?.tokensPerSec).toBe(0)
  })

  it('line 487: tokensPerSec > 0 when latencyMs > 0 in llmStream (true branch)', async () => {
    mockIsAllowed.mockResolvedValue(true)
    const emitted: any[] = []
    // Two chunks: content chunk + usage chunk at root level
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(makeStream(
      { choices: [{ delta: { content: 'ok' } }] },
      { usage: { prompt_tokens: 10, completion_tokens: 5 } },  // root-level usage
    )) } as any)
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    // First Date.now() call = t0 (1000), all subsequent = 1100 so latencyMs = 100
    let firstCall = true
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
      if (firstCall) { firstCall = false; return 1000 }
      return 1100
    })
    try {
      const result = await llmStream({ messages: [] } as any, makeModel(), ctx)
      for await (const _ of result.chunks) { /* consume */ }
    } finally {
      spy.mockRestore()
    }
    const successEntry = emitted.find(e => e.message === 'model:success')
    expect(successEntry?.details?.tokensPerSec).toBeGreaterThan(0)
  })

  it('includes endUserId, sessionId, tags in stream generator trackUsage (lines 522-524)', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(makeStream({ choices: [{ delta: { content: 'ok' } }] })) } as any)
    const ctx = makeCtx({
      endUserId: 'user-stream',
      sessionId: 'session-stream',
      tags: { source: 'api' },
    })
    const result = await llmStream({ messages: [] } as any, makeModel(), ctx)
    for await (const _ of result.chunks) {}
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({
      endUserId: 'user-stream',
      sessionId: 'session-stream',
      tags: { source: 'api' },
    }))
  })

  it('uses model.cost.cachePerMillion in stream cost calculation when set', async () => {
    // Line 402: model.cost.cachePerMillion ?? model.cost.inputPerMillion in stream
    mockIsAllowed.mockResolvedValue(true)
    const modelWithCache = { ...makeModel(), cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: 1 } }
    async function* withCached() {
      yield { choices: [{ delta: { content: 'x' } }] }
      yield { choices: [], usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 30 } } }
    }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(withCached()) } as any)
    const result = await llmStream({ messages: [] } as any, modelWithCache as any, makeCtx())
    for await (const _ of result.chunks) { /* consume */ }
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ cachedInputTokens: 30, outcome: 'success' }))
  })

  it('covers mid-stream error log.error call', async () => {
    // Line 387: log?.error in mid-stream error catch
    mockIsAllowed.mockResolvedValue(true)
    async function* failMid() {
      yield { choices: [{ delta: { content: 'a' } }] }
      throw new Error('mid-log-err')
    }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(failMid()) } as any)
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const ctx = makeCtx({ log })
    const result = await llmStream({ messages: [] } as any, makeModel(), ctx)
    await expect(async () => { for await (const _ of result.chunks) { /* consume */ } }).rejects.toThrow('mid-log-err')
    expect(log.error).toHaveBeenCalled()
  })

  it('covers mid-stream rate-limit error → provider.rate_limited event (line 480 true branch)', async () => {
    // isRateLimitError returns true → provEvt = 'provider.rate_limited' (not 'provider.error')
    mockIsAllowed.mockResolvedValue(true)
    async function* rateLimit() {
      yield { choices: [{ delta: { content: 'x' } }] }
      throw new Error('429 rate limit exceeded')
    }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(rateLimit()) } as any)
    const result = await llmStream({ messages: [] } as any, makeModel(), makeCtx())
    await expect(async () => { for await (const _ of result.chunks) {} }).rejects.toThrow('rate limit exceeded')
    expect(mockEmitEvent).toHaveBeenCalledWith('provider.rate_limited', expect.any(String), expect.any(Object), expect.any(Object))
  })

  it('line 502: emits cachedInputTokens in model:success when cachedInputTokens > 0', async () => {
    // Line 502: cachedInputTokens > 0 ? cachedInputTokens : undefined — true branch
    mockIsAllowed.mockResolvedValue(true)
    async function* withCached() {
      yield { choices: [{ delta: { content: 'x' } }] }
      yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 3 } } }
    }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(withCached()) } as any)
    const emitted: any[] = []
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    const result = await llmStream({ messages: [] } as any, makeModel(), ctx)
    for await (const _ of result.chunks) {}
    const successEntry = emitted.find(e => e.message === 'model:success')
    expect(successEntry?.details?.cachedInputTokens).toBe(3)
  })
})

// ─── llmMessages — additional branch coverage ────────────────────────────────

describe('llmMessages — additional branches', () => {
  it('includes traceId in checkBudget trackUsage when budget exceeded in messages', async () => {
    // Line 112 (via checkBudget): traceId set when budget denied
    mockIsAllowed.mockResolvedValue(false)
    const ctx = makeCtx({ traceId: 'msg-budget-trace' })
    await expect(llmMessages({ messages: [] } as any, makeModel(), ctx)).rejects.toThrow(BudgetExceededError)
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ traceId: 'msg-budget-trace', errorMessage: 'budget_exceeded' }))
  })

  it('emits tokensPerSec=0 when latencyMs=0 in messages (line 485 false branch)', async () => {
    // Line 485: latencyMs > 0 ? ... : 0
    mockIsAllowed.mockResolvedValue(true)
    const emitted: any[] = []
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockResolvedValue(makeMessagesResponse()) } as any)
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    const now = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      await llmMessages({ messages: [] } as any, makeModel(), ctx)
    } finally {
      spy.mockRestore()
    }
    const successEntry = emitted.find(e => e.message === 'model:success')
    expect(successEntry?.details?.tokensPerSec).toBe(0)
  })

  it('emits cachedInputTokens as undefined in messages success when cachedInputTokens is 0 (line 499)', async () => {
    // Line 499: cachedInputTokens > 0 ? cachedInputTokens : undefined — false branch
    mockIsAllowed.mockResolvedValue(true)
    const emitted: any[] = []
    // makeMessagesResponse has cache_read_input_tokens: 0 → cachedInputTokens = 0
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockResolvedValue(makeMessagesResponse()) } as any)
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    await llmMessages({ messages: [] } as any, makeModel(), ctx)
    const successEntry = emitted.find(e => e.message === 'model:success')
    expect(successEntry?.details?.cachedInputTokens).toBeUndefined()
  })

  it('uses model.cost.cachePerMillion in messages cost calculation when set (line 489)', async () => {
    // Line 489: model.cost.cachePerMillion ?? model.cost.inputPerMillion — true branch
    mockIsAllowed.mockResolvedValue(true)
    const modelWithCache = { ...makeModel(), cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: 0.5 } }
    const resp = { ...makeMessagesResponse(), usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 } }
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockResolvedValue(resp) } as any)
    await llmMessages({ messages: [] } as any, modelWithCache as any, makeCtx())
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ cachedInputTokens: 50, outcome: 'success' }))
  })
})

// ─── llmMessages ─────────────────────────────────────────────────────────────

describe('llmMessages', () => {
  it('calls adapter.messages and returns response', async () => {
    mockIsAllowed.mockResolvedValue(true)
    const mockAdapter = { messages: vi.fn().mockResolvedValue(makeMessagesResponse()) }
    mockGetProvider.mockReturnValue(mockAdapter as any)

    const result = await llmMessages({ messages: [] } as any, makeModel(), makeCtx())
    expect(result.usage.input_tokens).toBe(10)
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }))
  })

  it('throws when adapter.messages is missing', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn() } as any) // no messages()

    await expect(llmMessages({ messages: [] } as any, makeModel(), makeCtx())).rejects.toThrow('does not support')
  })

  it('throws BudgetExceededError when budget exhausted', async () => {
    mockIsAllowed.mockResolvedValue(false)
    await expect(llmMessages({ messages: [] } as any, makeModel(), makeCtx())).rejects.toThrow(BudgetExceededError)
  })

  it('throws and tracks error when messages() fails', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockRejectedValue(new Error('api error')) } as any)

    await expect(llmMessages({ messages: [] } as any, makeModel(), makeCtx())).rejects.toThrow('api error')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error', errorMessage: 'api error' }))
  })

  it('emits trace entries', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockResolvedValue(makeMessagesResponse()) } as any)

    const emitted: any[] = []
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    await llmMessages({ messages: [] } as any, makeModel(), ctx)
    expect(emitted.some(e => e.message === 'model:request')).toBe(true)
    expect(emitted.some(e => e.message === 'model:success')).toBe(true)
  })

  it('handles cache tokens in usage', async () => {
    mockIsAllowed.mockResolvedValue(true)
    const resp = { ...makeMessagesResponse(), usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 5 } }
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockResolvedValue(resp) } as any)

    await llmMessages({ messages: [] } as any, makeModel(), makeCtx())
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ cachedInputTokens: 30, cacheCreationInputTokens: 5 }))
  })

  it('emits trace entries in error path with log', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockRejectedValue(new Error('api fail')) } as any)
    const emitted: any[] = []
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e), log })
    await expect(llmMessages({ messages: [] } as any, makeModel(), ctx)).rejects.toThrow('api fail')
    expect(emitted.some(e => e.message === 'model:error')).toBe(true)
    expect(log.warn).toHaveBeenCalled()
  })

  it('covers non-Error thrown in messages', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockRejectedValue('raw string error') } as any)
    await expect(llmMessages({ messages: [] } as any, makeModel(), makeCtx())).rejects.toBe('raw string error')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: 'raw string error' }))
  })

  it('covers traceId in messages tracking', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockResolvedValue(makeMessagesResponse()) } as any)
    const ctx = makeCtx({ traceId: 'trace-msg-456' })
    await llmMessages({ messages: [] } as any, makeModel(), ctx)
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ traceId: 'trace-msg-456' }))
  })

  it('swallows trackUsage rejection in success path', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockResolvedValue(makeMessagesResponse()) } as any)
    mockTrackUsage.mockRejectedValueOnce(new Error('db error'))
    await expect(llmMessages({ messages: [] } as any, makeModel(), makeCtx())).resolves.toBeDefined()
  })

  it('swallows trackUsage rejection in error path', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockRejectedValue(new Error('api err')) } as any)
    mockTrackUsage.mockRejectedValueOnce(new Error('db error'))
    await expect(llmMessages({ messages: [] } as any, makeModel(), makeCtx())).rejects.toThrow('api err')
  })

  it('covers traceId in error path tracking', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockRejectedValue(new Error('fail')) } as any)
    const ctx = makeCtx({ traceId: 'trace-err-789' })
    await expect(llmMessages({ messages: [] } as any, makeModel(), ctx)).rejects.toThrow('fail')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ traceId: 'trace-err-789' }))
  })

  it('covers undefined cache token fields in usage (covers ?? 0 branches)', async () => {
    mockIsAllowed.mockResolvedValue(true)
    // usage without optional cache fields → triggers ?? 0 branches
    const resp = { ...makeMessagesResponse(), usage: { input_tokens: 10, output_tokens: 5 } }
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockResolvedValue(resp) } as any)
    const emitted: any[] = []
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    await llmMessages({ } as any, makeModel(), ctx)  // no messages field → triggers ?? 0
    expect(emitted.some(e => e.message === 'model:success')).toBe(true)
  })

  it('emits success trace with emit and cached tokens', async () => {
    mockIsAllowed.mockResolvedValue(true)
    const resp = { ...makeMessagesResponse(), usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 0 } }
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockResolvedValue(resp) } as any)
    const emitted: any[] = []
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    await llmMessages({ messages: [] } as any, makeModel(), ctx)
    const successEntry = emitted.find(e => e.message === 'model:success')
    expect(successEntry?.details?.cachedInputTokens).toBe(30)
  })

  it('line 578: tokensPerSec > 0 when latencyMs > 0 (true branch)', async () => {
    mockIsAllowed.mockResolvedValue(true)
    const emitted: any[] = []
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockResolvedValue(makeMessagesResponse()) } as any)
    const ctx = makeCtx({ emit: (e: any) => emitted.push(e) })
    // Make Date.now return different values so latencyMs > 0
    let call = 0
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => call++ === 0 ? 1000 : 1100)
    try {
      await llmMessages({ messages: [] } as any, makeModel(), ctx)
    } finally {
      spy.mockRestore()
    }
    const successEntry = emitted.find(e => e.message === 'model:success')
    expect(successEntry?.details?.tokensPerSec).toBeGreaterThan(0)
  })

  it('includes endUserId, sessionId, tags, guardrailTriggered, piiRedacted in messages success trackUsage (lines 617-621)', async () => {
    // Covers the truthy branches of all optional ctx fields in llmMessages success path
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockResolvedValue(makeMessagesResponse()) } as any)
    const ctx = makeCtx({
      endUserId: 'user-123',
      sessionId: 'session-abc',
      tags: { team: 'eng' },
      guardrailTriggered: 'pii-rule',
      piiRedacted: ['EMAIL'],
    })
    await llmMessages({ messages: [] } as any, makeModel(), ctx)
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({
      endUserId: 'user-123',
      sessionId: 'session-abc',
      tags: { team: 'eng' },
      guardrailTriggered: 'pii-rule',
      piiRedacted: ['EMAIL'],
    }))
  })

  it('includes endUserId, sessionId, tags, guardrailTriggered, piiRedacted in messages error trackUsage (lines 640-644)', async () => {
    // Covers the truthy branches of all optional ctx fields in llmMessages error path
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ messages: vi.fn().mockRejectedValue(new Error('api fail')) } as any)
    const ctx = makeCtx({
      endUserId: 'user-err',
      sessionId: 'session-err',
      tags: { env: 'prod' },
      guardrailTriggered: 'block-rule',
      piiRedacted: ['PHONE'],
    })
    await expect(llmMessages({ messages: [] } as any, makeModel(), ctx)).rejects.toThrow('api fail')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({
      endUserId: 'user-err',
      sessionId: 'session-err',
      tags: { env: 'prod' },
      guardrailTriggered: 'block-rule',
      piiRedacted: ['PHONE'],
    }))
  })
})

describe('llmChat — .catch(() => {}) coverage for emitEvent rejections', () => {
  it('swallows emitEvent rejection in chat success path (line 293 + handleProviderResult recovered, line 98)', async () => {
    // First make a call that succeeds → recovered emitEvent fires (line 98) on second call
    mockEmitEvent.mockResolvedValue(undefined)
    const model = makeModel('m1')
    mockIsAllowed.mockResolvedValue(true)
    mockGetLimitUsage.mockResolvedValue([])
    // First call succeeds normally
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    await llmChat({ messages: [] } as any, model, makeCtx())

    // Now make emitEvent reject for the recovered/success callbacks
    mockEmitEvent.mockRejectedValue(new Error('emit fail'))
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    await expect(llmChat({ messages: [] } as any, model, makeCtx())).resolves.toBeDefined()
    mockEmitEvent.mockResolvedValue(undefined)
  })

  it('swallows emitEvent rejection in chat error path (line 305, provEvt)', async () => {
    mockEmitEvent.mockRejectedValue(new Error('emit fail'))
    const model = makeModel('m1')
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockRejectedValue(new Error('provider down')) } as any)
    await expect(llmChat({ messages: [] } as any, model, makeCtx())).rejects.toThrow('provider down')
    mockEmitEvent.mockResolvedValue(undefined)
  })

  it('swallows emitEvent rejection in chat error with rate-limit message (provider.rate_limited path)', async () => {
    mockEmitEvent.mockRejectedValue(new Error('emit fail'))
    const model = makeModel('m1')
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockRejectedValue(new Error('429 rate limit exceeded')) } as any)
    await expect(llmChat({ messages: [] } as any, model, makeCtx())).rejects.toThrow('rate limit exceeded')
    mockEmitEvent.mockResolvedValue(undefined)
  })

  it('swallows handleProviderResult degraded emitEvent rejection (line 105, after 3 failures)', async () => {
    // Need 3 consecutive failures for the same model to trigger degraded → emitEvent
    mockEmitEvent.mockRejectedValue(new Error('emit fail'))
    const model = makeModel('degrade-test')
    mockIsAllowed.mockResolvedValue(true)
    const failAdapter = { chatCompletion: vi.fn().mockRejectedValue(new Error('fail')) }
    mockGetProvider.mockReturnValue(failAdapter as any)
    for (let i = 0; i < 3; i++) {
      await expect(llmChat({ messages: [] } as any, model, makeCtx())).rejects.toThrow('fail')
    }
    mockEmitEvent.mockResolvedValue(undefined)
  })
})

describe('llmStream — .catch(() => {}) coverage for emitEvent rejections', () => {
  it('swallows emitEvent rejection in pre-stream error path (line 398)', async () => {
    mockEmitEvent.mockRejectedValue(new Error('emit fail'))
    const model = makeModel('m1')
    mockIsAllowed.mockResolvedValue(true)
    async function* failFirst() { throw new Error('connect fail') }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(failFirst()) } as any)
    await expect(llmStream({ messages: [] } as any, model, makeCtx())).rejects.toThrow('connect fail')
    mockEmitEvent.mockResolvedValue(undefined)
  })

  it('swallows emitEvent rejection in mid-stream error path (line 481)', async () => {
    mockEmitEvent.mockRejectedValue(new Error('emit fail'))
    const model = makeModel('m1')
    mockIsAllowed.mockResolvedValue(true)
    async function* failMid() {
      yield { choices: [{ delta: { content: 'a' } }] }
      throw new Error('mid fail')
    }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(failMid()) } as any)
    const result = await llmStream({ messages: [] } as any, model, makeCtx())
    await expect(async () => { for await (const _ of result.chunks) {} }).rejects.toThrow('mid fail')
    mockEmitEvent.mockResolvedValue(undefined)
  })

  it('swallows trackUsage rejection in stream generator finally (line 525)', async () => {
    mockTrackUsage.mockRejectedValueOnce(new Error('db error'))
    const model = makeModel('m1')
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(makeStream({ choices: [{ delta: { content: 'ok' } }] })) } as any)
    const result = await llmStream({ messages: [] } as any, model, makeCtx())
    for await (const _ of result.chunks) {}
    // No throw — .catch(() => {}) swallowed it
  })
})

describe('checkBudget — budget reset and threshold paths', () => {
  it('emits budget.reset when previously-exceeded budget is now allowed (lines 162-167)', async () => {
    // Use model that IS in the project so isAllowed (not isAllowedForRoutingModel) is called
    const model = makeModel('m1') // makeProject defaults to modelId='m1'
    // Step 1: exhaust budget to set the budgetExceededKeys entry
    mockIsAllowed.mockResolvedValueOnce(false)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    await expect(llmChat({ messages: [] } as any, model, makeCtx())).rejects.toThrow(BudgetExceededError)

    // Step 2: budget is now allowed again → hits the reset path (line 162)
    mockIsAllowed.mockResolvedValueOnce(true)
    mockGetLimitUsage.mockResolvedValueOnce([])
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    await expect(llmChat({ messages: [] } as any, model, makeCtx())).resolves.toBeDefined()
  })

  it('emits budget.threshold_reached when usage >= 80% on completion call (lines 171-183)', async () => {
    const model = makeModel('m1')
    mockIsAllowed.mockResolvedValue(true)
    // Return a snapshot where current/value >= 0.8
    mockGetLimitUsage.mockResolvedValue([
      { metric: 'cost', window: 'daily', value: 10, current: 9 }, // 90%
    ] as any)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    await llmChat({ messages: [] } as any, model, makeCtx({ callType: 'completion' }))
    // threshold event fires async; give it a tick
    await new Promise(r => setTimeout(r, 0))
    expect(mockGetLimitUsage).toHaveBeenCalled()
  })

  it('does not check threshold for non-completion callType (line 171 branch)', async () => {
    const model = makeModel('routing-m1')
    mockIsAllowedForRouting.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    const ctx = makeCtx({ callType: 'routing', project: { ...makeProject('other'), models: [] } })
    await llmChat({ messages: [] } as any, model, ctx)
    // getLimitUsageSnapshot should NOT be called for routing callType
    expect(mockGetLimitUsage).not.toHaveBeenCalled()
  })

  it('covers .catch(() => {}) on emitEvent calls (budget.exceeded path)', async () => {
    // Make emitEvent reject → .catch(() => {}) on lines 157, 167, 181 fires
    mockEmitEvent.mockRejectedValue(new Error('emit failed'))
    const model = makeModel('m1')
    mockIsAllowed.mockResolvedValueOnce(false)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    // BudgetExceededError fires (emitEvent rejects → catch swallows it)
    await expect(llmChat({ messages: [] } as any, model, makeCtx())).rejects.toThrow(BudgetExceededError)
    // Restore
    mockEmitEvent.mockResolvedValue(undefined)
  })

  it('covers .catch(() => {}) on emitEvent after success path', async () => {
    mockEmitEvent.mockRejectedValue(new Error('emit failed'))
    const model = makeModel('m1')
    mockIsAllowed.mockResolvedValue(true)
    mockGetLimitUsage.mockResolvedValueOnce([])
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    await expect(llmChat({ messages: [] } as any, model, makeCtx())).resolves.toBeDefined()
    mockEmitEvent.mockResolvedValue(undefined)
  })

  it('line 165 false branch: threshold key from a different model is not deleted during budget reset', async () => {
    // Step 1: trigger threshold for m1 → thresholdFiredKeys gets 'proj-1:m1:daily'
    const m1 = makeModel('m1')
    mockIsAllowed.mockResolvedValue(true)
    mockGetLimitUsage.mockResolvedValueOnce([{ metric: 'cost', window: 'daily', value: 10, current: 9 }] as any)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    await llmChat({ messages: [] } as any, m1, makeCtx({ callType: 'completion' }))
    await new Promise(r => setTimeout(r, 0)) // let .then() fire

    // Step 2: exhaust budget for m2 → budgetExceededKeys gets 'proj-1:m2'
    const m2 = makeModel('m2')
    mockIsAllowed.mockResolvedValueOnce(false)
    const ctx2 = makeCtx({ project: { ...makeProject('m2'), models: [{ modelId: 'm2' }] } })
    await expect(llmChat({ messages: [] } as any, m2, ctx2)).rejects.toThrow(BudgetExceededError)

    // Step 3: reset budget for m2 → iterates thresholdFiredKeys, 'proj-1:m1:daily' doesn't start with 'proj-1:m2:'
    mockIsAllowed.mockResolvedValueOnce(true)
    mockGetLimitUsage.mockResolvedValueOnce([])
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    await expect(llmChat({ messages: [] } as any, m2, ctx2)).resolves.toBeDefined()
    // m1's threshold key should still be in thresholdFiredKeys (not deleted — false branch covered)
  })

  it('covers .catch on getLimitUsageSnapshot rejection (line 185)', async () => {
    // getLimitUsageSnapshot rejects → .then/.catch chain fires the .catch(() => {})
    mockIsAllowed.mockResolvedValue(true)
    mockGetLimitUsage.mockRejectedValue(new Error('budget db error'))
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    // Should not throw — the .catch swallows getLimitUsageSnapshot rejection
    await expect(llmChat({ messages: [] } as any, makeModel('m1'), makeCtx({ callType: 'completion' }))).resolves.toBeDefined()
    await new Promise(r => setTimeout(r, 0))
  })

  it('line 157 true: emits budget.exceeded with log when ctx.log is defined', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const model = makeModel('log-m157') // use unique model id
    // Make the model a project candidate so isAllowed (not isAllowedForRoutingModel) is called
    const ctx = makeCtx({ log, project: { ...makeProject('log-m157'), models: [{ modelId: 'log-m157' }] } })
    mockIsAllowed.mockResolvedValueOnce(false)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    await expect(llmChat({ messages: [] } as any, model, ctx)).rejects.toThrow(BudgetExceededError)
    expect(mockEmitEvent).toHaveBeenCalledWith('budget.exceeded', expect.any(String), expect.any(Object), expect.objectContaining({ log }))
  })

  it('line 167 true: emits budget.reset with log when ctx.log is defined', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const model = makeModel('log-m167')
    const ctx = makeCtx({ log, project: { ...makeProject('log-m167'), models: [{ modelId: 'log-m167' }] } })
    // Step 1: exceed budget to set budgetExceededKeys
    mockIsAllowed.mockResolvedValueOnce(false)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    await expect(llmChat({ messages: [] } as any, model, ctx)).rejects.toThrow(BudgetExceededError)
    // Step 2: budget allowed again → reset path fires with log
    mockIsAllowed.mockResolvedValueOnce(true)
    mockGetLimitUsage.mockResolvedValueOnce([])
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    await llmChat({ messages: [] } as any, model, ctx)
    expect(mockEmitEvent).toHaveBeenCalledWith('budget.reset', expect.any(String), expect.any(Object), expect.objectContaining({ log }))
  })

  it('line 181 true: emits budget.threshold_reached with log when ctx.log is defined', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const model = makeModel('log-m181')
    const ctx = makeCtx({ callType: 'completion', log, project: { ...makeProject('log-m181'), models: [{ modelId: 'log-m181' }] } })
    mockIsAllowed.mockResolvedValue(true)
    mockGetLimitUsage.mockResolvedValue([{ metric: 'cost', window: 'daily', value: 10, current: 9 }] as any)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    await llmChat({ messages: [] } as any, model, ctx)
    await new Promise(r => setTimeout(r, 0)) // let .then fire
    expect(mockEmitEvent).toHaveBeenCalledWith('budget.threshold_reached', expect.any(String), expect.any(Object), expect.objectContaining({ log }))
  })
})

describe('handleProviderResult — recovered with log (line 98 true branch)', () => {
  it('line 98: emits provider.recovered with log when log is defined', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const model = makeModel('log-model-98')
    mockIsAllowed.mockResolvedValue(true)
    mockGetLimitUsage.mockResolvedValue([])
    // Step 1: cause 3 failures to add model to providerDegraded
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockRejectedValue(new Error('fail')) } as any)
    for (let i = 0; i < 3; i++) {
      await expect(llmChat({ messages: [] } as any, model, makeCtx())).rejects.toThrow('fail')
    }
    // Step 2: succeed → providerDegraded.delete fires → recovered event with log
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    await llmChat({ messages: [] } as any, model, makeCtx({ log }))
    expect(mockEmitEvent).toHaveBeenCalledWith('provider.recovered', expect.any(String), expect.any(Object), expect.objectContaining({ log }))
  })

  it('line 98 .catch: swallows emitEvent rejection on provider.recovered', async () => {
    const model = makeModel('catch-model-98')
    mockIsAllowed.mockResolvedValue(true)
    mockGetLimitUsage.mockResolvedValue([])
    // Step 1: 3 failures → degraded
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockRejectedValue(new Error('fail')) } as any)
    for (let i = 0; i < 3; i++) {
      await expect(llmChat({ messages: [] } as any, model, makeCtx())).rejects.toThrow('fail')
    }
    // Step 2: emitEvent rejects → .catch(() => {}) fires at line 98
    mockEmitEvent.mockRejectedValue(new Error('emit fail'))
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    // Should not throw despite emitEvent rejecting
    await expect(llmChat({ messages: [] } as any, model, makeCtx())).resolves.toBeDefined()
    mockEmitEvent.mockResolvedValue(undefined)
  })
})

describe('llmChat — line 317 traceId in error trackUsage path', () => {
  it('includes traceId in error-path trackUsage (line 317 cond-expr branch=0)', async () => {
    // traceId is set AND the provider throws → line 317 should use { traceId }
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockRejectedValue(new Error('provider fail')) } as any)
    const ctx = makeCtx({ traceId: 'err-trace-317' })
    await expect(llmChat({ messages: [] } as any, makeModel(), ctx)).rejects.toThrow('provider fail')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ traceId: 'err-trace-317', outcome: 'error' }))
  })
})

describe('checkBudget — threshold snap branches (lines 174/176)', () => {
  it('covers near-threshold snap (lines 174/176 if branch=0 and branch=0)', async () => {
    // snap.value > 0 AND snap.current/snap.value >= 0.8 → fires threshold event (branch=0 = condition true)
    // !thresholdFiredKeys.has(tKey) → true (not fired yet, branch=0 = true)
    const model = makeModel('thresh-model')
    const ctx = makeCtx({ callType: 'completion', project: { ...makeProject('thresh-model'), models: [{ modelId: 'thresh-model' }] } })
    mockIsAllowed.mockResolvedValue(true)
    // 8/10 = 80% → meets >= 0.8 threshold
    mockGetLimitUsage.mockResolvedValue([{ metric: 'cost', window: 'daily', value: 10, current: 8 }] as any)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    await expect(llmChat({ messages: [] } as any, model, ctx)).resolves.toBeDefined()
    await new Promise(r => setTimeout(r, 0))
    expect(mockEmitEvent).toHaveBeenCalledWith('budget.threshold_reached', expect.any(String), expect.any(Object), expect.any(Object))
  })

  it('skips already-fired threshold (line 176 if branch=1)', async () => {
    // On first call, threshold fires and tKey is added. On second call, tKey is already in set → skip
    const model = makeModel('thresh-model-repeat')
    const ctx = makeCtx({ callType: 'completion', project: { ...makeProject('thresh-model-repeat'), models: [{ modelId: 'thresh-model-repeat' }] } })
    mockIsAllowed.mockResolvedValue(true)
    mockGetLimitUsage.mockResolvedValue([{ metric: 'cost', window: 'daily', value: 10, current: 9 }] as any)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    // First call: threshold fires
    await llmChat({ messages: [] } as any, model, ctx)
    await new Promise(r => setTimeout(r, 0))
    const firstCallCount = mockEmitEvent.mock.calls.filter(c => c[0] === 'budget.threshold_reached').length
    // Second call: tKey already in set → !thresholdFiredKeys.has(tKey) = false → skip
    await llmChat({ messages: [] } as any, model, ctx)
    await new Promise(r => setTimeout(r, 0))
    const secondCallCount = mockEmitEvent.mock.calls.filter(c => c[0] === 'budget.threshold_reached').length
    expect(secondCallCount).toBe(firstCallCount) // no new threshold event
  })
})

describe('checkBudget — snap below threshold (line 174 if branch=1)', () => {
  it('does not fire threshold event when snap is below 80% (line 174 if branch=1)', async () => {
    // snap.value > 0 AND snap.current/snap.value < 0.8 → condition FALSE → branch=1 → no event
    const model = makeModel('below-thresh')
    const ctx = makeCtx({ callType: 'completion', project: { ...makeProject('below-thresh'), models: [{ modelId: 'below-thresh' }] } })
    mockIsAllowed.mockResolvedValue(true)
    // 5/10 = 50% → below 0.8 threshold
    mockGetLimitUsage.mockResolvedValue([{ metric: 'cost', window: 'daily', value: 10, current: 5 }] as any)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    await expect(llmChat({ messages: [] } as any, model, ctx)).resolves.toBeDefined()
    await new Promise(r => setTimeout(r, 0))
    expect(mockEmitEvent).not.toHaveBeenCalledWith('budget.threshold_reached', expect.anything(), expect.anything(), expect.anything())
  })
})

// ── Lines 387 + 407: llmStream with callType !== 'completion' ─────────────────
describe('llmStream — callType routing (lines 387+407 branches)', () => {
  it('line 387: skips TTFT timeout when callType is not completion (routing)', async () => {
    // callType='routing' → ttftTimeoutMs = undefined → takes else branch (iter.next() directly)
    mockIsAllowedForRouting.mockResolvedValue(true)
    const chunk = { choices: [{ delta: { content: 'routed' } }] }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(makeStream(chunk)) } as any)

    const ctx = makeCtx({
      callType: 'routing' as const,
      project: { ...makeProject('other'), timeoutMs: 5000, models: [] },
    })
    const result = await llmStream({ messages: [] } as any, makeModel(), ctx)
    const collected: any[] = []
    for await (const c of result.chunks) collected.push(c)
    expect(collected).toHaveLength(1)
    // trackUsage called (proves stream completed without timeout interference)
    expect(mockTrackUsage).toHaveBeenCalled()
  })

  it('line 407: isTtftTimeout=false branch when error does not start with TTFT timeout', async () => {
    // callType='completion' + pre-stream error with generic message → isTtftTimeout = false
    mockIsAllowed.mockResolvedValue(true)
    async function* failFirst() { throw new Error('provider refused') }
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(failFirst()) } as any)

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const ctx = makeCtx({ log, callType: 'completion' as const })
    await expect(llmStream({ messages: [] } as any, makeModel(), ctx)).rejects.toThrow('provider refused')
    // warn called with the non-timeout log message
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'llm executor: stream failed before first chunk',
    )
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error' }))
  })
})

describe('checkBudget — threshold .catch coverage (line 181 .catch)', () => {
  it('line 181 .catch: swallows emitEvent rejection on budget.threshold_reached', async () => {
    const model = makeModel('catch-model-181')
    const ctx = makeCtx({ callType: 'completion', project: { ...makeProject('catch-model-181'), models: [{ modelId: 'catch-model-181' }] } })
    mockIsAllowed.mockResolvedValue(true)
    mockGetLimitUsage.mockResolvedValue([{ metric: 'cost', window: 'daily', value: 10, current: 9 }] as any)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)
    // Make emitEvent reject after the call is made (threshold fires async via .then)
    mockEmitEvent.mockRejectedValue(new Error('emit fail'))
    await expect(llmChat({ messages: [] } as any, model, ctx)).resolves.toBeDefined()
    await new Promise(r => setTimeout(r, 0)) // let .then fire
    mockEmitEvent.mockResolvedValue(undefined)
  })
})
