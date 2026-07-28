import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function (this: any, opts: any) {
    this._opts = opts
    this.messages = { create: mockCreate }
  }),
}))

vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
  getOrCreateSecret: vi.fn(),
}))

import Anthropic from '@anthropic-ai/sdk'
import {
  AnthropicOAuthAdapter,
  resolveAnthropicOAuthCredential,
  refreshAnthropicOAuthToken,
} from './anthropic-oauth.js'
import type { ModelConfig, ProviderConnection } from '@routerly/shared'
import { readConfig, writeConfig, getOrCreateSecret } from '../config/loader.js'
import { loadCredentialKey, encryptCredential, decryptCredential } from '../../lib/crypto-cred.js'

const mockReadConfig = vi.mocked(readConfig)
const mockWriteConfig = vi.mocked(writeConfig)
const mockGetOrCreateSecret = vi.mocked(getOrCreateSecret)

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

// ─── resolveAnthropicOAuthCredential / refreshAnthropicOAuthToken ──────────

beforeAll(async () => {
  mockGetOrCreateSecret.mockResolvedValue('a'.repeat(64)) // valid 32-byte hex secret
  await loadCredentialKey()
})

function makeConnection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: 'conn-anthropic-1',
    providerId: 'anthropic-oauth',
    label: 'Anthropic OAuth',
    endpoint: 'https://api.anthropic.com',
    enabled: true,
    credentials: {
      oauthEnc: encryptCredential('live-access-token'),
      refreshEnc: encryptCredential('refresh-token'),
      expiresAt: Date.now() + 3600_000,
    },
    ...overrides,
  }
}

describe('resolveAnthropicOAuthCredential', () => {
  it('returns the decrypted token as-is when not near expiry', async () => {
    const connection = makeConnection()
    const token = await resolveAnthropicOAuthCredential(connection)
    expect(token).toBe('live-access-token')
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('refreshes and persists an expired token', async () => {
    const connection = makeConnection({
      credentials: {
        oauthEnc: encryptCredential('stale-access-token'),
        refreshEnc: encryptCredential('refresh-token'),
        expiresAt: Date.now() - 1000,
      },
    })
    mockReadConfig.mockResolvedValueOnce([connection] as any)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_in: 3600 }),
    }) as any

    const token = await resolveAnthropicOAuthCredential(connection)
    expect(token).toBe('new-access-token')
    expect(mockWriteConfig).toHaveBeenCalledOnce()
    const written = mockWriteConfig.mock.calls[0]?.[1] as unknown as ProviderConnection[]
    expect(written[0]?.id).toBe('conn-anthropic-1')
    expect(decryptCredential(written[0]?.credentials['oauthEnc'] as string)).toBe('new-access-token')
    expect(decryptCredential(written[0]?.credentials['refreshEnc'] as string)).toBe('new-refresh-token')
  })

  it('leaves connections untouched when the connection id is no longer found', async () => {
    const connection = makeConnection({
      id: 'conn-vanished',
      credentials: {
        oauthEnc: encryptCredential('stale-access-token'),
        refreshEnc: encryptCredential('refresh-token'),
        expiresAt: Date.now() - 1000,
      },
    })
    mockReadConfig.mockResolvedValueOnce([] as any) // connection no longer present
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_in: 3600 }),
    }) as any

    const token = await resolveAnthropicOAuthCredential(connection)
    expect(token).toBe('new-access-token')
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('treats a nullish readConfig result as no existing connections (does not persist)', async () => {
    const connection = makeConnection({
      credentials: {
        oauthEnc: encryptCredential('stale-access-token'),
        refreshEnc: encryptCredential('refresh-token'),
        expiresAt: Date.now() - 1000,
      },
    })
    mockReadConfig.mockResolvedValueOnce(undefined as any)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_in: 3600 }),
    }) as any

    const token = await resolveAnthropicOAuthCredential(connection)
    expect(token).toBe('new-access-token')
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })
})

describe('refreshAnthropicOAuthToken', () => {
  it('posts to the primary endpoint and returns parsed tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'a1', refresh_token: 'r1', expires_in: 100 }),
    })
    global.fetch = fetchMock as any

    const result = await refreshAnthropicOAuthToken('old-refresh')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://platform.claude.com/v1/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.accessToken).toBe('a1')
    expect(result.refreshToken).toBe('r1')
    expect(result.expiresAt).toBeGreaterThan(Date.now())
  })

  it('falls back to console.anthropic.com when the primary endpoint returns non-2xx', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'a2', refresh_token: 'r2', expires_in: 50 }) })
    global.fetch = fetchMock as any

    const result = await refreshAnthropicOAuthToken('old-refresh')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://console.anthropic.com/v1/oauth/token', expect.anything())
    expect(result.accessToken).toBe('a2')
  })

  it('falls back to console.anthropic.com when the primary endpoint throws a network error', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'a3', refresh_token: 'r3', expires_in: 60 }) })
    global.fetch = fetchMock as any

    const result = await refreshAnthropicOAuthToken('old-refresh')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.accessToken).toBe('a3')
  })

  it('reuses the old refresh token when the response omits refresh_token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'a4', expires_in: 30 }),
    }) as any

    const result = await refreshAnthropicOAuthToken('kept-refresh-token')
    expect(result.refreshToken).toBe('kept-refresh-token')
  })

  it('defaults expiresAt to now when the response omits expires_in', async () => {
    const before = Date.now()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'a5', refresh_token: 'r5' }),
    }) as any

    const result = await refreshAnthropicOAuthToken('old-refresh')
    expect(result.expiresAt).toBeGreaterThanOrEqual(before)
    expect(result.expiresAt).toBeLessThan(before + 1000)
  })

  it('throws when both endpoints fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as any
    await expect(refreshAnthropicOAuthToken('old-refresh')).rejects.toThrow('anthropic oauth refresh failed')
  })
})
