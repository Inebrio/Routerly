import { describe, it, expect } from 'vitest'
import type { ModelConfig } from '@routerly/shared'
import { ProcessorRegistry, type Processor } from '../core/index.js'
import { runProxy, setProxyPipeline } from './run.js'
import { openaiEgress, openaiAttempt } from './lanes/openai.js'
import type { ProxyContext } from './context.js'
import { writeConfig } from '../config/loader.js'

// A fake upstream that stands in for openai:upstream, so the harness never hits a
// real provider. It sets a json result for the first candidate.
const fakeUpstream: Processor<ProxyContext> = {
  id: 'openai:upstream', phase: 'upstream.execute',
  run(ctx) {
    if (ctx.protocol !== 'openai' || ctx.result) return
    if (ctx.attempt) ctx.result = { kind: 'json', body: { object: 'chat.completion', model: ctx.attempt.model.id } }
  },
}

describe('runProxy transport harness (dark pipeline, no live route)', () => {
  it('attempt -> upstream -> egress writes the json result', async () => {
    // openai:attempt reads readConfig('models') for real (test-setup.ts isolates
    // ROUTERLY_HOME, so this never touches real config). Seed model-a so the fake
    // upstream fires a json result: run.ts's block-skip would short-circuit past
    // egress entirely on the 503-exhaustion path, so only the json outcome proves
    // egress actually wrote a response in this harness.
    const models: ModelConfig[] = [
      {
        id: 'model-a', name: 'model-a', provider: 'openai', endpoint: 'https://api.openai.com/v1',
        cost: { inputPerMillion: 0, outputPerMillion: 0 },
      },
    ]
    await writeConfig('models', models)

    const reg = new ProcessorRegistry<ProxyContext>()
    reg.contribute(openaiAttempt)
    reg.contribute(fakeUpstream)
    reg.contribute(openaiEgress)
    setProxyPipeline(reg)

    const sent: unknown[] = []
    const reply: any = { send: (b: unknown) => sent.push(b), header: () => {}, code: () => reply }
    const ctx = {
      protocol: 'openai', reply, log: { info() {}, warn() {}, error() {} },
      project: { id: 'p1', models: [] }, projectId: 'p1',
      traceId: 't1', traceEnabled: false, traceSuppressed: false,
      request: { model: 'm', messages: [] }, original: {}, stream: false, passthrough: false,
      candidates: [{ model: 'model-a', weight: 1 }],
    } as unknown as ProxyContext

    await runProxy(reg, ctx)

    expect(sent.length).toBe(1)
    expect(ctx.result?.kind).toBe('json')
  })
})
