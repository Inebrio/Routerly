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

function redactConnection(connection: ProviderConnection): Omit<ProviderConnection, 'credentials'> & { credentials: undefined } {
  return { ...connection, credentials: undefined };
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

// ── Zod schemas ────────────────────────────────────────────────────────────────

const connectionSchema = z.object({
  providerId: z.string().refine(isKnownProvider, { message: 'Unknown providerId' }),
  label: z.string(),
  credentials: z.record(z.string(), z.unknown()),
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
    const connection = { id: uuidv4(), ...parsed.data } as ProviderConnection;
    connection.credentials = encryptConnectionCredentials(connection.providerId, connection.credentials);
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

    const patchData = { ...parsed.data };
    if (patchData.credentials) {
      patchData.credentials = encryptConnectionCredentials(effectiveProviderId, patchData.credentials);
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
