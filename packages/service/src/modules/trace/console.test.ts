import { describe, it, expect, vi, afterEach } from 'vitest'
import type { TraceEvent } from './store.js'
import { formatTraceLine, isFailure, printTrace } from './console.js'

const event = (entry: Partial<TraceEvent['entry']>): TraceEvent => ({
  traceId: 't-1',
  entry: { panel: 'response', message: 'model:success', details: {}, ...entry },
})

function capture(fn: () => void): { out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true })
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true })
  try {
    fn()
  } finally {
    stdout.mockRestore()
    stderr.mockRestore()
  }
  return { out, err }
}

afterEach(() => vi.restoreAllMocks())

describe('trace console', () => {
  it('prints one line with where the entry came from and what it said', () => {
    const line = formatTraceLine(event({
      phase: 'request.preprocess', module: 'pii', message: 'pii:scrubbed', details: { entities: ['EMAIL'] },
    }))
    expect(line).toBe('trace t-1 request.preprocess/pii pii:scrubbed {"entities":["EMAIL"]}')
  })

  it('marks captured content without printing it', () => {
    const line = formatTraceLine(event({ message: 'model:request', details: {}, content: { systemPrompt: 'secret' } }))
    expect(line).toContain('+content')
    expect(line).not.toContain('secret')
  })

  it('survives a detail that cannot be serialized', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    expect(() => formatTraceLine(event({ details: cyclic }))).not.toThrow()
  })

  it('reads a failure from the message, an error detail, or the outcome', () => {
    expect(isFailure(event({ message: 'model:error' }).entry)).toBe(true)
    expect(isFailure(event({ details: { error: 'boom' } }).entry)).toBe(true)
    expect(isFailure(event({ message: 'trace:recap', details: { outcome: 'blocked' } }).entry)).toBe(true)
    expect(isFailure(event({ message: 'trace:recap', details: { outcome: 'ok' } }).entry)).toBe(false)
  })

  it('sends failures to stderr and everything else to stdout', () => {
    const { out, err } = capture(() => {
      printTrace(event({ message: 'model:success' }), 'info')
      printTrace(event({ message: 'model:error', details: { error: 'boom' } }), 'info')
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatch(/model:success/)
    expect(err[0]).toMatch(/model:error/)
  })

  it('at warn/error level prints failures only: the level is a request for less output', () => {
    const { out, err } = capture(() => {
      printTrace(event({ message: 'model:success' }), 'warn')
      printTrace(event({ message: 'model:error' }), 'error')
    })
    expect(out).toHaveLength(0)
    expect(err).toHaveLength(1)
  })
})
