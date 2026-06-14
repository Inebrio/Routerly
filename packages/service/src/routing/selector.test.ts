import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../config/loader.js', () => ({ readConfig: vi.fn() }))
vi.mock('../cost/budget.js', () => ({ isAllowed: vi.fn() }))

import { selectModel } from './selector.js'
import { readConfig } from '../config/loader.js'
import { isAllowed } from '../cost/budget.js'
import type { ModelConfig, ProjectConfig } from '@routerly/shared'

const mockReadConfig = vi.mocked(readConfig)
const mockIsAllowed = vi.mocked(isAllowed)

afterEach(() => { vi.clearAllMocks() })

function makeModel(id: string): ModelConfig {
  return {
    id, name: id, provider: 'openai', endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 1, outputPerMillion: 3 },
  }
}

const project: ProjectConfig = {
  id: 'proj-1', name: 'Test', tokens: [], members: [], models: [
    { modelId: 'model-a' },
    { modelId: 'model-b' },
  ],
}

describe('selectModel', () => {
  it('returns highest-weight model when all are allowed', async () => {
    const modelA = makeModel('model-a')
    const modelB = makeModel('model-b')
    mockReadConfig.mockResolvedValue([modelA, modelB])
    mockIsAllowed.mockResolvedValue(true)

    const result = await selectModel(
      { models: [{ model: 'model-a', weight: 0.4 }, { model: 'model-b', weight: 0.9 }] },
      project,
    )
    expect(result!.id).toBe('model-b')
  })

  it('skips models not found in config', async () => {
    mockReadConfig.mockResolvedValue([makeModel('model-b')])
    mockIsAllowed.mockResolvedValue(true)

    const result = await selectModel(
      { models: [{ model: 'missing', weight: 0.9 }, { model: 'model-b', weight: 0.5 }] },
      project,
    )
    expect(result!.id).toBe('model-b')
  })

  it('skips models not allowed by budget', async () => {
    mockReadConfig.mockResolvedValue([makeModel('model-a'), makeModel('model-b')])
    mockIsAllowed
      .mockResolvedValueOnce(false) // model-a not allowed
      .mockResolvedValueOnce(true)  // model-b allowed

    const result = await selectModel(
      { models: [{ model: 'model-a', weight: 0.9 }, { model: 'model-b', weight: 0.3 }] },
      project,
    )
    expect(result!.id).toBe('model-b')
  })

  it('returns null when all candidates fail', async () => {
    mockReadConfig.mockResolvedValue([makeModel('model-a')])
    mockIsAllowed.mockResolvedValue(false)

    const result = await selectModel(
      { models: [{ model: 'model-a', weight: 0.9 }] },
      project,
    )
    expect(result).toBeNull()
  })

  it('returns null when no candidates provided', async () => {
    mockReadConfig.mockResolvedValue([])
    const result = await selectModel({ models: [] }, project)
    expect(result).toBeNull()
  })

  it('sorts by weight descending before checking', async () => {
    const modelA = makeModel('model-a')
    const modelB = makeModel('model-b')
    mockReadConfig.mockResolvedValue([modelA, modelB])
    mockIsAllowed.mockResolvedValue(true)

    const result = await selectModel(
      { models: [{ model: 'model-b', weight: 0.2 }, { model: 'model-a', weight: 0.8 }] },
      project,
    )
    expect(result!.id).toBe('model-a')
  })
})
