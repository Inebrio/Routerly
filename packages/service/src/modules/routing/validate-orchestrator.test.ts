import { describe, it, expect } from 'vitest'
import { validateOrchestratorCandidates } from './validate-orchestrator.js'
import type { RouterConfig } from '@routerly/shared'

const router = (id: string, kind?: RouterConfig['kind']): RouterConfig => ({
  id, name: id, tokens: [], members: [], models: [],
  ...(kind !== undefined ? { kind } : {}),
})

describe('validateOrchestratorCandidates', () => {
  it('is a no-op for kind !== orchestrator, even with garbage candidates', () => {
    expect(validateOrchestratorCandidates({
      kind: 'router',
      candidates: [{ routerId: 'does-not-exist', weight: 1 }],
      routers: [],
    })).toBeNull()
  })

  it('allows a brand-new orchestrator to be created with zero candidates (RTR-09 2-step flow)', () => {
    expect(validateOrchestratorCandidates({
      kind: 'orchestrator', candidates: undefined, routers: [],
    })).toBeNull()
    expect(validateOrchestratorCandidates({
      kind: 'orchestrator', candidates: [], routers: [],
    })).toBeNull()
  })

  it('rejects editing an existing orchestrator down to zero candidates (EC2, update)', () => {
    const routers = [router('orc-1', 'orchestrator')]
    expect(validateOrchestratorCandidates({
      kind: 'orchestrator', candidates: undefined, routers, selfId: 'orc-1',
    })).toBe('An orchestrator needs at least one candidate router')
    expect(validateOrchestratorCandidates({
      kind: 'orchestrator', candidates: [], routers, selfId: 'orc-1',
    })).toBe('An orchestrator needs at least one candidate router')
  })

  it('rejects self-reference on update (AC4)', () => {
    const routers = [router('orc-1', 'orchestrator'), router('r1')]
    expect(validateOrchestratorCandidates({
      kind: 'orchestrator',
      candidates: [{ routerId: 'orc-1', weight: 1 }],
      routers,
      selfId: 'orc-1',
    })).toBe('An orchestrator cannot target itself')
  })

  it('does not check self-reference on create (no selfId)', () => {
    const routers = [router('r1')]
    expect(validateOrchestratorCandidates({
      kind: 'orchestrator',
      candidates: [{ routerId: 'r1', weight: 1 }],
      routers,
    })).toBeNull()
  })

  it('rejects a candidate that targets another orchestrator (AC3)', () => {
    const routers = [router('orc-2', 'orchestrator')]
    expect(validateOrchestratorCandidates({
      kind: 'orchestrator',
      candidates: [{ routerId: 'orc-2', weight: 1 }],
      routers,
      selfId: 'orc-1',
    })).toBe('An orchestrator cannot target another orchestrator')
  })

  it('rejects a candidate id that does not resolve to any router', () => {
    expect(validateOrchestratorCandidates({
      kind: 'orchestrator',
      candidates: [{ routerId: 'ghost', weight: 1 }],
      routers: [router('r1')],
    })).toBe('Unknown candidate router: ghost')
  })

  it('accepts a valid multi-candidate orchestrator', () => {
    const routers = [router('r1'), router('r2')]
    expect(validateOrchestratorCandidates({
      kind: 'orchestrator',
      candidates: [{ routerId: 'r1', weight: 1 }, { routerId: 'r2', weight: 2 }],
      routers,
      selfId: 'orc-1',
    })).toBeNull()
  })
})
