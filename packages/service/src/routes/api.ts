import type { FastifyPluginAsync } from 'fastify';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'node:crypto';
import { readConfig, writeConfig } from '../config/loader.js';
import { CONFIG_PATHS } from '../config/paths.js';
import { encrypt, decrypt } from '@localrouter/shared';
import { createSessionToken, verifyToken } from '../plugins/jwt.js';
import type { ModelConfig, ProjectConfig, UserConfig, Provider, TokenCost, PricingTier, RoutingPolicy, TokenModelRef, Settings } from '@localrouter/shared';
import { getTrace } from '../routing/traceStore.js';
import { sendTestNotification } from '../notifications/sender.js';

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
      contextWindow?: number;
      pricingTiers?: PricingTier[];
      dailyBudget?: number; weeklyBudget?: number; monthlyBudget?: number;
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
      globalThresholds: (req.body.dailyBudget !== undefined || req.body.weeklyBudget !== undefined || req.body.monthlyBudget !== undefined)
        ? {
          ...(req.body.dailyBudget !== undefined ? { daily: req.body.dailyBudget } : {}),
          ...(req.body.weeklyBudget !== undefined ? { weekly: req.body.weeklyBudget } : {}),
          ...(req.body.monthlyBudget !== undefined ? { monthly: req.body.monthlyBudget } : {}),
        }
        : undefined,
      ...(req.body.contextWindow !== undefined ? { contextWindow: req.body.contextWindow } : {}),
    };
    models.push(model);
    await writeConfig('models', models);
    return reply.status(201).send({ ...model, encryptedApiKey: undefined });
  });

  fastify.put<{
    Params: { id: string };
    Body: {
      id?: string;
      name?: string; provider: string; endpoint: string;
      apiKey?: string; inputPerMillion: number; outputPerMillion: number;
      cachePerMillion?: number;
      contextWindow?: number;
      pricingTiers?: PricingTier[];
      dailyBudget?: number; weeklyBudget?: number; monthlyBudget?: number;
    }
  }>('/api/models/:id', async (req, reply) => {
    const models = await readConfig('models');
    const index = models.findIndex(m => m.id === req.params.id);
    if (index === -1) {
      return reply.status(404).send({ error: 'Not found' });
    }
    const existing = models[index]!;

    // Handle ID change
    const newId = req.body.id || req.params.id;
    if (newId !== req.params.id && models.find(m => m.id === newId)) {
      return reply.status(409).send({ error: `Model "${newId}" already exists` });
    }

    const model: ModelConfig = {
      ...existing,
      id: newId,
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
      globalThresholds: (req.body.dailyBudget !== undefined || req.body.weeklyBudget !== undefined || req.body.monthlyBudget !== undefined)
        ? {
          ...(req.body.dailyBudget !== undefined ? { daily: req.body.dailyBudget } : {}),
          ...(req.body.weeklyBudget !== undefined ? { weekly: req.body.weeklyBudget } : {}),
          ...(req.body.monthlyBudget !== undefined ? { monthly: req.body.monthlyBudget } : {}),
        }
        : undefined,
      ...(req.body.contextWindow !== undefined ? { contextWindow: req.body.contextWindow } : existing.contextWindow !== undefined ? { contextWindow: existing.contextWindow } : {}),
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
    return reply.send(projects.map(p => ({
      ...p,
      tokens: p.tokens?.map(t => ({ ...t, encryptedToken: undefined })) || []
    })));
  });

  fastify.post<{
    Body: {
      name: string;
      routingModelId?: string;
      autoRouting?: boolean;
      fallbackRoutingModelIds?: string[];
      policies?: RoutingPolicy[];
      models?: { modelId: string; prompt?: string }[];
      timeoutMs?: number;
    }
  }>('/api/projects', async (req, reply) => {
    const projects = await readConfig('projects');
    const trimmedName = req.body.name.trim();
    if (!trimmedName) return reply.status(400).send({ error: 'Project name cannot be empty' });
    if (projects.some(p => p.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
      return reply.status(409).send({ error: `A project named "${trimmedName}" already exists` });
    }
    const rawToken = `sk-lr-${randomBytes(32).toString('hex')}`;
    const userId = requireAdmin(req.headers.authorization) || 'system';

    const project: ProjectConfig = {
      id: uuidv4(),
      name: trimmedName,
      tokens: [{
        id: uuidv4(),
        encryptedToken: encrypt(rawToken),
        tokenSnippet: rawToken.substring(0, 10),
        createdAt: new Date().toISOString()
      }],
      members: [{ userId, role: 'admin' }],
      ...(req.body.routingModelId !== undefined ? { routingModelId: req.body.routingModelId } : {}),
      autoRouting: req.body.autoRouting ?? true,
      ...(req.body.fallbackRoutingModelIds !== undefined && { fallbackRoutingModelIds: req.body.fallbackRoutingModelIds }),
      ...(req.body.policies !== undefined && req.body.policies.length > 0 ? { policies: req.body.policies } : {}),
      models: (req.body.models ?? []).map(m => ({
        modelId: m.modelId,
        ...(m.prompt ? { prompt: m.prompt } : {}),
      })),
      timeoutMs: req.body.timeoutMs ?? 30000,
    };
    projects.push(project);
    await writeConfig('projects', projects);
    // Return the raw token once (not stored in plain text after this)
    return reply.status(201).send({ ...project, tokens: project.tokens.map(t => ({ ...t, encryptedToken: undefined })), token: rawToken });
  });

  fastify.put<{
    Params: { id: string };
    Body: {
      name: string;
      routingModelId?: string;
      autoRouting?: boolean;
      fallbackRoutingModelIds?: string[];
      policies?: RoutingPolicy[];
      models: { modelId: string; prompt?: string }[];
      timeoutMs?: number;
    };
  }>('/api/projects/:id', async (req, reply) => {
    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Not found' });
    const trimmedName = req.body.name.trim();
    if (!trimmedName) return reply.status(400).send({ error: 'Project name cannot be empty' });
    if (projects.some(p => p.id !== req.params.id && p.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
      return reply.status(409).send({ error: `A project named "${trimmedName}" already exists` });
    }
    const existing = projects[index]!;
    const updated: ProjectConfig = {
      ...existing,
      name: trimmedName,
      ...(req.body.routingModelId !== undefined ? { routingModelId: req.body.routingModelId } : existing.routingModelId !== undefined ? { routingModelId: existing.routingModelId } : {}),
      autoRouting: req.body.autoRouting ?? existing.autoRouting ?? true,
      ...(req.body.fallbackRoutingModelIds !== undefined && { fallbackRoutingModelIds: req.body.fallbackRoutingModelIds }),
      ...(req.body.policies !== undefined && { policies: req.body.policies }),
      models: req.body.models.map(m => ({
        modelId: m.modelId,
        ...(m.prompt ? { prompt: m.prompt } : {}),
      })),
      timeoutMs: req.body.timeoutMs ?? existing.timeoutMs ?? 30000,
    };
    projects[index] = updated;
    await writeConfig('projects', projects);
    return reply.send({
      ...updated,
      tokens: updated.tokens?.map(t => ({ ...t, encryptedToken: undefined })) || []
    });
  });

  fastify.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const projects = await readConfig('projects');
    const filtered = projects.filter(p => p.id !== req.params.id);
    if (filtered.length === projects.length) return reply.status(404).send({ error: 'Not found' });
    await writeConfig('projects', filtered);
    return reply.status(204).send();
  });

  fastify.post<{ Params: { id: string }, Body: { labels?: string[] } }>('/api/projects/:id/tokens', async (req, reply) => {
    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Not found' });

    const rawToken = `sk-lr-${randomBytes(32).toString('hex')}`;

    const newToken = {
      id: uuidv4(),
      encryptedToken: encrypt(rawToken),
      tokenSnippet: rawToken.substring(0, 10),
      createdAt: new Date().toISOString(),
      ...(req.body.labels ? { labels: req.body.labels } : {})
    };

    const updated = { ...projects[index]! };
    if (!updated.tokens) updated.tokens = [];
    updated.tokens.push(newToken);

    projects[index] = updated;
    await writeConfig('projects', projects);
    return reply.send({ token: rawToken, tokenInfo: { ...newToken, encryptedToken: undefined } });
  });

  fastify.put<{ Params: { id: string, tokenId: string }; Body: { models?: TokenModelRef[], labels?: string[] } }>('/api/projects/:id/tokens/:tokenId', async (req, reply) => {
    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Project not found' });

    const project = projects[index]!;
    if (!project.tokens) return reply.status(404).send({ error: 'Token not found' });

    const token = project.tokens.find(t => t.id === req.params.tokenId);
    if (!token) return reply.status(404).send({ error: 'Token not found' });

    if (req.body.models !== undefined) token.models = req.body.models;
    if (req.body.labels !== undefined) token.labels = req.body.labels;
    await writeConfig('projects', projects);

    return reply.send(token);
  });

  fastify.delete<{ Params: { id: string, tokenId: string } }>('/api/projects/:id/tokens/:tokenId', async (req, reply) => {
    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Project not found' });

    const project = projects[index]!;
    if (!project.tokens) return reply.status(404).send({ error: 'Token not found' });

    const tokenIndex = project.tokens.findIndex(t => t.id === req.params.tokenId);
    if (tokenIndex === -1) return reply.status(404).send({ error: 'Token not found' });

    project.tokens.splice(tokenIndex, 1);
    await writeConfig('projects', projects);
    return reply.status(204).send();
  });

  fastify.post<{ Params: { id: string }; Body: { userId: string; role: string } }>('/api/projects/:id/members', async (req, reply) => {
    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Project not found' });

    const users = await readConfig('users');
    if (!users.find(u => u.id === req.body.userId)) return reply.status(404).send({ error: 'User not found' });

    const project = projects[index]!;
    if (!project.members) project.members = [];
    if (project.members.find(m => m.userId === req.body.userId)) {
      return reply.status(409).send({ error: 'User is already a member' });
    }

    project.members.push({ userId: req.body.userId, role: req.body.role as any });
    await writeConfig('projects', projects);
    return reply.status(201).send({ userId: req.body.userId, role: req.body.role });
  });

  fastify.put<{ Params: { id: string, userId: string }; Body: { role: string } }>('/api/projects/:id/members/:userId', async (req, reply) => {
    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Project not found' });

    const project = projects[index]!;
    if (!project.members) return reply.status(404).send({ error: 'Member not found' });
    const member = project.members.find(m => m.userId === req.params.userId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });

    member.role = req.body.role as any;
    await writeConfig('projects', projects);
    return reply.send(member);
  });

  fastify.delete<{ Params: { id: string, userId: string } }>('/api/projects/:id/members/:userId', async (req, reply) => {
    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Project not found' });

    const project = projects[index]!;
    if (!project.members) return reply.status(404).send({ error: 'Member not found' });

    const memberIndex = project.members.findIndex(m => m.userId === req.params.userId);
    if (memberIndex === -1) return reply.status(404).send({ error: 'Member not found' });

    project.members.splice(memberIndex, 1);
    await writeConfig('projects', projects);
    return reply.status(204).send();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // CURRENT USER (me)
  // ══════════════════════════════════════════════════════════════════════════════

  fastify.get('/api/me', async (req, reply) => {
    const userId = requireAdmin(req.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });
    const users = await readConfig('users');
    const user = users.find(u => u.id === userId);
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return reply.send({ id: user.id, email: user.email, roleId: user.roleId });
  });

  fastify.put<{
    Body: { currentPassword: string; newEmail?: string; newPassword?: string };
  }>('/api/me', async (req, reply) => {
    const userId = requireAdmin(req.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });
    const { currentPassword, newEmail, newPassword } = req.body;
    if (!currentPassword) return reply.status(400).send({ error: 'Current password is required' });
    const users = await readConfig('users');
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return reply.status(404).send({ error: 'User not found' });
    const user = users[idx];
    if (user.passwordHash !== hashPassword(currentPassword)) {
      return reply.status(401).send({ error: 'Current password is incorrect' });
    }
    if (newEmail && newEmail !== user.email) {
      if (users.find(u => u.email === newEmail)) {
        return reply.status(409).send({ error: 'Email already in use' });
      }
      users[idx] = { ...user, email: newEmail };
    }
    if (newPassword) {
      if (newPassword.length < 8) return reply.status(400).send({ error: 'Password must be at least 8 characters' });
      users[idx] = { ...users[idx], passwordHash: hashPassword(newPassword) };
    }
    await writeConfig('users', users);
    const updated = users[idx];
    return reply.send({ id: updated.id, email: updated.email, roleId: updated.roleId });
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

  fastify.put<{
    Params: { id: string };
    Body: { email?: string; roleId?: string; newPassword?: string };
  }>('/api/users/:id', async (req, reply) => {
    const users = await readConfig('users');
    const idx = users.findIndex(u => u.id === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: 'User not found' });
    const user = users[idx];
    const { email, roleId, newPassword } = req.body;
    if (email && email !== user.email) {
      if (users.find(u => u.email === email)) return reply.status(409).send({ error: 'Email already in use' });
      users[idx] = { ...users[idx], email };
    }
    if (roleId) users[idx] = { ...users[idx], roleId };
    if (newPassword) {
      if (newPassword.length < 8) return reply.status(400).send({ error: 'Password must be at least 8 characters' });
      users[idx] = { ...users[idx], passwordHash: hashPassword(newPassword) };
    }
    await writeConfig('users', users);
    const updated = users[idx];
    return reply.send({ id: updated.id, email: updated.email, roleId: updated.roleId, projectIds: updated.projectIds });
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

  fastify.get<{ Querystring: { period?: string; projectId?: string; from?: string; to?: string } }>('/api/usage', async (req, reply) => {
    const records = await readConfig('usage');
    const { period = 'monthly', projectId, from, to } = req.query;

    const now = new Date();
    let since = new Date(0);
    let until = new Date(now.getTime() + 86400000); // tomorrow
    if (period === 'daily') { since = new Date(now); since.setHours(0, 0, 0, 0); }
    else if (period === 'weekly') {
      since = new Date(now);
      const d = since.getDay();
      since.setDate(since.getDate() - (d === 0 ? 6 : d - 1));
      since.setHours(0, 0, 0, 0);
    } else if (period === 'monthly') { since = new Date(now); since.setDate(1); since.setHours(0, 0, 0, 0); }
    else if (period === 'custom') {
      if (from) { since = new Date(from); since.setHours(0, 0, 0, 0); }
      if (to)   { until = new Date(to);  until.setHours(23, 59, 59, 999); }
    }

    let filtered = records.filter(r => {
      const ts = new Date(r.timestamp);
      return ts >= since && ts <= until;
    });
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

    // Aggregate by callType
    const routingCalls = filtered.filter(r => r.callType === 'routing').length;
    const completionCalls = filtered.filter(r => r.callType !== 'routing').length;
    const routingCost = filtered.filter(r => r.callType === 'routing' && r.outcome === 'success').reduce((s, r) => s + r.cost, 0);
    const completionCost = filtered.filter(r => r.callType !== 'routing' && r.outcome === 'success').reduce((s, r) => s + r.cost, 0);

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
      summary: { totalCost, totalCalls, successCalls, errorCalls: totalCalls - successCalls, routingCalls, completionCalls, routingCost, completionCost },
      byModel,
      timeline: Object.entries(timeline).sort(([a], [b]) => a.localeCompare(b)).slice(-30),
      // Strip trace from list response to keep payload small
      records: filtered.slice(-100).reverse().map(({ trace: _trace, ...r }) => r),
    });
  });

  // ─── GET /api/usage/:id ────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/usage/:id', async (req, reply) => {
    const records = await readConfig('usage');
    const record = records.find(r => r.id === req.params.id);
    if (!record) return reply.status(404).send({ error: 'Record not found' });
    return reply.send(record);
  });

  // ─── GET /api/system/info ───────────────────────────────────────────────────
  fastify.get('/api/system/info', async (_req, reply) => {
    return reply.send({
      version: '0.0.1',
      nodeVersion: process.version,
      platform: process.platform,
      configDir: CONFIG_PATHS.config,
      dataDir: CONFIG_PATHS.data,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  // ─── GET /api/settings ─────────────────────────────────────────────────────
  fastify.get('/api/settings', async (_req, reply) => {
    const settings = await readConfig('settings');
    return reply.send(settings);
  });

  // ─── PUT /api/settings ─────────────────────────────────────────────────────
  fastify.put<{
    Body: Partial<Settings>;
  }>('/api/settings', async (req, reply) => {
    const current = await readConfig('settings');
    const allowed: (keyof Settings)[] = [
      'defaultTimeoutMs',
      'logLevel',
      'dashboardEnabled',
      'notifications',
      'publicUrl',
    ];
    const updated = { ...current };
    for (const key of allowed) {
      if ((req.body as Partial<Settings>)[key] !== undefined) {
        (updated as any)[key] = (req.body as Partial<Settings>)[key];
      }
    }
    await writeConfig('settings', updated);
    return reply.send(updated);
  });

  // ─── POST /api/notifications/test ─────────────────────────────────────────
  fastify.post<{ Body: { channelId: string; to: string } }>('/api/notifications/test', async (req, reply) => {
    const userId = requireAdmin(req.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { channelId, to } = req.body;
    if (!channelId) return reply.status(400).send({ error: 'channelId is required' });

    const settings = await readConfig('settings');
    const channels  = (settings.notifications?.channels ?? []) as Array<{ id: string; provider: string; [k: string]: unknown }>;
    const channel   = channels.find(ch => ch.id === channelId);
    if (!channel) return reply.status(400).send({ error: `Channel "${channelId}" not found` });

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await sendTestNotification(channel as any, to ?? '');
      return reply.send(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.send({ ok: false, message: msg });
    }
  });

  // ─── GET /api/traces/:id ─────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/traces/:id', async (req, reply) => {
    const userId = requireAdmin(req.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const trace = getTrace(req.params.id);
    if (!trace) return reply.status(404).send({ error: 'Trace not found' });

    return reply.send({ trace });
  });

};
