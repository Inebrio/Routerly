import { AlterableRegistry } from './registry.js'

export interface RouteContribution {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  url: string
  handler: (request: unknown, reply: unknown) => unknown | Promise<unknown>
}

export function createRouteRegistry(): AlterableRegistry<RouteContribution> {
  return new AlterableRegistry<RouteContribution>()
}
