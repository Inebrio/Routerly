import { defineModule } from '../../core/index.js'

// The Fastify route layer (api.ts) is not a DI consumer, so it cannot resolve a
// container token to know whether this module was bootstrapped. Mirrors
// optimizers/registry.ts's setOptimizerRegistry/getOptimizerRegistry: register()
// flips this marker, GET /api/clients reads it back to decide 404 vs. 200.
let enabled = false

export function setClientConfiguratorEnabled(value: boolean): void {
  enabled = value
}

export function isClientConfiguratorEnabled(): boolean {
  return enabled
}

/**
 * Client-configurator module (Plan 5). Publishes no runtime behavior of its
 * own. The CLIENT_REGISTRY metadata (@routerly/shared) is static data, read
 * directly by the GET /api/clients route. register() only flips the enabled
 * marker so that route can 404 when this module isn't bootstrapped.
 */
export const clientConfiguratorModule = defineModule({
  manifest: {
    id: 'client-configurator',
    version: '0.4.0',
    dependsOn: { config: '^0.4.0' },
  },
  register() {
    setClientConfiguratorEnabled(true)
  },
})
