import { defineModule } from '../../core/index.js'
import { CONFIG_STORE } from '../../core/tokens.js'
import { readConfig, writeConfig, appendUsageRecord } from './loader.js'
import { migrateModelsToConnections } from './migrate-connections.js'
import {
  migrateProjectConfigs,
  migrateSettings,
  migrateRolePermissions,
  migrateUsageRouterId,
  migrateNotificationChannelScope,
  migrateOrchestratorCandidateOrder,
} from './migrate.js'

/**
 * Config module: owns the real config store implementation (loader.ts,
 * migrate.ts) and exposes readConfig/writeConfig/appendUsageRecord behind
 * the CONFIG_STORE DI token. Other files still import loader.ts functions
 * directly by path; this module additionally makes them reachable through
 * the container.
 *
 * It also owns every config-shape migration except migrateRouterStorage
 * (RTR-01's projects.json -> routers.json move), which runs earlier, directly
 * in server.ts's startServer(), outside the kernel's best-effort try/catch —
 * see the comment there for why: that migration must be allowed to actually
 * stop the boot on malformed input (EC3), unlike every migration below, which
 * keeps the kernel's "log and continue" policy. Because every other module
 * declares dependsOn: { config }, the kernel runs this migrate() before any
 * other module registers, which is exactly the ordering the old hand-placed
 * calls in server.ts/bootstrap.ts relied on implicitly.
 */
export const configModule = defineModule({
  manifest: { id: 'config', version: '0.4.0' },
  async migrate() {
    // Independent catch: the two migrations touch different files, so a
    // failure in one must not skip the other (the behaviour before they moved
    // in here, when they were two separate call sites).
    await migrateModelsToConnections().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[startup] models.json -> connections/instances migration failed:', err)
    })
    const migrated = await migrateProjectConfigs()
    if (migrated > 0) {
      // eslint-disable-next-line no-console
      console.log(`[startup] migrated ${migrated} router(s) to new guardrails/PII config shape`)
    }
    const rolesMigrated = await migrateRolePermissions()
    if (rolesMigrated > 0) {
      // eslint-disable-next-line no-console
      console.log(`[startup] migrated ${rolesMigrated} custom role(s) to router:read/router:write permissions`)
    }
    const usageMigrated = await migrateUsageRouterId()
    if (usageMigrated > 0) {
      // eslint-disable-next-line no-console
      console.log(`[startup] migrated ${usageMigrated} usage record(s) from projectId to routerId`)
    }
    const channelsMigrated = await migrateNotificationChannelScope()
    if (channelsMigrated > 0) {
      // eslint-disable-next-line no-console
      console.log(`[startup] migrated ${channelsMigrated} notification channel(s) from projectIds to routerIds`)
    }
    const dropped = await migrateSettings()
    if (dropped.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[startup] dropped removed setting(s) from settings.json: ${dropped.join(', ')}`)
    }
    const orchestratorsMigrated = await migrateOrchestratorCandidateOrder()
    if (orchestratorsMigrated > 0) {
      // eslint-disable-next-line no-console
      console.log(`[startup] migrated ${orchestratorsMigrated} orchestrator(s) candidate order from legacy weight`)
    }
    // migrateUsageToNdjson() deliberately does NOT run here: this migrate()
    // is wrapped by the kernel in a best-effort try/catch that logs and
    // continues startup on failure (kernel.ts), but a corrupted legacy
    // usage.json must fail loudly and stop the boot (EC2). It runs instead
    // as its own step in server.ts's startServer(), outside that catch —
    // same reasoning as migrateRouterStorage (RTR-01, B2).
  },
  register({ container }) {
    container.register(CONFIG_STORE, { readConfig, writeConfig, appendUsageRecord })
  },
})
