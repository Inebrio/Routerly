import { defineModule } from '../../core/index.js';
import { PROVIDER_REGISTRY } from '../../core/tokens.js';
import { getProviderAdapter } from '../../providers/index.js';

/**
 * Provider module: exposes the existing, already-tested providers/index.ts
 * getProviderAdapter function behind the PROVIDER_REGISTRY DI token.
 * No logic is copied: the token value is literally the real function
 * reference. This module only makes the same function reachable through
 * the container for later plans.
 */
export const providerModule = defineModule({
  manifest: { id: 'provider', version: '0.4.0', dependsOn: { config: '^0.4.0' } },
  register({ container }) {
    container.register(PROVIDER_REGISTRY, { getProviderAdapter });
  },
});
