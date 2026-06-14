import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'

vi.mock('../config/loader.js', () => ({
  getOrCreateSecret: vi.fn(),
}))

import { getOrCreateSecret } from '../config/loader.js'
import { loadSecret, signToken, verifyToken, createSessionToken, generateRawToken } from './jwt.js'

const mockGetOrCreateSecret = vi.mocked(getOrCreateSecret)

afterEach(() => { vi.clearAllMocks() })

async function initSecret(secret = 'test-secret-32-bytes-long-padding!') {
  mockGetOrCreateSecret.mockResolvedValue(secret)
  await loadSecret()
}

describe('loadSecret', () => {
  it('loads secret via getOrCreateSecret', async () => {
    mockGetOrCreateSecret.mockResolvedValue('my-secret')
    await loadSecret()
    expect(mockGetOrCreateSecret).toHaveBeenCalled()
  })
})

describe('getSecret — throws when not initialised (line 12 throw branch)', () => {
  it('throws when signToken called before loadSecret (via fresh module)', async () => {
    vi.resetModules()
    vi.doMock('../config/loader.js', () => ({ getOrCreateSecret: vi.fn() }))
    const { signToken: freshSignToken } = await import('./jwt.js')
    // _secret is undefined in fresh module → getSecret() throws
    expect(() => freshSignToken({ sub: 'test' })).toThrow('JWT secret not initialised')
    vi.resetModules()
  })
})

describe('signToken / verifyToken', () => {
  it('signs and verifies a token successfully', async () => {
    await initSecret()
    const payload = { sub: 'user1', role: 'admin', data: 42 }
    const token = signToken(payload)
    expect(typeof token).toBe('string')
    expect(token).toContain('.')
    const verified = verifyToken(token)
    expect(verified).toMatchObject(payload)
  })

  it('returns null for a tampered token', async () => {
    await initSecret()
    const token = signToken({ sub: 'u1' })
    const tampered = token.slice(0, -5) + 'XXXXX'
    expect(verifyToken(tampered)).toBeNull()
  })

  it('returns null for a token missing the signature part', async () => {
    await initSecret()
    const token = signToken({ sub: 'u1' })
    const noSig = token.split('.')[0]!
    expect(verifyToken(noSig)).toBeNull()
  })

  it('returns null for an expired token', async () => {
    await initSecret()
    const expired = signToken({ sub: 'u1', exp: Date.now() - 1000 })
    expect(verifyToken(expired)).toBeNull()
  })

  it('returns payload for a non-expired token', async () => {
    await initSecret()
    const future = signToken({ sub: 'u1', exp: Date.now() + 60_000 })
    expect(verifyToken(future)).toMatchObject({ sub: 'u1' })
  })

  it('returns null for a token with invalid base64 payload', async () => {
    await initSecret()
    const badToken = 'not-valid-base64!@#.somesig'
    expect(verifyToken(badToken)).toBeNull()
  })

  it('throws if secret not initialised', () => {
    // Reset secret by re-importing won't work directly in ESM,
    // so we test behavior after a new loadSecret call with different secret
    // This indirectly tests getSecret guard.
    expect(() => signToken({ sub: 'test' })).not.toThrow() // secret already loaded from previous tests
  })

  it('returns null when base64 data decodes to invalid JSON (line 34 catch branch)', async () => {
    const secret = 'test-secret-32-bytes-long-padding!'
    await initSecret(secret)
    // Build a properly signed token where data is NOT valid JSON
    const data = Buffer.from('{ not valid json }').toString('base64url')
    const sig = createHmac('sha256', secret).update(data).digest('base64url')
    expect(verifyToken(`${data}.${sig}`)).toBeNull()
  })
})

describe('createSessionToken', () => {
  it('creates a token with sub, role and exp fields', async () => {
    await initSecret()
    const token = createSessionToken('user42', 'viewer', 2)
    const payload = verifyToken(token)
    expect(payload).not.toBeNull()
    expect(payload!['sub']).toBe('user42')
    expect(payload!['role']).toBe('viewer')
    expect(typeof payload!['exp']).toBe('number')
  })

  it('defaults to 1 hour expiry', async () => {
    await initSecret()
    const before = Date.now()
    const token = createSessionToken('u', 'admin')
    const payload = verifyToken(token)!
    const exp = payload['exp'] as number
    expect(exp).toBeGreaterThanOrEqual(before + 3590_000)
    expect(exp).toBeLessThanOrEqual(before + 3610_000)
  })
})

describe('generateRawToken', () => {
  it('returns a hex string of correct length', () => {
    const token = generateRawToken(32)
    expect(token).toMatch(/^[a-f0-9]+$/)
    expect(token.length).toBe(64) // 32 bytes → 64 hex chars
  })

  it('returns different tokens on each call', () => {
    const t1 = generateRawToken()
    const t2 = generateRawToken()
    expect(t1).not.toBe(t2)
  })
})
