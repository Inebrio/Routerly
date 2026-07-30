import { describe, it, expect } from 'vitest'
import type { Message } from '@routerly/shared'
import { OptimizerRegistry, type Optimizer } from './registry.js'
import { readMessages, writeMessages, tokensOf } from './messages.js'
import { runPreview } from './preview.js'

// ── Fake optimizers ──────────────────────────────────────────────────────────

// Lossless: drops the last message. Real token reduction, always validates.
const dropLast = {
  id: 'session-dedup',
  klass: 'lossless',
  supports: (ctx) => readMessages(ctx.request).length > 1,
  estimate(ctx) {
    const before = tokensOf(readMessages(ctx.request))
    return { estimatedTokensBefore: before, estimatedTokensAfter: before }
  },
  optimize(ctx) {
    const msgs = readMessages(ctx.request)
    const before = tokensOf(msgs)
    const kept = msgs.slice(0, -1)
    writeMessages(ctx.request, kept)
    return { changed: true, estimatedTokensBefore: before, estimatedTokensAfter: tokensOf(kept) }
  },
  validate: () => true,
} satisfies Optimizer

// Lossy: nukes everything to a stub below the safety-gate floor ratio. Mutates
// in place, then reports the tiny result — the gate must reject and roll it back.
const nuke = {
  id: 'caveman',
  klass: 'lossy',
  supports: () => true,
  estimate(ctx) {
    const before = tokensOf(readMessages(ctx.request))
    return { estimatedTokensBefore: before, estimatedTokensAfter: 1 }
  },
  optimize(ctx) {
    const before = tokensOf(readMessages(ctx.request))
    writeMessages(ctx.request, [{ role: 'user', content: 'x' }])
    return { changed: true, estimatedTokensBefore: before, estimatedTokensAfter: tokensOf(readMessages(ctx.request)) }
  },
  validate: () => true,
} satisfies Optimizer

function makeRegistry(...optimizers: Optimizer[]): OptimizerRegistry {
  const r = new OptimizerRegistry()
  for (const o of optimizers) r.register(o)
  return r
}

const sample: Message[] = [
  { role: 'system', content: 'You are a helpful assistant that answers questions.' },
  { role: 'user', content: 'What is the capital of France? Please be concise.' },
  { role: 'assistant', content: 'The capital of France is Paris.' },
  { role: 'user', content: 'And what about the capital city of the country Germany?' },
]

describe('runPreview', () => {
  it('reports per-step and total token deltas for an applied lossless step', async () => {
    const registry = makeRegistry(dropLast)
    const totalBefore = tokensOf(sample)

    const res = await runPreview({
      registry,
      sampleMessages: sample,
      steps: [{ id: 'session-dedup', enabled: true }],
    })

    expect(res.estimatedTokensBefore).toBe(totalBefore)
    expect(res.estimatedTokensAfter).toBeLessThan(totalBefore)
    expect(res.perStep).toEqual([
      { id: 'session-dedup', before: totalBefore, after: res.estimatedTokensAfter },
    ])
  })

  it('reports a lossy step that fails the safety gate as unchanged (before === after)', async () => {
    const registry = makeRegistry(nuke)
    const totalBefore = tokensOf(sample)

    const res = await runPreview({
      registry,
      sampleMessages: sample,
      steps: [{ id: 'caveman', enabled: true }],
    })

    // Gate rejects the over-compression → rolled back → no net change.
    expect(res.estimatedTokensAfter).toBe(totalBefore)
    expect(res.perStep).toEqual([{ id: 'caveman', before: totalBefore, after: totalBefore }])
  })

  it('chains steps: a rolled-back lossy step leaves the prior lossless reduction intact', async () => {
    const registry = makeRegistry(dropLast, nuke)
    const totalBefore = tokensOf(sample)

    const res = await runPreview({
      registry,
      sampleMessages: sample,
      steps: [
        { id: 'session-dedup', enabled: true },
        { id: 'caveman', enabled: true },
      ],
    })

    const afterDrop = res.perStep[0]!.after
    expect(afterDrop).toBeLessThan(totalBefore)
    // caveman rolled back → its before/after both equal the post-drop total.
    expect(res.perStep[1]).toEqual({ id: 'caveman', before: afterDrop, after: afterDrop })
    expect(res.estimatedTokensAfter).toBe(afterDrop)
  })

  it('treats a disabled step as a no-op', async () => {
    const registry = makeRegistry(dropLast)
    const totalBefore = tokensOf(sample)

    const res = await runPreview({
      registry,
      sampleMessages: sample,
      steps: [{ id: 'session-dedup', enabled: false }],
    })

    expect(res.estimatedTokensAfter).toBe(totalBefore)
    expect(res.perStep).toEqual([{ id: 'session-dedup', before: totalBefore, after: totalBefore }])
  })

  it('treats an unknown / unregistered optimizer id as a no-op', async () => {
    const registry = makeRegistry()
    const totalBefore = tokensOf(sample)

    const res = await runPreview({
      registry,
      sampleMessages: sample,
      steps: [{ id: 'session-dedup', enabled: true }],
    })

    expect(res.estimatedTokensAfter).toBe(totalBefore)
  })

  it('degrades to no-op deltas when no registry is present', async () => {
    const totalBefore = tokensOf(sample)

    const res = await runPreview({
      registry: undefined,
      sampleMessages: sample,
      steps: [{ id: 'session-dedup', enabled: true }],
    })

    expect(res.estimatedTokensBefore).toBe(totalBefore)
    expect(res.estimatedTokensAfter).toBe(totalBefore)
    expect(res.perStep).toEqual([{ id: 'session-dedup', before: totalBefore, after: totalBefore }])
  })

  it('does not mutate the caller sampleMessages array', async () => {
    const registry = makeRegistry(dropLast)
    const copy = structuredClone(sample)

    await runPreview({ registry, sampleMessages: sample, steps: [{ id: 'session-dedup', enabled: true }] })

    expect(sample).toEqual(copy)
  })
})
