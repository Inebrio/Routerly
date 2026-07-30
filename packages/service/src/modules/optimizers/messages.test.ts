import { describe, it, expect } from 'vitest'
import type { ChatCompletionRequest, Message } from '@routerly/shared'
import { readMessages, writeMessages, estimateTokens, messageText } from './messages.js'

function req(messages: Message[]): ChatCompletionRequest {
  return { model: 'gpt', messages }
}

describe('messages helpers', () => {
  it('round-trips a request unchanged via read then write', () => {
    const original = req([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ])
    const clone = structuredClone(original)
    const r = readMessages(clone)
    writeMessages(clone, r)
    expect(clone).toEqual(original)
  })

  it('writeMessages mutates in place (same request object identity)', () => {
    const r = req([{ role: 'user', content: 'a' }])
    const next: Message[] = [{ role: 'user', content: 'b' }]
    writeMessages(r, next)
    expect(r.messages).toBe(next)
    expect(readMessages(r)).toEqual(next)
  })

  it('estimateTokens counts by a chars/4 approximation', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })

  it('reuses messageText to flatten string and content-block content', () => {
    expect(messageText('plain')).toBe('plain')
    expect(
      messageText([
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' },
      ]),
    ).toBe('one\ntwo')
  })
})
