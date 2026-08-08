import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpAuthContext, RouterConfig } from '@routerly/shared'

vi.mock('../../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}))

import { readConfig, writeConfig } from '../../config/loader.js'
import { createRouterTokenTool, toggleModelTool } from './write.js'
import { expectNoSecrets } from './expectNoSecrets.js'
import { mcpAuthContext } from '../../../test-support/mcp-auth.js'

const mockReadConfig = vi.mocked(readConfig)
const mockWriteConfig = vi.mocked(writeConfig)

const SECRET_KEY = 'sk-secret-openai-key-abc123'

function makeRouter(overrides: Partial<RouterConfig> = {}): RouterConfig {
  return {
    id: 'proj-1',
    name: 'Alpha',
    models: [{ modelId: 'openai/gpt-4o' }],
    ...overrides,
  } as RouterConfig
}

/** Auth context reaching exactly the given router, so routerId stays optional. */
function authCtx(router = makeRouter()): McpAuthContext {
  return mcpAuthContext({ routers: [router] })
}

beforeEach(() => {
  mockReadConfig.mockReset()
  mockWriteConfig.mockReset()
  mockWriteConfig.mockResolvedValue(undefined as never)
})

describe('createRouterTokenTool', () => {
  it('is a write-scoped tool gated on token:write and the config-store DI token', () => {
    expect(createRouterTokenTool.name).toBe('create_router_token')
    expect(createRouterTokenTool.scope).toBe('write')
    expect(createRouterTokenTool.permission).toBe('token:write')
    expect(createRouterTokenTool.requires.key).toBe('config.store')
  })

  it('persists a new plaintext token onto the resolved router and returns no raw token', async () => {
    const router = makeRouter({ tokens: [] })
    mockReadConfig.mockResolvedValue([router, makeRouter({ id: 'proj-2', name: 'Beta' })] as never)

    const res = await createRouterTokenTool.handler({ scopes: ['chat'] }, authCtx(router))

    expect(res.isError).toBeUndefined()
    const parsed = JSON.parse(res.content[0]!.text)
    // Exactly the four allowed keys, no raw token.
    expect(Object.keys(parsed).sort()).toEqual(['createdAt', 'id', 'scopes', 'tokenSnippet'])
    expect(parsed.scopes).toEqual(['chat'])
    expect(parsed.tokenSnippet).toMatch(/^sk-rt-/)

    // The raw token was persisted (plaintext, by design) but never surfaced.
    const written = mockWriteConfig.mock.calls[0]!
    expect(written[0]).toBe('routers')
    const writtenRouters = written[1] as RouterConfig[]
    const persisted = writtenRouters[0]!.tokens![0]!
    expect(persisted.token).toMatch(/^sk-rt-[0-9a-f]{64}$/)
    expect(persisted.scopes).toEqual(['chat'])
    // proj-2 is untouched.
    expect(writtenRouters[1]!.tokens).toBeUndefined()

    // Result must never contain the raw token string, anywhere.
    expect(res.content[0]!.text).not.toContain(persisted.token)
    expectNoSecrets(res.content[0]!.text, [persisted.token, SECRET_KEY])
  })

  it('defaults scopes to an empty array when none are given, still no raw token', async () => {
    const router = makeRouter()
    mockReadConfig.mockResolvedValue([router] as never)

    const res = await createRouterTokenTool.handler({}, authCtx(router))

    const parsed = JSON.parse(res.content[0]!.text)
    expect(parsed.scopes).toEqual([])
    const persisted = (mockWriteConfig.mock.calls[0]![1] as RouterConfig[])[0]!.tokens![0]!
    expect(res.content[0]!.text).not.toContain(persisted.token)
    expectNoSecrets(res.content[0]!.text, [persisted.token])
  })

  it('mints on the router named by routerId when several are accessible', async () => {
    const alpha = makeRouter()
    const beta = makeRouter({ id: 'proj-2', name: 'Beta' })
    mockReadConfig.mockResolvedValue([alpha, beta] as never)

    const res = await createRouterTokenTool.handler(
      { routerId: 'Beta' },
      mcpAuthContext({ routers: [alpha, beta] }),
    )

    expect(res.isError).toBeUndefined()
    const writtenRouters = mockWriteConfig.mock.calls[0]![1] as RouterConfig[]
    expect(writtenRouters[1]!.tokens).toHaveLength(1)
    expect(writtenRouters[0]!.tokens).toBeUndefined()
  })

  it('refuses a router the token owner cannot reach, and writes nothing', async () => {
    mockReadConfig.mockResolvedValue([makeRouter(), makeRouter({ id: 'proj-2', name: 'Beta' })] as never)

    const res = await createRouterTokenTool.handler({ routerId: 'proj-2' }, authCtx())

    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain('not accessible')
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('returns isError when the resolved router is missing from config', async () => {
    mockReadConfig.mockResolvedValue([makeRouter({ id: 'other' })] as never)

    const res = await createRouterTokenTool.handler({}, authCtx())

    expect(res.isError).toBe(true)
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })
})

describe('toggleModelTool', () => {
  it('is a write-scoped tool gated on router:write and the config-store DI token', () => {
    expect(toggleModelTool.name).toBe('toggle_model')
    expect(toggleModelTool.scope).toBe('write')
    expect(toggleModelTool.permission).toBe('router:write')
    expect(toggleModelTool.requires.key).toBe('config.store')
  })

  it('flips an absent enabled flag to false and persists it', async () => {
    const router = makeRouter({ models: [{ modelId: 'openai/gpt-4o' }] })
    mockReadConfig.mockResolvedValue([router] as never)

    const res = await toggleModelTool.handler({ modelId: 'openai/gpt-4o' }, authCtx(router))

    expect(JSON.parse(res.content[0]!.text)).toEqual({ modelId: 'openai/gpt-4o', enabled: false })
    const written = mockWriteConfig.mock.calls[0]!
    expect(written[0]).toBe('routers')
    expect((written[1] as RouterConfig[])[0]!.models[0]!.enabled).toBe(false)
  })

  it('flips an explicit false back to true', async () => {
    const router = makeRouter({ models: [{ modelId: 'openai/gpt-4o', enabled: false }] })
    mockReadConfig.mockResolvedValue([router] as never)

    const res = await toggleModelTool.handler({ modelId: 'openai/gpt-4o' }, authCtx(router))

    expect(JSON.parse(res.content[0]!.text)).toEqual({ modelId: 'openai/gpt-4o', enabled: true })
    expect((mockWriteConfig.mock.calls[0]![1] as RouterConfig[])[0]!.models[0]!.enabled).toBe(true)
  })

  it('returns isError and performs no write when the model ref is absent', async () => {
    const router = makeRouter({ models: [{ modelId: 'openai/gpt-4o' }] })
    mockReadConfig.mockResolvedValue([router] as never)

    const res = await toggleModelTool.handler({ modelId: 'nope' }, authCtx(router))

    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain('nope')
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('returns isError and performs no write when no router is accessible', async () => {
    const res = await toggleModelTool.handler(
      { modelId: 'openai/gpt-4o' },
      mcpAuthContext({ routers: [] }),
    )

    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain('no router')
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })
})
