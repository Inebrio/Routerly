import { describe, it, expect, vi, afterEach } from 'vitest'
import { ALL_MODULES } from '../modules/index.js'
import { filterEnabledModules } from '../core/modules/registry.js'

// bootstrap() reads the 'modules' config key to gate the static module list —
// mock the same seam server.test.ts uses so bootstrap() runs for real against
// a controlled disabled-module record.
vi.mock('../modules/config/loader.js', () => ({
  initConfigDirs: vi.fn(),
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
  pruneOrphanUsage: vi.fn(async () => 0),
  appendUsageRecord: vi.fn(),
}))

// bootstrap() also runs the one-shot models->connections migration; mock it
// so the real implementation (which calls the real loader) never runs.
vi.mock('../modules/config/migrate-connections.js', () => ({
  migrateModelsToConnections: vi.fn().mockResolvedValue({ connections: 0, instances: 0 }),
}))

import { bootstrap } from './index.js'
import { readConfig } from '../modules/config/loader.js'
import { migrateModelsToConnections } from '../modules/config/migrate-connections.js'

const mockReadConfig = vi.mocked(readConfig)
const mockMigrate = vi.mocked(migrateModelsToConnections)

afterEach(() => vi.clearAllMocks())

describe('bootstrap gating', () => {
  it('exposes the full static module list including infra + core', () => {
    const ids = ALL_MODULES.map((m) => m.manifest.id)
    expect(ids).toContain('config')
    expect(ids).toContain('reverse-proxy')
    expect(ids).toContain('guardrails')
    expect(ids).toContain('cache')
    expect(ids).toContain('provider-oauth')
    expect(ids).toContain('provider-web')
  })

  it('a disabled feature module is filtered out of the kernel list', () => {
    const kept = filterEnabledModules([{ id: 'guardrails', enabled: false }], ALL_MODULES).map(
      (m) => m.manifest.id,
    )
    expect(kept).not.toContain('guardrails')
    expect(kept).toContain('reverse-proxy')
  })

  it('an always-on module cannot be filtered out', () => {
    const kept = filterEnabledModules([{ id: 'config', enabled: false }], ALL_MODULES).map(
      (m) => m.manifest.id,
    )
    expect(kept).toContain('config')
  })

  // End-to-end: the plan's core guarantee is that a disabled module is never
  // registered in the DI container, not merely filtered from a list. Runs the
  // real bootstrap() (real filterEnabledModules + real buildKernel + real
  // ALL_MODULES, only readConfig('modules') mocked) and inspects the actually
  // started kernel's startedOrder — the module's real register()/start() run
  // for every other module, so this also proves the disabled module leaves no
  // dangling MissingDependencyError (nothing in ALL_MODULES depends on
  // guardrails per its manifest.dependsOn).
  it('bootstrap() never registers a disabled module in the started kernel', async () => {
    mockReadConfig.mockImplementation(async (key: string) =>
      (key === 'modules' ? [{ id: 'guardrails', enabled: false }] : []) as any,
    )

    const kernel = await bootstrap()
    try {
      expect(kernel.startedOrder).not.toContain('guardrails')
      expect(kernel.startedOrder).toContain('reverse-proxy')
      expect(kernel.startedOrder).toContain('routing')
    } finally {
      await kernel.stop()
    }
  })

  // Regression for a real production bug: routingModule.register() resolves
  // RESILIENCE_STORE via container.tryResolve() to wire the resilience pre-filter.
  // That only works if resilience has actually registered first. Nothing but an
  // explicit dependsOn edge guarantees that (array order in coreModules is not
  // topologicalSort's tie-break rule the way it looks). Asserts the real,
  // fully-wired kernel's startedOrder — not a hand-built container — so this
  // fails the same way production did if the edge is ever removed.
  it('registers resilience before routing so the resilience pre-filter store is resolvable', async () => {
    mockReadConfig.mockImplementation(async () => [] as any)

    const kernel = await bootstrap()
    try {
      const order = kernel.startedOrder
      expect(order.indexOf('resilience')).toBeGreaterThanOrEqual(0)
      expect(order.indexOf('routing')).toBeGreaterThanOrEqual(0)
      expect(order.indexOf('resilience')).toBeLessThan(order.indexOf('routing'))
    } finally {
      await kernel.stop()
    }
  })

  it('bootstrap() runs the models->connections migration exactly once', async () => {
    mockReadConfig.mockImplementation(async () => [] as any)

    const kernel = await bootstrap()
    try {
      expect(mockMigrate).toHaveBeenCalledTimes(1)
    } finally {
      await kernel.stop()
    }
  })
})
