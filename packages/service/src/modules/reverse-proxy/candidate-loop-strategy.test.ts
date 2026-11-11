import { describe, it, expect, vi, afterEach } from 'vitest'
import { runCandidateLoop, takeAttemptFailure, MAX_COOLDOWN_RETRIES, type AttemptOutcome } from './candidate-loop.js'
import { COOLDOWN_MS } from '../routing/fallback/index.js'
import type { ProxyContext } from './context.js'

const fail: AttemptOutcome = { reason: 'HTTP 500', retryable: true }
const cands = [{ id: 'a', weight: 3 }, { id: 'b', weight: 2 }, { id: 'c', weight: 1 }]

async function run(strategy: 'next-best' | 'retry-after-cooldown' | 'abort', results: (id: string, n: number) => AttemptOutcome, extra = {}) {
  const calls: string[] = []
  const events: string[] = []
  const exhausted = vi.fn()
  const p = runCandidateLoop(cands, async (c) => {
    calls.push(c.id)
    return results(c.id, calls.filter((x) => x === c.id).length)
  }, exhausted, { strategy, onFallback: (e) => events.push(`${e.action}:${(e.candidate as { id: string }).id}`), ...extra })
  await vi.runAllTimersAsync()
  await p
  return { calls, events, exhausted }
}

describe('runCandidateLoop strategies', () => {
  afterEach(() => vi.useRealTimers())

  it('next-best walks to the next candidate', async () => {
    vi.useFakeTimers()
    const r = await run('next-best', (id) => (id === 'b' ? true : fail))
    expect(r.calls).toEqual(['a', 'b'])
    expect(r.events).toEqual(['next:a'])
  })

  it('abort stops at the first failure and exhausts', async () => {
    vi.useFakeTimers()
    const r = await run('abort', (id) => (id === 'b' ? true : fail))
    expect(r.calls).toEqual(['a'])
    expect(r.events).toEqual(['abort:a'])
    expect(r.exhausted).toHaveBeenCalledOnce()
  })

  it('abort does not trigger on a local skip', async () => {
    vi.useFakeTimers()
    const r = await run('abort', (id) => (id === 'a' ? 'skip' : true))
    expect(r.calls).toEqual(['a', 'b'])
  })

  it('retry-after-cooldown retries the same model after the wait, then moves on', async () => {
    vi.useFakeTimers()
    const t0 = Date.now()
    const r = await run('retry-after-cooldown', (id) => (id === 'b' ? true : fail))
    expect(r.calls).toEqual(['a', 'a', 'a', 'b'])
    expect(r.events).toEqual(['retry:a', 'retry:a', 'next:a'])
    expect(Date.now() - t0).toBe(COOLDOWN_MS * MAX_COOLDOWN_RETRIES)
  })

  it('retry budget is per request, not per candidate', async () => {
    vi.useFakeTimers()
    const r = await run('retry-after-cooldown', () => fail)
    expect(r.calls.length).toBe(cands.length + MAX_COOLDOWN_RETRIES)
    expect(r.exhausted).toHaveBeenCalledOnce()
  })

  it('succeeds on a retry', async () => {
    vi.useFakeTimers()
    const r = await run('retry-after-cooldown', (_id, n) => (n === 2 ? true : fail))
    expect(r.calls).toEqual(['a', 'a'])
  })

  it('does not retry a non-retryable failure', async () => {
    vi.useFakeTimers()
    const r = await run('retry-after-cooldown', (id) => (id === 'b' ? true : { reason: 'HTTP 400', retryable: false }))
    expect(r.calls).toEqual(['a', 'b'])
  })

  it('does not retry a model the health gate excludes', async () => {
    vi.useFakeTimers()
    const r = await run('retry-after-cooldown', (id) => (id === 'b' ? true : fail), { canRetry: () => false })
    expect(r.calls).toEqual(['a', 'b'])
  })
})

describe('takeAttemptFailure', () => {
  it('skip when nothing failed, status reason + clears the stash otherwise', () => {
    expect(takeAttemptFailure({} as ProxyContext)).toBe('skip')
    const ctx = { attemptError: new Error('sk-secret leaked'), attemptResponse: { status: 429, body: {} } } as unknown as ProxyContext
    expect(takeAttemptFailure(ctx)).toEqual({ reason: 'HTTP 429', retryable: false })
    expect(ctx.attemptError).toBeUndefined()
    const net = { attemptError: new TypeError('fetch failed sk-secret') } as unknown as ProxyContext
    const out = takeAttemptFailure(net)
    expect(out).toEqual({ reason: 'TypeError', retryable: true })
  })
})
