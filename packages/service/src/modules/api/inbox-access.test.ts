import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadConfig = vi.fn()
vi.mock('../config/loader.js', () => ({ readConfig: (t: string) => mockReadConfig(t) }))

const { loadInboxScope, isVisibleToUser, requiredPermission } = await import('./inbox-access.js')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const item = (over: Record<string, unknown> = {}): any => ({
  id: 'n1', event: 'provider.error', severity: 'critical',
  timestamp: '2026-01-01T00:00:00.000Z', details: {}, readBy: [], ...over,
})

beforeEach(() => {
  mockReadConfig.mockReset()
  mockReadConfig.mockImplementation(async (type: string) => {
    if (type === 'users') return [{ id: 'u1', email: 'u1@example.com', roleId: 'member', routerIds: ['p1'] }]
    if (type === 'routers') return [{ id: 'p1', name: 'Mine' }, { id: 'p2', name: 'Theirs' }]
    return []
  })
})

describe('requiredPermission', () => {
  it('maps each event family to the permission its subject is read through', () => {
    expect(requiredPermission('auth.login_failed')).toBe('audit:read')
    expect(requiredPermission('config.model_added')).toBe('model:read')
    expect(requiredPermission('config.router_deleted')).toBe('router:read')
    expect(requiredPermission('system.startup')).toBe('settings:read')
  })

  it('leaves operational events ungated', () => {
    expect(requiredPermission('provider.error')).toBeUndefined()
    expect(requiredPermission('routing.fallback_used')).toBeUndefined()
    expect(requiredPermission('budget.exceeded')).toBeUndefined()
  })
})

describe('loadInboxScope', () => {
  it('scopes a user to the routers they belong to', async () => {
    const scope = await loadInboxScope('u1')
    expect([...scope.known]).toEqual(['p1', 'p2'])
    expect([...scope.mine]).toEqual(['p1'])
  })

  it('gives an unknown user no router at all', async () => {
    const scope = await loadInboxScope('ghost')
    expect(scope.mine.size).toBe(0)
    expect(scope.known.size).toBe(2)
  })
})

describe('isVisibleToUser', () => {
  it('honours the explicit audience', async () => {
    const scope = await loadInboxScope('u1')
    expect(isVisibleToUser(item({ recipients: ['someone-else'] }), 'u1', [], scope)).toBe(false)
    expect(isVisibleToUser(item({ recipients: ['u1'] }), 'u1', [], scope)).toBe(true)
  })

  it('hides an event about a router the user cannot reach', async () => {
    const scope = await loadInboxScope('u1')
    expect(isVisibleToUser(item({ details: { routerId: 'p2' } }), 'u1', [], scope)).toBe(false)
    expect(isVisibleToUser(item({ details: { routerId: 'p1' } }), 'u1', [], scope)).toBe(true)
  })

  it('keeps an event about a router that is gone', async () => {
    const scope = await loadInboxScope('u1')
    expect(isVisibleToUser(item({ details: { routerId: 'p9' } }), 'u1', [], scope)).toBe(true)
  })

  it('ignores a non-string routerId', async () => {
    const scope = await loadInboxScope('u1')
    expect(isVisibleToUser(item({ details: { routerId: 42 } }), 'u1', [], scope)).toBe(true)
  })

  it('requires the permission the subject is read through', async () => {
    const scope = await loadInboxScope('u1')
    const login = item({ event: 'auth.login_failed' })
    expect(isVisibleToUser(login, 'u1', [], scope)).toBe(false)
    expect(isVisibleToUser(login, 'u1', ['audit:read'], scope)).toBe(true)
  })
})
