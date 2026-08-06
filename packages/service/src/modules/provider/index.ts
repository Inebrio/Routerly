import { defineModule } from '../../core/index.js';
import { PROVIDER_REGISTRY } from '../../core/tokens.js';
import { getProviderAdapter } from './registry.js';

/**
 * Provider module: owns the real hook-based dispatcher (registry.ts) and
 * exposes its getProviderAdapter behind the PROVIDER_REGISTRY DI token.
 * Other files still import registry.ts directly by path; this module
 * additionally makes it reachable through the container.
 */
export const providerModule = defineModule({
  manifest: { id: 'provider', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container }) {
    container.register(PROVIDER_REGISTRY, { getProviderAdapter });
  },
});
