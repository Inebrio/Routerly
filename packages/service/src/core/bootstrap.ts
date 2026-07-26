import { Kernel } from './kernel.js'
import type { RouterlyModule } from './module.js'

/**
 * Assemble a Kernel from the given modules and return it already started.
 * This is the single seam server.ts uses to boot the modular kernel alongside
 * Fastify. Kept intentionally tiny: module composition lives at the call site.
 */
export async function buildKernel(
  modules: readonly RouterlyModule[],
): Promise<Kernel> {
  const kernel = new Kernel(modules)
  await kernel.start()
  return kernel
}
