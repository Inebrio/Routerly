import type { ModelConfig, ModelInstance, ProviderConnection } from '@routerly/shared';

const CREDENTIAL_FIELDS = [
  'apiKey', 'cfClearance',
  'awsAccessKeyId', 'awsSecretAccessKey', 'awsRegion', 'awsSessionToken',
  'azureResourceName', 'azureDeploymentId', 'azureApiVersion',
  'vertexProjectId', 'vertexLocation', 'vertexServiceAccountKey',
] as const;

/**
 * Test-only (connections-cutover task A3): split legacy `ModelConfig`-shaped
 * fixtures into the `instances`/`connections` pairs that `listEffectiveModels()`
 * now resolves from, so existing tests keep seeding one flat model list while the
 * service reads instances+connections under the hood. One dedicated connection
 * per model, enabled by default.
 */
export function splitModelsIntoInstancesConnections(
  models: ModelConfig[],
): { instances: ModelInstance[]; connections: ProviderConnection[] } {
  const instances: ModelInstance[] = [];
  const connections: ProviderConnection[] = [];

  for (const m of models) {
    const connectionId = `conn-${m.id}`;
    const credentials: Record<string, unknown> = {};
    for (const field of CREDENTIAL_FIELDS) {
      const value = (m as unknown as Record<string, unknown>)[field];
      if (value !== undefined) credentials[field] = value;
    }

    connections.push({
      id: connectionId,
      providerId: m.provider,
      label: m.name ?? m.id,
      credentials,
      enabled: true,
      ...(m.endpoint !== undefined ? { endpoint: m.endpoint } : {}),
    });

    instances.push({
      id: m.id,
      connectionId,
      upstreamModelId: m.upstreamModelId ?? m.id,
      cost: m.cost,
      contextWindow: m.contextWindow ?? 0,
      ...(m.limits !== undefined ? { limits: m.limits } : {}),
      ...(m.capabilities !== undefined ? { capabilities: m.capabilities } : {}),
      ...(m.fieldOverrides !== undefined ? { fieldOverrides: m.fieldOverrides } : {}),
      ...(m.catalogDefaults !== undefined ? { catalogDefaults: m.catalogDefaults } : {}),
    });
  }

  return { instances, connections };
}

/** Disable a connection by model id (round-trips through splitModelsIntoInstancesConnections). */
export function disableConnectionFor(
  connections: ProviderConnection[],
  modelId: string,
): ProviderConnection[] {
  return connections.map((c) => (c.id === `conn-${modelId}` ? { ...c, enabled: false } : c));
}
