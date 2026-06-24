import { describe, it, expect } from 'vitest'
import type { ProjectConfig, ModelConfig, AgentPolicy } from '@routerly/shared'
import { resolveAgentPolicy, agentPolicyCandidates, AGENT_POLICY_HEADER } from './agentPolicy.js'

const policy: AgentPolicy = { name: 'fast', models: ['m2', 'm1', 'ghost'], maxCostUsd: 0.01 }

const project = {
  id: 'p1', name: 'P', tokens: [], members: [], models: [],
  agentPolicies: [policy],
} as ProjectConfig

const allModels = [
  { id: 'm1', name: 'M1', provider: 'openai', endpoint: '', cost: { inputPerMillion: 1, outputPerMillion: 2 } },
  { id: 'm2', name: 'M2', provider: 'openai', endpoint: '', cost: { inputPerMillion: 3, outputPerMillion: 4 } },
] as ModelConfig[]

describe('AGENT_POLICY_HEADER', () => {
  it('is the lowercased x-routerly-policy header', () => {
    expect(AGENT_POLICY_HEADER).toBe('x-routerly-policy')
  })
})

describe('resolveAgentPolicy', () => {
  it('returns undefined when no policy name', () => {
    expect(resolveAgentPolicy(project, undefined)).toBeUndefined()
  })

  it('returns undefined when name does not match', () => {
    expect(resolveAgentPolicy(project, 'nope')).toBeUndefined()
  })

  it('returns the matching policy', () => {
    expect(resolveAgentPolicy(project, 'fast')).toBe(policy)
  })

  it('returns undefined when project has no agentPolicies', () => {
    const p: ProjectConfig = { id: 'p2', name: 'P2', tokens: [], members: [], models: [] }
    expect(resolveAgentPolicy(p, 'fast')).toBeUndefined()
  })
})

describe('agentPolicyCandidates', () => {
  it('keeps only known models, preserving order, weights descending', () => {
    const out = agentPolicyCandidates(policy, allModels)
    // 'ghost' is filtered out; order m2, m1 preserved
    expect(out).toEqual([
      { model: 'm2', weight: 2 },
      { model: 'm1', weight: 1 },
    ])
  })

  it('returns empty when no policy model exists', () => {
    const out = agentPolicyCandidates({ name: 'x', models: ['ghost'] }, allModels)
    expect(out).toEqual([])
  })
})
