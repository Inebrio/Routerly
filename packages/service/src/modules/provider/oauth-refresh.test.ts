import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn(), writeConfig: vi.fn(), getOrCreateSecret: vi.fn() }))

import { readConfig, writeConfig, getOrCreateSecret } from '../config/loader.js'
import { loadCredentialKey, encryptCredential, decryptCredential } from '../../lib/crypto-cred.js'
import {
  OAuthReauthError, OAuthRefreshHttpError, classifyOAuthUpstreamFailure, refreshConnectionTokens, markConnectionReauth, noteOAuthUpstreamFailure,
} from './oauth-refresh.js'
import { resolveAnthropicOAuthCredential } from './anthropic-oauth.js'
import { resolveOpenAIOAuthCredential } from './openai-oauth.js'
import type { ProviderConnection } from '@routerly/shared'

const mockRead = vi.mocked(readConfig)
const mockWrite = vi.mocked(writeConfig)

let store: ProviderConnection[]

function conn(providerId: 'anthropic-oauth' | 'openai-oauth', expiresInMs: number): ProviderConnection {
  return {
    id: 'c1', providerId, label: 'c1', enabled: true,
    credentials: { oauthEnc: encryptCredential('old-access'), refreshEnc: encryptCredential('old-refresh'), expiresAt: Date.now() + expiresInMs },
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(getOrCreateSecret).mockResolvedValue('0'.repeat(64))
  await loadCredentialKey()
  mockRead.mockImplementation((async () => structuredClone(store)) as never)
  mockWrite.mockImplementation((async (_k: string, v: ProviderConnection[]) => { store = structuredClone(v) }) as never)
})

describe.each(['anthropic-oauth', 'openai-oauth'] as const)('%s credential renewal', (providerId) => {
  const resolve = providerId === 'anthropic-oauth' ? resolveAnthropicOAuthCredential : resolveOpenAIOAuthCredential
  const url = providerId === 'anthropic-oauth' ? 'platform.claude.com' : 'auth.openai.com'
  const okBody = { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }

  it('renews a token about to expire (AC1) and persists the rotated pair', async () => {
    store = [conn(providerId, 60_000)]
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(okBody), { status: 200 }))
    expect(await resolve(store[0]!)).toBe('new-access')
    expect(String(fetchMock.mock.calls[0]![0])).toContain(url)
    const c = store[0]!.credentials as { oauthEnc: string; refreshEnc: string }
    expect(decryptCredential(c.refreshEnc)).toBe('new-refresh')
    fetchMock.mockRestore()
  })

  it('shares one refresh among concurrent requests (single-flight)', async () => {
    store = [conn(providerId, 60_000)]
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20))
      return new Response(JSON.stringify(okBody), { status: 200 })
    })
    const snapshot = store[0]!
    const out = await Promise.all(Array.from({ length: 10 }, () => resolve(snapshot)))
    expect(new Set(out)).toEqual(new Set(['new-access']))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockRestore()
  })

  it('flags the connection as needing re-authorization when the refresh token is rejected (AC2)', async () => {
    store = [conn(providerId, -1000)]
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"invalid_grant"}', { status: 400 }))
    await expect(resolve(store[0]!)).rejects.toThrow(/oauth_revoked/)
    expect(store[0]!.authState).toMatchObject({ status: 'reauth_required', reason: 'revoked' })
    // next call fails fast, without touching the token endpoint again
    fetchMock.mockClear()
    await expect(resolve(store[0]!)).rejects.toBeInstanceOf(OAuthReauthError)
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })

  it('treats a network error as transient: no state change', async () => {
    store = [conn(providerId, -1000)]
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'))
    await expect(resolve(store[0]!)).rejects.not.toBeInstanceOf(OAuthReauthError)
    expect(store[0]!.authState).toBeUndefined()
    fetchMock.mockRestore()
  })
})

describe('refreshConnectionTokens', () => {
  it('treats a 5xx from the token endpoint as transient', async () => {
    store = [conn('anthropic-oauth', -1000)]
    await expect(refreshConnectionTokens(store[0]!, async () => { throw new OAuthRefreshHttpError(503, 'down') })).rejects.toThrow('down')
    expect(store[0]!.authState).toBeUndefined()
  })
})

describe('upstream 401 classification (AC4)', () => {
  it('distinguishes expired, revoked and unauthorized', () => {
    expect(classifyOAuthUpstreamFailure(401, 'OAuth token has expired')).toBe('expired')
    expect(classifyOAuthUpstreamFailure(401, 'OAuth access token has been revoked')).toBe('revoked')
    expect(classifyOAuthUpstreamFailure(401, 'invalid x-api-key')).toBe('unauthorized')
    expect(classifyOAuthUpstreamFailure(429, 'revoked')).toBeUndefined()
  })

  it('flags the connection on revoked/expired, labels but does not flag a plain 401', async () => {
    store = [conn('anthropic-oauth', 3_600_000)]
    expect(noteOAuthUpstreamFailure('c1', 401, 'invalid credentials')).toBe('oauth_unauthorized')
    await new Promise((r) => setTimeout(r, 10))
    expect(store[0]!.authState).toBeUndefined()
    expect(noteOAuthUpstreamFailure('c1', 401, 'OAuth access token has been revoked')).toBe('oauth_revoked')
    await new Promise((r) => setTimeout(r, 10))
    expect(store[0]!.authState?.reason).toBe('revoked')
    await expect(resolveAnthropicOAuthCredential(store[0]!)).rejects.toThrow(/oauth_revoked/)
  })

  it('markConnectionReauth is a no-op for an unknown connection', async () => {
    store = []
    await markConnectionReauth('nope', 'expired', 'x')
    expect(mockWrite).not.toHaveBeenCalled()
  })
})
