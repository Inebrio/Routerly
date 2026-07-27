import { routingModule } from './routing/index.js'
import { budgetModule } from './budget/index.js'
import { usageModule } from './usage/index.js'
import { guardrailsModule } from './guardrails/index.js'
import { piiModule } from './pii/index.js'
import { loggingModule } from './logging/index.js'
import { cacheModule } from './cache.js'

export const coreModules = [
  routingModule,
  budgetModule,
  usageModule,
  guardrailsModule,
  piiModule,
  loggingModule,
  cacheModule,
]
