import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RouterConfig, UserConfig } from '@routerly/shared'

vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}))

import { readConfig, writeConfig } from '../config/loader.js'
import {
  MCP_TOKEN_PREFIX,
  accessibleRouters,
  hashMcpToken,
  mintMcpToken,
  resolveUserByMcpToken,
  resolveUserPermissions,
  touchMcpToken,
} from './tokens.js'
import { buildAuthContext } from './auth-context.js'

const mockReadConfig = vi.mocked(readConfig)
const mockWriteConfig = vi.mocked(writeConfig)

const RAW = 'sk-rt-mcp-known-token'

function user(overrides: Partial<UserConfig> = {}): UserConfig {
  return {
    id: 'u1',
    email: 'u@example.com',
    passwordHash: 'x',
    roleId: 'viewer',
    routerIds: [],
    mcpTokens: [
      {
        id: 'tok-1',
        name: 'laptop',
        tokenHash: hashMcpToken(RAW),
        tokenSnippet: RAW.substring(0, 14),
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  } as UserConfig
}

const ROUTERS = [
  { id: 'proj-1', name: 'Alpha', models: [] },
  { id: 'proj-2', name: 'Beta', models: [], members: [{ userId: 'u-member', role: 'member' }] },
] as unknown as RouterConfig[]

function mockConfig(users: UserConfig[], routers: RouterConfig[] = ROUTERS) {
  mockReadConfig.mockImplementation(async (key: string) => {
    if (key === 'users') return users as never
    if (key === 'routers') return routers as never
    return [] as never
  })
}

beforeEach(() => {
  mockReadConfig.mockReset()
  mockWriteConfig.mockReset()
  mockWriteConfig.mockResolvedValue(undefined as never)
})

describe('mintMcpToken', () => {
  it('returns a prefixed raw token whose hash, not value, is stored', () => {
    const { raw, token } = mintMcpToken('laptop')

    expect(raw.startsWith(MCP_TOKEN_PREFIX)).toBe(true)
    expect(raw).toMatch(/^sk-rt-mcp-[0-9a-f]{64}$/)
    expect(token.tokenHash).toBe(hashMcpToken(raw))
    expect(token.tokenHash).toHaveLength(64)
    expect(token.tokenSnippet).toBe(raw.substring(0, 14))
    expect(JSON.stringify(token)).not.toContain(raw)
    expect(token.expiresAt).toBeUndefined()
  })

  it('carries an expiry only when one is given', () => {
    expect(mintMcpToken('ci', '2027-01-01T00:00:00.000Z').token.expiresAt).toBe(
      '2027-01-01T00:00:00.000Z',
    )
  })

  it('mints a distinct value every time', () => {
    expect(mintMcpToken('a').raw).not.toBe(mintMcpToken('a').raw)
  })
})

describe('resolveUserByMcpToken', () => {
  it('finds the owning user by hash', async () => {
    mockConfig([user()])

    const resolved = await resolveUserByMcpToken(RAW)

    expect(resolved?.user.id).toBe('u1')
    expect(resolved?.token.id).toBe('tok-1')
  })

  it('returns null for an unknown token', async () => {
    mockConfig([user()])
    expect(await resolveUserByMcpToken('sk-rt-mcp-other')).toBeNull()
  })

  it('never reads the users config for a non-MCP token', async () => {
    mockConfig([user()])

    expect(await resolveUserByMcpToken('sk-rt-router-token')).toBeNull()
    expect(mockReadConfig).not.toHaveBeenCalled()
  })
})

describe('touchMcpToken', () => {
  it('stamps lastUsedAt on the matching token', async () => {
    mockConfig([user()])

    await touchMcpToken('u1', 'tok-1')

    const written = mockWriteConfig.mock.calls[0]![1] as UserConfig[]
    expect(written[0]!.mcpTokens![0]!.lastUsedAt).toBeTypeOf('string')
  })

  it('writes nothing when the token is gone', async () => {
    mockConfig([user()])

    await touchMcpToken('u1', 'nope')

    expect(mockWriteConfig).not.toHaveBeenCalled()
  })
})

describe('resolveUserPermissions', () => {
  it('resolves a built-in role', async () => {
    mockConfig([user()])
    expect(await resolveUserPermissions(user())).toContain('router:read')
  })

  it('resolves a custom role from the roles config', async () => {
    mockReadConfig.mockImplementation(async (key: string) =>
      (key === 'roles' ? [{ id: 'custom', name: 'Custom', permissions: ['audit:read'] }] : []) as never,
    )

    expect(await resolveUserPermissions(user({ roleId: 'custom' }))).toEqual(['audit:read'])
  })

  it('returns no permission for an unknown role', async () => {
    mockConfig([user()])
    expect(await resolveUserPermissions(user({ roleId: 'ghost' }))).toEqual([])
  })
})

describe('accessibleRouters', () => {
  it('returns the routers listed in routerIds', async () => {
    mockConfig([user()])

    const routers = await accessibleRouters(user({ routerIds: ['proj-1'] }))

    expect(routers.map(p => p.id)).toEqual(['proj-1'])
  })

  it('includes routers the user is a member of', async () => {
    mockConfig([user()])

    const routers = await accessibleRouters(user({ id: 'u-member', routerIds: [] }))

    expect(routers.map(p => p.id)).toEqual(['proj-2'])
  })

  it('falls back to every router for an unscoped user, as the dashboard does', async () => {
    mockConfig([user()])

    const routers = await accessibleRouters(user({ id: 'u9', routerIds: [] }))

    expect(routers.map(p => p.id)).toEqual(['proj-1', 'proj-2'])
  })
})

describe('buildAuthContext', () => {
  it('builds the context a tool runs with and records the use', async () => {
    mockConfig([user({ routerIds: ['proj-1'] })])

    const resolved = await buildAuthContext(RAW)

    expect('error' in resolved).toBe(false)
    if ('error' in resolved) return
    expect(resolved.context.user).toEqual({ id: 'u1', email: 'u@example.com', roleId: 'viewer' })
    expect(resolved.context.permissions).toContain('router:read')
    expect(resolved.context.routers.map(p => p.id)).toEqual(['proj-1'])
    expect(resolved.context.token.id).toBe('tok-1')
    // The hash never leaves the service through the context's own consumers, but
    // it is the token record itself; what matters is the raw value is not in it.
    expect(JSON.stringify(resolved.context)).not.toContain(RAW)
  })

  it('rejects an unknown token', async () => {
    mockConfig([user()])
    expect(await buildAuthContext('sk-rt-mcp-nope')).toEqual({ error: 'Invalid MCP token.' })
  })

  it('rejects an expired token', async () => {
    const expired = user()
    expired.mcpTokens![0]!.expiresAt = '2000-01-01T00:00:00.000Z'
    mockConfig([expired])

    expect(await buildAuthContext(RAW)).toEqual({ error: 'MCP token expired.' })
  })

  it('survives a failing lastUsedAt write', async () => {
    mockConfig([user()])
    mockWriteConfig.mockRejectedValue(new Error('disk full') as never)

    const resolved = await buildAuthContext(RAW)

    expect('context' in resolved).toBe(true)
  })
})
