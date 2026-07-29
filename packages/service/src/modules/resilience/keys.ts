import type { ModelConfig, ResilienceKey } from '@routerly/shared';

/**
 * Derives the three resilience keys (provider, connection, model) from a ModelConfig.
 * Used by the router pre-filter and executor to look up circuit-breaker, cooldown, and lockout state.
 *
 * @param model The model configuration to derive keys from
 * @returns An object containing provider, connection, and model resilience keys
 */
export function resilienceKeys(
  model: ModelConfig,
): {
  provider: ResilienceKey;
  connection: ResilienceKey;
  model: ResilienceKey;
} {
  return {
    provider: {
      level: 'provider',
      id: model.provider,
    },
    // G1: connection uses model.provider as placeholder until ProviderConnection.id is threaded through resolved-model type
    connection: {
      level: 'connection',
      id: model.provider,
    },
    model: {
      level: 'model',
      id: model.id,
    },
  };
}
