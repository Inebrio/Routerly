import { routingModule } from './routing.js'
import { budgetModule } from './budget.js'
import { usageModule } from './usage.js'
import { guardrailsModule } from './guardrails.js'
import { piiModule } from './pii.js'
import { loggingModule } from './logging.js'
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
