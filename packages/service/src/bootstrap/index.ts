import { buildKernel } from '../core/lifecycle/bootstrap.js';
import { ALL_MODULES } from '../modules/index.js';
import { filterEnabledModules } from '../core/modules/registry.js';
import { readConfig } from '../modules/config/loader.js';
import { migrateModelsToConnections } from '../modules/config/migrate-connections.js';
import type { Kernel } from '../core/index.js';

/**
 * Assembles and starts the modular kernel. The static module set lives in
 * modules/index.ts (ALL_MODULES); here we read the persisted module records
 * and drop any explicitly-disabled feature module before building the kernel,
 * so a disabled module is never registered in the container (feature absent,
 * not stubbed). Always-on infra modules cannot be filtered out.
 *
 * Also runs the one-shot models.json → connections/instances migration,
 * best-effort: initConfigDirs()/loadSecret() already ran in startServer()
 * before buildServer() calls bootstrap(), so config dirs are guaranteed to
 * exist here. A migration failure must never block startup.
 */
export async function bootstrap(): Promise<Kernel> {
  await migrateModelsToConnections().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[bootstrap] models.json -> connections/instances migration failed:', err);
  });
  const records = await readConfig('modules');
  return buildKernel(filterEnabledModules(records, ALL_MODULES));
}
