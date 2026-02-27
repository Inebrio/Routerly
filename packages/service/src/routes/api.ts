import type { FastifyPluginAsync } from 'fastify';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'node:crypto';
import { readConfig, writeConfig } from '../config/loader.js';
import { encrypt, decrypt } from '@localrouter/shared';
import { createSessionToken, verifyToken } from '../plugins/jwt.js';
import type { ModelConfig, ProjectConfig, UserConfig, Provider, TokenCost, PricingTier } from '@localrouter/shared';

function hashPassword(p: string): string {
  return createHash('sha256').update(p).digest('hex');
}

function requireAdmin(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) return null;
  return payload['sub'] as string;
}

export const apiRoutes: FastifyPluginAsync = async (fastify) => {

  // ─── POST /api/auth/login ────────────────────────────────────────────────────
  fastify.post<{ Body: { email: string; password: string } }>('/api/auth/login', async (req, reply) => {
    const { email, password } = req.body;
    const users = await readConfig('users');
    const user = users.find(u => u.email === email);
    if (!user || user.passwordHash !== hashPassword(password)) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }
    const token = createSessionToken(user.id, user.roleId);
    return reply.send({ token, user: { id: user.id, email: user.email, role: user.roleId } });
  });

  // ─── Setup endpoints (public, no auth required) ─────────────────────────────
  fastify.get('/api/setup/status', async (_req, reply) => {
    const users = await readConfig('users');
    const hasAdmin = users.some(u => u.roleId === 'admin');
    return reply.send({ needsSetup: !hasAdmin });
  });

  fastify.post<{ Body: { email: string; password: string } }>('/api/setup/first-admin', async (req, reply) => {
    const users = await readConfig('users');
    if (users.some(u => u.roleId === 'admin')) {
      return reply.status(403).send({ error: 'Setup already completed. An admin user already exists.' });
    }
    const { email, password } = req.body;
    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required' });
    }
    const user: UserConfig = {
      id: uuidv4(),
      email,
      passwordHash: hashPassword(password),
      roleId: 'admin',
      projectIds: [],
    };
    users.push(user);
    await writeConfig('users', users);
    const token = createSessionToken(user.id, user.roleId);
    return reply.status(201).send({ token, user: { id: user.id, email: user.email, role: user.roleId } });
  });

  // ─── Auth middleware for /api/* (except login and setup) ─────────────────────
  fastify.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (req.url === '/api/auth/login') return;
    if (req.url.startsWith('/api/setup/')) return;
    const userId = requireAdmin(req.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // MODELS
  // ══════════════════════════════════════════════════════════════════════════════

  fastify.get('/api/models', async (_req, reply) => {
    const models = await readConfig('models');
    // Strip encrypted keys before sending to client
    return reply.send(models.map(m => ({ ...m, encryptedApiKey: undefined })));
  });

  fastify.post<{
    Body: {
      id: string; name?: string; provider: string; endpoint: string;
      apiKey?: string; inputPerMillion: number; outputPerMillion: number;
      cachePerMillion?: number;
      pricingTiers?: PricingTier[];
      dailyBudget?: number; monthlyBudget?: number;
    }
  }>('/api/models', async (req, reply) => {
    const models = await readConfig('models');
    if (models.find(m => m.id === req.body.id)) {
      return reply.status(409).send({ error: `Model "${req.body.id}" already exists` });
    }
    const model: ModelConfig = {
      id: req.body.id,
      name: req.body.name ?? req.body.id,
      provider: req.body.provider as Provider,
      endpoint: req.body.endpoint,
      encryptedApiKey: req.body.apiKey ? encrypt(req.body.apiKey) : undefined,
      cost: {
        inputPerMillion: req.body.inputPerMillion,
        outputPerMillion: req.body.outputPerMillion,
        ...(req.body.cachePerMillion !== undefined ? { cachePerMillion: req.body.cachePerMillion } : {}),
        ...(req.body.pricingTiers?.length ? { pricingTiers: req.body.pricingTiers } : {}),
      },
      globalThresholds: (req.body.dailyBudget !== undefined || req.body.monthlyBudget !== undefined)
        ? {
          ...(req.body.dailyBudget !== undefined ? { daily: req.body.dailyBudget } : {}),
          ...(req.body.monthlyBudget !== undefined ? { monthly: req.body.monthlyBudget } : {}),
        }
        : undefined,
    };
    models.push(model);
    await writeConfig('models', models);
    return reply.status(201).send({ ...model, encryptedApiKey: undefined });
  });

  fastify.put<{
    Params: { id: string };
    Body: {
      name?: string; provider: string; endpoint: string;
      apiKey?: string; inputPerMillion: number; outputPerMillion: number;
      cachePerMillion?: number;
      pricingTiers?: PricingTier[];
      dailyBudget?: number; monthlyBudget?: number;
    }
  }>('/api/models/:id', async (req, reply) => {
    const models = await readConfig('models');
    const index = models.findIndex(m => m.id === req.params.id);
    if (index === -1) {
      return reply.status(404).send({ error: 'Not found' });
    }
    const existing = models[index]!;
    const model: ModelConfig = {
      ...existing,
      name: req.body.name ?? existing.name,
      provider: req.body.provider as Provider,
      endpoint: req.body.endpoint,
      encryptedApiKey: req.body.apiKey ? encrypt(req.body.apiKey) : existing.encryptedApiKey,
      cost: {
        inputPerMillion: req.body.inputPerMillion,
        outputPerMillion: req.body.outputPerMillion,
        ...(req.body.cachePerMillion !== undefined ? { cachePerMillion: req.body.cachePerMillion } : {}),
        ...(req.body.pricingTiers?.length ? { pricingTiers: req.body.pricingTiers } : {}),
      },
      globalThresholds: (req.body.dailyBudget !== undefined || req.body.monthlyBudget !== undefined)
        ? {
          ...(req.body.dailyBudget !== undefined ? { daily: req.body.dailyBudget } : {}),
          ...(req.body.monthlyBudget !== undefined ? { monthly: req.body.monthlyBudget } : {}),
        }
        : undefined,
    };
    models[index] = model;
    await writeConfig('models', models);
    return reply.send({ ...model, encryptedApiKey: undefined });
  });

  fastify.delete<{ Params: { id: string } }>('/api/models/:id', async (req, reply) => {
    const models = await readConfig('models');
    const filtered = models.filter(m => m.id !== req.params.id);
    if (filtered.length === models.length) return reply.status(404).send({ error: 'Not found' });
    await writeConfig('models', filtered);
    return reply.status(204).send();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // PROJECTS
  // ══════════════════════════════════════════════════════════════════════════════

  fastify.get('/api/projects', async (_req, reply) => {
    const projects = await readConfig('projects');
    return reply.send(projects.map(p => ({ ...p, encryptedToken: undefined })));
  });

  fastify.post<{
    Body: {
      name: string;
      routingModelId: string;
      autoRouting?: boolean;
      fallbackRoutingModelIds?: string[];
      models: { modelId: string; prompt?: string }[];
      timeoutMs?: number;
    }
  }>('/api/projects', async (req, reply) => {
    const projects = await readConfig('projects');
    const rawToken = `sk-lr-${randomBytes(32).toString('hex')}`;
    const project: ProjectConfig = {
      id: uuidv4(),
      name: req.body.name,
      encryptedToken: encrypt(rawToken),
      tokenSnippet: rawToken.substring(0, 10),
      routingModelId: req.body.routingModelId,
      autoRouting: req.body.autoRouting ?? true,
      ...(req.body.fallbackRoutingModelIds !== undefined && { fallbackRoutingModelIds: req.body.fallbackRoutingModelIds }),
      models: req.body.models.map(m => ({
        modelId: m.modelId,
        ...(m.prompt ? { prompt: m.prompt } : {}),
      })),
      timeoutMs: req.body.timeoutMs ?? 30000,
    };
    projects.push(project);
    await writeConfig('projects', projects);
    // Return the raw token once (not stored in plain text after this)
    return reply.status(201).send({ ...project, encryptedToken: undefined, token: rawToken });
  });

  fastify.put<{
    Params: { id: string };
    Body: {
      name: string;
      routingModelId: string;
      autoRouting?: boolean;
      fallbackRoutingModelIds?: string[];
      models: { modelId: string; prompt?: string }[];
      timeoutMs?: number;
    };
  }>('/api/projects/:id', async (req, reply) => {
    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Not found' });
    const existing = projects[index]!;
    const updated: ProjectConfig = {
      ...existing,
      name: req.body.name,
      routingModelId: req.body.routingModelId,
      autoRouting: req.body.autoRouting ?? true,
      ...(req.body.fallbackRoutingModelIds !== undefined && { fallbackRoutingModelIds: req.body.fallbackRoutingModelIds }),
      models: req.body.models.map(m => ({
        modelId: m.modelId,
        ...(m.prompt ? { prompt: m.prompt } : {}),
      })),
      timeoutMs: req.body.timeoutMs ?? existing.timeoutMs ?? 30000,
    };
    projects[index] = updated;
    await writeConfig('projects', projects);
    return reply.send({ ...updated, encryptedToken: undefined });
  });

  fastify.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const projects = await readConfig('projects');
    const filtered = projects.filter(p => p.id !== req.params.id);
    if (filtered.length === projects.length) return reply.status(404).send({ error: 'Not found' });
    await writeConfig('projects', filtered);
    return reply.status(204).send();
  });

  fastify.post<{ Params: { id: string } }>('/api/projects/:id/rotate-token', async (req, reply) => {
    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Not found' });
    const rawToken = `sk-lr-${randomBytes(32).toString('hex')}`;
    const existing = projects[index]!;
    const updated: ProjectConfig = {
      ...existing,
      encryptedToken: encrypt(rawToken),
      tokenSnippet: rawToken.substring(0, 10),
    };
    projects[index] = updated;
    await writeConfig('projects', projects);
    return reply.send({ ...updated, encryptedToken: undefined, token: rawToken });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // USERS
  // ══════════════════════════════════════════════════════════════════════════════

  fastify.get('/api/users', async (_req, reply) => {
    const users = await readConfig('users');
    return reply.send(users.map(u => ({ ...u, passwordHash: undefined })));
  });

  fastify.post<{
    Body: { email: string; password: string; roleId?: string; projectIds?: string[] }
  }>('/api/users', async (req, reply) => {
    const users = await readConfig('users');
    if (users.find(u => u.email === req.body.email)) {
      return reply.status(409).send({ error: 'Email already exists' });
    }
    const user: UserConfig = {
      id: uuidv4(),
      email: req.body.email,
      passwordHash: hashPassword(req.body.password),
      roleId: req.body.roleId ?? 'viewer',
      projectIds: req.body.projectIds ?? [],
    };
    users.push(user);
    await writeConfig('users', users);
    return reply.status(201).send({ ...user, passwordHash: undefined });
  });

  fastify.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    const users = await readConfig('users');
    const filtered = users.filter(u => u.id !== req.params.id);
    if (filtered.length === users.length) return reply.status(404).send({ error: 'Not found' });
    await writeConfig('users', filtered);
    return reply.status(204).send();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // USAGE STATS
  // ══════════════════════════════════════════════════════════════════════════════

  fastify.get<{ Querystring: { period?: string; projectId?: string } }>('/api/usage', async (req, reply) => {
    const records = await readConfig('usage');
    const { period = 'monthly', projectId } = req.query;

    const now = new Date();
    let since = new Date(0);
    if (period === 'daily') { since = new Date(now); since.setHours(0, 0, 0, 0); }
    else if (period === 'weekly') {
      since = new Date(now);
      const d = since.getDay();
      since.setDate(since.getDate() - (d === 0 ? 6 : d - 1));
      since.setHours(0, 0, 0, 0);
    } else if (period === 'monthly') { since = new Date(now); since.setDate(1); since.setHours(0, 0, 0, 0); }

    let filtered = records.filter(r => new Date(r.timestamp) >= since);
    if (projectId) filtered = filtered.filter(r => r.projectId === projectId);

    // Aggregate by model
    const byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number; cost: number; errors: number }> = {};
    for (const r of filtered) {
      const entry = byModel[r.modelId] ?? { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, errors: 0 };
      entry.calls++;
      entry.inputTokens += r.inputTokens;
      entry.outputTokens += r.outputTokens;
      entry.cost += r.cost;
      if (r.outcome !== 'success') entry.errors++;
      byModel[r.modelId] = entry;
    }

    // Daily timeline (last 30 days)
    const timeline: Record<string, number> = {};
    for (const r of records.filter(r => r.outcome === 'success')) {
      const day = r.timestamp.slice(0, 10);
      timeline[day] = (timeline[day] ?? 0) + r.cost;
    }

    const totalCost = filtered.filter(r => r.outcome === 'success').reduce((s, r) => s + r.cost, 0);
    const totalCalls = filtered.length;
    const successCalls = filtered.filter(r => r.outcome === 'success').length;

    return reply.send({
      summary: { totalCost, totalCalls, successCalls, errorCalls: totalCalls - successCalls },
      byModel,
      timeline: Object.entries(timeline).sort(([a], [b]) => a.localeCompare(b)).slice(-30),
      records: filtered.slice(-100).reverse(),
    });
  });
};
