import { describe, expect, it } from 'vitest'
import type { Message, OptimizerStep, ProjectConfig } from '@routerly/shared'
import { optimizerFixture } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { jsonTableOptimizer, jsonTableModule } from './index.js'

function makeCtx(
  messages: Message[],
  steps: OptimizerStep[] = [{ id: 'json-table', enabled: true }],
): ProxyContext {
  const request = { model: 'test', messages } as ProxyContext['request']
  return {
    request,
    original: request,
    project: { id: 'p1', optimizers: { steps } } as unknown as ProjectConfig,
    projectId: 'p1',
  } as unknown as ProxyContext
}

const ROWS = Array.from({ length: 10 }, (_, i) => ({
  path: `src/${String.fromCharCode(97 + i)}/index.ts`,
  bytes: 1000 + i * 10,
  modified: `2026-07-0${(i % 9) + 1}`,
}))

describe('json-table optimizer', () => {
  it('is recoverable with the json-table id', () => {
    expect(jsonTableOptimizer.id).toBe('json-table')
    expect(jsonTableOptimizer.klass).toBe('recoverable')
  })

  it('compacts a uniform array of objects', () => {
    const ctx = makeCtx([{ role: 'user', content: JSON.stringify(ROWS) }])
    expect(jsonTableOptimizer.supports(ctx)).toBe(true)
    const result = jsonTableOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    expect(result.estimatedTokensAfter).toBeLessThan(result.estimatedTokensBefore)
    expect(jsonTableOptimizer.validate(ctx, result)).toBe(true)
  })

  it('keeps every value in the compacted output', () => {
    const ctx = makeCtx([{ role: 'user', content: JSON.stringify(ROWS) }])
    jsonTableOptimizer.optimize(ctx)
    const out = String(ctx.request.messages![0]!.content)
    for (const row of ROWS) {
      expect(out).toContain(row.path)
      expect(out).toContain(String(row.bytes))
      expect(out).toContain(row.modified)
    }
    // The key names appear once, in the header, instead of once per row.
    expect(out.match(/path/g)).toHaveLength(1)
  })

  it('stays inert below the row threshold', () => {
    const ctx = makeCtx([{ role: 'user', content: JSON.stringify(ROWS.slice(0, 3)) }], [
      { id: 'json-table', enabled: true, threshold: 5 },
    ])
    expect(jsonTableOptimizer.supports(ctx)).toBe(false)
  })

  it('stays inert on a ragged array', () => {
    const ragged = [{ a: 1 }, { a: 2, b: 3 }, { a: 4 }, { a: 5 }, { a: 6 }, { a: 7 }]
    const ctx = makeCtx([{ role: 'user', content: JSON.stringify(ragged) }])
    expect(jsonTableOptimizer.supports(ctx)).toBe(false)
  })

  it('stays inert on rows that share a key count but not the keys', () => {
    const mismatched = Array.from({ length: 6 }, (_, i) =>
      i === 3 ? { a: i, c: 'x' } : { a: i, b: 'x' },
    )
    const ctx = makeCtx([{ role: 'user', content: JSON.stringify(mismatched) }])
    expect(jsonTableOptimizer.supports(ctx)).toBe(false)
  })

  it('stays inert on nested values it cannot flatten', () => {
    const nested = Array.from({ length: 6 }, (_, i) => ({ a: i, b: { deep: true } }))
    const ctx = makeCtx([{ role: 'user', content: JSON.stringify(nested) }])
    expect(jsonTableOptimizer.supports(ctx)).toBe(false)
  })

  it('stays inert when a value carries the column separator', () => {
    const piped = Array.from({ length: 6 }, (_, i) => ({ a: i, b: 'left | right' }))
    const ctx = makeCtx([{ role: 'user', content: JSON.stringify(piped) }])
    expect(jsonTableOptimizer.supports(ctx)).toBe(false)
  })

  it('leaves prose that merely quotes an array alone', () => {
    const prose = `Here is the listing: ${JSON.stringify(ROWS)}`
    const ctx = makeCtx([{ role: 'user', content: prose }])
    expect(jsonTableOptimizer.supports(ctx)).toBe(false)
  })

  it('fires on the coding-agent fixture', () => {
    const fixture = optimizerFixture('agent-tools-en')!
    expect(jsonTableOptimizer.supports(makeCtx(fixture.messages))).toBe(true)
  })

  it('restores the original array on recover', () => {
    const original = JSON.stringify(ROWS)
    const ctx = makeCtx([{ role: 'user', content: original }])
    const result = jsonTableOptimizer.optimize(ctx)
    jsonTableOptimizer.recover(ctx, result)
    expect(String(ctx.request.messages![0]!.content)).toBe(original)
  })

  it('registers itself into the optimizer registry', () => {
    expect(jsonTableModule.manifest.id).toBe('optimizer-json-table')
    expect(jsonTableModule.manifest.dependsOn).toEqual({ 'optimizer-core': '^0.4.0' })
  })
})
