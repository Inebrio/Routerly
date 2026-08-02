import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))
vi.mock('openai', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: vi.fn().mockImplementation(function (this: any) {
    this.chat = { completions: { create: mockCreate } }
  }),
}))

import { GeminiAdapter, unwrapGeminiError } from './gemini.js'
import type { ModelConfig, MessagesRequest } from '@routerly/shared'

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

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

  it('strips provider prefix from model ID before upstream call (#115)', async () => {
    mockCreate.mockResolvedValue({
      id: '1', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    await adapter.chatCompletion(
      { model: 'gemini/gemini-2.5-pro', messages: [{ role: 'user', content: 'hi' }] },
      makeModel('gemini/gemini-2.5-pro'),
    )
    expect(mockCreate.mock.calls[0]![0].model).toBe('gemini-2.5-pro')
  })
})

describe('GeminiAdapter thought signatures', () => {
  const toolHistory = [
    { role: 'user' as const, content: 'read it' },
    {
      role: 'assistant' as const, content: null,
      tool_calls: [{ id: 'toolu_01', type: 'function' as const, function: { name: 'Read', arguments: '{}' } }],
    },
    { role: 'tool' as const, tool_call_id: 'toolu_01', content: '42' },
  ]

  it('stamps the placeholder signature on replayed tool calls (Gemini 3 rejects them otherwise)', async () => {
    mockCreate.mockResolvedValue({ id: '1', choices: [{ message: { content: '42' }, finish_reason: 'stop' }], usage: {} })

    await adapter.chatCompletion({ model: 'auto', messages: toolHistory as any }, makeModel('gemini-3.5-flash'))

    const sent = mockCreate.mock.calls[0]![0].messages
    expect(sent[1].tool_calls[0].extra_content).toEqual({ google: { thought_signature: 'skip_thought_signature_validator' } })
    expect(sent[0]).toEqual({ role: 'user', content: 'read it' })
    expect(sent[2]).toEqual({ role: 'tool', tool_call_id: 'toolu_01', content: '42' })
  })

  it('keeps a real signature when the tool call already carries one', async () => {
    mockCreate.mockResolvedValue({ id: '1', choices: [{ message: { content: '42' }, finish_reason: 'stop' }], usage: {} })
    const signed = [
      toolHistory[0],
      {
        ...toolHistory[1],
        tool_calls: [{ ...toolHistory[1]!.tool_calls![0], extra_content: { google: { thought_signature: 'real-sig' } } }],
      },
      toolHistory[2],
    ]

    await adapter.chatCompletion({ model: 'auto', messages: signed as any }, makeModel('gemini-3.5-flash'))

    const sent = mockCreate.mock.calls[0]![0].messages
    expect(sent[1].tool_calls[0].extra_content.google.thought_signature).toBe('real-sig')
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

  it('strips provider prefix from model ID before upstream call (#115)', async () => {
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {},
    })

    // consume the generator
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of adapter.streamCompletion(
      { model: 'gemini/gemini-2.5-pro', messages: [] },
      makeModel('gemini/gemini-2.5-pro'),
    )) { /* noop */ }
    expect(mockCreate.mock.calls[0]![0].model).toBe('gemini-2.5-pro')
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

  it('strips provider prefix from model ID before upstream call (#115)', async () => {
    mockCreate.mockResolvedValue({
      id: '1', model: 'gemini-2.5-pro',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    await adapter.messages(
      { model: 'gemini/gemini-2.5-pro', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] },
      makeModel('gemini/gemini-2.5-pro'),
    )
    expect(mockCreate.mock.calls[0]![0].model).toBe('gemini-2.5-pro')
  })
})

describe('unwrapGeminiError', () => {
  it('unwraps array-wrapped Gemini error so the SDK can read .error', async () => {
    const upstream = new Response(
      JSON.stringify([{ error: { code: 429, message: 'You exceeded your current quota' } }]),
      { status: 429, headers: { 'content-type': 'application/json' } },
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream))

    const res = await unwrapGeminiError('https://generativelanguage.googleapis.com/x', {})
    expect(res.status).toBe(429)
    const body = await res.json() as { error?: { message?: string } }
    expect(body.error?.message).toBe('You exceeded your current quota')
  })

  it('passes successful responses through untouched (body not consumed)', async () => {
    const ok = new Response('data: chunk', { status: 200 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok))

    const res = await unwrapGeminiError('https://x', {})
    expect(res).toBe(ok)
    expect(await res.text()).toBe('data: chunk')
  })

  it('forwards object-shaped error bodies unchanged', async () => {
    const upstream = new Response(
      JSON.stringify({ error: { code: 401, message: 'API key not valid' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream))

    const res = await unwrapGeminiError('https://x', {})
    expect(res.status).toBe(401)
    const body = await res.json() as { error?: { message?: string } }
    expect(body.error?.message).toBe('API key not valid')
  })

  it('forwards non-JSON error bodies as-is', async () => {
    const upstream = new Response('502 Bad Gateway', { status: 502 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream))

    const res = await unwrapGeminiError('https://x', {})
    expect(res.status).toBe(502)
    expect(await res.text()).toBe('502 Bad Gateway')
  })
})
