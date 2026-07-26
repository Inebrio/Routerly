import { describe, it, expect } from 'vitest'
import { ProcessorRegistry, type Processor } from './processors.js'

interface Ctx {
  trail: string[]
}

const step = (id: string, phase: string, rel: Partial<Processor<Ctx>> = {}): Processor<Ctx> => ({
  id,
  phase,
  run(c) {
    c.trail.push(id)
  },
  ...rel,
})

describe('ProcessorRegistry', () => {
  it('orders processors within a phase by before/after', async () => {
    const reg = new ProcessorRegistry<Ctx>()
    reg.contribute(step('policies', 'routing', { after: ['candidates'] }))
    reg.contribute(step('candidates', 'routing'))
    reg.contribute(step('budget', 'routing', { after: ['candidates'], before: ['policies'] }))
    const ctx: Ctx = { trail: [] }
    await reg.runPhase('routing', ctx)
    expect(ctx.trail).toEqual(['candidates', 'budget', 'policies'])
  })

  it('runs only the processors of the requested phase', async () => {
    const reg = new ProcessorRegistry<Ctx>()
    reg.contribute(step('a', 'ingress'))
    reg.contribute(step('b', 'egress'))
    const ctx: Ctx = { trail: [] }
    await reg.runPhase('ingress', ctx)
    expect(ctx.trail).toEqual(['a'])
  })

  it('ignores cross-phase ordering references', () => {
    const reg = new ProcessorRegistry<Ctx>()
    reg.contribute(step('a', 'ingress', { after: ['b-in-other-phase'] }))
    expect(reg.orderedFor('ingress').map((p) => p.id)).toEqual(['a'])
  })

  it('returns empty for an unknown phase', async () => {
    const reg = new ProcessorRegistry<Ctx>()
    const ctx: Ctx = { trail: [] }
    await reg.runPhase('nope', ctx)
    expect(ctx.trail).toEqual([])
  })
})
