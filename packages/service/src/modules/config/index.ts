import { defineModule } from '../../core/index.js'
import { CONFIG_STORE } from '../../core/tokens.js'
import { readConfig, writeConfig, appendUsageRecord } from './loader.js'

/**
 * Config module: owns the real config store implementation (loader.ts,
 * migrate.ts) and exposes readConfig/writeConfig/appendUsageRecord behind
 * the CONFIG_STORE DI token. Other files still import loader.ts functions
 * directly by path; this module additionally makes them reachable through
 * the container.
 */
export const configModule = defineModule({
  manifest: { id: 'config', version: '0.4.0' },
  register({ container }) {
    container.register(CONFIG_STORE, { readConfig, writeConfig, appendUsageRecord })
  },
})
