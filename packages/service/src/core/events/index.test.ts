import { describe, it, expect, vi } from 'vitest'
import { EventBus, topicMatches } from './index.js'

describe('topicMatches', () => {
  it('matches exact topics and normalizes leading slash', () => {
    expect(topicMatches('/routing/started', 'routing/started')).toBe(true)
    expect(topicMatches('routing/started', '/routing/started')).toBe(true)
    expect(topicMatches('routing/started', 'routing/completed')).toBe(false)
  })

  it('* matches a single segment only', () => {
    expect(topicMatches('routing/*/failed', 'routing/policy/failed')).toBe(true)
    expect(topicMatches('routing/*/failed', 'routing/a/b/failed')).toBe(false)
    expect(topicMatches('routing/*/failed', 'routing/failed')).toBe(false)
  })

  it('** matches zero or more segments', () => {
    expect(topicMatches('routing/**', 'routing')).toBe(true)
    expect(topicMatches('routing/**', 'routing/policy/cheapest/completed')).toBe(true)
    expect(topicMatches('**/failed', 'a/b/failed')).toBe(true)
    expect(topicMatches('**/failed', 'ok')).toBe(false)
  })

  it('** in the middle matches zero or more segments', () => {
    expect(topicMatches('a/**/z', 'a/z')).toBe(true)
    expect(topicMatches('a/**/z', 'a/b/c/z')).toBe(true)
    expect(topicMatches('a/**/z', 'a/y')).toBe(false)
  })
})

describe('EventBus', () => {
  it('delivers to matching subscribers only', () => {
    const bus = new EventBus()
    const hits: string[] = []
    bus.subscribe('routing/**', (t) => hits.push(t))
    bus.subscribe('upstream/**', (t) => hits.push(`u:${t}`))
    bus.publish('routing/completed', { ok: true })
    expect(hits).toEqual(['routing/completed'])
  })

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus()
    const fn = vi.fn()
    const off = bus.subscribe('a/**', fn)
    bus.publish('a/x')
    off()
    bus.publish('a/y')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('isolates a throwing listener and reports the error', () => {
    const onListenerError = vi.fn()
    const bus = new EventBus({ onListenerError })
    const good = vi.fn()
    bus.subscribe('t/**', () => {
      throw new Error('bad')
    })
    bus.subscribe('t/**', good)
    bus.publish('t/x')
    expect(good).toHaveBeenCalledTimes(1)
    expect(onListenerError).toHaveBeenCalledTimes(1)
  })
})
