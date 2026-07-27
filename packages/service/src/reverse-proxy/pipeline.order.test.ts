import { describe, it, expect } from 'vitest'
import { ProcessorRegistry } from '../core/index.js'
import { openaiTransportProcessors } from './lanes/openai.js'
import { anthropicTransportProcessors } from './lanes/anthropic.js'
import { PROXY_PHASES } from './run.js'
import type { ProxyContext } from './context.js'

function combined(): ProcessorRegistry<ProxyContext> {
  const reg = new ProcessorRegistry<ProxyContext>()
  for (const p of [...openaiTransportProcessors, ...anthropicTransportProcessors]) reg.contribute(p)
  return reg
}

describe('combined transport pipeline', () => {
  it('both lanes share upstream.execute / routing.execute / egress', () => {
    const reg = combined()
    expect(reg.orderedFor('upstream.execute').map((p) => p.id)).toEqual(expect.arrayContaining(['openai:upstream', 'anthropic:upstream']))
    expect(reg.orderedFor('routing.execute').map((p) => p.id)).toEqual(expect.arrayContaining(['openai:attempt', 'anthropic:attempt']))
    expect(reg.orderedFor('egress').map((p) => p.id)).toEqual(expect.arrayContaining(['openai:egress', 'anthropic:egress']))
  })

  it('transport owns NO other phase (ingress/preprocess/routing.prepare/postprocess/finalize are Plan 5)', () => {
    const reg = combined()
    for (const phase of ['ingress', 'protocol.decode', 'request.preprocess', 'routing.prepare', 'upstream.prepare', 'response.postprocess', 'protocol.encode', 'finalize']) {
      expect(reg.orderedFor(phase)).toEqual([])
    }
  })

  it('the closed phase list is exactly the 11 frozen phases', () => {
    expect([...PROXY_PHASES]).toEqual([
      'ingress', 'protocol.decode', 'request.preprocess', 'routing.prepare',
      'routing.execute', 'upstream.prepare', 'upstream.execute',
      'response.postprocess', 'protocol.encode', 'egress', 'finalize',
    ])
  })
})
