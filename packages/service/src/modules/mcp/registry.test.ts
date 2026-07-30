import { describe, it, expect } from 'vitest'
import { AlterableRegistry, token } from '../../core/index.js'
import { createMcpToolRegistry, type McpToolEntry } from './registry.js'

function entry(overrides: Partial<McpToolEntry> = {}): McpToolEntry {
  return {
    name: 'ping',
    description: 'health probe',
    inputSchema: { type: 'object', properties: {} },
    scope: 'read',
    requires: token<unknown>('test.dep'),
    async handler() {
      return { content: [{ type: 'text', text: 'pong' }] }
    },
    ...overrides,
  }
}

describe('createMcpToolRegistry', () => {
  it('returns an AlterableRegistry', () => {
    expect(createMcpToolRegistry()).toBeInstanceOf(AlterableRegistry)
  })

  it('round-trips one contributed entry through ordered()', () => {
    const reg = createMcpToolRegistry()
    const e = entry()
    reg.contribute({ id: 'ping', value: e })

    const ordered = reg.ordered()
    expect(ordered).toHaveLength(1)
    const [first] = ordered
    expect(first).toBe(e)
    expect(first?.name).toBe('ping')
    expect(first?.requires.key).toBe('test.dep')
  })

  it('keeps each entry retrievable by id and carries the DI gate token', () => {
    const reg = createMcpToolRegistry()
    const dep = token<unknown>('catalog.registry')
    reg.contribute({ id: 'catalog', value: entry({ name: 'catalog', requires: dep }) })

    const got = reg.get('catalog')
    expect(got?.requires).toBe(dep)
    expect(got?.scope).toBe('read')
  })
})
