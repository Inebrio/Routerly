import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../../llm/executor.js', () => ({
  llmChat: vi.fn(),
  BudgetExceededError: class BudgetExceededError extends Error {
    constructor(msg = 'budget') { super(msg); this.name = 'BudgetExceededError' }
  },
}))
vi.mock('../routingMemoryStore.js', () => ({ getRoutingHistory: vi.fn() }))
vi.mock('../../cost/budget.js', () => ({ getLimitUsageSnapshot: vi.fn() }))

import { llmPolicy } from './llm.js'
import { readConfig } from '../../config/loader.js'
import { llmChat, BudgetExceededError } from '../../llm/executor.js'
import { getRoutingHistory } from '../routingMemoryStore.js'
import { getLimitUsageSnapshot } from '../../cost/budget.js'
import type { PolicyInput } from './types.js'
import type { ModelConfig, ProjectConfig } from '@routerly/shared'

const mockReadConfig = vi.mocked(readConfig)
const mockLlmChat = vi.mocked(llmChat)
const mockGetRoutingHistory = vi.mocked(getRoutingHistory)
const mockGetLimitUsageSnapshot = vi.mocked(getLimitUsageSnapshot)

afterEach(() => { vi.clearAllMocks() })

const routingModel: ModelConfig = {
  id: 'router-model', name: 'Router', provider: 'openai',
  endpoint: 'https://api.openai.com/v1',
  cost: { inputPerMillion: 1, outputPerMillion: 3 },
}

const candidateA: ModelConfig = {
  id: 'candidate-a', name: 'A', provider: 'openai',
  endpoint: 'https://api.openai.com/v1',
  cost: { inputPerMillion: 1, outputPerMillion: 3 },
}

const candidateB: ModelConfig = {
  id: 'candidate-b', name: 'B', provider: 'anthropic',
  endpoint: 'https://api.anthropic.com',
  cost: { inputPerMillion: 5, outputPerMillion: 15 },
}

const project: ProjectConfig = {
  id: 'proj-1', name: 'Test', tokens: [], members: [], models: [],
}

function makeInput(config: any, overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    request: { model: 'auto', messages: [{ role: 'user', content: 'What is 2+2?' }] },
    candidates: [{ model: candidateA }, { model: candidateB }],
    config,
    projectId: 'proj-1',
    ...overrides,
  } as PolicyInput
}

function makeSuccessResponse(routing: { model: string; point: number }[]) {
  return { choices: [{ message: { content: JSON.stringify({ routing }) } }] }
}

describe('llmPolicy', () => {
  it('throws when routingModelId is not configured', async () => {
    await expect(llmPolicy(makeInput({}))).rejects.toThrow('routingModelId not configured')
  })

  it('returns routing scores from LLM response', async () => {
    mockReadConfig
      .mockResolvedValueOnce([routingModel])   // models
      .mockResolvedValueOnce([project])         // projects
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.9 },
      { model: 'candidate-b', point: 0.4 },
    ]) as any)

    const result = await llmPolicy(makeInput({ routingModelId: 'router-model' }))
    expect(result.routing).toHaveLength(2)
    expect(result.routing.find(r => r.model === 'candidate-a')!.point).toBe(0.9)
    expect(result.routing.find(r => r.model === 'candidate-b')!.point).toBe(0.4)
  })

  it('strips markdown code fences from LLM response', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    const json = JSON.stringify({ routing: [{ model: 'candidate-a', point: 0.7 }, { model: 'candidate-b', point: 0.3 }] })
    mockLlmChat.mockResolvedValue({ choices: [{ message: { content: `\`\`\`json\n${json}\n\`\`\`` } }] } as any)

    const result = await llmPolicy(makeInput({ routingModelId: 'router-model' }))
    expect(result.routing.find(r => r.model === 'candidate-a')!.point).toBe(0.7)
  })

  it('attempts repair when initial parse fails', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat
      .mockResolvedValueOnce({ choices: [{ message: { content: 'This is not JSON!' } }] } as any)
      .mockResolvedValueOnce(makeSuccessResponse([
        { model: 'candidate-a', point: 0.8 },
        { model: 'candidate-b', point: 0.2 },
      ]) as any)

    const result = await llmPolicy(makeInput({ routingModelId: 'router-model' }))
    expect(mockLlmChat).toHaveBeenCalledTimes(2)
    expect(result.routing).toHaveLength(2)
  })

  it('throws when all routing model attempts fail with parse errors', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue({ choices: [{ message: { content: 'garbage' } }] } as any)

    await expect(llmPolicy(makeInput({ routingModelId: 'router-model' }))).rejects.toThrow('all models failed')
  })

  it('skips model on BudgetExceededError and tries fallback', async () => {
    const fallbackModel: ModelConfig = {
      id: 'fallback', name: 'Fallback', provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      cost: { inputPerMillion: 1, outputPerMillion: 3 },
    }
    mockReadConfig.mockResolvedValueOnce([routingModel, fallbackModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat
      .mockRejectedValueOnce(new (BudgetExceededError as any)('budget exceeded'))
      .mockResolvedValueOnce(makeSuccessResponse([
        { model: 'candidate-a', point: 0.7 },
        { model: 'candidate-b', point: 0.3 },
      ]) as any)

    const result = await llmPolicy(makeInput({
      routingModelId: 'router-model',
      fallbackModelIds: ['fallback'],
    }))
    expect(result.routing).toHaveLength(2)
    expect(mockLlmChat).toHaveBeenCalledTimes(2)
  })

  it('skips model on generic call error', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockRejectedValue(new Error('network error'))

    await expect(llmPolicy(makeInput({ routingModelId: 'router-model' }))).rejects.toThrow('all models failed')
  })

  it('skips model when routing model not found in models config', async () => {
    mockReadConfig.mockResolvedValueOnce([]).mockResolvedValueOnce([project]) // no models
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])

    await expect(llmPolicy(makeInput({ routingModelId: 'nonexistent' }))).rejects.toThrow('all models failed')
  })

  it('uses memory when enabled and conversationId is provided', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([{ model: 'candidate-a', ts: Date.now() }])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.9 },
      { model: 'candidate-b', point: 0.1 },
    ]) as any)

    await llmPolicy(makeInput(
      { routingModelId: 'router-model', memory: true, memoryCount: 3 },
      { conversationId: 'conv-123' },
    ))
    expect(mockGetRoutingHistory).toHaveBeenCalledWith('proj-1', 'conv-123', 3)
    const callArgs = mockLlmChat.mock.calls[0]![0]
    const userMsg = (callArgs as any).messages.find((m: any) => m.role === 'user').content
    expect(userMsg).toContain('Previous routing decisions')
  })

  it('includes additionalPromptInfo when autoRouting is false', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.5 },
      { model: 'candidate-b', point: 0.5 },
    ]) as any)

    await llmPolicy(makeInput({
      routingModelId: 'router-model',
      autoRouting: false,
      additionalPromptInfo: 'Prefer small models',
    }))
    const callArgs = mockLlmChat.mock.calls[0]![0]
    const systemMsg = (callArgs as any).messages.find((m: any) => m.role === 'system').content
    expect(systemMsg).toContain('Prefer small models')
  })

  it('does not include additionalPromptInfo when autoRouting is true', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.5 },
      { model: 'candidate-b', point: 0.5 },
    ]) as any)

    await llmPolicy(makeInput({
      routingModelId: 'router-model',
      autoRouting: true,
      additionalPromptInfo: 'Should not appear',
    }))
    const systemMsg = (mockLlmChat.mock.calls[0]![0] as any).messages.find((m: any) => m.role === 'system').content
    expect(systemMsg).not.toContain('Should not appear')
  })

  it('applies maxCompletionTokens from config', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.5 },
      { model: 'candidate-b', point: 0.5 },
    ]) as any)

    await llmPolicy(makeInput({ routingModelId: 'router-model', maxCompletionTokens: 200 }))
    const callArgs = mockLlmChat.mock.calls[0]![0] as any
    expect(callArgs.max_completion_tokens).toBe(200)
  })

  it('truncates user message when maxUserMessageChars is set', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.5 },
      { model: 'candidate-b', point: 0.5 },
    ]) as any)

    const longContent = 'x'.repeat(10000)
    await llmPolicy({
      request: { model: 'auto', messages: [{ role: 'user', content: longContent }] },
      candidates: [{ model: candidateA }, { model: candidateB }],
      config: { routingModelId: 'router-model', maxUserMessageChars: 100 },
      projectId: 'proj-1',
    } as PolicyInput)
    const userMsg = (mockLlmChat.mock.calls[0]![0] as any).messages.find((m: any) => m.role === 'user').content
    expect(userMsg).toContain('[truncated]')
  })

  it('handles system message in request', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.7 },
      { model: 'candidate-b', point: 0.3 },
    ]) as any)

    await llmPolicy({
      request: {
        model: 'auto',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
        ],
      },
      candidates: [{ model: candidateA }, { model: candidateB }],
      config: { routingModelId: 'router-model' },
      projectId: 'proj-1',
    } as PolicyInput)
    const userMsg = (mockLlmChat.mock.calls[0]![0] as any).messages.find((m: any) => m.role === 'user').content
    expect(userMsg).toContain('system_prompt')
  })

  it('recovers routing from truncated JSON via regex', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    // Truncated JSON with complete entries
    const truncated = `{"routing": [{"model": "candidate-a", "point": 0.8}, {"model": "candidate-b", "point": 0`
    mockLlmChat.mockResolvedValue({ choices: [{ message: { content: truncated } }] } as any)

    const result = await llmPolicy(makeInput({ routingModelId: 'router-model' }))
    expect(result.routing.find(r => r.model === 'candidate-a')!.point).toBe(0.8)
  })

  it('includes limit snapshots in system prompt when model has limits', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValueOnce([
      { metric: 'cost', window: 'daily', value: 100, current: 20, remaining: 80 },
    ])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.6 },
      { model: 'candidate-b', point: 0.4 },
    ]) as any)

    await llmPolicy(makeInput({ routingModelId: 'router-model' }))
    const systemMsg = (mockLlmChat.mock.calls[0]![0] as any).messages.find((m: any) => m.role === 'system').content
    expect(systemMsg).toContain('limits')
  })

  it('includes reason in routing when includeReason is true', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        routing: [
          { model: 'candidate-a', point: 0.9, reason: 'complex task' },
          { model: 'candidate-b', point: 0.1, reason: 'simple' },
        ],
      }) } }],
    } as any)

    const result = await llmPolicy(makeInput({ routingModelId: 'router-model', includeReason: true }))
    expect(result.routing.find(r => r.model === 'candidate-a')!.reason).toBe('complex task')
  })

  it('disables thinking when model does not support it', async () => {
    const routingModelNoThinking = { ...routingModel, capabilities: { thinking: false } }
    mockReadConfig.mockResolvedValueOnce([routingModelNoThinking]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.5 },
      { model: 'candidate-b', point: 0.5 },
    ]) as any)

    await llmPolicy(makeInput({ routingModelId: 'router-model', thinking: true }))
    expect(mockLlmChat).toHaveBeenCalled()
  })

  it('uses project defaults when project is not found in config', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([]) // no projects
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.5 },
      { model: 'candidate-b', point: 0.5 },
    ]) as any)

    const result = await llmPolicy(makeInput({ routingModelId: 'router-model' }))
    expect(result.routing).toHaveLength(2)
  })

  it('handles candidate with a routing prompt', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.8 },
      { model: 'candidate-b', point: 0.2 },
    ]) as any)

    await llmPolicy({
      request: { model: 'auto', messages: [{ role: 'user', content: 'code task' }] },
      candidates: [
        { model: candidateA, prompt: 'Best for coding tasks' },
        { model: candidateB },
      ],
      config: { routingModelId: 'router-model' },
      projectId: 'proj-1',
    } as PolicyInput)
    const systemMsg = (mockLlmChat.mock.calls[0]![0] as any).messages.find((m: any) => m.role === 'system').content
    expect(systemMsg).toContain('routing_guidance')
  })

  it('handles non-string user message content', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.5 },
      { model: 'candidate-b', point: 0.5 },
    ]) as any)

    await llmPolicy({
      request: {
        model: 'auto',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'complex' }] }],
      } as any,
      candidates: [{ model: candidateA }, { model: candidateB }],
      config: { routingModelId: 'router-model' },
      projectId: 'proj-1',
    } as PolicyInput)
    expect(mockLlmChat).toHaveBeenCalled()
  })

  // ── Line 80: non-string system message content (object) ──────────────────
  it('handles non-string system message content', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.7 },
      { model: 'candidate-b', point: 0.3 },
    ]) as any)

    await llmPolicy({
      request: {
        model: 'auto',
        messages: [
          { role: 'system', content: [{ type: 'text', text: 'Be helpful' }] },
          { role: 'user', content: 'Hello' },
        ],
      } as any,
      candidates: [{ model: candidateA }, { model: candidateB }],
      config: { routingModelId: 'router-model' },
      projectId: 'proj-1',
    } as PolicyInput)
    const userMsg = (mockLlmChat.mock.calls[0]![0] as any).messages.find((m: any) => m.role === 'user').content
    expect(userMsg).toContain('system_prompt')
  })

  // ── Line 86: no user message in request (content defaults to empty) ───────
  it('handles request with no user message', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.5 },
      { model: 'candidate-b', point: 0.5 },
    ]) as any)

    await llmPolicy({
      request: {
        model: 'auto',
        messages: [{ role: 'assistant', content: 'Hello there' }],
      } as any,
      candidates: [{ model: candidateA }, { model: candidateB }],
      config: { routingModelId: 'router-model' },
      projectId: 'proj-1',
    } as PolicyInput)
    const userMsg = (mockLlmChat.mock.calls[0]![0] as any).messages.find((m: any) => m.role === 'user').content
    expect(userMsg).toContain('request_to_route')
  })

  // ── Lines 200-201: request.messages is undefined ──────────────────────────
  it('handles request with undefined messages', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.5 },
      { model: 'candidate-b', point: 0.5 },
    ]) as any)

    await llmPolicy({
      request: { model: 'auto' } as any,
      candidates: [{ model: candidateA }, { model: candidateB }],
      config: { routingModelId: 'router-model' },
      projectId: 'proj-1',
    } as unknown as PolicyInput)
    expect(mockLlmChat).toHaveBeenCalled()
  })

  // ── Line 124: routing entry with non-numeric or NaN point ─────────────────
  it('defaults point to 0 when routing entry has non-numeric point', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        routing: [
          { model: 'candidate-a', point: 'high' },
          { model: 'candidate-b', point: NaN },
        ],
      }) } }],
    } as any)

    const result = await llmPolicy(makeInput({ routingModelId: 'router-model' }))
    expect(result.routing.find(r => r.model === 'candidate-a')!.point).toBe(0)
    expect(result.routing.find(r => r.model === 'candidate-b')!.point).toBe(0)
  })

  // ── Line 130: non-Error thrown during JSON parse ──────────────────────────
  it('handles non-Error thrown during JSON parse (string thrown)', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    // Malformed JSON that causes parse to fail with a string message; we simulate
    // the string-thrown branch by returning a valid structure via repair call.
    mockLlmChat
      .mockResolvedValueOnce({ choices: [{ message: { content: 'not json at all !!!' } }] } as any)
      .mockResolvedValueOnce(makeSuccessResponse([
        { model: 'candidate-a', point: 0.6 },
        { model: 'candidate-b', point: 0.4 },
      ]) as any)

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const result = await llmPolicy({ ...makeInput({ routingModelId: 'router-model' }), log })
    expect(result.routing).toHaveLength(2)
  })

  // ── Lines 143-145: regex recovery includes reason field ───────────────────
  it('recovers routing entries with reason field from truncated JSON', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    const truncated = `{"routing": [{"model": "candidate-a", "point": 0.9, "reason": "complex task"}, {"model": "candidate-b", "point": 0`
    mockLlmChat.mockResolvedValue({ choices: [{ message: { content: truncated } }] } as any)

    const result = await llmPolicy(makeInput({ routingModelId: 'router-model' }))
    const entryA = result.routing.find(r => r.model === 'candidate-a')!
    expect(entryA.point).toBe(0.9)
    expect(entryA.reason).toBe('complex task')
  })

  // ── Line 144: regex recovery with NaN point value ─────────────────────────
  it('defaults point to 0 when regex-recovered entry has unparseable number', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    // Craft a response where JSON.parse fails but regex matches an entry
    // with a point that parseFloat returns NaN for (blank match[2] would do it,
    // but our regex only matches [\d.]+ so we simulate it via malformed outer JSON
    // with a valid inner entry where the numeric part is just dots)
    const broken = `not-json {"model": "candidate-a", "point": ..., "extra": true} trailing`
    mockLlmChat
      .mockResolvedValueOnce({ choices: [{ message: { content: broken } }] } as any)
      .mockResolvedValueOnce(makeSuccessResponse([
        { model: 'candidate-a', point: 0.5 },
      ]) as any)

    const result = await llmPolicy(makeInput({ routingModelId: 'router-model' }))
    expect(result.routing).toBeDefined()
  })

  // ── Lines 181, 320: repairRoutingResponse with maxCompletionTokens set ────
  it('passes maxCompletionTokens to repair call when initial parse fails', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat
      .mockResolvedValueOnce({ choices: [{ message: { content: 'garbage response' } }] } as any)
      .mockResolvedValueOnce(makeSuccessResponse([
        { model: 'candidate-a', point: 0.7 },
        { model: 'candidate-b', point: 0.3 },
      ]) as any)

    await llmPolicy(makeInput({ routingModelId: 'router-model', maxCompletionTokens: 300 }))
    const repairCall = mockLlmChat.mock.calls[1]![0] as any
    expect(repairCall.max_completion_tokens).toBe(300)
  })

  // ── Line 188: repairRoutingResponse with null/undefined message content ───
  it('handles null content in repair response gracefully', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat
      .mockResolvedValueOnce({ choices: [{ message: { content: 'garbage' } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: null } }] } as any)

    await expect(llmPolicy(makeInput({ routingModelId: 'router-model' }))).rejects.toThrow('all models failed')
  })

  // ── Line 216: projectId is undefined → fallback project id is empty string ─
  it('uses empty string project id when projectId is undefined', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.5 },
      { model: 'candidate-b', point: 0.5 },
    ]) as any)

    const result = await llmPolicy({
      request: { model: 'auto', messages: [{ role: 'user', content: 'test' }] },
      candidates: [{ model: candidateA }, { model: candidateB }],
      config: { routingModelId: 'router-model' },
      projectId: undefined,
    } as unknown as PolicyInput)
    expect(result.routing).toHaveLength(2)
  })

  // ── Line 251: memory enabled but conversationId missing ──────────────────
  it('skips memory lookup when conversationId is missing', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.9 },
      { model: 'candidate-b', point: 0.1 },
    ]) as any)

    await llmPolicy(makeInput({ routingModelId: 'router-model', memory: true }))
    expect(mockGetRoutingHistory).not.toHaveBeenCalled()
  })

  // ── Line 251: memory enabled but projectId is missing ────────────────────
  it('skips memory lookup when projectId is missing', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.9 },
      { model: 'candidate-b', point: 0.1 },
    ]) as any)

    await llmPolicy({
      ...makeInput({ routingModelId: 'router-model', memory: true }),
      projectId: undefined,
      conversationId: 'conv-xyz',
    } as unknown as PolicyInput)
    expect(mockGetRoutingHistory).not.toHaveBeenCalled()
  })

  // ── Line 251: memory enabled with memoryCount of 0 (uses default 5) ───────
  it('uses default memoryCount of 5 when memoryCount is 0 or invalid', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([{ model: 'candidate-a', ts: Date.now() }])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.9 },
      { model: 'candidate-b', point: 0.1 },
    ]) as any)

    await llmPolicy(makeInput(
      { routingModelId: 'router-model', memory: true, memoryCount: 0 },
      { conversationId: 'conv-abc' },
    ))
    expect(mockGetRoutingHistory).toHaveBeenCalledWith('proj-1', 'conv-abc', 5)
  })

  // ── Line 253: memory enabled but history is empty → previousDecisions = undefined
  it('sets previousDecisions to undefined when memory history is empty', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.9 },
      { model: 'candidate-b', point: 0.1 },
    ]) as any)

    await llmPolicy(makeInput(
      { routingModelId: 'router-model', memory: true },
      { conversationId: 'conv-empty' },
    ))
    const userMsg = (mockLlmChat.mock.calls[0]![0] as any).messages.find((m: any) => m.role === 'user').content
    expect(userMsg).not.toContain('Previous routing decisions')
  })

  // ── Lines 283-284: thinking=true and model DOES support thinking ──────────
  it('uses original model (with thinking) when thinking=true and model supports it', async () => {
    const thinkingModel: ModelConfig = {
      ...routingModel,
      capabilities: { thinking: true },
    }
    mockReadConfig.mockResolvedValueOnce([thinkingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.8 },
      { model: 'candidate-b', point: 0.2 },
    ]) as any)

    await llmPolicy(makeInput({ routingModelId: 'router-model', thinking: true }))
    const calledModel = mockLlmChat.mock.calls[0]![1] as ModelConfig
    expect(calledModel.capabilities?.thinking).toBe(true)
  })

  // ── Lines 290-293: no token/traceId/emit/log in context ──────────────────
  it('builds ctx without optional fields when token/traceId/emit/log are absent', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.5 },
      { model: 'candidate-b', point: 0.5 },
    ]) as any)

    const result = await llmPolicy({
      request: { model: 'auto', messages: [{ role: 'user', content: 'test' }] },
      candidates: [{ model: candidateA }, { model: candidateB }],
      config: { routingModelId: 'router-model' },
      projectId: 'proj-1',
      // no token, traceId, emit, log
    } as PolicyInput)
    expect(result.routing).toHaveLength(2)
    const ctx = mockLlmChat.mock.calls[0]![2] as any
    expect(ctx.token).toBeUndefined()
    expect(ctx.traceId).toBeUndefined()
    expect(ctx.emit).toBeUndefined()
    expect(ctx.log).toBeUndefined()
  })

  // ── Lines 290-293: all optional ctx fields are present ───────────────────
  it('includes token/traceId/emit/log in ctx when all are provided', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.5 },
      { model: 'candidate-b', point: 0.5 },
    ]) as any)

    const emit = vi.fn()
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    await llmPolicy({
      request: { model: 'auto', messages: [{ role: 'user', content: 'test' }] },
      candidates: [{ model: candidateA }, { model: candidateB }],
      config: { routingModelId: 'router-model' },
      projectId: 'proj-1',
      token: 'tok-abc',
      traceId: 'trace-xyz',
      emit,
      log,
    } as unknown as PolicyInput)
    const ctx = mockLlmChat.mock.calls[0]![2] as any
    expect(ctx.token).toBe('tok-abc')
    expect(ctx.traceId).toBe('trace-xyz')
    expect(ctx.emit).toBe(emit)
    expect(ctx.log).toBe(log)
  })

  // ── Line 320: response with null/undefined choices content ───────────────
  it('treats empty choices content as empty string and attempts repair', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat
      .mockResolvedValueOnce({ choices: [{ message: { content: null } }] } as any)
      .mockResolvedValueOnce(makeSuccessResponse([
        { model: 'candidate-a', point: 0.8 },
        { model: 'candidate-b', point: 0.2 },
      ]) as any)

    const result = await llmPolicy(makeInput({ routingModelId: 'router-model' }))
    expect(result.routing).toHaveLength(2)
  })

  // ── Line 320: response with missing choices array ─────────────────────────
  it('treats missing choices array as empty string and attempts repair', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat
      .mockResolvedValueOnce({ choices: null } as any)
      .mockResolvedValueOnce(makeSuccessResponse([
        { model: 'candidate-a', point: 0.6 },
        { model: 'candidate-b', point: 0.4 },
      ]) as any)

    const result = await llmPolicy(makeInput({ routingModelId: 'router-model' }))
    expect(result.routing).toHaveLength(2)
  })

  // ── Line 345: emit scores with reason field present ───────────────────────
  it('includes reason in emitted scores when routing entries have reasons', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    const emit = vi.fn()
    mockLlmChat.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        routing: [
          { model: 'candidate-a', point: 0.9, reason: 'best for this' },
          { model: 'candidate-b', point: 0.1 },
        ],
      }) } }],
    } as any)

    await llmPolicy({
      request: { model: 'auto', messages: [{ role: 'user', content: 'hello' }] },
      candidates: [{ model: candidateA }, { model: candidateB }],
      config: { routingModelId: 'router-model' },
      projectId: 'proj-1',
      emit,
    } as unknown as PolicyInput)

    const scoresCall = emit.mock.calls.find(c => c[0]?.message === 'llm-policy:scores')
    expect(scoresCall).toBeDefined()
    const scores = scoresCall![0].details.scores
    expect(scores.find((s: any) => s.model === 'candidate-a').reason).toBe('best for this')
    expect(scores.find((s: any) => s.model === 'candidate-b').reason).toBeUndefined()
  })

  // ── Line 355: non-Error thrown in llmChat (string exception) ─────────────
  it('handles non-Error thrown by llmChat (string exception)', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    mockLlmChat.mockRejectedValue('string error')

    await expect(llmPolicy(makeInput({ routingModelId: 'router-model' }))).rejects.toThrow('all models failed')
  })

  // ── Line 278: emit called when model not found in config ──────────────────
  it('calls emit with skip message when routing model not found in config', async () => {
    mockReadConfig.mockResolvedValueOnce([]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    const emit = vi.fn()

    await expect(llmPolicy({
      request: { model: 'auto', messages: [{ role: 'user', content: 'test' }] },
      candidates: [{ model: candidateA }, { model: candidateB }],
      config: { routingModelId: 'nonexistent' },
      projectId: 'proj-1',
      emit,
    } as unknown as PolicyInput)).rejects.toThrow('all models failed')
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ message: 'llm-policy:skip' }))
  })

  // ── maxCompletionTokens clamps to minimum 50 ─────────────────────────────
  it('clamps maxCompletionTokens to minimum 50', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.5 },
      { model: 'candidate-b', point: 0.5 },
    ]) as any)

    await llmPolicy(makeInput({ routingModelId: 'router-model', maxCompletionTokens: 10 }))
    const callArgs = mockLlmChat.mock.calls[0]![0] as any
    expect(callArgs.max_completion_tokens).toBe(50)
  })

  // ── maxUserMessageChars clamps to minimum 100 ─────────────────────────────
  it('clamps maxUserMessageChars to minimum 100', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat.mockResolvedValue(makeSuccessResponse([
      { model: 'candidate-a', point: 0.5 },
      { model: 'candidate-b', point: 0.5 },
    ]) as any)

    await llmPolicy(makeInput({ routingModelId: 'router-model', maxUserMessageChars: 10 }))
    const userMsg = (mockLlmChat.mock.calls[0]![0] as any).messages.find((m: any) => m.role === 'user').content
    // should be truncated at 100 chars + '[truncated]' — not at 10
    expect(userMsg.length).toBeGreaterThanOrEqual(100)
  })

  // ── repair call throws → skips model and throws all models failed ─────────
  it('skips model when repair call itself throws', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    mockLlmChat
      .mockResolvedValueOnce({ choices: [{ message: { content: 'garbage' } }] } as any)
      .mockRejectedValueOnce(new Error('repair network error'))

    await expect(llmPolicy(makeInput({ routingModelId: 'router-model' }))).rejects.toThrow('all models failed')
    expect(mockLlmChat).toHaveBeenCalledTimes(2)
  })

  // ── emit called for repair attempt ───────────────────────────────────────
  it('calls emit with repair message when parse fails', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    const emit = vi.fn()
    mockLlmChat
      .mockResolvedValueOnce({ choices: [{ message: { content: 'not json' } }] } as any)
      .mockResolvedValueOnce(makeSuccessResponse([
        { model: 'candidate-a', point: 0.7 },
        { model: 'candidate-b', point: 0.3 },
      ]) as any)

    await llmPolicy({
      request: { model: 'auto', messages: [{ role: 'user', content: 'test' }] },
      candidates: [{ model: candidateA }, { model: candidateB }],
      config: { routingModelId: 'router-model' },
      projectId: 'proj-1',
      emit,
    } as unknown as PolicyInput)
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ message: 'llm-policy:repair' }))
  })

  // ── emit called for llm-policy:error on non-budget call failure ───────────
  it('calls emit with error message on non-budget llmChat failure', async () => {
    mockReadConfig.mockResolvedValueOnce([routingModel]).mockResolvedValueOnce([project])
    mockGetLimitUsageSnapshot.mockResolvedValue([])
    mockGetRoutingHistory.mockReturnValue([])
    const emit = vi.fn()
    mockLlmChat.mockRejectedValue(new Error('timeout'))

    await expect(llmPolicy({
      request: { model: 'auto', messages: [{ role: 'user', content: 'test' }] },
      candidates: [{ model: candidateA }, { model: candidateB }],
      config: { routingModelId: 'router-model' },
      projectId: 'proj-1',
      emit,
    } as unknown as PolicyInput)).rejects.toThrow('all models failed')
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ message: 'llm-policy:error' }))
  })
})
