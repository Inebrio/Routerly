import { describe, it, expect } from 'vitest'
import {
  anthropicToOpenAIMessages, openAIToAnthropicResponse, anthropicToChatRequest,
  anthropicToolsToOpenAI, anthropicToolChoiceToOpenAI, openAIChunksToAnthropicSSE, flattenSystem,
} from './messages-compat.js'
import type { MessagesRequest, StreamChunk } from '@routerly/shared'

describe('anthropicToOpenAIMessages', () => {
  it('converts string content messages unchanged', () => {
    const request: MessagesRequest = {
      model: 'claude-3',
      max_tokens: 100,
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    }
    const { messages, system } = anthropicToOpenAIMessages(request)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({ role: 'user', content: 'Hello' })
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Hi there' })
    expect(system).toBeUndefined()
  })

  it('extracts system prompt', () => {
    const request: MessagesRequest = {
      model: 'claude-3',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hello' }],
      system: 'You are a helpful assistant.',
    }
    const { messages, system } = anthropicToOpenAIMessages(request)
    expect(system).toBe('You are a helpful assistant.')
    expect(messages).toHaveLength(1)
  })

  it('collapses text-only block content to a plain string', () => {
    // Compat servers that only accept string content (DeepSeek, Ollama) reject a
    // one-element parts array, so text-only messages are sent as a string.
    const request: MessagesRequest = {
      model: 'claude-3',
      max_tokens: 100,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Hello world' }] },
      ],
    }
    const { messages } = anthropicToOpenAIMessages(request)
    expect(messages[0]!.content).toBe('Hello world')
  })

  it('converts base64 image source to data URI', () => {
    const request: MessagesRequest = {
      model: 'claude-3',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [{
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
          }],
        },
      ],
    }
    const { messages } = anthropicToOpenAIMessages(request)
    const imgPart = (messages[0]!.content as any[])[0]
    expect(imgPart.type).toBe('image_url')
    expect(imgPart.image_url.url).toBe('data:image/png;base64,abc123')
  })

  it('converts URL image source', () => {
    const request: MessagesRequest = {
      model: 'claude-3',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [{
            type: 'image',
            source: { type: 'url', url: 'https://example.com/img.png' },
          }],
        },
      ],
    }
    const { messages } = anthropicToOpenAIMessages(request)
    const imgPart = (messages[0]!.content as any[])[0]
    expect(imgPart.image_url.url).toBe('https://example.com/img.png')
  })
})

describe('openAIToAnthropicResponse', () => {
  it('converts a basic OpenAI response to Anthropic format', () => {
    const openAIRes = {
      id: 'chatcmpl-123',
      model: 'gpt-4',
      choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }
    const result = openAIToAnthropicResponse(openAIRes, 'gpt-4')
    expect(result.id).toBe('chatcmpl-123')
    expect(result.type).toBe('message')
    expect(result.role).toBe('assistant')
    expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }])
    expect(result.model).toBe('gpt-4')
    expect(result.stop_reason).toBe('end_turn')
    expect(result.usage.input_tokens).toBe(10)
    expect(result.usage.output_tokens).toBe(5)
  })

  it('maps finish_reason=length to max_tokens stop_reason', () => {
    const openAIRes = {
      id: 'chatcmpl-456',
      model: 'gpt-4',
      choices: [{ message: { content: 'Truncated...' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 5, completion_tokens: 100 },
    }
    const result = openAIToAnthropicResponse(openAIRes, 'gpt-4')
    expect(result.stop_reason).toBe('max_tokens')
  })

  it('generates fallback id when response has no id', () => {
    const openAIRes = {
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    }
    const result = openAIToAnthropicResponse(openAIRes, 'model')
    expect(result.id).toMatch(/^msg-\d+$/)
  })

  it('uses upstreamModel as fallback model name', () => {
    const openAIRes = {
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    }
    const result = openAIToAnthropicResponse(openAIRes, 'upstream-model')
    expect(result.model).toBe('upstream-model')
  })

  it('handles missing choices gracefully', () => {
    const openAIRes = { choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } }
    const result = openAIToAnthropicResponse(openAIRes, 'model')
    expect(result.content).toEqual([{ type: 'text', text: '' }])
    expect(result.stop_reason).toBe('end_turn')
  })

  it('uses 0 for input_tokens when usage is undefined (line 65 ?? branch)', () => {
    const openAIRes = { choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }], usage: undefined }
    const result = openAIToAnthropicResponse(openAIRes as any, 'model')
    expect(result.usage.input_tokens).toBe(0)
    expect(result.usage.output_tokens).toBe(0)
  })

  it('uses 0 for input_tokens when prompt_tokens is undefined (line 65-66 ?? branch)', () => {
    const openAIRes = {
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: undefined, completion_tokens: undefined },
    }
    const result = openAIToAnthropicResponse(openAIRes as any, 'model')
    expect(result.usage.input_tokens).toBe(0)
    expect(result.usage.output_tokens).toBe(0)
  })

  it('turns tool_calls into tool_use blocks and stops with tool_use', () => {
    const result = openAIToAnthropicResponse({
      id: 'cmpl-1',
      model: 'gpt-5-mini',
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{"path":"./a.txt"}' } }],
        },
      }],
      usage: { prompt_tokens: 5, completion_tokens: 7 },
    }, 'gpt-5-mini')

    expect(result.content).toEqual([{ type: 'tool_use', id: 'call_1', name: 'Read', input: { path: './a.txt' } }])
    expect(result.stop_reason).toBe('tool_use')
  })

  it('keeps text before tool_use when the model emitted both', () => {
    const result = openAIToAnthropicResponse({
      choices: [{
        finish_reason: 'tool_calls',
        message: { content: 'let me look', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: '{}' } }] },
      }],
    }, 'm')
    expect(result.content.map((b) => b.type)).toEqual(['text', 'tool_use'])
  })

  it('tolerates unparseable tool arguments', () => {
    const result = openAIToAnthropicResponse({
      choices: [{
        finish_reason: 'tool_calls',
        message: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: '{"path": ' } }] },
      }],
    }, 'm')
    expect(result.content[0]).toMatchObject({ type: 'tool_use', input: {} })
  })

  it('reports cached prompt tokens when the provider breaks them out', () => {
    const result = openAIToAnthropicResponse({
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 80 } },
    }, 'm')
    expect(result.usage.cache_read_input_tokens).toBe(80)
  })
})

describe('flattenSystem', () => {
  it('passes a plain string through', () => {
    expect(flattenSystem('you are helpful')).toBe('you are helpful')
  })

  it('joins a cache-controlled block list into text instead of stringifying JSON', () => {
    expect(flattenSystem([
      { type: 'text', text: 'You are Claude Code.', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Be terse.' },
    ])).toBe('You are Claude Code.\n\nBe terse.')
  })

  it('returns undefined when absent', () => {
    expect(flattenSystem(undefined)).toBeUndefined()
  })
})

describe('tool round-trip translation', () => {
  const base = (over: Partial<MessagesRequest> = {}): MessagesRequest => ({
    model: 'claude-opus-5', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }], ...over,
  })

  it('converts an assistant tool_use block into tool_calls', () => {
    const { messages } = anthropicToOpenAIMessages(base({
      messages: [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'reading' },
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: './a.txt' } },
        ],
      }],
    }))
    expect(messages).toEqual([{
      role: 'assistant',
      content: 'reading',
      tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'Read', arguments: '{"path":"./a.txt"}' } }],
    }])
  })

  it('emits a tool role message for a tool_result, before the remaining user text', () => {
    const { messages } = anthropicToOpenAIMessages(base({
      messages: [{
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: '42' }] },
          { type: 'text', text: 'thanks' },
        ],
      }],
    }))
    expect(messages).toEqual([
      { role: 'tool', tool_call_id: 'toolu_1', content: '42' },
      { role: 'user', content: 'thanks' },
    ])
  })

  it('accepts a string tool_result payload', () => {
    const { messages } = anthropicToOpenAIMessages(base({
      messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }] }],
    }))
    expect(messages).toEqual([{ role: 'tool', tool_call_id: 't1', content: 'done' }])
  })

  it('maps tool definitions and every tool_choice variant', () => {
    expect(anthropicToolsToOpenAI([
      { name: 'Read', description: 'read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
    ])).toEqual([{
      type: 'function',
      function: { name: 'Read', description: 'read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
    }])
    expect(anthropicToolsToOpenAI(undefined)).toBeUndefined()
    expect(anthropicToolsToOpenAI([])).toBeUndefined()
    expect(anthropicToolChoiceToOpenAI({ type: 'auto' })).toBe('auto')
    expect(anthropicToolChoiceToOpenAI({ type: 'any' })).toBe('required')
    expect(anthropicToolChoiceToOpenAI({ type: 'none' })).toBe('none')
    expect(anthropicToolChoiceToOpenAI({ type: 'tool', name: 'Read' })).toEqual({ type: 'function', function: { name: 'Read' } })
    expect(anthropicToolChoiceToOpenAI(undefined)).toBeUndefined()
  })

  it('forwards tools, system and stop_sequences, and drops Anthropic-only fields', () => {
    const req = anthropicToChatRequest(base({
      system: [{ type: 'text', text: 'sys' }],
      tools: [{ name: 'Read', input_schema: { type: 'object' } }],
      tool_choice: { type: 'auto' },
      stop_sequences: ['END'],
      thinking: { type: 'enabled', budget_tokens: 1024 },
      metadata: { user_id: 'x' },
      betas: ['interleaved-thinking-2025-05-14'],
    }))
    expect(req.tools).toHaveLength(1)
    expect(req.tool_choice).toBe('auto')
    expect(req.messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(req.stop).toEqual(['END'])
    expect(req).not.toHaveProperty('thinking')
    expect(req).not.toHaveProperty('metadata')
    expect(req).not.toHaveProperty('betas')
  })

  it('defaults tool parameters when the client sent no input_schema', () => {
    expect(anthropicToolsToOpenAI([{ name: 'Ping' }])![0]!.function.parameters).toEqual({ type: 'object', properties: {} })
  })
})

describe('openAIChunksToAnthropicSSE', () => {
  async function* chunksOf(chunks: Array<Record<string, unknown>>): AsyncGenerator<StreamChunk> {
    for (const c of chunks) {
      yield { id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [], ...c } as unknown as StreamChunk
    }
  }

  async function collect(gen: AsyncGenerator<string>): Promise<Array<{ event: string; data: any }>> {
    const out: Array<{ event: string; data: any }> = []
    for await (const line of gen) {
      out.push({
        event: /event: (.+)\n/.exec(line)?.[1] ?? '',
        data: JSON.parse(/data: (.+)\n/.exec(line)?.[1] ?? '{}'),
      })
    }
    return out
  }

  it('streams text as one block and closes the message', async () => {
    const events = await collect(openAIChunksToAnthropicSSE(chunksOf([
      { choices: [{ index: 0, delta: { content: 'he' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: 'llo' }, finish_reason: 'stop' }] },
    ]), 'msg_1', 'claude-opus-5'))

    expect(events.map((e) => e.event)).toEqual([
      'message_start', 'ping', 'content_block_start', 'content_block_delta',
      'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop',
    ])
    expect(events.find((e) => e.event === 'message_delta')!.data.delta.stop_reason).toBe('end_turn')
  })

  it('streams a tool call as a tool_use block with input_json_delta', async () => {
    const events = await collect(openAIChunksToAnthropicSSE(chunksOf([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'Read', arguments: '{"pa' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a"}' } }] }, finish_reason: 'tool_calls' }] },
    ]), 'msg_1', 'claude-opus-5'))

    expect(events.find((e) => e.event === 'content_block_start')!.data.content_block)
      .toEqual({ type: 'tool_use', id: 'call_1', name: 'Read', input: {} })
    expect(events.filter((e) => e.event === 'content_block_delta').map((d) => d.data.delta.partial_json).join(''))
      .toBe('{"path":"a"}')
    expect(events.find((e) => e.event === 'message_delta')!.data.delta.stop_reason).toBe('tool_use')
  })

  it('gives text and each tool call their own block, never interleaved', async () => {
    const events = await collect(openAIChunksToAnthropicSSE(chunksOf([
      { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'A', arguments: '{}' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'c2', function: { name: 'B', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] },
    ]), 'msg_1', 'claude-opus-5'))

    expect(events.filter((e) => e.event.startsWith('content_block_st')).map((e) => `${e.event}:${e.data.index}`))
      .toEqual([
        'content_block_start:0', 'content_block_stop:0',
        'content_block_start:1', 'content_block_stop:1',
        'content_block_start:2', 'content_block_stop:2',
      ])
  })

  it('reports usage from the chunk that carries it', async () => {
    const events = await collect(openAIChunksToAnthropicSSE(chunksOf([
      { choices: [{ index: 0, delta: { content: 'x' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 9 } },
    ]), 'msg_1', 'm'))
    expect(events.find((e) => e.event === 'message_delta')!.data.usage.output_tokens).toBe(9)
    expect(events.find((e) => e.event === 'message_start')!.data.message.usage.input_tokens).toBe(3)
  })

  it('emits a well-formed empty message when the upstream stream yields nothing', async () => {
    const events = await collect(openAIChunksToAnthropicSSE(chunksOf([]), 'msg_1', 'm'))
    expect(events.map((e) => e.event)).toEqual([
      'message_start', 'ping', 'content_block_start', 'content_block_stop', 'message_delta', 'message_stop',
    ])
  })

  it('maps a length finish to max_tokens', async () => {
    const events = await collect(openAIChunksToAnthropicSSE(chunksOf([
      { choices: [{ index: 0, delta: { content: 'x' }, finish_reason: 'length' }] },
    ]), 'msg_1', 'm'))
    expect(events.find((e) => e.event === 'message_delta')!.data.delta.stop_reason).toBe('max_tokens')
  })
})
