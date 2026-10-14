import type { ModelInstance, ProviderConnection, EffectiveModel, Provider } from '@routerly/shared';

/** Registry id "openai/gpt-4o" → upstream name "gpt-4o". Ids without a slash are returned as-is. */
export function defaultUpstreamModelId(id: string): string {
  const i = id.indexOf('/');
  return i < 0 ? id : id.slice(i + 1);
}

/**
 * Resolve a ModelInstance + ProviderConnection into an EffectiveModel (ModelConfig-shaped).
 * Maps connection credentials and instance fields to produce a runtime representation
 * ready for adapter consumption.
 */
export function resolveEffectiveModel(
  instance: ModelInstance,
  connection: ProviderConnection,
): EffectiveModel {
  // upstreamModelId equal to the full registry id is the pre-ROUT-283 default (ROUT-275 regression):
  // never a real provider model name, so normalise it on read for already-stored configs.
  const upstreamModelId =
    instance.upstreamModelId === instance.id ? defaultUpstreamModelId(instance.id) : instance.upstreamModelId;
  const result: EffectiveModel = {
    id: instance.id,
    name: upstreamModelId,
    provider: connection.providerId as Provider,
    connectionId: connection.id,
    endpoint: connection.endpoint,
    ...((connection.credentials as Partial<EffectiveModel>) || {}),
    upstreamModelId,
    cost: instance.cost,
    contextWindow: instance.contextWindow,
  };

  if (instance.timeout !== undefined) {
    result.timeout = instance.timeout;
  }

  if (instance.limits !== undefined) {
    result.limits = instance.limits;
  }

  if (instance.capabilities !== undefined) {
    result.capabilities = instance.capabilities;
  }

  if (instance.fieldOverrides !== undefined) {
    result.fieldOverrides = instance.fieldOverrides;
  }

  if (instance.catalogDefaults !== undefined) {
    result.catalogDefaults = instance.catalogDefaults;
  }

  return result;
}
