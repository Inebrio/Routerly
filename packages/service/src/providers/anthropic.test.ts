import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: vi.fn().mockImplementation(function (this: any) {
    this.messages = { create: mockCreate }
  }),
}))

import { AnthropicAdapter } from './anthropic.js'
import type { ModelConfig, MessagesRequest } from '@routerly/shared'

afterEach(() => { vi.clearAllMocks() })

function makeModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'claude-3-haiku-20240307',
    name: 'Claude 3 Haiku',
    provider: 'anthropic',
    endpoint: 'https://api.anthropic.com',
    apiKey: 'sk-ant-test',
    cost: { inputPerMillion: 0.25, outputPerMillion: 1.25 },
    ...overrides,
  }
}

const adapter = new AnthropicAdapter()

describe('AnthropicAdapter.chatCompletion', () => {
  it('calls anthropic messages API and converts response to OpenAI format', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-123',
      model: 'claude-3-haiku-20240307',
      content: [{ type: 'text', text: 'Hello!' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    const result = await adapter.chatCompletion({
      model: 'auto',
      messages: [{ role: 'user', content: 'Hello' }],
    }, makeModel())

    expect(result.choices[0]!.message.content).toBe('Hello!')
    expect(result.choices[0]!.finish_reason).toBe('stop')
    expect(result.usage!.prompt_tokens).toBe(10)
    expect(result.usage!.completion_tokens).toBe(5)
  })

  it('extracts system message from messages array', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-sys',
      model: 'claude-3-haiku',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ],
    }, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    expect(callParams.system).toBe('You are helpful.')
    expect(callParams.messages).not.toContainEqual(expect.objectContaining({ role: 'system' }))
  })

  it('enables thinking when model.capabilities.thinking is true', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-think',
      model: 'claude-3-haiku',
      content: [{ type: 'text', text: 'thought' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [{ role: 'user', content: 'Think hard' }],
    }, makeModel({ capabilities: { thinking: true } }))

    const callParams = mockCreate.mock.calls[0]![0]
    expect(callParams.thinking).toEqual({ type: 'enabled', budget_tokens: 10000 })
    expect(callParams.max_tokens).toBeGreaterThanOrEqual(16000)
  })

  it('converts tool result messages to Anthropic format', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-tool',
      model: 'claude-3',
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'user', content: 'Call a tool' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', function: { name: 'fn', arguments: '{}' } }] } as any,
        { role: 'tool', tool_call_id: 'tc1', content: 'result' } as any,
      ],
    }, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    const toolResult = callParams.messages.find((m: any) => m.role === 'user' && Array.isArray(m.content))
    expect(toolResult.content[0].type).toBe('tool_result')
  })

  it('handles image content parts (data URI)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-img', model: 'claude-3',
      content: [{ type: 'text', text: 'I see an image' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } }] },
      ],
    } as any, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    const imgBlock = callParams.messages[0].content[0]
    expect(imgBlock.type).toBe('image')
    expect(imgBlock.source.type).toBe('base64')
  })

  it('handles image URL content parts', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-img2', model: 'claude-3',
      content: [{ type: 'text', text: 'seen' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } }] },
      ],
    } as any, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    const imgBlock = callParams.messages[0].content[0]
    expect(imgBlock.source.type).toBe('url')
  })

  it('strips provider prefix from model id for upstream call', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-prefix', model: 'claude-3-haiku',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [{ role: 'user', content: 'Hi' }],
    }, makeModel({ id: 'anthropic/claude-3-haiku' }))

    expect(mockCreate.mock.calls[0]![0].model).toBe('claude-3-haiku')
  })

  it('includes cache token counts in usage', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-cache', model: 'claude-3',
      content: [{ type: 'text', text: 'cached' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
    })

    const result = await adapter.chatCompletion({
      model: 'auto',
      messages: [{ role: 'user', content: 'Hi' }],
    }, makeModel())

    expect(result.usage!.prompt_tokens).toBe(15) // 10 + 3 + 2
  })
})

  it('includes text content when assistant message has content AND tool_calls (non-string content)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-tc-content', model: 'claude-3',
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'user', content: 'Call a tool' },
        { role: 'assistant', content: [{ type: 'text', text: 'I will call' }], tool_calls: [{ id: 'tc2', function: { name: 'fn', arguments: '{}' } }] } as any,
        { role: 'tool', tool_call_id: 'tc2', content: 'result' } as any,
      ],
    }, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    const assistantMsg = callParams.messages.find((m: any) => m.role === 'assistant')
    // Should have text block from non-string content
    expect(assistantMsg.content.some((b: any) => b.type === 'text')).toBe(true)
  })

describe('AnthropicAdapter — uncovered branches', () => {
  it('convertContent: text block with undefined text falls back to empty string (line 61)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-notext', model: 'claude-3',
      content: [{ type: 'text', text: '' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        // content part with type:'text' but no text field → text ?? '' should yield ''
        { role: 'user', content: [{ type: 'text' }] },
      ],
    } as any, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    const block = callParams.messages[0].content[0]
    expect(block.type).toBe('text')
    expect(block.text).toBe('')
  })

  it('convertSystem: array content maps to Anthropic text blocks (lines 72-74)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-sys-arr', model: 'claude-3',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'Be helpful.', cache_control: { type: 'ephemeral' } }] },
        { role: 'user', content: 'Hi' },
      ],
    } as any, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    expect(Array.isArray(callParams.system)).toBe(true)
    expect(callParams.system[0]).toMatchObject({ type: 'text', text: 'Be helpful.', cache_control: { type: 'ephemeral' } })
  })

  it('convertSystem: array content part with undefined text falls back to empty string (line 74)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-sys-notext', model: 'claude-3',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'system', content: [{ type: 'text' }] },
        { role: 'user', content: 'Hi' },
      ],
    } as any, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    expect(Array.isArray(callParams.system)).toBe(true)
    expect(callParams.system[0].text).toBe('')
  })

  it('merges consecutive tool result messages into the same user turn (line 94)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-multi-tool', model: 'claude-3',
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'user', content: 'Use two tools' },
        {
          role: 'assistant', content: null,
          tool_calls: [
            { id: 'tc-a', function: { name: 'fnA', arguments: '{}' } },
            { id: 'tc-b', function: { name: 'fnB', arguments: '{}' } },
          ],
        } as any,
        { role: 'tool', tool_call_id: 'tc-a', content: 'result-a' } as any,
        { role: 'tool', tool_call_id: 'tc-b', content: 'result-b' } as any,
      ],
    }, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    // Both tool results should be merged into a single user message
    const userMessages = callParams.messages.filter((m: any) => m.role === 'user' && Array.isArray(m.content))
    // Only one user turn should hold both tool_result blocks
    const mergedUser = userMessages.find((m: any) => m.content.length === 2)
    expect(mergedUser).toBeDefined()
    expect(mergedUser.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tc-a' })
    expect(mergedUser.content[1]).toMatchObject({ type: 'tool_result', tool_use_id: 'tc-b' })
  })
})

describe('AnthropicAdapter.messages', () => {
  it('calls anthropic messages and returns response directly', async () => {
    const anthropicResponse = {
      id: 'msg-native', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'native response' }],
      model: 'claude-3', stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 3 },
    }
    mockCreate.mockResolvedValue(anthropicResponse)

    const request: MessagesRequest = {
      model: 'claude-3',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hello' }],
      system: 'Be helpful.',
    }
    const result = await adapter.messages(request, makeModel())
    expect(result).toEqual(anthropicResponse)
  })

  it('handles messages with non-string content (line 324)', async () => {
    const anthropicResponse = {
      id: 'msg-native-arr', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-3', stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 3 },
    }
    mockCreate.mockResolvedValue(anthropicResponse)

    const request: MessagesRequest = {
      model: 'claude-3',
      max_tokens: 100,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] as any }],
    }
    await adapter.messages(request, makeModel())
    const callParams = mockCreate.mock.calls[0]![0]
    // Non-string content is JSON.stringify'd
    expect(typeof callParams.messages[0].content).toBe('string')
  })

  it('omits system param when request.system is absent (line 328)', async () => {
    const anthropicResponse = {
      id: 'msg-nosys', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-3', stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 2 },
    }
    mockCreate.mockResolvedValue(anthropicResponse)

    const request: MessagesRequest = {
      model: 'claude-3',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hello' }],
      // no system field
    }
    await adapter.messages(request, makeModel())
    const callParams = mockCreate.mock.calls[0]![0]
    expect(callParams.system).toBeUndefined()
  })
})

describe('AnthropicAdapter.streamCompletion — system message and stop reasons', () => {
  it('includes system prompt in streaming params', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-sys', usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    for await (const _ of adapter.streamCompletion({
      model: 'auto',
      messages: [{ role: 'system', content: 'Be concise.' }, { role: 'user', content: 'Hi' }],
    }, makeModel())) { /* consume */ }

    expect(mockCreate.mock.calls[0]![0].system).toBeDefined()
  })

  it('handles stop_reason=max_tokens in stream (finish_reason becomes length)', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-max', usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'truncated' } },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 3 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    const chunks: any[] = []
    for await (const c of adapter.streamCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }, makeModel())) {
      chunks.push(c)
    }
    const finalChunk = chunks.find(c => c.choices?.[0]?.finish_reason != null)
    expect(finalChunk.choices[0].finish_reason).toBe('length')
  })

  it('handles stop_reason=stop_sequence in stream (finish_reason becomes stop)', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-seq', usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'stopped' } },
      { type: 'message_delta', delta: { stop_reason: 'stop_sequence' }, usage: { output_tokens: 2 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    const chunks: any[] = []
    for await (const c of adapter.streamCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }, makeModel())) {
      chunks.push(c)
    }
    const finalChunk = chunks.find(c => c.choices?.[0]?.finish_reason != null)
    expect(finalChunk.choices[0].finish_reason).toBe('stop')
  })
})

describe('AnthropicAdapter.streamCompletion', () => {
  it('yields OpenAI-format stream chunks from Anthropic events', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-s', usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    const chunks: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }, makeModel())) {
      chunks.push(chunk)
    }

    const textChunk = chunks.find(c => c.choices?.[0]?.delta?.content === 'Hello')
    expect(textChunk).toBeDefined()
  })

  it('yields thinking chunks as custom delta.thinking field', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-think', usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think...' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Answer' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    const chunks: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Think' }] }, makeModel({ capabilities: { thinking: true } }))) {
      chunks.push(chunk)
    }

    const thinkChunk = chunks.find(c => c.choices?.[0]?.delta?.thinking === 'Let me think...')
    expect(thinkChunk).toBeDefined()
  })

  it('emits cache token usage in message_delta', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-c', usage: { input_tokens: 10, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    const chunks: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }, makeModel())) {
      chunks.push(chunk)
    }

    const usageChunk = chunks.find(c => c.usage != null)
    expect(usageChunk).toBeDefined()
    expect(usageChunk.usage.prompt_tokens).toBe(15) // 10+3+2
  })
})

describe('AnthropicAdapter — getClient branches (lines 14, 17)', () => {
  it('uses empty string for apiKey when model.apiKey is undefined (line 14)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-nokey', model: 'claude-3',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    // apiKey: undefined triggers the ?? '' fallback on line 14
    await adapter.chatCompletion(
      { model: 'auto', messages: [{ role: 'user', content: 'Hi' }] },
      makeModel({ apiKey: undefined }),
    )
    expect(mockCreate).toHaveBeenCalled()
  })

  it('uses default anthropic baseURL when model.endpoint is empty string (line 17)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-noep', model: 'claude-3',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    // endpoint: '' triggers the || 'https://api.anthropic.com' fallback on line 17
    await adapter.chatCompletion(
      { model: 'auto', messages: [{ role: 'user', content: 'Hi' }] },
      makeModel({ endpoint: '' }),
    )
    expect(mockCreate).toHaveBeenCalled()
  })
})

describe('AnthropicAdapter — convertContent data URI (line 55)', () => {
  it('handles data URI where header split produces empty header → media_type fallback (line 55)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-datauri', model: 'claude-3',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    // A data URI without a proper header — header part will be 'data:image/jpeg;base64'
    // and the ?? '' on header covers when header could be undefined (split edge)
    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/test' } }] },
      ],
    } as any, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    const imgBlock = callParams.messages[0].content[0]
    expect(imgBlock.type).toBe('image')
    expect(imgBlock.source.type).toBe('base64')
    expect(imgBlock.source.media_type).toBe('image/jpeg')
  })
})

describe('AnthropicAdapter — tool role branches (lines 88, 89)', () => {
  it('uses empty string tool_use_id when tool_call_id is absent (line 88)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-notcid', model: 'claude-3',
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'user', content: 'call' },
        // tool role without tool_call_id — triggers ?? '' on line 88
        { role: 'tool', content: 'result' } as any,
      ],
    }, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    const toolMsg = callParams.messages.find((m: any) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result')
    expect(toolMsg.content[0].tool_use_id).toBe('')
  })

  it('JSON.stringifies non-string tool content (line 89)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-toolobj', model: 'claude-3',
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'user', content: 'call' },
        // tool role with object (non-string) content — triggers JSON.stringify branch on line 89
        { role: 'tool', tool_call_id: 'tc-x', content: { result: 42 } } as any,
      ],
    }, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    const toolMsg = callParams.messages.find((m: any) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result')
    expect(toolMsg.content[0].content).toBe('{"result":42}')
  })
})

describe('AnthropicAdapter — assistant tool_calls branches (lines 102, 106, 107)', () => {
  it('includes text block when assistant content is a string and has tool_calls (line 102 string branch)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-asttc', model: 'claude-3',
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'user', content: 'go' },
        {
          role: 'assistant',
          content: 'I will call a tool',
          tool_calls: [{ id: 'tc-s', function: { name: 'myFn', arguments: '{"x":1}' } }],
        } as any,
        { role: 'tool', tool_call_id: 'tc-s', content: 'res' } as any,
      ],
    }, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    const assistantMsg = callParams.messages.find((m: any) => m.role === 'assistant')
    expect(assistantMsg.content[0]).toMatchObject({ type: 'text', text: 'I will call a tool' })
    expect(assistantMsg.content[1]).toMatchObject({ type: 'tool_use', name: 'myFn' })
  })

  it('survives invalid JSON in tool_call arguments and uses empty input (line 106 catch branch)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-badjson', model: 'claude-3',
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'user', content: 'go' },
        {
          role: 'assistant',
          content: null,
          // invalid JSON arguments → catch block → input stays {}
          tool_calls: [{ id: 'tc-bad', function: { name: 'fn', arguments: 'NOT JSON' } }],
        } as any,
        { role: 'tool', tool_call_id: 'tc-bad', content: 'res' } as any,
      ],
    }, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    const assistantMsg = callParams.messages.find((m: any) => m.role === 'assistant')
    const toolUseBlock = assistantMsg.content.find((b: any) => b.type === 'tool_use')
    expect(toolUseBlock.input).toEqual({})
  })

  it('uses empty string for tool name when tc.function.name is missing (line 107)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-noname', model: 'claude-3',
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'user', content: 'go' },
        {
          role: 'assistant',
          content: null,
          // no function.name → ?? '' fallback on line 107
          tool_calls: [{ id: 'tc-nn', function: { arguments: '{}' } }],
        } as any,
        { role: 'tool', tool_call_id: 'tc-nn', content: 'res' } as any,
      ],
    }, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    const assistantMsg = callParams.messages.find((m: any) => m.role === 'assistant')
    const toolUseBlock = assistantMsg.content.find((b: any) => b.type === 'tool_use')
    expect(toolUseBlock.name).toBe('')
  })
})

describe('AnthropicAdapter.chatCompletion — additional branches', () => {
  it('returns empty string content when response has no text block (line 166 false branch)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-notxt', model: 'claude-3',
      // No text block — only a tool_use block
      content: [{ type: 'tool_use', id: 'tu1', name: 'fn', input: {} }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    const result = await adapter.chatCompletion(
      { model: 'auto', messages: [{ role: 'user', content: 'Hi' }] },
      makeModel(),
    )
    expect(result.choices[0]!.message.content).toBe('')
  })

  it('returns finish_reason=length when stop_reason is not end_turn (line 168 false branch)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-len', model: 'claude-3',
      content: [{ type: 'text', text: 'truncated' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 5, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    const result = await adapter.chatCompletion(
      { model: 'auto', messages: [{ role: 'user', content: 'Hi' }] },
      makeModel(),
    )
    expect(result.choices[0]!.finish_reason).toBe('length')
  })

  it('includes only cached_tokens when cacheCreation is 0 but cacheRead > 0 (line 177 true, 178 false)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-cread', model: 'claude-3',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 },
    })

    const result = await adapter.chatCompletion(
      { model: 'auto', messages: [{ role: 'user', content: 'Hi' }] },
      makeModel(),
    )
    const details = (result.usage as any).prompt_tokens_details
    expect(details.cached_tokens).toBe(5)
    expect(details.cache_creation_tokens).toBeUndefined()
  })

  it('includes only cache_creation_tokens when cacheRead is 0 but cacheCreation > 0 (line 177 false, 178 true)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-ccreate', model: 'claude-3',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 7 },
    })

    const result = await adapter.chatCompletion(
      { model: 'auto', messages: [{ role: 'user', content: 'Hi' }] },
      makeModel(),
    )
    const details = (result.usage as any).prompt_tokens_details
    expect(details.cache_creation_tokens).toBe(7)
    expect(details.cached_tokens).toBeUndefined()
  })

  it('uses cache_read/creation tokens undefined (null-ish) so ?? 0 yields 0 (lines 153,154)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-nocache', model: 'claude-3',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      // usage without cache fields — ?? 0 fallback fires
      usage: { input_tokens: 8, output_tokens: 3 },
    })

    const result = await adapter.chatCompletion(
      { model: 'auto', messages: [{ role: 'user', content: 'Hi' }] },
      makeModel(),
    )
    expect(result.usage!.prompt_tokens).toBe(8)
    expect((result.usage as any).prompt_tokens_details).toBeUndefined()
  })

  it('does not bump max_tokens when already >= 16000 with thinking enabled (line 146 false branch)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-bigthink', model: 'claude-3',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      max_tokens: 32000,
      messages: [{ role: 'user', content: 'Think big' }],
    }, makeModel({ capabilities: { thinking: true } }))

    const callParams = mockCreate.mock.calls[0]![0]
    expect(callParams.max_tokens).toBe(32000)
  })
})

describe('AnthropicAdapter.streamCompletion — additional branches', () => {
  it('does not bump stream max_tokens when already >= 16000 with thinking (line 209 false branch)', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-bigst', usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    for await (const _ of adapter.streamCompletion({
      model: 'auto',
      max_tokens: 32000,
      messages: [{ role: 'user', content: 'Think big' }],
    }, makeModel({ capabilities: { thinking: true } }))) { /* consume */ }

    expect(mockCreate.mock.calls[0]![0].max_tokens).toBe(32000)
  })

  it('handles message_start with cache tokens undefined (lines 228,229 ?? 0 fallback)', async () => {
    const events = [
      // cache fields absent — triggers ?? 0 on both lines 228 and 229
      { type: 'message_start', message: { id: 'msg-nocache-st', usage: { input_tokens: 7 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    const chunks: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }, makeModel())) {
      chunks.push(chunk)
    }
    const usageChunk = chunks.find(c => c.usage != null)
    expect(usageChunk.usage.prompt_tokens).toBe(7)
  })

  it('registers tool_use content_block_start as text type (line 247 non-thinking branch)', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-tu', usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      // type 'tool_use' is not 'thinking', so blockTypes.set → 'text'
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'fn' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    const chunks: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }, makeModel())) {
      chunks.push(chunk)
    }
    // The tool_use block is treated as text — a content delta should be yielded
    const textChunk = chunks.find(c => c.choices?.[0]?.delta?.content === 'fn')
    expect(textChunk).toBeDefined()
  })

  it('skips content_block_delta when blockType is thinking but delta is not thinking_delta (line 264 false branch)', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-th-skip', usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      // delta type is text_delta on a thinking block — neither branch fires, no yield
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ignored' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    const chunks: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Think' }] }, makeModel())) {
      chunks.push(chunk)
    }
    // No content chunk with text 'ignored' should be emitted
    const ignoredChunk = chunks.find(c => c.choices?.[0]?.delta?.content === 'ignored')
    expect(ignoredChunk).toBeUndefined()
  })

  it('skips content_block_delta when blockType is text but delta type is input_json_delta (line 264 false branch)', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-json-skip', usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use' } },
      // input_json_delta on a text-type block — text branch condition is false
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"k":' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    const chunks: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }, makeModel())) {
      chunks.push(chunk)
    }
    // No content delta should contain partial_json
    const jsonChunk = chunks.find(c => c.choices?.[0]?.delta?.content?.includes('{"k":'))
    expect(jsonChunk).toBeUndefined()
  })

  it('emits null finish_reason when stop_reason is unknown (line 284 else branch)', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-unknwn', usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
      // stop_reason is something unknown — none of the if/else if branches match → finish_reason stays null
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    const chunks: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }, makeModel())) {
      chunks.push(chunk)
    }
    const deltaChunk = chunks.find(c => c.usage != null)
    expect(deltaChunk.choices[0].finish_reason).toBeNull()
  })

  it('includes only cached_tokens in stream usage when cacheCreation is 0 (lines 305 true, 306 false)', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-sr', usage: { input_tokens: 10, cache_read_input_tokens: 4, cache_creation_input_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    const chunks: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }, makeModel())) {
      chunks.push(chunk)
    }
    const usageChunk = chunks.find(c => c.usage != null)
    expect(usageChunk.usage.prompt_tokens_details.cached_tokens).toBe(4)
    expect(usageChunk.usage.prompt_tokens_details.cache_creation_tokens).toBeUndefined()
  })

  it('includes only cache_creation_tokens in stream usage when cacheRead is 0 (lines 305 false, 306 true)', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-sc', usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 6 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    const chunks: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }, makeModel())) {
      chunks.push(chunk)
    }
    const usageChunk = chunks.find(c => c.usage != null)
    expect(usageChunk.usage.prompt_tokens_details.cache_creation_tokens).toBe(6)
    expect(usageChunk.usage.prompt_tokens_details.cached_tokens).toBeUndefined()
  })

  it('handles message_delta with no usage field — outputTokens defaults to 0 (line 280 ?? 0)', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-nousage', usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
      // no usage field on message_delta — triggers ?? 0 on line 280
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    const chunks: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }, makeModel())) {
      chunks.push(chunk)
    }
    const usageChunk = chunks.find(c => c.usage != null)
    expect(usageChunk.usage.completion_tokens).toBe(0)
  })
})

describe('AnthropicAdapter — remaining branch coverage', () => {
  it('handles data URI with no comma (header is undefined after split) — line 55 ?? fallback', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-nocomma', model: 'claude-3',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    // A data: URL with no comma — split(',', 2) gives ['data:nope'] so header='data:nope', data=undefined
    // but to hit header=undefined we'd need split to return [] which can't happen for a non-empty string.
    // Instead cover the v8 "false" branch on ?? by making header be an actual value that goes through replace:
    // The key is that the url starts with 'data:' so we must hit this branch.
    // We use a URL where the comma is the first char: 'data:,base64data' → header='data:', data='base64data'
    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:,rawdata' } }] },
      ],
    } as any, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    const imgBlock = callParams.messages[0].content[0]
    expect(imgBlock.type).toBe('image')
    expect(imgBlock.source.type).toBe('base64')
    // media_type is '' because 'data:'.replace('data:','').replace(';base64','') = ''
    expect(imgBlock.source.media_type).toBe('')
  })

  it('handles tool_call with no function property — line 106 tc.function?.arguments ?? {} fallback', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-nofn', model: 'claude-3',
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    await adapter.chatCompletion({
      model: 'auto',
      messages: [
        { role: 'user', content: 'go' },
        {
          role: 'assistant',
          content: null,
          // tc.function is undefined → tc.function?.arguments is undefined → ?? '{}' fires on line 106
          tool_calls: [{ id: 'tc-nofn' }],
        } as any,
        { role: 'tool', tool_call_id: 'tc-nofn', content: 'res' } as any,
      ],
    }, makeModel())

    const callParams = mockCreate.mock.calls[0]![0]
    const assistantMsg = callParams.messages.find((m: any) => m.role === 'assistant')
    const toolUseBlock = assistantMsg.content.find((b: any) => b.type === 'tool_use')
    expect(toolUseBlock.input).toEqual({})
    expect(toolUseBlock.name).toBe('')
  })

  it('handles content_block_delta for unknown index (not in blockTypes map) — line 247 ?? text fallback', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-unk-idx', usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      // No content_block_start for index 99 — blockTypes.get(99) returns undefined → ?? 'text' fires
      { type: 'content_block_delta', index: 99, delta: { type: 'text_delta', text: 'fallback-text' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    const chunks: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }, makeModel())) {
      chunks.push(chunk)
    }
    // Unknown index defaults to 'text' so the text_delta IS yielded
    const textChunk = chunks.find(c => c.choices?.[0]?.delta?.content === 'fallback-text')
    expect(textChunk).toBeDefined()
  })

  it('ignores unrecognised stream event types — line 279 implicit else fallthrough', async () => {
    const events = [
      { type: 'message_start', message: { id: 'msg-unk-ev', usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      // An event type that does not match any handler — exercises the implicit else/fallthrough
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    ]
    mockCreate.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { for (const e of events) yield e },
    })

    const chunks: any[] = []
    for await (const chunk of adapter.streamCompletion({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }, makeModel())) {
      chunks.push(chunk)
    }
    // Should still yield text chunk and finish normally
    const textChunk = chunks.find(c => c.choices?.[0]?.delta?.content === 'hi')
    expect(textChunk).toBeDefined()
  })
})
