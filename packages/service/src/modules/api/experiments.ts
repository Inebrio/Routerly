import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ExperimentConfig, ExperimentVariant, Permission, ProjectToken } from '@routerly/shared';
import { EXPERIMENT_ROTATIONS, STICKY_KEYS } from '@routerly/shared';
import { readConfig, writeConfig } from '../config/loader.js';
import { logAudit } from '../audit/logger.js';
import type { AuditEntry } from '../audit/logger.js';
import { isModuleEnabled } from '../../core/modules/registry.js';
import { computeExperimentMetrics } from '../experiments/metrics.js';

// ── Route-local auth helpers (mirrors api.ts/profiles.ts; no shared route-helper module exists) ──

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

async function checkModuleGate(reply: FastifyReply): Promise<boolean> {
  const records = await readConfig('modules');
  if (isModuleEnabled(records, 'experiments')) return true;
  reply.status(403).send({ error: 'module_disabled', message: 'experiments module is disabled' });
  return false;
}

/** The token value is written once, at creation, and never read back — same rule as project tokens. */
function mask(experiment: ExperimentConfig) {
  return { ...experiment, tokens: experiment.tokens.map(t => ({ ...t, token: undefined })) };
}

/** Zod leaves every optional field as `key: undefined`; exactOptionalPropertyTypes wants the key gone. */
function toVariant(v: { id?: string | undefined; projectId: string; name?: string | undefined; weight?: number | undefined }): ExperimentVariant {
  return {
    id: v.id ?? randomUUID(),
    projectId: v.projectId,
    ...(v.name !== undefined ? { name: v.name } : {}),
    ...(v.weight !== undefined ? { weight: v.weight } : {}),
  };
}

function newToken(): ProjectToken {
  const raw = `sk-rt-${randomBytes(32).toString('hex')}`;
  return { id: randomUUID(), token: raw, tokenSnippet: raw.substring(0, 10), createdAt: new Date().toISOString() };
}

// ── Zod schemas ────────────────────────────────────────────────────────────────

const variantSchema = z.object({
  id: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  weight: z.number().min(0).optional(),
});

const judgeSchema = z.object({
  enabled: z.boolean(),
  modelId: z.string().trim().min(1),
  criteria: z.array(z.string().trim().min(1)),
  sampleRate: z.number().min(0).max(1),
});

const createSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  rotation: z.enum(EXPERIMENT_ROTATIONS).default('sticky'),
  stickyKey: z.enum(STICKY_KEYS).optional(),
  variants: z.array(variantSchema).default([]),
  judge: judgeSchema.optional(),
  minSamplesPerVariant: z.number().int().min(1).optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  rotation: z.enum(EXPERIMENT_ROTATIONS).optional(),
  stickyKey: z.enum(STICKY_KEYS).optional(),
  variants: z.array(variantSchema).optional(),
  judge: judgeSchema.optional(),
  minSamplesPerVariant: z.number().int().min(1).optional(),
}).refine(b => Object.keys(b).length > 0, { message: 'At least one field must be provided' });

/**
 * What may still change once traffic is flowing. Everything that would make the
 * two arms incomparable (who they route to, how traffic splits, how quality is
 * judged) is frozen: a running test can be renamed, not redesigned.
 */
const EDITABLE_WHILE_RUNNING = ['name', 'description', 'minSamplesPerVariant'] as const;

const closeSchema = z.object({ winnerVariantId: z.string().trim().min(1).optional() });

// ── Routes ─────────────────────────────────────────────────────────────────────

export const experimentsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/experiments', async (req, reply) => {
    if (!requirePerm(req, 'experiments:read', reply)) return;
    if (!await checkModuleGate(reply)) return;
    return reply.send((await readConfig('experiments')).map(mask));
  });

  fastify.get<{ Params: { id: string } }>('/api/experiments/:id', async (req, reply) => {
    if (!requirePerm(req, 'experiments:read', reply)) return;
    if (!await checkModuleGate(reply)) return;
    const found = (await readConfig('experiments')).find(e => e.id === req.params.id);
    if (!found) return reply.status(404).send({ error: 'Not found' });
    return reply.send(mask(found));
  });

  // Read straight off the usage log: the experiment stamps its id on every record
  // it routes (T71), so the comparison needs no store of its own.
  fastify.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>('/api/experiments/:id/metrics', async (req, reply) => {
    if (!requirePerm(req, 'experiments:read', reply)) return;
    if (!await checkModuleGate(reply)) return;
    const found = (await readConfig('experiments')).find(e => e.id === req.params.id);
    if (!found) return reply.status(404).send({ error: 'Not found' });
    const [records, projects] = await Promise.all([readConfig('usage'), readConfig('projects')]);
    // ponytail: an explicit ISO window, not the period vocabulary /api/usage uses.
    // The caller already knows which window it wants; the server needs no names for them.
    const { from, to } = req.query;
    const since = from ? new Date(from) : null;
    const until = to ? new Date(to) : null;
    const windowed = since || until
      ? records.filter(r => {
        const ts = new Date(r.timestamp);
        return (!since || ts >= since) && (!until || ts <= until);
      })
      : records;
    return reply.send(computeExperimentMetrics(found, windowed, projects));
  });

  fastify.post<{ Body: unknown }>('/api/experiments', async (req, reply) => {
    if (!requirePerm(req, 'experiments:manage', reply)) return;
    if (!await checkModuleGate(reply)) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const experiments = await readConfig('experiments');
    if (experiments.some(e => e.name.trim().toLowerCase() === parsed.data.name.toLowerCase())) {
      return reply.status(409).send({ error: `An experiment named "${parsed.data.name}" already exists` });
    }
    const unknown = await unknownProjects(parsed.data.variants.map(v => v.projectId));
    if (unknown.length > 0) return reply.status(404).send({ error: 'project_not_found', projectIds: unknown });

    const token = newToken();
    const experiment: ExperimentConfig = {
      id: randomUUID(),
      name: parsed.data.name,
      ...(parsed.data.description ? { description: parsed.data.description } : {}),
      status: 'draft',
      rotation: parsed.data.rotation,
      ...(parsed.data.stickyKey ? { stickyKey: parsed.data.stickyKey } : {}),
      variants: parsed.data.variants.map(toVariant),
      tokens: [token],
      ...(parsed.data.judge ? { judge: parsed.data.judge } : {}),
      ...(parsed.data.minSamplesPerVariant ? { minSamplesPerVariant: parsed.data.minSamplesPerVariant } : {}),
      createdAt: new Date().toISOString(),
    };
    experiments.push(experiment);
    await writeConfig('experiments', experiments);
    audit(req, 'experiment:create', 'success', { id: experiment.id });
    // The raw token is returned here and nowhere else, exactly like a project's first token.
    return reply.status(201).send({ ...mask(experiment), token: token.token });
  });

  fastify.patch<{ Params: { id: string }; Body: unknown }>('/api/experiments/:id', async (req, reply) => {
    if (!requirePerm(req, 'experiments:manage', reply)) return;
    if (!await checkModuleGate(reply)) return;
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const experiments = await readConfig('experiments');
    const idx = experiments.findIndex(e => e.id === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: 'Not found' });
    const current = experiments[idx]!;

    if (current.status !== 'draft') {
      const frozen = Object.keys(parsed.data).filter(k => !EDITABLE_WHILE_RUNNING.includes(k as never));
      if (frozen.length > 0) {
        return reply.status(409).send({
          error: 'experiment_frozen',
          message: `A ${current.status} experiment cannot change ${frozen.join(', ')}. Only ${EDITABLE_WHILE_RUNNING.join(', ')} stay editable.`,
        });
      }
    }
    if (parsed.data.variants) {
      const unknown = await unknownProjects(parsed.data.variants.map(v => v.projectId));
      if (unknown.length > 0) return reply.status(404).send({ error: 'project_not_found', projectIds: unknown });
    }

    const d = parsed.data;
    const updated: ExperimentConfig = {
      ...current,
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.rotation !== undefined ? { rotation: d.rotation } : {}),
      ...(d.stickyKey !== undefined ? { stickyKey: d.stickyKey } : {}),
      ...(d.variants !== undefined ? { variants: d.variants.map(toVariant) } : {}),
      ...(d.judge !== undefined ? { judge: d.judge } : {}),
      ...(d.minSamplesPerVariant !== undefined ? { minSamplesPerVariant: d.minSamplesPerVariant } : {}),
    };
    experiments[idx] = updated;
    await writeConfig('experiments', experiments);
    audit(req, 'experiment:update', 'success', { id: req.params.id });
    return reply.send(mask(updated));
  });

  fastify.post<{ Params: { id: string } }>('/api/experiments/:id/start', async (req, reply) => {
    if (!requirePerm(req, 'experiments:manage', reply)) return;
    if (!await checkModuleGate(reply)) return;
    const experiments = await readConfig('experiments');
    const idx = experiments.findIndex(e => e.id === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: 'Not found' });
    const current = experiments[idx]!;
    if (current.status !== 'draft') {
      return reply.status(409).send({ error: 'experiment_not_draft', message: `This experiment is already ${current.status}.` });
    }
    if (current.variants.length < 2) {
      return reply.status(400).send({ error: 'too_few_variants', message: 'An experiment needs at least two variants to compare.' });
    }
    if (current.tokens.length === 0) {
      return reply.status(400).send({ error: 'no_token', message: 'An experiment needs a token for clients to call.' });
    }

    const updated: ExperimentConfig = { ...current, status: 'running', startedAt: new Date().toISOString() };
    experiments[idx] = updated;
    await writeConfig('experiments', experiments);
    audit(req, 'experiment:start', 'success', { id: req.params.id });
    return reply.send(mask(updated));
  });

  fastify.post<{ Params: { id: string }; Body: unknown }>('/api/experiments/:id/close', async (req, reply) => {
    if (!requirePerm(req, 'experiments:manage', reply)) return;
    if (!await checkModuleGate(reply)) return;
    const parsed = closeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const experiments = await readConfig('experiments');
    const idx = experiments.findIndex(e => e.id === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: 'Not found' });
    const current = experiments[idx]!;
    if (current.status !== 'running') {
      return reply.status(409).send({ error: 'experiment_not_running', message: `Only a running experiment can be closed; this one is ${current.status}.` });
    }
    const winnerVariantId = parsed.data.winnerVariantId;
    if (winnerVariantId && !current.variants.some(v => v.id === winnerVariantId)) {
      return reply.status(404).send({ error: 'variant_not_found' });
    }

    const updated: ExperimentConfig = {
      ...current,
      status: 'closed',
      closedAt: new Date().toISOString(),
      ...(winnerVariantId ? { winnerVariantId } : {}),
    };
    experiments[idx] = updated;
    await writeConfig('experiments', experiments);
    audit(req, 'experiment:close', 'success', { id: req.params.id, ...(winnerVariantId ? { winnerVariantId } : {}) });
    return reply.send(mask(updated));
  });

  fastify.post<{ Params: { id: string } }>('/api/experiments/:id/tokens', async (req, reply) => {
    if (!requirePerm(req, 'experiments:manage', reply)) return;
    if (!await checkModuleGate(reply)) return;
    const experiments = await readConfig('experiments');
    const idx = experiments.findIndex(e => e.id === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: 'Not found' });

    const token = newToken();
    experiments[idx] = { ...experiments[idx]!, tokens: [...experiments[idx]!.tokens, token] };
    await writeConfig('experiments', experiments);
    audit(req, 'experiment:token:create', 'success', { id: req.params.id });
    return reply.send({ token: token.token, tokenInfo: { ...token, token: undefined } });
  });

  fastify.delete<{ Params: { id: string; tokenId: string } }>('/api/experiments/:id/tokens/:tokenId', async (req, reply) => {
    if (!requirePerm(req, 'experiments:manage', reply)) return;
    if (!await checkModuleGate(reply)) return;
    const experiments = await readConfig('experiments');
    const idx = experiments.findIndex(e => e.id === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: 'Not found' });
    const tokens = experiments[idx]!.tokens.filter(t => t.id !== req.params.tokenId);
    if (tokens.length === experiments[idx]!.tokens.length) return reply.status(404).send({ error: 'Token not found' });

    experiments[idx] = { ...experiments[idx]!, tokens };
    await writeConfig('experiments', experiments);
    audit(req, 'experiment:token:delete', 'success', { id: req.params.id, tokenId: req.params.tokenId });
    return reply.status(204).send();
  });

  fastify.delete<{ Params: { id: string } }>('/api/experiments/:id', async (req, reply) => {
    if (!requirePerm(req, 'experiments:manage', reply)) return;
    if (!await checkModuleGate(reply)) return;
    const experiments = await readConfig('experiments');
    const idx = experiments.findIndex(e => e.id === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: 'Not found' });
    // Deleting a running test would silently 401 every client still calling its
    // token: close it first, so stopping traffic is always a deliberate step.
    if (experiments[idx]!.status === 'running') {
      return reply.status(409).send({ error: 'experiment_running', message: 'Close the experiment before deleting it.' });
    }

    experiments.splice(idx, 1);
    await writeConfig('experiments', experiments);
    audit(req, 'experiment:delete', 'success', { id: req.params.id });
    return reply.status(204).send();
  });
};

async function unknownProjects(projectIds: string[]): Promise<string[]> {
  const projects = await readConfig('projects');
  const known = new Set(projects.map(p => p.id));
  return [...new Set(projectIds.filter(id => !known.has(id)))];
}
