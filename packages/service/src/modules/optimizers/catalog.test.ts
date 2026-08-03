import { describe, it, expect, vi } from 'vitest'
import { OPTIMIZER_CATALOG } from '@routerly/shared'
import type { ChatCompletionRequest, Message, OptimizerId } from '@routerly/shared'
import type { ProxyContext } from '../reverse-proxy/context.js'
import type { Optimizer } from './registry.js'
import { readMessages } from './messages.js'
import { sessionDedupOptimizer } from './session-dedup/index.js'
import { ccrOptimizer } from './ccr/index.js'
import { rtkOptimizer } from './rtk/index.js'
import { headroomOptimizer } from './headroom/index.js'
import { jsonTableOptimizer } from './json-table/index.js'
import { relevanceOptimizer } from './relevance/index.js'
import { cavemanOptimizer } from './caveman/index.js'
import { llmlingua2Optimizer } from './llmlingua2/index.js'

/**
 * The shared catalog (T63) is what dashboard, CLI and docs read to present an
 * optimizer. It restates two things the implementations own: the reversibility
 * class, and the value a step falls back to when its threshold is empty. This
 * file is the guard against those two copies drifting apart.
 */

const IMPLEMENTATIONS: Optimizer[] = [
  sessionDedupOptimizer,
  ccrOptimizer,
  rtkOptimizer,
  headroomOptimizer,
  jsonTableOptimizer,
  relevanceOptimizer,
  cavemanOptimizer,
  llmlingua2Optimizer,
]

function ctxWith(messages: Message[], step?: { id: OptimizerId; threshold?: number }, attempt?: unknown): ProxyContext {
  const request = { model: 'gpt', messages } as ChatCompletionRequest
  return {
    protocol: 'openai',
    req: { headers: {} } as any,
    reply: {} as any,
    log: { warn: vi.fn(), error: vi.fn() } as any,
    project: { id: 'p1', optimizers: { steps: step ? [{ ...step, enabled: true }] : [] } } as any,
    projectId: 'p1',
    traceId: 't1',
    original: request,
    request,
    stream: false,
    passthrough: false,
    ...(attempt ? { attempt } : {}),
  } as ProxyContext
}

/** Catalog default of an optimizer that must declare one, loud when it stops declaring it. */
function catalogDefault(id: OptimizerId): number {
  const value = OPTIMIZER_CATALOG[id].threshold?.default
  if (value === undefined) throw new Error(`no catalog default for ${id}`)
  return value
}

/**
 * A conversation of `turns` user/assistant exchanges, long enough to be worth
 * trimming. `answerLen` pads each answer past ccr's condense cap, which is what
 * makes condensation save more than the condensed block's own overhead costs.
 */
function conversation(turns: number, answerLen = 0): Message[] {
  const messages: Message[] = [{ role: 'system', content: 'be terse' }]
  const pad = answerLen > 0 ? ` ${'x'.repeat(answerLen)}` : ''
  for (let i = 0; i < turns; i++) {
    messages.push({ role: 'user', content: `question number ${i} with enough words to weigh something` })
    messages.push({ role: 'assistant', content: `answer number ${i} with enough words to weigh something${pad}` })
  }
  return messages
}

describe('OPTIMIZER_CATALOG parity with the implementations', () => {
  it('covers every registered optimizer and nothing else', () => {
    const implIds = IMPLEMENTATIONS.map((o) => o.id).sort()
    expect(Object.keys(OPTIMIZER_CATALOG).sort()).toEqual(implIds)
  })

  it('states the same reversibility class as each implementation', () => {
    for (const impl of IMPLEMENTATIONS) {
      expect(OPTIMIZER_CATALOG[impl.id].klass).toBe(impl.klass)
    }
  })

  it('declares a threshold only for the optimizers that read one', () => {
    // session-dedup, rtk and caveman ignore `threshold` entirely: giving them a
    // control in the dashboard would suggest a knob that does nothing.
    const withThreshold = Object.values(OPTIMIZER_CATALOG)
      .filter((m) => m.threshold)
      .map((m) => m.id)
      .sort()
    expect(withThreshold).toEqual(['ccr', 'headroom', 'json-table', 'llmlingua-2', 'relevance'])
  })

  it("ccr's catalog default is the window it actually falls back to", () => {
    const fallback = ccrOptimizer.optimize(ctxWith(conversation(10, 400)))
    const explicit = ccrOptimizer.optimize(
      ctxWith(conversation(10, 400), { id: 'ccr', threshold: catalogDefault('ccr') }),
    )
    expect(fallback.estimatedTokensAfter).toBe(explicit.estimatedTokensAfter)
    expect(fallback.changed).toBe(true)
  })

  it("headroom's catalog default is the reserve it actually falls back to", () => {
    const attempt = { model: { contextWindow: 1200 } }
    const messages = conversation(40)
    const fallback = headroomOptimizer.optimize(ctxWith(messages.slice(), undefined, attempt))
    const explicit = headroomOptimizer.optimize(
      ctxWith(messages.slice(), { id: 'headroom', threshold: catalogDefault('headroom') }, attempt),
    )
    expect(fallback.estimatedTokensAfter).toBe(explicit.estimatedTokensAfter)
    expect(fallback.changed).toBe(true)
  })

  it("relevance's catalog default is the overlap it actually falls back to", () => {
    // Enabling the step is the whole opt-in: no second, undiscoverable number.
    const offTopic = (): Message[] => [
      { role: 'user', content: 'how do I bake sourdough bread at home' },
      { role: 'assistant', content: 'start with a ripe starter and a long bulk ferment' },
      { role: 'user', content: 'which port does the proxy bind on' },
      { role: 'assistant', content: 'the proxy binds port 3000 by default' },
    ]
    expect(relevanceOptimizer.supports(ctxWith(offTopic()))).toBe(true)
    const fallback = relevanceOptimizer.optimize(ctxWith(offTopic()))
    const explicit = relevanceOptimizer.optimize(
      ctxWith(offTopic(), { id: 'relevance', threshold: catalogDefault('relevance') }),
    )
    expect(fallback.changed).toBe(true)
    expect(fallback.estimatedTokensAfter).toBe(explicit.estimatedTokensAfter)
  })

  it('llmlingua-2 keeps the catalog default ratio when the threshold is out of range', () => {
    // The optimizer clamps by falling back: anything outside 0 < t < 1 becomes
    // the default, so a step of 0 and a step of the catalog default must agree.
    const messages = conversation(4)
    const outOfRange = ctxWith(messages.slice(), { id: 'llmlingua-2', threshold: 0 })
    const atDefault = ctxWith(messages.slice(), { id: 'llmlingua-2', threshold: catalogDefault('llmlingua-2') })
    expect(llmlingua2Optimizer.estimate(outOfRange)).toEqual(llmlingua2Optimizer.estimate(atDefault))
  })

  it('keeps the catalog id in step with the implementation id', () => {
    for (const impl of IMPLEMENTATIONS) {
      expect(OPTIMIZER_CATALOG[impl.id].id).toBe(impl.id)
    }
  })

  it('leaves the request untouched when an optimizer is only estimated', () => {
    const messages = conversation(10)
    const ctx = ctxWith(messages)
    ccrOptimizer.estimate(ctx)
    expect(readMessages(ctx.request)).toHaveLength(messages.length)
  })
})
