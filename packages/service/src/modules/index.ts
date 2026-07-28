import { configModule } from './config/index.js'
import { providerModule } from './provider/index.js'
import { catalogModule } from './catalog/index.js'
import { reverseProxyModule } from './reverse-proxy/index.js'
import { routingModule } from './routing/index.js'
import { budgetModule } from './budget/index.js'
import { usageModule } from './usage/index.js'
import { guardrailsModule } from './guardrails/index.js'
import { piiModule } from './pii/index.js'
import { loggingModule } from './logging/index.js'
import { cacheModule } from './cache.js'
import { CONTRIB_MODULES } from '../core/contrib.js'
import type { RouterlyModule } from '../core/index.js'

export const coreModules = [
  routingModule,
  budgetModule,
  usageModule,
  guardrailsModule,
  piiModule,
  loggingModule,
  cacheModule,
]

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
  ...coreModules,
  ...CONTRIB_MODULES,
]
