import { describe, it, expect } from 'vitest'
import { ProcessorRegistry, type Processor } from './processors.js'
import { shortCircuit } from './result.js'
import { MissingDependencyError } from './errors.js'

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

  it('stops the phase when a processor returns shortCircuit', async () => {
    const reg = new ProcessorRegistry<Ctx>()
    reg.contribute({
      id: 'first',
      phase: 'p',
      run(c) {
        c.trail.push('first')
        return shortCircuit({ stopped: true })
      },
    })
    reg.contribute({ id: 'second', phase: 'p', after: ['first'], run: (c) => { c.trail.push('second') } })
    const ctx: Ctx = { trail: [] }
    await reg.runPhase('p', ctx)
    expect(ctx.trail).toEqual(['first'])
  })

  it('runs every processor when none short-circuits (no regression)', async () => {
    const reg = new ProcessorRegistry<Ctx>()
    reg.contribute(step('a', 'p'))
    reg.contribute(step('b', 'p', { after: ['a'] }))
    const ctx: Ctx = { trail: [] }
    await reg.runPhase('p', ctx)
    expect(ctx.trail).toEqual(['a', 'b'])
  })

  it('overrides a specific processor by phase+id, wrapping its run', async () => {
    const reg = new ProcessorRegistry<{ trail: string[] }>()
    reg.contribute({
      id: 'a',
      phase: 'p',
      run: (c) => {
        c.trail.push('a')
      },
    })
    reg.override('p', 'a', (prev) => ({
      ...prev,
      run: async (c) => {
        c.trail.push('before-a')
        await prev.run(c)
        c.trail.push('after-a')
      },
    }))
    const ctx = { trail: [] as string[] }
    await reg.runPhase('p', ctx)
    expect(ctx.trail).toEqual(['before-a', 'a', 'after-a'])
  })

  it('throws MissingDependencyError overriding an id not contributed to that phase', () => {
    const reg = new ProcessorRegistry<{ trail: string[] }>()
    expect(() => reg.override('p', 'missing', (prev) => prev)).toThrow(MissingDependencyError)
  })
})
