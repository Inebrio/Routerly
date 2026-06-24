import { describe, it, expect } from 'vitest'
import { parseRoutingTags } from './requestEnrichment.js'

describe('parseRoutingTags', () => {
  it('returns undefined for undefined input', () => {
    expect(parseRoutingTags(undefined)).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(parseRoutingTags('')).toBeUndefined()
  })

  it('parses a single key=value pair', () => {
    expect(parseRoutingTags('key=val')).toEqual({ key: 'val' })
  })

  it('parses multiple comma-separated pairs', () => {
    expect(parseRoutingTags('customer=acme,feature=rag')).toEqual({ customer: 'acme', feature: 'rag' })
  })

  it('truncates values to 64 characters', () => {
    const long = 'a'.repeat(100)
    const result = parseRoutingTags(`k=${long}`)
    expect(result!['k']).toHaveLength(64)
  })

  it('respects the 10-key cap (12 pairs → only first 10 kept)', () => {
    const pairs = Array.from({ length: 12 }, (_, i) => `k${i}=v${i}`).join(',')
    const result = parseRoutingTags(pairs)!
    expect(Object.keys(result)).toHaveLength(10)
    expect(result['k0']).toBe('v0')
    expect(result['k9']).toBe('v9')
    expect(result['k10']).toBeUndefined()
  })

  it('ignores pairs without =', () => {
    expect(parseRoutingTags('noequalssign')).toBeUndefined()
  })

  it('ignores pairs where = is the first character (empty key)', () => {
    expect(parseRoutingTags('=value')).toBeUndefined()
  })

  it('trims whitespace around keys and values', () => {
    expect(parseRoutingTags('  key  =  val  ')).toEqual({ key: 'val' })
  })

  it('returns undefined when all pairs are invalid', () => {
    expect(parseRoutingTags('noeq,alsono,=badkey')).toBeUndefined()
  })
})
