import { optimizerCoreModule } from './core.js'
import { sessionDedupModule } from './session-dedup/index.js'
import { ccrModule } from './ccr/index.js'
import { rtkModule } from './rtk/index.js'
import { headroomModule } from './headroom/index.js'
import { relevanceModule } from './relevance/index.js'
import { cavemanModule } from './caveman/index.js'
import type { RouterlyModule } from '../../core/index.js'

/**
 * Optimizer subsystem module set. optimizer-core creates the registry, binds the
 * DI token, and contributes the request.preprocess processor. Individual
 * optimizer submodules (built in later tasks) are appended here and self-register
 * into OPTIMIZER_REGISTRY on their own register().
 */
export const optimizerModules: RouterlyModule[] = [
  optimizerCoreModule,
  sessionDedupModule,
  ccrModule,
  rtkModule,
  headroomModule,
  relevanceModule,
  cavemanModule,
]
