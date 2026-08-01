import { describe, it, expect, beforeEach } from 'vitest'
import type { Message } from '@routerly/shared'
import { captureSample, listSamples, clearSamples } from './samples.js'

beforeEach(() => clearSamples())

const AT = '2026-08-01T10:00:00.000Z'

function conversation(n: number): Message[] {
  return Array.from({ length: n }, (_, i) => ({ role: 'user', content: `message ${i}` }) as Message)
}

describe('captureSample', () => {
  it('returns the captured prompt with its estimated size', () => {
    captureSample('p1', [{ role: 'user', content: 'hello there' }], AT)
    expect(listSamples('p1')).toEqual([
      { capturedAt: AT, messages: [{ role: 'user', content: 'hello there' }], estimatedTokens: 3 },
    ])
  })

  it('keeps samples per project', () => {
    captureSample('p1', [{ role: 'user', content: 'one' }], AT)
    captureSample('p2', [{ role: 'user', content: 'two' }], AT)
    expect(listSamples('p1')).toHaveLength(1)
    expect(listSamples('p2')[0]!.messages[0]!.content).toBe('two')
  })

  it('lists newest first', () => {
    captureSample('p1', [{ role: 'user', content: 'first' }], '2026-08-01T10:00:00.000Z')
    captureSample('p1', [{ role: 'user', content: 'second' }], '2026-08-01T10:01:00.000Z')
    expect(listSamples('p1').map(s => s.messages[0]!.content)).toEqual(['second', 'first'])
  })

  it('keeps only the five most recent prompts of a project', () => {
    for (let i = 0; i < 8; i++) captureSample('p1', [{ role: 'user', content: `n${i}` }], AT)
    expect(listSamples('p1').map(s => s.messages[0]!.content)).toEqual(['n7', 'n6', 'n5', 'n4', 'n3'])
  })

  it('keeps the newest twenty messages of a long conversation and says so', () => {
    captureSample('p1', conversation(25), AT)
    const sample = listSamples('p1')[0]!
    expect(sample.messages).toHaveLength(20)
    expect(sample.messages[0]!.content).toBe('message 5')
    expect(sample.truncated).toBe(true)
  })

  it('reports the size of the whole prompt, not of the trimmed excerpt', () => {
    const full = conversation(25)
    const whole = captureSampleTokens(full)
    captureSample('p1', full, AT)
    expect(listSamples('p1')[0]!.estimatedTokens).toBe(whole)
  })

  it('clips a long message and marks the sample truncated', () => {
    captureSample('p1', [{ role: 'user', content: 'x'.repeat(1500) }], AT)
    const sample = listSamples('p1')[0]!
    expect(sample.messages[0]!.content).toBe(`${'x'.repeat(1000)}...`)
    expect(sample.truncated).toBe(true)
  })

  it('clips the text parts of a structured message, leaving the shape alone', () => {
    captureSample(
      'p1',
      [{ role: 'user', content: [{ type: 'text', text: 'y'.repeat(1500) }, { type: 'text', text: 'short' }] }] as Message[],
      AT,
    )
    const parts = listSamples('p1')[0]!.messages[0]!.content as { type: string; text: string }[]
    expect(parts[0]!.text).toBe(`${'y'.repeat(1000)}...`)
    expect(parts[1]!.text).toBe('short')
  })

  it('leaves a short prompt unmarked', () => {
    captureSample('p1', [{ role: 'user', content: 'short enough' }], AT)
    expect(listSamples('p1')[0]!.truncated).toBeUndefined()
  })

  it('ignores an empty prompt and a missing project id', () => {
    captureSample('p1', [], AT)
    captureSample('', [{ role: 'user', content: 'orphan' }], AT)
    expect(listSamples('p1')).toEqual([])
    expect(listSamples('')).toEqual([])
  })

  it('returns an empty list for a project nothing has reached', () => {
    expect(listSamples('never-seen')).toEqual([])
  })
})

/** estimateTokens over a whole prompt, mirroring what the buffer reports. */
function captureSampleTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + Math.ceil(String(m.content).length / 4), 0)
}
