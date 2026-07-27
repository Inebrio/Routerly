import { describe, it, expect } from 'vitest'
import {
  buildContentFilterBlock, primaryText, conversationText, wrapWithStreamingScrubber,
} from './helpers.js'
import type { ProxyContext } from './context.js'

function ctxOf(partial: Partial<ProxyContext>): ProxyContext {
  return { protocol: 'openai', traceId: 't1', request: { model: 'm', messages: [] }, ...partial } as unknown as ProxyContext
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}

describe('helpers', () => {
  it('buildContentFilterBlock (openai) is the 200 empty-choice content_filter shape', () => {
    const r = buildContentFilterBlock(ctxOf({ protocol: 'openai', request: { model: 'gpt', messages: [] } as any }))
    expect(r.kind).toBe('block')
    expect(r.status).toBe(200)
    const body = r.body as any
    expect(body.object).toBe('chat.completion')
    expect(body.choices[0].finish_reason).toBe('content_filter')
    expect(body.choices[0].message.content).toBe('')
  })

  it('buildContentFilterBlock (anthropic) is the refusal shape', () => {
    const r = buildContentFilterBlock(ctxOf({ protocol: 'anthropic', original: { model: 'claude', messages: [] } } as any))
    const body = r.body as any
    expect(body.type).toBe('message')
    expect(body.stop_reason).toBe('refusal')
    expect(body.stop_details).toEqual({ type: 'refusal' })
  })

  it('primaryText picks the last user message; conversationText joins roles', () => {
    const req = { messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'bye' }] } as any
    expect(primaryText(req)).toBe('bye')
    expect(conversationText(req)).toBe('user: hi\nassistant: yo\nuser: bye')
  })

  it('wrapWithStreamingScrubber passes chunks through unchanged when the scrubber finds nothing', async () => {
    const effective = { entities: [], customPatterns: [] } as any
    async function* src() {
      yield { choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }] }
    }
    const out = await collect(wrapWithStreamingScrubber(src(), effective, ctxOf({})))
    expect((out[1] as any).choices[0].delta.content).toBe('hello')
  })
})
