import type { ServiceContainer } from '../container/index.js'
import type { EventBus } from '../events/index.js'
import { KernelError } from '../errors.js'

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
  /**
   * Brings persisted config owned by this module up to the shape the current
   * version expects. Runs once at startup, before any register(), in
   * topological order, so a module always migrates before its dependents read
   * the data. Must be idempotent and shape-detecting: it is re-run on every
   * boot and must be a no-op once the data is current.
   */
  migrate?(): void | Promise<void>
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
