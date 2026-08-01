import { defineModule } from '../../core/index.js'
import { CONFIG_STORE } from '../../core/tokens.js'
import { readConfig, writeConfig, appendUsageRecord } from './loader.js'
import { migrateModelsToConnections } from './migrate-connections.js'
import { migrateProjectConfigs, migrateSettings } from './migrate.js'

/**
 * Config module: owns the real config store implementation (loader.ts,
 * migrate.ts) and exposes readConfig/writeConfig/appendUsageRecord behind
 * the CONFIG_STORE DI token. Other files still import loader.ts functions
 * directly by path; this module additionally makes them reachable through
 * the container.
 *
 * It also owns every config-shape migration. Because every other module
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
      console.log(`[startup] migrated ${migrated} project(s) to new guardrails/PII config shape`)
    }
    const dropped = await migrateSettings()
    if (dropped.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[startup] dropped removed setting(s) from settings.json: ${dropped.join(', ')}`)
    }
  },
  register({ container }) {
    container.register(CONFIG_STORE, { readConfig, writeConfig, appendUsageRecord })
  },
})
