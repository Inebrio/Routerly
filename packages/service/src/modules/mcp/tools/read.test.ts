import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ModelConfig, McpAuthContext } from '@routerly/shared'

vi.mock('../../config/loader.js', () => ({
  readConfig: vi.fn(),
}))

import { readConfig } from '../../config/loader.js'
import { listModelsTool } from './read.js'
import { expectNoSecrets } from './expectNoSecrets.js'

const mockReadConfig = vi.mocked(readConfig)

const SECRET_KEY = 'sk-secret-openai-key-abc123'
const SECRET_CF = 'cf-clearance-cookie-xyz'

function model(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    apiKey: SECRET_KEY,
    cfClearance: SECRET_CF,
    cost: { inputPerMillion: 2.5, outputPerMillion: 10 },
    contextWindow: 128000,
    ...overrides,
  }
}

// list_models is global (not project-scoped); the handler ignores authCtx.
const authCtx = {} as McpAuthContext

describe('listModelsTool', () => {
  beforeEach(() => {
    mockReadConfig.mockReset()
  })

  it('is a read-scoped tool gated on the catalog DI token', () => {
    expect(listModelsTool.name).toBe('list_models')
    expect(listModelsTool.scope).toBe('read')
    expect(listModelsTool.requires.key).toBe('catalog.registry')
  })

  it('lists id/provider/enabled/contextWindow for each configured model', async () => {
    mockReadConfig.mockResolvedValue([
      model(),
      model({
        id: 'anthropic/claude',
        provider: 'anthropic',
        contextWindow: 200000,
        apiKey: 'sk-ant-secret',
      }),
    ] as never)

    const res = await listModelsTool.handler({}, authCtx)

    expect(res.isError).toBeUndefined()
    const parsed = JSON.parse(res.content[0]!.text)
    expect(parsed).toEqual([
      { id: 'openai/gpt-4o', provider: 'openai', enabled: true, contextWindow: 128000 },
      { id: 'anthropic/claude', provider: 'anthropic', enabled: true, contextWindow: 200000 },
    ])
  })

  it('never leaks provider secrets in the output text', async () => {
    mockReadConfig.mockResolvedValue([model()] as never)

    const res = await listModelsTool.handler({}, authCtx)

    expectNoSecrets(res.content[0]!.text, [SECRET_KEY, SECRET_CF])
  })
})
