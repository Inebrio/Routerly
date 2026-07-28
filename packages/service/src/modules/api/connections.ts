import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type { ProviderConnection, ModelInstance, Permission } from '@routerly/shared';
import { readConfig, writeConfig } from '../config/loader.js';
import { logAudit } from '../audit/logger.js';
import type { AuditEntry } from '../audit/logger.js';
import { isKnownProvider, providerDescriptorRegistry } from '../provider/descriptor.js';

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

    const connections = await readConfig('connections');
    const connection = { id: uuidv4(), ...parsed.data } as ProviderConnection;
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

    const updated = { ...connections[index]!, ...parsed.data } as ProviderConnection;
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
