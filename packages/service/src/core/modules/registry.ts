import type { ModuleManifest, RouterlyModule } from './index.js'
import type { ModuleRecord } from '@routerly/shared'

/**
 * Every module is core: always active, never disabled. Stored `modules` records
 * are ignored, so a restored/imported config cannot turn a module off.
 */
export function isAlwaysOn(_id: string): boolean {
  return true
}

export function isModuleEnabled(_records: ModuleRecord[], _id: string): boolean {
  return true
}

export function resolveEnabledModules(
  _records: ModuleRecord[],
  all: ModuleManifest[],
): ModuleManifest[] {
  return all
}

export function filterEnabledModules(
  _records: ModuleRecord[],
  modules: readonly RouterlyModule[],
): RouterlyModule[] {
  return [...modules]
}
