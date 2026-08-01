import { configModule } from './config/index.js'
import { providerModule } from './provider/index.js'
import { catalogModule } from './catalog/index.js'
import { reverseProxyModule } from './reverse-proxy/index.js'
import { apiModule } from './api/index.js'
import { routingModule } from './routing/index.js'
import { budgetModule } from './budget/index.js'
import { usageModule } from './usage/index.js'
import { guardrailsModule } from './guardrails/index.js'
import { piiModule } from './pii/index.js'
import { loggingModule } from './logging/index.js'
import { cacheModule } from './cache.js'
import { resilienceModule } from './resilience/index.js'
import { optimizerModules } from './optimizers/index.js'
import { clientConfiguratorModule } from './clients/module.js'
import { mcpModule } from './mcp/index.js'
import { experimentsModule } from './experiments/index.js'
import { CONTRIB_MODULES } from '../core/contrib.js'
import { defineModule, type RouterlyModule } from '../core/index.js'

// Ordering here is cosmetic only — the kernel topologically sorts by each module's
// manifest.dependsOn, not array position. resilienceModule declares dependsOn: { api }
// so it always registers after apiModule regardless of where apiModule sits in this array.
export const coreModules = [
  apiModule,
  routingModule,
  budgetModule,
  usageModule,
  guardrailsModule,
  piiModule,
  loggingModule,
  cacheModule,
  resilienceModule,
  mcpModule,
  experimentsModule,
]

// ponytail: provider-oauth/provider-web are pure feature-gate slots (no register()
// lifecycle of their own — see anthropic-oauth.ts/openai-oauth.ts/anthropic-web.ts/
// openai-web.ts, which check isModuleEnabled directly). Declaring them here is what
// makes the existing generic /api/modules + dashboard Modules page + CLI `modules`
// command list and toggle them — no bespoke UI needed for this capability gate.
export const providerOAuthModule: RouterlyModule = defineModule({
  manifest: { id: 'provider-oauth', version: '0.4.0', dependsOn: { provider: '^0.4.0' } },
  register() {
    // intentionally empty
  },
})

export const providerWebModule: RouterlyModule = defineModule({
  manifest: { id: 'provider-web', version: '0.4.0', dependsOn: { provider: '^0.4.0' } },
  register() {
    // intentionally empty
  },
})

/**
 * The full static module set the kernel can run. bootstrap() gates this list
 * through filterEnabledModules; the API's module endpoints list its manifests.
 * Order matches the historical bootstrap array; the kernel topologically sorts
 * anyway, so ordering here is only for stable listing.
 */
export const ALL_MODULES: RouterlyModule[] = [
  configModule,
  providerModule,
  catalogModule,
  reverseProxyModule,
  providerOAuthModule,
  providerWebModule,
  ...coreModules,
  ...optimizerModules,
  // Client configurator (Plan: client-configurator)
  clientConfiguratorModule,
  ...CONTRIB_MODULES,
]
