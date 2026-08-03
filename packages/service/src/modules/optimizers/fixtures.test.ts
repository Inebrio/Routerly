import { describe, expect, it } from 'vitest'
import { OPTIMIZER_FIXTURES, optimizerFixture } from '@routerly/shared'
import { segment } from './messages.js'

describe('optimizer fixtures', () => {
  it('exposes stable ids the surfaces reference', () => {
    const ids = OPTIMIZER_FIXTURES.map(f => f.id)
    expect(ids).toEqual(['support-chat-en', 'brief-en', 'agent-tools-en'])
  })

  it('gives every fixture a non-empty conversation', () => {
    for (const f of OPTIMIZER_FIXTURES) {
      expect(f.messages.length).toBeGreaterThan(0)
      expect(f.label).not.toBe('')
    }
  })

  it('gives support-chat-en enough turns for ccr and relevance to have something to do', () => {
    const fixture = optimizerFixture('support-chat-en')!
    expect(segment(fixture.messages).turns.length).toBeGreaterThanOrEqual(6)
  })

  it('returns undefined for an unknown id', () => {
    expect(optimizerFixture('nope')).toBeUndefined()
  })
})
