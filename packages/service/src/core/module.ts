import type { ServiceContainer } from './container.js'
import type { EventBus } from './events.js'
import { KernelError } from './errors.js'

export interface ModuleManifest {
  id: string
  version: string
  dependsOn?: Record<string, string>
  before?: string[]
  after?: string[]
  weight?: number
}

export interface ModuleRegistry {
  container: ServiceContainer
  events: EventBus
}

export interface Runtime {
  container: ServiceContainer
  events: EventBus
}

export interface RouterlyModule {
  manifest: ModuleManifest
  register(registry: ModuleRegistry): void | Promise<void>
  start?(runtime: Runtime): void | Promise<void>
  stop?(): void | Promise<void>
}

export function defineModule(mod: RouterlyModule): RouterlyModule {
  if (!mod.manifest.id) {
    throw new KernelError('module manifest id must be non-empty', 'INVALID_MANIFEST')
  }
  if (!mod.manifest.version) {
    throw new KernelError('module manifest version must be non-empty', 'INVALID_MANIFEST')
  }
  return mod
}
