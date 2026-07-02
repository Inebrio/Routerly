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
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'ds-1',
        choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await adapter.chatCompletion({
      model: 'auto',
      messages: [{ role: 'user', content: 'Hi' }],
    }, makeModel())

    expect(result.choices[0]!.message.content).toBe('Hello')
    const [url, opts] = mockFetch.mock.calls[0]!
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions')
    const body = JSON.parse(opts.body as string)
    expect(body.model).toBe('deepseek-chat')
    expect(body.stream).toBe(false)

    vi.unstubAllGlobals()
  })

  it('strips stream field before forwarding', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await adapter.chatCompletion({ model: 'auto', messages: [], stream: true } as any, makeModel())
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.stream).toBe(false)

    vi.unstubAllGlobals()
  })

  it('forwards reasoning_content in messages', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await adapter.chatCompletion({
      model: 'auto',
      messages: [{ role: 'assistant', content: 'Think', reasoning_content: '<think>x</think>' } as any],
    }, makeModel())
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.messages[0].reasoning_content).toBe('<think>x</think>')

    vi.unstubAllGlobals()
  })

  it('uses "custom" as apiKey fallback', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await adapter.chatCompletion({ model: 'auto', messages: [] }, makeModel({ apiKey: undefined } as any))
    const [, opts] = mockFetch.mock.calls[0]!
    expect(opts.headers['Authorization']).toBe('Bearer custom')

    vi.unstubAllGlobals()
  })

  it('throws when endpoint is not configured', async () => {
    const noEndpoint = makeModel({ endpoint: undefined } as any)
    await expect(adapter.chatCompletion({ model: 'auto', messages: [] }, noEndpoint)).rejects.toThrow('no endpoint configured')
  })

  it('throws on non-2xx response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' })
    vi.stubGlobal('fetch', mockFetch)

    await expect(adapter.chatCompletion({ model: 'auto', messages: [] }, makeModel())).rejects.toThrow('401')

    vi.unstubAllGlobals()
  })
})

describe('CustomAdapter.streamCompletion', () => {
  it('yields stream chunks', async () => {
    const encoder = new TextEncoder()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: (async function* () {
        const chunk = { choices: [{ delta: { content: 'Stream' } }] }
        yield encoder.encode(`data: ${JSON.stringify(chunk)}\n`)
        yield encoder.encode('data: [DONE]\n')
      })() as unknown as ReadableStream,
    })
    vi.stubGlobal('fetch', mockFetch)

    const received: any[] = []
    for await (const c of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) {
      received.push(c)
    }
    expect(received).toHaveLength(1)
    expect(received[0].choices[0].delta.content).toBe('Stream')

    vi.unstubAllGlobals()
  })

  it('stops at [DONE] marker', async () => {
    const encoder = new TextEncoder()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: (async function* () {
        yield encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'first' } }] })}\n`)
        yield encoder.encode('data: [DONE]\n')
        yield encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'never' } }] })}\n`)
      })() as unknown as ReadableStream,
    })
    vi.stubGlobal('fetch', mockFetch)

    const received: any[] = []
    for await (const c of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) {
      received.push(c)
    }
    expect(received).toHaveLength(1)

    vi.unstubAllGlobals()
  })

  it('forwards reasoning_content in stream chunks', async () => {
    const encoder = new TextEncoder()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: (async function* () {
        yield encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok', reasoning_content: '<x>' } }] })}\n`)
        yield encoder.encode('data: [DONE]\n')
      })() as unknown as ReadableStream,
    })
    vi.stubGlobal('fetch', mockFetch)

    const received: any[] = []
    for await (const c of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) {
      received.push(c)
    }
    expect(received[0].choices[0].delta.reasoning_content).toBe('<x>')

    vi.unstubAllGlobals()
  })

  it('throws when endpoint is not configured', async () => {
    const noEndpoint = makeModel({ endpoint: undefined } as any)
    await expect(async () => {
      for await (const _ of adapter.streamCompletion({ model: 'auto', messages: [] }, noEndpoint)) { /* empty */ }
    }).rejects.toThrow('no endpoint configured')
  })

  it('throws on non-2xx response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'Bad' })
    vi.stubGlobal('fetch', mockFetch)

    await expect(async () => {
      for await (const _ of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) { /* empty */ }
    }).rejects.toThrow('400')

    vi.unstubAllGlobals()
  })

  it('throws when response body is null', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body: null })
    vi.stubGlobal('fetch', mockFetch)

    await expect(async () => {
      for await (const _ of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) { /* empty */ }
    }).rejects.toThrow('no response body')

    vi.unstubAllGlobals()
  })

  it('flushes buffer with valid SSE data at end', async () => {
    const encoder = new TextEncoder()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: (async function* () {
        yield encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'final' } }] })}`)
      })() as unknown as ReadableStream,
    })
    vi.stubGlobal('fetch', mockFetch)

    const received: any[] = []
    for await (const c of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) {
      received.push(c)
    }
    expect(received).toHaveLength(1)
    expect(received[0].choices[0].delta.content).toBe('final')

    vi.unstubAllGlobals()
  })

  it('skips malformed JSON in buffer', async () => {
    const encoder = new TextEncoder()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: (async function* () {
        yield encoder.encode('data: {invalid')
      })() as unknown as ReadableStream,
    })
    vi.stubGlobal('fetch', mockFetch)

    const received: any[] = []
    for await (const c of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) {
      received.push(c)
    }
    expect(received).toHaveLength(0)

    vi.unstubAllGlobals()
  })

  it('skips non-data lines', async () => {
    const encoder = new TextEncoder()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: (async function* () {
        yield encoder.encode(`event: message\n`)
        yield encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n`)
        yield encoder.encode(`:\n`)
        yield encoder.encode('data: [DONE]\n')
      })() as unknown as ReadableStream,
    })
    vi.stubGlobal('fetch', mockFetch)

    const received: any[] = []
    for await (const c of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) {
      received.push(c)
    }
    expect(received).toHaveLength(1)

    vi.unstubAllGlobals()
  })

  it('handles multiple parsing edge cases in one stream', async () => {
    const encoder = new TextEncoder()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: (async function* () {
        yield encoder.encode(`\n`)
        yield encoder.encode(`event: start\n`)
        yield encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'test' } }] })}\n`)
        yield encoder.encode(`\n`)
        yield encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'end' } }] })}`)
      })() as unknown as ReadableStream,
    })
    vi.stubGlobal('fetch', mockFetch)

    const received: any[] = []
    for await (const c of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) {
      received.push(c)
    }
    expect(received).toHaveLength(2)

    vi.unstubAllGlobals()
  })

  it('uses "custom" as apiKey fallback', async () => {
    const encoder = new TextEncoder()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: (async function* () {
        yield encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n`)
        yield encoder.encode('data: [DONE]\n')
      })() as unknown as ReadableStream,
    })
    vi.stubGlobal('fetch', mockFetch)

    const received: any[] = []
    for await (const c of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel({ apiKey: undefined } as any))) {
      received.push(c)
    }
    expect(received).toHaveLength(1)
    const [, opts] = mockFetch.mock.calls[0]!
    expect(opts.headers['Authorization']).toBe('Bearer custom')

    vi.unstubAllGlobals()
  })

  it('ignores buffer content that does not start with data:', async () => {
    const encoder = new TextEncoder()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: (async function* () {
        yield encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n`)
        yield encoder.encode('event: done')
      })() as unknown as ReadableStream,
    })
    vi.stubGlobal('fetch', mockFetch)

    const received: any[] = []
    for await (const c of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) {
      received.push(c)
    }
    expect(received).toHaveLength(1)

    vi.unstubAllGlobals()
  })

  it('skips buffer flush when remaining data is empty', async () => {
    const encoder = new TextEncoder()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: (async function* () {
        yield encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n`)
        yield encoder.encode('data: ')
      })() as unknown as ReadableStream,
    })
    vi.stubGlobal('fetch', mockFetch)

    const received: any[] = []
    for await (const c of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) {
      received.push(c)
    }
    expect(received).toHaveLength(1)

    vi.unstubAllGlobals()
  })

  it('skips buffer flush when remaining data is [DONE]', async () => {
    const encoder = new TextEncoder()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: (async function* () {
        yield encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n`)
        yield encoder.encode('data: [DONE]')
      })() as unknown as ReadableStream,
    })
    vi.stubGlobal('fetch', mockFetch)

    const received: any[] = []
    for await (const c of adapter.streamCompletion({ model: 'auto', messages: [] }, makeModel())) {
      received.push(c)
    }
    expect(received).toHaveLength(1)

    vi.unstubAllGlobals()
  })
})

describe('CustomAdapter.messages', () => {
  it('converts MessagesRequest and returns Anthropic response', async () => {
    mockCreate.mockResolvedValue({
      id: 'c-1', model: 'deepseek-chat',
      choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    })

    const request: MessagesRequest = {
      model: 'deepseek/deepseek-chat',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hello' }],
      system: 'You are helpful.',
    }
    const result = await adapter.messages(request, makeModel())
    expect((result.content[0] as any).text).toBe('Response')
    const callMessages = mockCreate.mock.calls[0]![0].messages
    expect(callMessages[0].role).toBe('system')
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

  it('throws when endpoint is not configured', async () => {
    const noEndpoint = makeModel({ endpoint: undefined } as any)
    const request: MessagesRequest = {
      model: 'custom', max_tokens: 50,
      messages: [{ role: 'user', content: 'Hi' }],
    }
    await expect(adapter.messages(request, noEndpoint)).rejects.toThrow('no endpoint configured')
  })

  it('uses "custom" as fallback apiKey', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    const request: MessagesRequest = {
      model: 'custom', max_tokens: 50,
      messages: [{ role: 'user', content: 'Hi' }],
    }
    await adapter.messages(request, makeModel({ apiKey: undefined } as any))
    expect(mockCreate).toHaveBeenCalled()
  })
})

describe('CustomAdapter — model ID handling', () => {
  it('uses model id as-is when no prefix present', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await adapter.chatCompletion({ model: 'auto', messages: [] }, makeModel({ id: 'plain-model' }))
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.model).toBe('plain-model')

    vi.unstubAllGlobals()
  })

  it('prefers upstreamModelId over id prefix stripping', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await adapter.chatCompletion({ model: 'auto', messages: [] }, makeModel({ upstreamModelId: 'custom-reasoner' }))
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.model).toBe('custom-reasoner')

    vi.unstubAllGlobals()
  })
})
