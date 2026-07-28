import type { ModuleManifest, RouterlyModule } from './index.js'
import type { ModuleRecord } from '@routerly/shared'

/**
 * Modules that form the gateway core and cannot be disabled. Without any one
 * of these the proxy cannot serve a request, so the enable/disable layer never
 * exposes them. `routing` is included because the proxy has nothing to route to
 * without it, even though it lives in coreModules.
 */
export const ALWAYS_ON_MODULE_IDS: readonly string[] = [
  'config',
  'provider',
  'catalog',
  'reverse-proxy',
  'routing',
]

export function isAlwaysOn(id: string): boolean {
  return ALWAYS_ON_MODULE_IDS.includes(id)
}

/** A module is enabled unless a record explicitly disables it; always-on wins. */
export function isModuleEnabled(records: ModuleRecord[], id: string): boolean {
  if (isAlwaysOn(id)) return true
  const rec = records.find((r) => r.id === id)
  return rec ? rec.enabled : true
}

export function resolveEnabledModules(
  records: ModuleRecord[],
  all: ModuleManifest[],
): ModuleManifest[] {
  return all.filter((m) => isModuleEnabled(records, m.id))
}

export function filterEnabledModules(
  records: ModuleRecord[],
  modules: readonly RouterlyModule[],
): RouterlyModule[] {
  const enabled = new Set(
    resolveEnabledModules(records, modules.map((m) => m.manifest)).map((m) => m.id),
  )
  return modules.filter((m) => enabled.has(m.manifest.id))
}

export interface GuardResult {
  ok: boolean
  error?: string
}

export function canDisable(
  id: string,
  records: ModuleRecord[],
  all: ModuleManifest[],
): GuardResult {
  if (isAlwaysOn(id)) {
    return { ok: false, error: `Module "${id}" is always-on and cannot be disabled` }
  }
  if (!all.some((m) => m.id === id)) {
    return { ok: false, error: `Unknown module "${id}"` }
  }
  const dependents = all.filter(
    (m) => m.id !== id && m.dependsOn && id in m.dependsOn && isModuleEnabled(records, m.id),
  )
  if (dependents.length) {
    return {
      ok: false,
      error: `Cannot disable "${id}": required by ${dependents.map((d) => d.id).join(', ')}`,
    }
  }
  return { ok: true }
}

export function canEnable(
  id: string,
  records: ModuleRecord[],
  all: ModuleManifest[],
): GuardResult {
  const manifest = all.find((m) => m.id === id)
  if (!manifest) {
    return { ok: false, error: `Unknown module "${id}"` }
  }
  const missing = Object.keys(manifest.dependsOn ?? {}).filter(
    (dep) => !isModuleEnabled(records, dep),
  )
  if (missing.length) {
    return { ok: false, error: `Cannot enable "${id}": depends on disabled ${missing.join(', ')}` }
  }
  return { ok: true }
}

/** Upsert a single module's enabled flag, returning a new records array. */
export function setModuleEnabled(
  records: ModuleRecord[],
  id: string,
  enabled: boolean,
): ModuleRecord[] {
  return [...records.filter((r) => r.id !== id), { id, enabled }]
}
