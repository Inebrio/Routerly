import { describe, it, expect } from 'vitest'
import { ProcessorRegistry, type Processor } from '../core/index.js'
import { runProxy, PROXY_PHASES, setProxyPipeline, getProxyPipeline } from './run.js'
import type { ProxyContext } from './context.js'

function fakeCtx(): ProxyContext {
  return {} as unknown as ProxyContext
}

const mark = (id: string, phase: string, fn: (c: ProxyContext) => void): Processor<ProxyContext> => ({
  id, phase, run(c) { fn(c) },
})

describe('runProxy', () => {
  it('a kind:"block" result skips every phase except egress and finalize', async () => {
    const reg = new ProcessorRegistry<ProxyContext>()
    const trail: string[] = []
    reg.contribute(mark('a', 'request.preprocess', (c) => {
      trail.push('preprocess')
      c.result = { kind: 'block', status: 200 }
    }))
    reg.contribute(mark('b', 'upstream.execute', () => { trail.push('upstream') }))
    reg.contribute(mark('e', 'egress', () => { trail.push('egress') }))
    reg.contribute(mark('c', 'finalize', () => { trail.push('finalize') }))
    await runProxy(reg, fakeCtx())
    // upstream skipped, egress still runs (it writes the block response) and finalize still runs
    expect(trail).toEqual(['preprocess', 'egress', 'finalize'])
  })

  it('a kind:"json" result does NOT stop the walk (egress must still run)', async () => {
    const reg = new ProcessorRegistry<ProxyContext>()
    const trail: string[] = []
    reg.contribute(mark('u', 'upstream.execute', (c) => {
      trail.push('upstream')
      c.result = { kind: 'json', body: { ok: true } }
    }))
    reg.contribute(mark('e', 'egress', () => { trail.push('egress') }))
    reg.contribute(mark('f', 'finalize', () => { trail.push('finalize') }))
    await runProxy(reg, fakeCtx())
    expect(trail).toEqual(['upstream', 'egress', 'finalize'])
  })

  it('walks every phase when nothing sets a result', async () => {
    const reg = new ProcessorRegistry<ProxyContext>()
    const seen: string[] = []
    for (const phase of PROXY_PHASES) reg.contribute(mark(`p:${phase}`, phase, () => { seen.push(phase) }))
    await runProxy(reg, fakeCtx())
    expect(seen).toEqual([...PROXY_PHASES])
  })

  it('set/getProxyPipeline round-trips', () => {
    const reg = new ProcessorRegistry<ProxyContext>()
    setProxyPipeline(reg)
    expect(getProxyPipeline()).toBe(reg)
  })
})
