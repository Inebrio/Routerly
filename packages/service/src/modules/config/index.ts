import { defineModule } from '../../core/index.js'
import { CONFIG_STORE } from '../../core/tokens.js'
import { readConfig, writeConfig, appendUsageRecord } from '../../config/loader.js'

/**
 * Config module: the first Routerly module. Its only job is to expose the
 * existing, already-tested config/loader.ts functions behind the CONFIG_STORE
 * DI token. No logic is copied: the token value is literally the real function
 * references. Routes continue to import config/loader.ts directly; this module
 * only makes the same functions reachable through the container for later plans.
 */
export const configModule = defineModule({
  manifest: { id: 'config', version: '0.4.0' },
  register({ container }) {
    container.register(CONFIG_STORE, { readConfig, writeConfig, appendUsageRecord })
  },
})
