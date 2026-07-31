/**
 * One-shot migration: legacy per-model `ModelConfig` (models.json) → the new
 * `ProviderConnection` + `ModelInstance` shapes (connections.json / instances.json).
 *
 * A ProviderConnection is derived from a model's credential fields + endpoint +
 * provider, deduplicated by a deterministic fingerprint so multiple models that
 * share the same credentials collapse into one connection. Every legacy model
 * always produces exactly one ModelInstance (id = legacy model id).
 *
 * Idempotent and additive: never deletes models.json, never overwrites an
 * existing connection/instance, only appends records that don't already exist.
 * Runs once per startup (see bootstrap/index.ts).
 */
import { createHash } from 'node:crypto';
import type { ModelConfig, ProviderConnection, ModelInstance } from '@routerly/shared';
import { readConfig, writeConfig } from './loader.js';

/** Credential fields on ModelConfig, in the fixed order used by the fingerprint hash. */
const CREDENTIAL_FIELDS = [
  'apiKey',
  'cfClearance',
  'awsAccessKeyId',
  'awsSecretAccessKey',
  'awsRegion',
  'awsSessionToken',
  'azureResourceName',
  'azureDeploymentId',
  'azureApiVersion',
  'vertexProjectId',
  'vertexLocation',
  'vertexServiceAccountKey',
] as const;

function connectionId(model: ModelConfig): string {
  const parts = [model.provider, model.endpoint, ...CREDENTIAL_FIELDS.map((f) => model[f] ?? '')];
  const hash = createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  return `${model.provider}-${hash.slice(0, 16)}`;
}

function buildCredentials(model: ModelConfig): Record<string, unknown> {
  const credentials: Record<string, unknown> = {};
  for (const field of CREDENTIAL_FIELDS) {
    if (model[field] !== undefined) credentials[field] = model[field];
  }
  return credentials;
}

function buildInstance(model: ModelConfig, connId: string): ModelInstance {
  const instance: ModelInstance = {
    id: model.id,
    connectionId: connId,
    upstreamModelId: model.upstreamModelId ?? model.id,
    cost: model.cost,
    // ponytail: no catalog lookup here, 0 means "unknown until user edits" — acceptable since this is a one-shot migration of pre-existing data, not new-model creation
    contextWindow: model.contextWindow ?? 0,
  };
  if (model.limits !== undefined) instance.limits = model.limits;
  if (model.capabilities !== undefined) instance.capabilities = model.capabilities;
  return instance;
}

export async function migrateModelsToConnections(): Promise<{ connections: number; instances: number }> {
  const [models, existingConnections, existingInstances] = await Promise.all([
    readConfig('models'),
    readConfig('connections'),
    readConfig('instances'),
  ]);

  const connectionIds = new Set(existingConnections.map((c) => c.id));
  const instanceIds = new Set(existingInstances.map((i) => i.id));

  const newConnections: ProviderConnection[] = [];
  const newInstances: ModelInstance[] = [];
  const seenNewConnectionIds = new Set<string>();

  for (const model of models) {
    const connId = connectionId(model);

    if (!connectionIds.has(connId) && !seenNewConnectionIds.has(connId)) {
      seenNewConnectionIds.add(connId);
      const conn: ProviderConnection = {
        id: connId,
        providerId: model.provider,
        label: `${model.provider} (migrated)`,
        credentials: buildCredentials(model),
        enabled: true,
      };
      if (model.endpoint !== undefined) conn.endpoint = model.endpoint;
      newConnections.push(conn);
    }

    if (!instanceIds.has(model.id)) {
      instanceIds.add(model.id);
      newInstances.push(buildInstance(model, connId));
    }
  }

  if (newConnections.length > 0) {
    await writeConfig('connections', [...existingConnections, ...newConnections]);
  }
  if (newInstances.length > 0) {
    await writeConfig('instances', [...existingInstances, ...newInstances]);
  }

  return { connections: newConnections.length, instances: newInstances.length };
}
