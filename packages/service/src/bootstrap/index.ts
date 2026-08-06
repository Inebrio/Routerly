import { buildKernel } from '../core/lifecycle/bootstrap.js';
import { ALL_MODULES } from '../modules/index.js';
import { filterEnabledModules } from '../core/modules/registry.js';
import { readConfig } from '../modules/config/loader.js';
import type { Kernel } from '../core/index.js';

/**
 * Assembles and starts the modular kernel. The static module set lives in
 * modules/index.ts (ALL_MODULES); here we read the persisted module records
 * and drop any explicitly-disabled feature module before building the kernel,
 * so a disabled module is never registered in the container (feature absent,
 * not stubbed). Always-on infra modules cannot be filtered out.
 *
 * Config migrations are not run here: each module declares its own migrate()
 * and the kernel runs them all in dependency order before any register().
 */
export async function bootstrap(): Promise<Kernel> {
  const records = await readConfig('modules');
  return buildKernel(filterEnabledModules(records, ALL_MODULES));
}
