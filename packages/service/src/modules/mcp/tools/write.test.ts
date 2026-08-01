import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpAuthContext, ProjectConfig } from '@routerly/shared'

vi.mock('../../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}))

import { readConfig, writeConfig } from '../../config/loader.js'
import { createProjectTokenTool, toggleModelTool } from './write.js'
import { expectNoSecrets } from './expectNoSecrets.js'
import { mcpAuthContext } from '../../../test-support/mcp-auth.js'

const mockReadConfig = vi.mocked(readConfig)
const mockWriteConfig = vi.mocked(writeConfig)

const SECRET_KEY = 'sk-secret-openai-key-abc123'

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: 'proj-1',
    name: 'Alpha',
    models: [{ modelId: 'openai/gpt-4o' }],
    ...overrides,
  } as ProjectConfig
}

/** Auth context reaching exactly the given project, so projectId stays optional. */
function authCtx(project = makeProject()): McpAuthContext {
  return mcpAuthContext({ projects: [project] })
}

beforeEach(() => {
  mockReadConfig.mockReset()
  mockWriteConfig.mockReset()
  mockWriteConfig.mockResolvedValue(undefined as never)
})

describe('createProjectTokenTool', () => {
  it('is a write-scoped tool gated on token:write and the config-store DI token', () => {
    expect(createProjectTokenTool.name).toBe('create_project_token')
    expect(createProjectTokenTool.scope).toBe('write')
    expect(createProjectTokenTool.permission).toBe('token:write')
    expect(createProjectTokenTool.requires.key).toBe('config.store')
  })

  it('persists a new plaintext token onto the resolved project and returns no raw token', async () => {
    const project = makeProject({ tokens: [] })
    mockReadConfig.mockResolvedValue([project, makeProject({ id: 'proj-2', name: 'Beta' })] as never)

    const res = await createProjectTokenTool.handler({ scopes: ['chat'] }, authCtx(project))

    expect(res.isError).toBeUndefined()
    const parsed = JSON.parse(res.content[0]!.text)
    // Exactly the four allowed keys, no raw token.
    expect(Object.keys(parsed).sort()).toEqual(['createdAt', 'id', 'scopes', 'tokenSnippet'])
    expect(parsed.scopes).toEqual(['chat'])
    expect(parsed.tokenSnippet).toMatch(/^sk-rt-/)

    // The raw token was persisted (plaintext, by design) but never surfaced.
    const written = mockWriteConfig.mock.calls[0]!
    expect(written[0]).toBe('projects')
    const writtenProjects = written[1] as ProjectConfig[]
    const persisted = writtenProjects[0]!.tokens![0]!
    expect(persisted.token).toMatch(/^sk-rt-[0-9a-f]{64}$/)
    expect(persisted.scopes).toEqual(['chat'])
    // proj-2 is untouched.
    expect(writtenProjects[1]!.tokens).toBeUndefined()

    // Result must never contain the raw token string, anywhere.
    expect(res.content[0]!.text).not.toContain(persisted.token)
    expectNoSecrets(res.content[0]!.text, [persisted.token, SECRET_KEY])
  })

  it('defaults scopes to an empty array when none are given, still no raw token', async () => {
    const project = makeProject()
    mockReadConfig.mockResolvedValue([project] as never)

    const res = await createProjectTokenTool.handler({}, authCtx(project))

    const parsed = JSON.parse(res.content[0]!.text)
    expect(parsed.scopes).toEqual([])
    const persisted = (mockWriteConfig.mock.calls[0]![1] as ProjectConfig[])[0]!.tokens![0]!
    expect(res.content[0]!.text).not.toContain(persisted.token)
    expectNoSecrets(res.content[0]!.text, [persisted.token])
  })

  it('mints on the project named by projectId when several are accessible', async () => {
    const alpha = makeProject()
    const beta = makeProject({ id: 'proj-2', name: 'Beta' })
    mockReadConfig.mockResolvedValue([alpha, beta] as never)

    const res = await createProjectTokenTool.handler(
      { projectId: 'Beta' },
      mcpAuthContext({ projects: [alpha, beta] }),
    )

    expect(res.isError).toBeUndefined()
    const writtenProjects = mockWriteConfig.mock.calls[0]![1] as ProjectConfig[]
    expect(writtenProjects[1]!.tokens).toHaveLength(1)
    expect(writtenProjects[0]!.tokens).toBeUndefined()
  })

  it('refuses a project the token owner cannot reach, and writes nothing', async () => {
    mockReadConfig.mockResolvedValue([makeProject(), makeProject({ id: 'proj-2', name: 'Beta' })] as never)

    const res = await createProjectTokenTool.handler({ projectId: 'proj-2' }, authCtx())

    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain('not accessible')
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('returns isError when the resolved project is missing from config', async () => {
    mockReadConfig.mockResolvedValue([makeProject({ id: 'other' })] as never)

    const res = await createProjectTokenTool.handler({}, authCtx())

    expect(res.isError).toBe(true)
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })
})

describe('toggleModelTool', () => {
  it('is a write-scoped tool gated on project:write and the config-store DI token', () => {
    expect(toggleModelTool.name).toBe('toggle_model')
    expect(toggleModelTool.scope).toBe('write')
    expect(toggleModelTool.permission).toBe('project:write')
    expect(toggleModelTool.requires.key).toBe('config.store')
  })

  it('flips an absent enabled flag to false and persists it', async () => {
    const project = makeProject({ models: [{ modelId: 'openai/gpt-4o' }] })
    mockReadConfig.mockResolvedValue([project] as never)

    const res = await toggleModelTool.handler({ modelId: 'openai/gpt-4o' }, authCtx(project))

    expect(JSON.parse(res.content[0]!.text)).toEqual({ modelId: 'openai/gpt-4o', enabled: false })
    const written = mockWriteConfig.mock.calls[0]!
    expect(written[0]).toBe('projects')
    expect((written[1] as ProjectConfig[])[0]!.models[0]!.enabled).toBe(false)
  })

  it('flips an explicit false back to true', async () => {
    const project = makeProject({ models: [{ modelId: 'openai/gpt-4o', enabled: false }] })
    mockReadConfig.mockResolvedValue([project] as never)

    const res = await toggleModelTool.handler({ modelId: 'openai/gpt-4o' }, authCtx(project))

    expect(JSON.parse(res.content[0]!.text)).toEqual({ modelId: 'openai/gpt-4o', enabled: true })
    expect((mockWriteConfig.mock.calls[0]![1] as ProjectConfig[])[0]!.models[0]!.enabled).toBe(true)
  })

  it('returns isError and performs no write when the model ref is absent', async () => {
    const project = makeProject({ models: [{ modelId: 'openai/gpt-4o' }] })
    mockReadConfig.mockResolvedValue([project] as never)

    const res = await toggleModelTool.handler({ modelId: 'nope' }, authCtx(project))

    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain('nope')
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('returns isError and performs no write when no project is accessible', async () => {
    const res = await toggleModelTool.handler(
      { modelId: 'openai/gpt-4o' },
      mcpAuthContext({ projects: [] }),
    )

    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain('no project')
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })
})
