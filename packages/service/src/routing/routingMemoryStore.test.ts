import { describe, it, expect, vi } from 'vitest'
import { addRoutingDecision, getRoutingHistory } from './routingMemoryStore.js'

describe('routingMemoryStore', () => {
  it('returns empty array when no decisions exist', () => {
    const history = getRoutingHistory('proj-new', 'conv-new', 5)
    expect(history).toEqual([])
  })

  it('stores and retrieves routing decisions', () => {
    addRoutingDecision('proj1', 'conv1', 'model-a')
    addRoutingDecision('proj1', 'conv1', 'model-b')
    const history = getRoutingHistory('proj1', 'conv1', 10)
    expect(history).toHaveLength(2)
    expect(history[0]!.model).toBe('model-a')
    expect(history[1]!.model).toBe('model-b')
  })

  it('respects count parameter and returns last N entries', () => {
    addRoutingDecision('proj2', 'conv2', 'ma')
    addRoutingDecision('proj2', 'conv2', 'mb')
    addRoutingDecision('proj2', 'conv2', 'mc')
    const history = getRoutingHistory('proj2', 'conv2', 2)
    expect(history).toHaveLength(2)
    expect(history[0]!.model).toBe('mb')
    expect(history[1]!.model).toBe('mc')
  })

  it('isolates by project:conversation key', () => {
    addRoutingDecision('proj3', 'convA', 'x')
    addRoutingDecision('proj3', 'convB', 'y')
    expect(getRoutingHistory('proj3', 'convA', 5)).toHaveLength(1)
    expect(getRoutingHistory('proj3', 'convB', 5)).toHaveLength(1)
    expect(getRoutingHistory('proj3', 'convA', 5)[0]!.model).toBe('x')
  })

  it('caps entries per conversation at MAX_ENTRIES_PER_CONV (50)', () => {
    for (let i = 0; i < 55; i++) {
      addRoutingDecision('proj4', 'conv4', `model-${i}`)
    }
    const history = getRoutingHistory('proj4', 'conv4', 100)
    expect(history.length).toBeLessThanOrEqual(50)
  })

  it('stores timestamp with each decision', () => {
    const before = Date.now()
    addRoutingDecision('proj5', 'conv5', 'model-ts')
    const after = Date.now()
    const history = getRoutingHistory('proj5', 'conv5', 1)
    expect(history[0]!.ts).toBeGreaterThanOrEqual(before)
    expect(history[0]!.ts).toBeLessThanOrEqual(after)
  })

  it('removes conversation key when all entries are older than MAX_AGE_MS (line 21)', () => {
    let mockTime = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => mockTime)

    addRoutingDecision('proj-stale', 'conv-stale', 'model-old')
    // Advance past 1-hour TTL
    mockTime += 2 * 60 * 60 * 1_000
    // Trigger cleanup by adding a new entry to a different conversation
    addRoutingDecision('proj-stale', 'conv-new', 'model-new')

    // The stale conversation should be gone
    expect(getRoutingHistory('proj-stale', 'conv-stale', 5)).toHaveLength(0)
    expect(getRoutingHistory('proj-stale', 'conv-new', 5)).toHaveLength(1)

    vi.restoreAllMocks()
  })
})
