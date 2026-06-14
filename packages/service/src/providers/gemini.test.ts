import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))
vi.mock('openai', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: vi.fn().mockImplementation(function (this: any) {
    this.chat = { completions: { create: mockCreate } }
  }),
}))

import { GeminiAdapter } from './gemini.js'
import type { ModelConfig, MessagesRequest } from '@routerly/shared'

afterEach(() => { vi.clearAllMocks() })

function makeModel(id = 'gemini-1.5-flash'): ModelConfig {
  return {
    id, name: 'Gemini Flash', provider: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKey: 'AIza-test',
    cost: { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  }
}

const adapter = new GeminiAdapter()

describe('GeminiAdapter.chatCompletion', () => {
  it('calls OpenAI-compat endpoint and returns response', async () => {
    mockCreate.mockResolvedValue({
      id: 'chatcmpl-1',
      choices: [{ message: { role: 'assistant', content: 'Hello from Gemini' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    })

    const result = await adapter.chatCompletion({
      model: 'auto',
      messages: [{ role: 'user', content: 'Hi' }],
    }, makeModel())

    expect(result.choices[0]!.message.content).toBe('Hello from Gemini')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ stream: false }))
  })

  it('strips stream field from request', async () => {
    mockCreate.mockResolvedValue({
      id: '1', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    await adapter.chatCompletion({ model: 'auto', messages: [], stream: true } as any, makeModel())
    expect(mockCreate.mock.calls[0]![0].stream).toBe(false)
  })
})

describe('GeminiAdapter.streamCompletion', () => {
  it('yields chunks from the stream', async () => {
    const chunks = [
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c },
    })

    const received: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) {
      received.push(chunk)
    }
    expect(received).toHaveLength(2)
    expect(received[0].choices[0].delta.content).toBe('Hel')
  })
})

describe('GeminiAdapter.getClient defaults', () => {
  it('uses empty string when apiKey is missing (covers ?? "")', async () => {
    mockCreate.mockResolvedValue({
      id: '1', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    const modelNoKey: ModelConfig = {
      id: 'gemini-1.5', name: 'Gemini', provider: 'gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      cost: { inputPerMillion: 0.075, outputPerMillion: 0.3 },
      // no apiKey
    }
    await adapter.chatCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }, modelNoKey)
    expect(mockCreate).toHaveBeenCalled()
  })

  it('uses default Gemini endpoint when endpoint is not set (covers ||)', async () => {
    mockCreate.mockResolvedValue({
      id: '2', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    const modelNoEndpoint = {
      id: 'gemini-1.5', name: 'Gemini', provider: 'gemini',
      apiKey: 'AIza-test',
      cost: { inputPerMillion: 0.075, outputPerMillion: 0.3 },
    } as ModelConfig
    await adapter.chatCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }, modelNoEndpoint)
    expect(mockCreate).toHaveBeenCalled()
  })
})

describe('GeminiAdapter.messages', () => {
  it('converts MessagesRequest to OpenAI format and returns Anthropic-format response', async () => {
    mockCreate.mockResolvedValue({
      id: 'gchat-1', model: 'gemini-1.5-flash',
      choices: [{ message: { content: 'Gemini response' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })

    const request: MessagesRequest = {
      model: 'gemini-1.5-flash',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hello' }],
      system: 'Be helpful.',
    }
    const result = await adapter.messages(request, makeModel())
    expect(result.content[0]!.type).toBe('text')
    expect((result.content[0] as any).text).toBe('Gemini response')
    // System prompt should be prepended as system message
    const callMessages = mockCreate.mock.calls[0]![0].messages
    expect(callMessages[0].role).toBe('system')
    expect(callMessages[0].content).toBe('Be helpful.')
  })

  it('handles MessagesRequest without system prompt', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    const request: MessagesRequest = {
      model: 'gemini',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hi' }],
    }
    await adapter.messages(request, makeModel())
    const callMessages = mockCreate.mock.calls[0]![0].messages
    expect(callMessages[0].role).toBe('user')
  })
})
