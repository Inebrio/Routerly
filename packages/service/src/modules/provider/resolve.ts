import type { ModelInstance, ProviderConnection, EffectiveModel, Provider } from '@routerly/shared';

/**
 * Resolve a ModelInstance + ProviderConnection into an EffectiveModel (ModelConfig-shaped).
 * Maps connection credentials and instance fields to produce a runtime representation
 * ready for adapter consumption.
 */
export function resolveEffectiveModel(
  instance: ModelInstance,
  connection: ProviderConnection,
): EffectiveModel {
  const result: EffectiveModel = {
    id: instance.id,
    name: instance.upstreamModelId,
    provider: connection.providerId as Provider,
    endpoint: connection.endpoint ?? '',
    // ponytail: endpoint defaults to empty string when undefined; per-provider descriptor defaults are a follow-up
    ...((connection.credentials as Partial<EffectiveModel>) || {}),
    upstreamModelId: instance.upstreamModelId,
    cost: instance.cost,
    contextWindow: instance.contextWindow,
  };

  if (instance.limits !== undefined) {
    result.limits = instance.limits;
  }

  if (instance.capabilities !== undefined) {
    result.capabilities = instance.capabilities;
  }

  return result;
}
