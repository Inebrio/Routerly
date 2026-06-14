import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))
vi.mock('openai', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: vi.fn().mockImplementation(function (this: any) {
    this.chat = { completions: { create: mockCreate } }
  }),
}))

import { OllamaAdapter } from './ollama.js'
import type { ModelConfig, MessagesRequest } from '@routerly/shared'

afterEach(() => { vi.clearAllMocks() })

function makeModel(id = 'llama3.1', caps?: Partial<NonNullable<ModelConfig['capabilities']>>): ModelConfig {
  return {
    id, name: 'Llama 3.1', provider: 'ollama',
    endpoint: 'http://localhost:11434/v1',
    cost: { inputPerMillion: 0, outputPerMillion: 0 },
    ...(caps ? { capabilities: caps } : {}),
  }
}

const adapter = new OllamaAdapter()

describe('OllamaAdapter.chatCompletion', () => {
  it('calls OpenAI-compat endpoint with ollama normalizations', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    })

    const result = await adapter.chatCompletion({
      model: 'auto',
      messages: [{ role: 'user', content: 'Hi' }],
      max_completion_tokens: 200,
    }, makeModel())

    expect(result.choices[0]!.message.content).toBe('Hello')
    const call = mockCreate.mock.calls[0]![0]
    expect(call.max_tokens).toBe(200)
    expect(call.think).toBe(false) // thinking disabled by default
  })

  it('strips model id prefix for upstream call', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    await adapter.chatCompletion({ model: 'auto', messages: [] }, makeModel('ollama/llama3.1'))
    expect(mockCreate.mock.calls[0]![0].model).toBe('llama3.1')
  })

  it('enables thinking when capability is set', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'thought' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    await adapter.chatCompletion({ model: 'auto', messages: [] }, makeModel('qwen3', { thinking: true }))
    const call = mockCreate.mock.calls[0]![0]
    expect(call.think).toBeUndefined() // not set to false when thinking enabled
  })

  it('falls back thinking content to content field when thinking disabled', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: '', thinking: 'I thought about it' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    const result = await adapter.chatCompletion({ model: 'auto', messages: [] }, makeModel())
    expect(result.choices[0]!.message.content).toBe('I thought about it')
  })

  it('does not fallback thinking when content is present', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'real content', thinking: 'thinking' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    const result = await adapter.chatCompletion({ model: 'auto', messages: [] }, makeModel())
    expect(result.choices[0]!.message.content).toBe('real content')
  })
})

describe('OllamaAdapter.streamCompletion', () => {
  it('yields stream chunks normally', async () => {
    const chunks = [
      { choices: [{ delta: { content: 'Hello' } }] },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c },
    })

    const received: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) {
      received.push(chunk)
    }
    expect(received[0].choices[0].delta.content).toBe('Hello')
  })

  it('remaps thinking-only delta to content when thinking disabled', async () => {
    const chunks = [
      { choices: [{ delta: { thinking: 'Let me think', content: undefined } }] },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c },
    })

    const received: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) {
      received.push(chunk)
    }
    expect(received[0].choices[0].delta.content).toBe('Let me think')
    expect(received[0].choices[0].delta.thinking).toBeUndefined()
  })

  it('does not remap thinking-only delta when thinking is enabled', async () => {
    const chunks = [
      { choices: [{ delta: { thinking: 'My thoughts', content: undefined } }] },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c },
    })

    const received: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel('qwen3', { thinking: true }))) {
      received.push(chunk)
    }
    expect(received[0].choices[0].delta.thinking).toBe('My thoughts')
  })
})

describe('OllamaAdapter.messages', () => {
  it('converts MessagesRequest to OpenAI compat format', async () => {
    mockCreate.mockResolvedValue({
      id: 'o-1', model: 'llama3.1',
      choices: [{ message: { content: 'Llama response' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    })

    const request: MessagesRequest = {
      model: 'llama3.1',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hello' }],
      system: 'You are helpful.',
    }
    const result = await adapter.messages(request, makeModel())
    expect((result.content[0] as any).text).toBe('Llama response')
    const callMessages = mockCreate.mock.calls[0]![0].messages
    expect(callMessages[0].role).toBe('system')
  })

  it('omits system message when system is not set (line 105 false branch)', async () => {
    mockCreate.mockResolvedValue({
      id: 'o-2', model: 'llama3.1',
      choices: [{ message: { content: 'No system' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 2 },
    })

    const request: MessagesRequest = {
      model: 'llama3.1',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hello' }],
    }
    const result = await adapter.messages(request, makeModel())
    expect((result.content[0] as any).text).toBe('No system')
    const callMessages = mockCreate.mock.calls[0]![0].messages
    expect(callMessages[0].role).toBe('user')
  })
})

describe('OllamaAdapter — empty endpoint (line 19 || branch)', () => {
  it('uses default Ollama URL when model.endpoint is empty string', async () => {
    mockCreate.mockResolvedValue({
      id: 'e-1', model: 'llama3.1',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const adapterNoEp = new OllamaAdapter()
    const modelNoEp: any = { ...makeModel(), endpoint: '' }
    await adapterNoEp.chatCompletion({ messages: [{ role: 'user', content: 'Hi' }] } as any, modelNoEp)
    expect(mockCreate).toHaveBeenCalled()
  })
})
