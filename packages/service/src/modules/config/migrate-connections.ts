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

/**
 * Credential fields on ModelConfig, in the fixed order used by the fingerprint hash.
 * Deliberately excludes the oauth/web ciphertext fields (see COPY_FIELDS): those are
 * volatile (re-encrypted on every token refresh) and would make the connection id
 * unstable across refreshes.
 */
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

/**
 * Fields copied verbatim into the connection's credentials. Superset of the fingerprint
 * fields plus the oauth/web ciphertext a properly-seeded connection needs at runtime
 * (adapters read these from connection.credentials). Dropping them here silently broke
 * oauth/web/subscription routing on migration.
 */
const COPY_FIELDS = [
  ...CREDENTIAL_FIELDS,
  'oauthEnc',
  'refreshEnc',
  'cookieEnc',
  'cfClearanceEnc',
  'expiresAt',
] as const;

function connectionId(model: ModelConfig): string {
  const parts = [model.provider, model.endpoint, ...CREDENTIAL_FIELDS.map((f) => model[f] ?? '')];
  const hash = createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  return `${model.provider}-${hash.slice(0, 16)}`;
}

function buildCredentials(model: ModelConfig): Record<string, unknown> {
  const credentials: Record<string, unknown> = {};
  // enc fields (oauthEnc/refreshEnc/cookieEnc/cfClearanceEnc/expiresAt) are not typed on
  // ModelConfig; read through a record cast so legacy oauth/web credentials are carried over.
  const record = model as unknown as Record<string, unknown>;
  for (const field of COPY_FIELDS) {
    if (record[field] !== undefined) credentials[field] = record[field];
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
  if (model.fieldOverrides !== undefined) instance.fieldOverrides = model.fieldOverrides;
  if (model.catalogDefaults !== undefined) instance.catalogDefaults = model.catalogDefaults;
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
