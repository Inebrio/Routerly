import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'

vi.mock('../modules/config/loader.js', () => ({ getOrCreateSecret: vi.fn() }))

import { getOrCreateSecret } from '../modules/config/loader.js'
import { loadCredentialKey, encryptCredential, decryptCredential } from './crypto-cred.js'

const mockGetOrCreateSecret = vi.mocked(getOrCreateSecret)

afterEach(() => vi.clearAllMocks())

describe('crypto-cred', () => {
  beforeAll(async () => {
    mockGetOrCreateSecret.mockResolvedValue('a'.repeat(64)) // valid 32-byte hex secret
    await loadCredentialKey()
  })

  it('round-trips a credential and rejects tampering', () => {
    const enc = encryptCredential('secret-token')
    expect(decryptCredential(enc)).toBe('secret-token')
    expect(() => decryptCredential(enc.slice(0, -4) + 'XXXX')).toThrow()
  })

  it('produces a different ciphertext each call (random iv)', () => {
    const a = encryptCredential('same-plaintext')
    const b = encryptCredential('same-plaintext')
    expect(a).not.toBe(b)
    expect(decryptCredential(a)).toBe('same-plaintext')
    expect(decryptCredential(b)).toBe('same-plaintext')
  })

  describe('uninitialised key', () => {
    it('throws from encryptCredential when loadCredentialKey was never called', async () => {
      vi.resetModules()
      vi.doMock('../modules/config/loader.js', () => ({ getOrCreateSecret: vi.fn() }))
      const fresh = await import('./crypto-cred.js')
      expect(() => fresh.encryptCredential('x')).toThrow('Credential encryption key not initialised')
      vi.resetModules()
    })

    it('throws from decryptCredential when loadCredentialKey was never called', async () => {
      vi.resetModules()
      vi.doMock('../modules/config/loader.js', () => ({ getOrCreateSecret: vi.fn() }))
      const fresh = await import('./crypto-cred.js')
      expect(() => fresh.decryptCredential('AAAA')).toThrow('Credential encryption key not initialised')
      vi.resetModules()
    })
  })
})
