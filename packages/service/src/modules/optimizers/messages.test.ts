import { describe, it, expect } from 'vitest'
import type { ChatCompletionRequest, Message } from '@routerly/shared'
import { readMessages, writeMessages, estimateTokens, messageText, contentKind } from './messages.js'

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

  it('readMessages returns [] when a request carries no messages', () => {
    expect(readMessages({ model: 'gpt' } as unknown as ChatCompletionRequest)).toEqual([])
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

describe('contentKind', () => {
  it('classifies a bare JSON array', () => {
    expect(contentKind('[{"a":1},{"a":2}]')).toBe('json')
  })

  it('classifies a bare JSON object', () => {
    expect(contentKind('  {"is": true, "for": "x"}  ')).toBe('json')
  })

  it('classifies a fenced code block as code', () => {
    expect(contentKind('```ts\nconst a = 1\n```')).toBe('code')
  })

  it('classifies ordinary text as prose', () => {
    expect(contentKind('Please open the file and tell me what it does.')).toBe('prose')
  })

  it('classifies prose that merely quotes JSON inline as prose', () => {
    expect(contentKind('The server answered with {"ok":true} and then closed the stream.')).toBe('prose')
  })
})
