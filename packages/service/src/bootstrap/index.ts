import { buildKernel } from '../core/lifecycle/bootstrap.js';
import { configModule } from '../modules/config/index.js';
import { providerModule } from '../modules/provider/index.js';
import { catalogModule } from '../modules/catalog/index.js';
import { reverseProxyModule } from '../modules/reverse-proxy/index.js';
import { coreModules } from '../modules/index.js';
import { CONTRIB_MODULES } from '../core/contrib.js';
import type { Kernel } from '../core/index.js';

/**
 * Assembles and starts the modular kernel with every module server.ts needs.
 * Kept separate from server.ts so the module-array assembly is the single
 * seam Fastify wiring doesn't need to know about.
 */
export async function bootstrap(): Promise<Kernel> {
  return buildKernel([
    configModule,       // Plan 2
    providerModule,     // Plan 3  (manifest id 'provider')
    catalogModule,      // Step 5 (manifest id 'catalog')
    reverseProxyModule, // Plan 4  (owns PROXY_PIPELINE, transport-only, dark)
    ...coreModules,     // Plan 5  (concern processors)
    ...CONTRIB_MODULES, // Plan 6  (inert extension point, empty this phase)
  ]);
}
