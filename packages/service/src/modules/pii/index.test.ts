import { describe, it, expect, vi } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../core/index.js'
import { PROXY_PIPELINE } from '../../core/tokens.js'
import type { ProxyContext } from '../reverse-proxy/context.js'
import { piiModule } from './index.js'

function harness() {
  const container = new ServiceContainer()
  const events = new EventBus()
  container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
  return { container, events }
}

async function processor(id: 'pii.input' | 'pii.output') {
  const { container, events } = harness()
  await piiModule.register({ container, events })
  const pipeline = container.resolve(PROXY_PIPELINE)
  const phase = id === 'pii.input' ? 'request.preprocess' : 'response.postprocess'
  return pipeline.orderedFor(phase).find((p) => p.id === id)!
}

const emailPolicy = { target: 'both', entities: ['EMAIL'] }

function ctxOf(overrides: Partial<ProxyContext>, emit: ReturnType<typeof vi.fn>): ProxyContext {
  return {
    protocol: 'openai',
    router: { id: 'p1', pii: { policies: [emailPolicy] } },
    request: { model: 'gpt', messages: [] },
    emit,
    ...overrides,
  } as unknown as ProxyContext
}

describe('pii module', () => {
  it('contributes input + output PII processors', async () => {
    const { container, events } = harness()
    await piiModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    expect(pipeline.orderedFor('request.preprocess').map((p) => p.id)).toContain('pii.input')
    expect(pipeline.orderedFor('response.postprocess').map((p) => p.id)).toContain('pii.output')
  })

  it('orders pii.input before guardrail-style later processors via weight', async () => {
    const { container, events } = harness()
    await piiModule.register({ container, events })
    const pipeline = container.resolve(PROXY_PIPELINE)
    // pii.input carries weight -10 so it wins the ready-set tiebreak and runs first.
    expect(pipeline.orderedFor('request.preprocess')[0]?.id).toBe('pii.input')
  })

  it('traces what the request scan looked for, not only what it found', async () => {
    const emit = vi.fn()
    const proc = await processor('pii.input')
    const ctx = ctxOf({
      request: {
        model: 'gpt',
        messages: [
          { role: 'user', content: 'write to a@b.com and c@d.com' },
          { role: 'user', content: [{ type: 'image_url' }] },
        ],
      },
      router: { id: 'p1', pii: { policies: [emailPolicy, { target: 'response', entities: ['SSN'] }] } },
    } as unknown as Partial<ProxyContext>, emit)
    await proc.run(ctx)
    expect(emit.mock.calls[0]![0]).toMatchObject({
      panel: 'request',
      message: 'pii:evaluated',
      details: {
        target: 'request',
        policies: { configured: 2, active: 1 },
        entities: ['EMAIL'],
        customPatterns: 0,
        scanned: 1, // the multimodal message is not a string, so it is not scanned
        redacted: ['EMAIL'],
        counts: { EMAIL: 2 },
      },
    })
    expect(emit.mock.calls[1]![0]).toEqual({
      panel: 'request',
      message: 'pii:scrubbed',
      details: { entities: ['EMAIL'], counts: { EMAIL: 2 } },
    })
  })

  it('traces the response scan on the JSON path, which reported nothing before', async () => {
    const emit = vi.fn()
    const proc = await processor('pii.output')
    const body = { choices: [{ message: { content: 'reply to a@b.com' } }] }
    const ctx = ctxOf({ result: { kind: 'json', body } } as unknown as Partial<ProxyContext>, emit)
    await proc.run(ctx)
    expect(body.choices[0]!.message.content).toBe('reply to [EMAIL]')
    expect(emit.mock.calls[0]![0]).toMatchObject({
      panel: 'response',
      message: 'pii:evaluated',
      details: { target: 'response', mode: 'json', scanned: 1, redacted: ['EMAIL'], counts: { EMAIL: 1 } },
    })
    expect(emit.mock.calls[1]![0]).toMatchObject({ message: 'pii:scrubbed', details: { entities: ['EMAIL'] } })
  })

  it('traces a clean response scan without a scrubbed entry', async () => {
    const emit = vi.fn()
    const proc = await processor('pii.output')
    const ctx = ctxOf({
      result: { kind: 'json', body: { choices: [{ message: { content: 'nothing here' } }] } },
    } as unknown as Partial<ProxyContext>, emit)
    await proc.run(ctx)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0]![0]).toMatchObject({ message: 'pii:evaluated', details: { redacted: [], counts: {} } })
  })
})
