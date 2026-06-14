import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../providers/index.js', () => ({ getProviderAdapter: vi.fn() }))
vi.mock('../cost/budget.js', () => ({ isAllowed: vi.fn(), isAllowedForRoutingModel: vi.fn() }))
vi.mock('../cost/tracker.js', () => ({ trackUsage: vi.fn().mockResolvedValue(undefined) }))

import { llmChat, llmStream, llmMessages, BudgetExceededError } from './executor.js'
import { getProviderAdapter } from '../providers/index.js'
import { isAllowed, isAllowedForRoutingModel } from '../cost/budget.js'
import { trackUsage } from '../cost/tracker.js'

const mockGetProvider = vi.mocked(getProviderAdapter)
const mockIsAllowed = vi.mocked(isAllowed)
const mockIsAllowedForRouting = vi.mocked(isAllowedForRoutingModel)
const mockTrackUsage = vi.mocked(trackUsage)

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

  it('includes cacheHit in trackUsage when ctx.cacheHit is true', async () => {
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockResolvedValue(makeChatResponse()) } as any)

    const ctx = makeCtx({ cacheHit: true, cacheSimilarity: 0.92 })
    await llmChat({ messages: [] } as any, makeModel(), ctx)
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ cacheHit: true, cacheSimilarity: 0.92 }))
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

  it('includes traceId and cacheHit in error path trackUsage', async () => {
    // Lines 237-238: traceId + cacheHit branches in the catch block
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ chatCompletion: vi.fn().mockRejectedValue(new Error('prov err')) } as any)
    const ctx = makeCtx({ traceId: 'trace-err', cacheHit: true, cacheSimilarity: 0.85 })
    await expect(llmChat({ messages: [] } as any, makeModel(), ctx)).rejects.toThrow('prov err')
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({
      traceId: 'trace-err',
      cacheHit: true,
      cacheSimilarity: 0.85,
      outcome: 'error',
    }))
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

  it('includes cacheHit in stream finally trackUsage when ctx.cacheHit is true (line 431)', async () => {
    // Line 431: ctx.cacheHit branch in stream generator finally block
    mockIsAllowed.mockResolvedValue(true)
    mockGetProvider.mockReturnValue({ streamCompletion: vi.fn().mockReturnValue(makeStream({ choices: [{ delta: { content: 'ok' } }] })) } as any)
    const ctx = makeCtx({ cacheHit: true, cacheSimilarity: 0.77 })
    const result = await llmStream({ messages: [] } as any, makeModel(), ctx)
    for await (const _ of result.chunks) { /* consume */ }
    expect(mockTrackUsage).toHaveBeenCalledWith(expect.objectContaining({ cacheHit: true, cacheSimilarity: 0.77 }))
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
})
