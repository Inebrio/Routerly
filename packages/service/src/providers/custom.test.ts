import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))
vi.mock('openai', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: vi.fn().mockImplementation(function (this: any) {
    this.chat = { completions: { create: mockCreate } }
  }),
}))

import { CustomAdapter } from './custom.js'
import type { ModelConfig, MessagesRequest } from '@routerly/shared'

afterEach(() => { vi.clearAllMocks() })

function makeModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek Chat',
    provider: 'custom',
    endpoint: 'https://api.deepseek.com/v1',
    apiKey: 'ds-test',
    cost: { inputPerMillion: 0.14, outputPerMillion: 0.28 },
    ...overrides,
  }
}

const adapter = new CustomAdapter()

describe('CustomAdapter.chatCompletion', () => {
  it('calls OpenAI-compat endpoint with correct model ID', async () => {
    mockCreate.mockResolvedValue({
      id: 'ds-1',
      choices: [{ message: { content: 'Hello from DeepSeek' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    })

    const result = await adapter.chatCompletion({
      model: 'auto',
      messages: [{ role: 'user', content: 'Hi' }],
    }, makeModel())

    expect(result.choices[0]!.message.content).toBe('Hello from DeepSeek')
    expect(mockCreate.mock.calls[0]![0].model).toBe('deepseek-chat') // stripped prefix
    expect(mockCreate.mock.calls[0]![0].stream).toBe(false)
  })

  it('prefers upstreamModelId over id prefix stripping', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    await adapter.chatCompletion({ model: 'auto', messages: [] }, makeModel({ upstreamModelId: 'deepseek-reasoner' }))
    expect(mockCreate.mock.calls[0]![0].model).toBe('deepseek-reasoner')
  })

  it('throws when endpoint is not configured', async () => {
    const noEndpointModel = makeModel({ endpoint: undefined } as any)
    await expect(adapter.chatCompletion({ model: 'auto', messages: [] }, noEndpointModel)).rejects.toThrow(
      'no endpoint configured',
    )
  })

  it('strips stream field before forwarding', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    await adapter.chatCompletion({ model: 'auto', messages: [], stream: true } as any, makeModel())
    expect(mockCreate.mock.calls[0]![0].stream).toBe(false)
  })

  it('uses model id as-is when no prefix present', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    await adapter.chatCompletion({ model: 'auto', messages: [] }, makeModel({ id: 'plain-model-id' }))
    expect(mockCreate.mock.calls[0]![0].model).toBe('plain-model-id')
  })
})

describe('CustomAdapter.streamCompletion', () => {
  it('yields stream chunks', async () => {
    const chunks = [
      { choices: [{ delta: { content: 'Stream' } }] },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c },
    })

    const received: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) {
      received.push(chunk)
    }
    expect(received[0].choices[0].delta.content).toBe('Stream')
  })
})

describe('CustomAdapter.messages', () => {
  it('converts MessagesRequest and returns Anthropic-format response', async () => {
    mockCreate.mockResolvedValue({
      id: 'custom-1', model: 'deepseek-chat',
      choices: [{ message: { content: 'Custom response' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    })

    const request: MessagesRequest = {
      model: 'deepseek/deepseek-chat',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hello' }],
      system: 'You are helpful.',
    }
    const result = await adapter.messages(request, makeModel())
    expect((result.content[0] as any).text).toBe('Custom response')
    const callMessages = mockCreate.mock.calls[0]![0].messages
    expect(callMessages[0].role).toBe('system')
    expect(callMessages[0].content).toBe('You are helpful.')
  })

  it('handles messages without system prompt', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    const request: MessagesRequest = {
      model: 'custom', max_tokens: 50,
      messages: [{ role: 'user', content: 'Hi' }],
    }
    await adapter.messages(request, makeModel())
    const callMessages = mockCreate.mock.calls[0]![0].messages
    expect(callMessages[0].role).toBe('user')
  })
})

describe('CustomAdapter — no endpoint (line 19)', () => {
  it('throws when model has no endpoint configured', async () => {
    const adapter = new CustomAdapter()
    const modelNoEp = makeModel({ endpoint: undefined } as any)
    await expect(adapter.chatCompletion({ messages: [] } as any, modelNoEp)).rejects.toThrow('has no endpoint configured')
  })
})

describe('CustomAdapter — no apiKey (line 19 ?? branch)', () => {
  it('uses "custom" as apiKey fallback when model.apiKey is undefined', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const modelNoKey: any = { ...makeModel(), apiKey: undefined }
    await adapter.chatCompletion({ messages: [{ role: 'user', content: 'Hi' }] } as any, modelNoKey)
    expect(mockCreate).toHaveBeenCalled()
  })
})
