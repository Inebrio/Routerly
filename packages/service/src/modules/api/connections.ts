import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type { ProviderConnection, ModelInstance, Permission } from '@routerly/shared';
import { readConfig, writeConfig } from '../config/loader.js';
import { logAudit } from '../audit/logger.js';
import type { AuditEntry } from '../audit/logger.js';
import { isKnownProvider, providerDescriptorRegistry, getProviderDescriptor } from '../provider/descriptor.js';
import { isModuleEnabled } from '../../core/modules/registry.js';
import { encryptCredential } from '../../lib/crypto-cred.js';

// ── Route-local auth helpers (mirrors api.ts; no shared route-helper module exists) ──

function audit(req: FastifyRequest, action: string, result: AuditEntry['result'], details?: Record<string, unknown>): void {
  void logAudit({
    userId: req.dashUser?.id ?? 'unknown',
    email: req.dashUser?.email ?? 'unknown',
    endpoint: `${req.method} ${req.url}`,
    action,
    result,
    ...(details !== undefined ? { details } : {}),
  });
}

function requirePerm(req: FastifyRequest, perm: Permission, reply: FastifyReply): boolean {
  if (!req.dashUser?.permissions.includes(perm)) {
    reply.status(403).send({ error: 'Forbidden', message: `Required permission: ${perm}` });
    audit(req, perm, 'forbidden');
    return false;
  }
  return true;
}

// Non-secret cloud credential fields safe to return (identifiers/region/resource names,
// never secrets or ciphertext). Mirrors the cloud subset of MODEL_SAFE_FIELDS in api.ts so
// the connection edit form can prefill them exactly like the model detail form does.
const SAFE_CRED_FIELDS = [
  'awsAccessKeyId', 'awsRegion', 'azureResourceName', 'azureDeploymentId', 'azureApiVersion',
  'vertexProjectId', 'vertexLocation',
] as const;

function redactConnection(connection: ProviderConnection): Omit<ProviderConnection, 'credentials'> & { credentials?: Record<string, unknown> } {
  const safe: Record<string, unknown> = {};
  for (const f of SAFE_CRED_FIELDS) {
    const v = connection.credentials?.[f];
    if (v !== undefined) safe[f] = v;
  }
  // With exactOptionalPropertyTypes an optional prop is cleared by dropping the
  // key, not by assigning undefined. Same JSON either way.
  const { credentials: _secret, ...rest } = connection;
  return Object.keys(safe).length > 0 ? { ...rest, credentials: safe } : rest;
}

/**
 * Gates connection create/update on the oauth/web module records. Only oauth and web
 * support-level providers require a module check; api-key/local/native providers are
 * always-on and skip the extra config read.
 */
async function checkProviderModuleGate(providerId: string, reply: FastifyReply): Promise<boolean> {
  const supportLevel = getProviderDescriptor(providerId)?.supportLevel;
  if (supportLevel !== 'oauth' && supportLevel !== 'web') return true;

  const moduleId = supportLevel === 'oauth' ? 'provider-oauth' : 'provider-web';
  const records = await readConfig('modules');
  if (isModuleEnabled(records, moduleId)) return true;

  reply.status(403).send({
    error: 'module_disabled',
    message: `Provider connections requiring the '${supportLevel}' module cannot be created or updated while '${moduleId}' is disabled.`,
  });
  return false;
}

/**
 * Encrypts plaintext oauth/web credential fields before persistence, per provider
 * supportLevel. `native`/`compatible` providers (e.g. plaintext `apiKey`) pass through
 * untouched — that plaintext-at-rest behavior is intentional (see Task 13 self-review).
 *
 * - oauth: `oauthPlain` -> `oauthEnc` (required to populate), `refreshPlain` -> `refreshEnc`
 *   (optional). `expiresAt` and any other field pass through untouched.
 * - web: `cookiePlain` -> `cookieEnc`, `cfClearancePlain` -> `cfClearanceEnc` (optional).
 *
 * Only fields actually present in `credentials` are transformed — safe to call on a
 * partial PATCH body.
 */
export function encryptConnectionCredentials(
  providerId: string,
  credentials: Record<string, unknown>,
): Record<string, unknown> {
  const supportLevel = getProviderDescriptor(providerId)?.supportLevel;
  if (supportLevel !== 'oauth' && supportLevel !== 'web') return credentials;

  const result: Record<string, unknown> = { ...credentials };
  const plainToEnc: Array<[string, string]> = supportLevel === 'oauth'
    ? [['oauthPlain', 'oauthEnc'], ['refreshPlain', 'refreshEnc']]
    : [['cookiePlain', 'cookieEnc'], ['cfClearancePlain', 'cfClearanceEnc']];

  for (const [plainKey, encKey] of plainToEnc) {
    const plain = result[plainKey];
    if (typeof plain === 'string') {
      result[encKey] = encryptCredential(plain);
      delete result[plainKey];
    }
  }
  return result;
}

/** Cloud-provider credential fields — stored plaintext at rest (intentional): they pass through
 *  `encryptConnectionCredentials` untouched. Secret ones are still redacted in model responses. */
export const CLOUD_CREDENTIAL_FIELDS = [
  'azureResourceName', 'azureDeploymentId', 'azureApiVersion',
  'awsRegion', 'awsAccessKeyId', 'awsSecretAccessKey', 'awsSessionToken',
  'vertexProjectId', 'vertexLocation', 'vertexServiceAccountKey',
] as const;

/** The single flat, provider-aware credential input shape shared by the model and connection
 *  API paths. `apiKey`/`cfClearance` are the model-form convenience inputs; the oauth/web plain
 *  fields are the connection-path convention inputs; the cloud fields pass straight through. */
export interface ConnectionCredentialFields {
  apiKey?: string | undefined;
  cfClearance?: string | undefined;
  oauthPlain?: string | undefined;
  refreshPlain?: string | undefined;
  expiresAt?: number | undefined;
  cookiePlain?: string | undefined;
  cfClearancePlain?: string | undefined;
  azureResourceName?: string | undefined;
  azureDeploymentId?: string | undefined;
  azureApiVersion?: string | undefined;
  awsRegion?: string | undefined;
  awsAccessKeyId?: string | undefined;
  awsSecretAccessKey?: string | undefined;
  awsSessionToken?: string | undefined;
  vertexProjectId?: string | undefined;
  vertexLocation?: string | undefined;
  vertexServiceAccountKey?: string | undefined;
}

/**
 * Single source of truth for turning the flat credential input into the stored credential
 * record, for BOTH the model API path and the connection API path.
 *
 * - Maps the model-form `apiKey`/`cfClearance` onto the provider's convention field names by
 *   supportLevel: web → cookiePlain/cfClearancePlain; oauth → oauthPlain; native/compatible →
 *   apiKey/cfClearance (plaintext, intentional).
 * - Forwards the oauth/web convention fields (oauthPlain/refreshPlain/expiresAt, cookiePlain/
 *   cfClearancePlain) supplied directly by the connection path.
 * - Copies every present, non-empty cloud field straight through under its own key (blank/absent
 *   fields are dropped so a partial update never clobbers a stored value with empty).
 *
 * `encryptConnectionCredentials` then encrypts the oauth/web plain fields; everything else
 * (apiKey, cloud fields) passes through untouched → stored as-is.
 */
export function buildConnectionCredentials(
  provider: string,
  fields: ConnectionCredentialFields,
): Record<string, unknown> {
  const supportLevel = getProviderDescriptor(provider)?.supportLevel;
  const plain: Record<string, unknown> = {};
  if (supportLevel === 'web') {
    if (fields.apiKey) plain.cookiePlain = fields.apiKey;
    if (fields.cfClearance) plain.cfClearancePlain = fields.cfClearance;
    if (fields.cookiePlain) plain.cookiePlain = fields.cookiePlain;
    if (fields.cfClearancePlain) plain.cfClearancePlain = fields.cfClearancePlain;
  } else if (supportLevel === 'oauth') {
    if (fields.apiKey) plain.oauthPlain = fields.apiKey;
    if (fields.oauthPlain) plain.oauthPlain = fields.oauthPlain;
    if (fields.refreshPlain) plain.refreshPlain = fields.refreshPlain;
    if (typeof fields.expiresAt === 'number') plain.expiresAt = fields.expiresAt;
  } else {
    if (fields.apiKey) plain.apiKey = fields.apiKey;
    if (fields.cfClearance) plain.cfClearance = fields.cfClearance;
  }
  for (const key of CLOUD_CREDENTIAL_FIELDS) {
    const value = fields[key];
    if (typeof value === 'string' && value !== '') plain[key] = value;
  }
  return encryptConnectionCredentials(provider, plain);
}

// ── Zod schemas ────────────────────────────────────────────────────────────────

/** Flat, provider-aware credential fields accepted by the connection API path. Unknown keys are
 *  stripped; empty values are dropped downstream by `buildConnectionCredentials`. */
const credentialFieldsSchema = z.object({
  apiKey: z.string(),
  cfClearance: z.string(),
  oauthPlain: z.string(),
  refreshPlain: z.string(),
  expiresAt: z.number(),
  cookiePlain: z.string(),
  cfClearancePlain: z.string(),
  azureResourceName: z.string(),
  azureDeploymentId: z.string(),
  azureApiVersion: z.string(),
  awsRegion: z.string(),
  awsAccessKeyId: z.string(),
  awsSecretAccessKey: z.string(),
  awsSessionToken: z.string(),
  vertexProjectId: z.string(),
  vertexLocation: z.string(),
  vertexServiceAccountKey: z.string(),
}).partial();

const connectionSchema = z.object({
  providerId: z.string().refine(isKnownProvider, { message: 'Unknown providerId' }),
  // Names the upstream service behind a custom connection; free text, never dispatched on.
  providerName: z.string().optional(),
  label: z.string(),
  credentials: credentialFieldsSchema,
  endpoint: z.string().optional(),
  enabled: z.boolean(),
});

const connectionPatchSchema = connectionSchema.partial();

const pricingTierSchema = z.object({
  metric: z.string(),
  above: z.number(),
  inputPerMillion: z.number(),
  outputPerMillion: z.number(),
  cachePerMillion: z.number().optional(),
});

const tokenCostSchema = z.object({
  inputPerMillion: z.number(),
  outputPerMillion: z.number(),
  cachePerMillion: z.number().optional(),
  cacheWritePerMillion: z.number().optional(),
  pricingTiers: z.array(pricingTierSchema).optional(),
});

const limitSchema = z.object({
  metric: z.enum(['cost', 'calls', 'input_tokens', 'output_tokens', 'total_tokens']),
  windowType: z.enum(['period', 'rolling']),
  period: z.enum(['hourly', 'daily', 'weekly', 'monthly', 'yearly']).optional(),
  rollingAmount: z.number().optional(),
  rollingUnit: z.enum(['second', 'minute', 'hour', 'day', 'week', 'month']).optional(),
  value: z.number(),
});

const capabilitiesSchema = z.object({
  thinking: z.boolean().optional(),
  vision: z.boolean().optional(),
  functionCalling: z.boolean().optional(),
  json: z.boolean().optional(),
  embedding: z.boolean().optional(),
});

const instanceSchema = z.object({
  connectionId: z.string(),
  upstreamModelId: z.string(),
  cost: tokenCostSchema,
  contextWindow: z.number(),
  limits: z.array(limitSchema).optional(),
  capabilities: capabilitiesSchema.optional(),
});

const instancePatchSchema = instanceSchema.partial();

export const connectionsRoutes: FastifyPluginAsync = async (fastify) => {
  // ══════════════════════════════════════════════════════════════════════════
  // PROVIDER DESCRIPTORS
  // ══════════════════════════════════════════════════════════════════════════

  fastify.get('/api/providers/descriptors', async (req, reply) => {
    if (!requirePerm(req, 'connections:read', reply)) return;
    return reply.send(providerDescriptorRegistry.ordered());
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CONNECTIONS
  // ══════════════════════════════════════════════════════════════════════════

  fastify.get('/api/connections', async (req, reply) => {
    if (!requirePerm(req, 'connections:read', reply)) return;
    const connections = await readConfig('connections');
    return reply.send(connections.map(redactConnection));
  });

  fastify.post<{ Body: unknown }>('/api/connections', async (req, reply) => {
    if (!requirePerm(req, 'connections:manage', reply)) return;
    const parsed = connectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    if (!(await checkProviderModuleGate(parsed.data.providerId, reply))) return;

    const connections = await readConfig('connections');
    const connection = {
      id: uuidv4(),
      ...parsed.data,
      credentials: buildConnectionCredentials(parsed.data.providerId, parsed.data.credentials ?? {}),
    } as ProviderConnection;
    connections.push(connection);
    await writeConfig('connections', connections);
    audit(req, 'connection:create', 'success', { id: connection.id });
    return reply.send(redactConnection(connection));
  });

  fastify.patch<{ Params: { id: string }; Body: unknown }>('/api/connections/:id', async (req, reply) => {
    if (!requirePerm(req, 'connections:manage', reply)) return;
    const parsed = connectionPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const connections = await readConfig('connections');
    const index = connections.findIndex(c => c.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Not found' });

    const effectiveProviderId = parsed.data.providerId ?? connections[index]!.providerId;
    if (!(await checkProviderModuleGate(effectiveProviderId, reply))) return;

    const patchData = { ...parsed.data } as Partial<ProviderConnection>;
    if (parsed.data.credentials) {
      // Partial-preserving: merge only the mapped, non-empty fields onto the stored credentials so
      // patching one field never clobbers the others. Absent `credentials` leaves the record intact.
      patchData.credentials = {
        ...connections[index]!.credentials,
        ...buildConnectionCredentials(effectiveProviderId, parsed.data.credentials),
      };
    }
    const updated = { ...connections[index]!, ...patchData } as ProviderConnection;
    connections[index] = updated;
    await writeConfig('connections', connections);
    audit(req, 'connection:update', 'success', { id: req.params.id });
    return reply.send(redactConnection(updated));
  });

  fastify.delete<{ Params: { id: string } }>('/api/connections/:id', async (req, reply) => {
    if (!requirePerm(req, 'connections:manage', reply)) return;
    const connections = await readConfig('connections');
    const filtered = connections.filter(c => c.id !== req.params.id);
    if (filtered.length === connections.length) return reply.status(404).send({ error: 'Not found' });
    await writeConfig('connections', filtered);
    audit(req, 'connection:delete', 'success', { id: req.params.id });
    return reply.status(204).send();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // INSTANCES
  // ══════════════════════════════════════════════════════════════════════════

  fastify.get('/api/instances', async (req, reply) => {
    if (!requirePerm(req, 'connections:read', reply)) return;
    const instances = await readConfig('instances');
    return reply.send(instances);
  });

  fastify.post<{ Body: unknown }>('/api/instances', async (req, reply) => {
    if (!requirePerm(req, 'connections:manage', reply)) return;
    const parsed = instanceSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const instances = await readConfig('instances');
    const instance = { id: uuidv4(), ...parsed.data } as ModelInstance;
    instances.push(instance);
    await writeConfig('instances', instances);
    audit(req, 'instance:create', 'success', { id: instance.id });
    return reply.send(instance);
  });

  fastify.patch<{ Params: { id: string }; Body: unknown }>('/api/instances/:id', async (req, reply) => {
    if (!requirePerm(req, 'connections:manage', reply)) return;
    const parsed = instancePatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const instances = await readConfig('instances');
    const index = instances.findIndex(i => i.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Not found' });

    const updated = { ...instances[index]!, ...parsed.data } as ModelInstance;
    instances[index] = updated;
    await writeConfig('instances', instances);
    audit(req, 'instance:update', 'success', { id: req.params.id });
    return reply.send(updated);
  });

  fastify.delete<{ Params: { id: string } }>('/api/instances/:id', async (req, reply) => {
    if (!requirePerm(req, 'connections:manage', reply)) return;
    const instances = await readConfig('instances');
    const filtered = instances.filter(i => i.id !== req.params.id);
    if (filtered.length === instances.length) return reply.status(404).send({ error: 'Not found' });
    await writeConfig('instances', filtered);
    audit(req, 'instance:delete', 'success', { id: req.params.id });
    return reply.status(204).send();
  });
};
