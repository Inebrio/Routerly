import { describe, it, expect } from 'vitest'
import { createRouteRegistry } from './routes.js'

describe('createRouteRegistry', () => {
  it('creates an AlterableRegistry of route contributions, ordered and overridable', () => {
    const routes = createRouteRegistry()
    routes.contribute({ id: 'list', value: { method: 'GET', url: '/things', handler: () => 'list' } })
    routes.contribute({ id: 'create', value: { method: 'POST', url: '/things', handler: () => 'create' } })
    expect(routes.ordered().map((r) => r.method)).toEqual(['GET', 'POST'])

    routes.override('list', (prev) => ({ ...prev, handler: () => 'overridden' }))
    expect(routes.ordered()[0]?.handler(undefined, undefined)).toBe('overridden')
  })
})
