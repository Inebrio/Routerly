import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function (this: any, opts: any) {
    this._opts = opts
    this.messages = { create: mockCreate }
  }),
}))

import Anthropic from '@anthropic-ai/sdk'
import { AnthropicOAuthAdapter } from './anthropic-oauth.js'
import type { ModelConfig } from '@routerly/shared'

afterEach(() => vi.clearAllMocks())

function makeModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'claude-3-haiku-20240307',
    name: 'Claude 3 Haiku',
    provider: 'anthropic-oauth',
    endpoint: 'https://api.anthropic.com',
    apiKey: 'sk-ant-oat-test',
    cost: { inputPerMillion: 0.25, outputPerMillion: 1.25 },
    ...overrides,
  }
}

describe('AnthropicOAuthAdapter.getClient (line 9)', () => {
  it('creates Anthropic client with oauth beta header and correct authToken', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-1',
      model: 'claude-3-haiku',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    const adapter = new AnthropicOAuthAdapter()
    await adapter.chatCompletion(
      { model: 'auto', messages: [{ role: 'user', content: 'hi' }] },
      makeModel(),
    )

    const AnthropicCtor = vi.mocked(Anthropic)
    expect(AnthropicCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        authToken: 'sk-ant-oat-test',
        defaultHeaders: expect.objectContaining({
          'anthropic-beta': 'oauth-2025-04-20',
          'anthropic-dangerous-direct-browser-access': 'true',
        }),
      }),
    )
    expect(mockCreate).toHaveBeenCalled()
  })

  it('falls back to empty string when apiKey is undefined (line 10 ?? branch)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-2',
      model: 'claude-3-haiku',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    const adapter = new AnthropicOAuthAdapter()
    await adapter.chatCompletion(
      { model: 'auto', messages: [{ role: 'user', content: 'hi' }] },
      makeModel({ apiKey: undefined }),
    )

    const AnthropicCtor = vi.mocked(Anthropic)
    expect(AnthropicCtor).toHaveBeenCalledWith(expect.objectContaining({ authToken: '' }))
  })

  it('uses default anthropic endpoint when model.endpoint is falsy (line 11 || branch)', async () => {
    mockCreate.mockResolvedValue({
      id: 'msg-3',
      model: 'claude-3-haiku',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

    const adapter = new AnthropicOAuthAdapter()
    await adapter.chatCompletion(
      { model: 'auto', messages: [{ role: 'user', content: 'hi' }] },
      makeModel({ endpoint: '' }),
    )

    const AnthropicCtor = vi.mocked(Anthropic)
    expect(AnthropicCtor).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://api.anthropic.com' }))
  })
})
