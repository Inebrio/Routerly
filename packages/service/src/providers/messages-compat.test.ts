import { describe, it, expect } from 'vitest'
import { anthropicToOpenAIMessages, openAIToAnthropicResponse } from './messages-compat.js'
import type { MessagesRequest } from '@routerly/shared'

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

  it('converts text block content', () => {
    const request: MessagesRequest = {
      model: 'claude-3',
      max_tokens: 100,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Hello world' }] },
      ],
    }
    const { messages } = anthropicToOpenAIMessages(request)
    expect(messages[0]!.content).toEqual([{ type: 'text', text: 'Hello world' }])
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
})
