import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'node:crypto';
import { pingTelemetry } from '../telemetry.js';
import { readConfig, writeConfig } from '../modules/config/loader.js';
import { CONFIG_PATHS } from '../lib/paths.js';
import { createSessionToken, verifyToken, generateRawToken } from '../modules/auth/jwt.js';
import { generateTotpSecret, verifyTotp, generateBackupCodes, hashBackupCode } from '../modules/auth/totp.js';
import type { ModelConfig, ProjectConfig, UserConfig, RoleConfig, Permission, Provider, PricingTier, RoutingPolicy, TokenModelRef, Settings, Limit, ModelCapabilities, GuardrailConfig, PiiConfig, UsageByModelEntry, ChannelProvider, ProviderRepo } from '@routerly/shared';
import { CHANNEL_SECRET_FIELDS } from '@routerly/shared';
import { catalogFetcher } from '../modules/catalog/fetcher.js';
import { syncModelsFromCatalog } from '../modules/catalog/sync.js';
import { z } from 'zod';
import { getTrace } from '../modules/logging/traceStore.js';
import { getProviderAdapter } from '../modules/provider/registry.js';
import { sendTestNotification } from '../notifications/sender.js';
import { emitEvent } from '../notifications/emitter.js';
import { ALL_PERMISSIONS, BUILT_IN_ROLES, getEffectiveRoles } from '../modules/auth/roles.js';
import { updateChecker } from '../update-checker.js';
import { logAudit } from '../modules/audit/logger.js';
import type { AuditEntry } from '../modules/audit/logger.js';

const { version: pkgVersion } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as { version: string };

const GITHUB_OWNER = 'Inebrio';
const GITHUB_REPO  = 'Routerly';

// SHA-256 for random tokens only (refresh tokens are not user-chosen passwords)
function hashToken(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

const BCRYPT_ROUNDS = 12;

/** 95th percentile of a numeric array (0 when empty). Nearest-rank method. */
function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
}

// ── Notification channel validation (U5) ──────────────────────────────────────
const CHANNEL_PROVIDERS = [
  'smtp', 'ses', 'sendgrid', 'azure', 'google',
  'webhook', 'slack', 'teams', 'pagerduty', 'discord', 'dashboard',
] as const;

const channelTargetsSchema = z.object({
  roles:       z.array(z.string()).max(200).optional(),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).max(200).optional(),
  users:       z.array(z.string()).max(200).optional(),
}).strict();

/**
 * Validates a NotificationChannel: enforces a known provider, optional events
 * and targets, and a string id/name. Provider-specific fields (host, apiKey…)
 * pass through unvalidated — they are exercised by the channel's own sender.
 */
const notificationChannelSchema = z.object({
  id:              z.string().min(1).optional(),
  name:            z.string().optional(),
  provider:        z.enum(CHANNEL_PROVIDERS),
  events:          z.array(z.string()).max(50).optional(),
  cooldownSeconds: z.number().int().min(0).optional(),
  projects:        z.array(z.string()).optional(),
  targets:         channelTargetsSchema.optional(),
}).passthrough();

const notificationsConfigSchema = z.object({
  channels: z.array(notificationChannelSchema).max(100).optional(),
}).passthrough();

const REDACT_MARKER = '********';

/**
 * Returns a shallow copy of the channel with all non-empty secret fields
 * replaced by REDACT_MARKER. Fields absent or empty in the stored config
 * are omitted from the copy (they carry no info anyway).
 */
function redactChannel(channel: Record<string, unknown>): Record<string, unknown> {
  const provider = channel['provider'] as ChannelProvider | undefined;
  if (!provider) return { ...channel };
  const secrets = CHANNEL_SECRET_FIELDS[provider] ?? [];
  const out: Record<string, unknown> = { ...channel };
  for (const field of secrets) {
    const v = out[field];
    if (v && typeof v === 'string' && v.length > 0) {
      out[field] = REDACT_MARKER;
    } else if (v === undefined || v === '') {
      delete out[field];
    }
  }
  return out;
}

async function hashPassword(p: string): Promise<string> {
  return bcrypt.hash(p, BCRYPT_ROUNDS);
}

/**
 * Verifies a plaintext password against a stored hash.
 * Handles legacy unsalted SHA-256 hashes transparently and returns an upgraded
 * bcrypt hash so the caller can persist the migration on the fly.
 */
async function verifyPassword(
  plain: string,
  stored: string,
): Promise<{ ok: boolean; upgradedHash?: string }> {
  if (stored.startsWith('$2b$') || stored.startsWith('$2a$')) {
    return { ok: await bcrypt.compare(plain, stored) };
  }
  // Legacy: unsalted SHA-256
  const legacy = createHash('sha256').update(plain).digest('hex');
  if (legacy === stored) {
    return { ok: true, upgradedHash: await bcrypt.hash(plain, BCRYPT_ROUNDS) };
  }
  return { ok: false };
}


// ── Module augmentation ───────────────────────────────────────────────────────
declare module 'fastify' {
  interface FastifyRequest {
    dashUser: { id: string; email: string; roleId: string; permissions: Permission[] } | null;
  }
}

function resolvePermissions(roleId: string, allRoles: RoleConfig[]): Permission[] {
  return allRoles.find(r => r.id === roleId)?.permissions ?? [];
}

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

/**
 * Email-provider channels need a recipient to test against. When the caller
 * supplies none, default to the requesting user's own email so a one-click
 * test works. Native/webhook/dashboard providers ignore the recipient.
 */
const EMAIL_TEST_PROVIDERS = new Set(['smtp', 'ses', 'sendgrid', 'azure', 'google']);
function resolveTestRecipient(provider: string, to: string | undefined, fallback: string): string {
  if (to && to.trim()) return to.trim();
  return EMAIL_TEST_PROVIDERS.has(provider) ? fallback : '';
}

const ruleCommonFields = {
  enabled: z.boolean().optional(),
  // Judge/scan scope. Required for regex/semantic; optional for topic/moderation
  // (omitted = inject-only, no judge). Enforced in .superRefine below.
  target: z.enum(['request', 'response', 'both']).optional(),
  block: z.boolean().optional(),
  log: z.boolean().optional(),
  blockMessage: z.string().optional(),
  useJudgeResponse: z.boolean().optional(),
  // (topic/moderation only) Inject the rule instruction into the request system
  // prompt. Independent of the judge; see cross-field checks in .superRefine.
  inject: z.boolean().optional(),
};

const guardrailRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('regex'), ...ruleCommonFields, config: z.object({ patterns: z.array(z.string()) }) }),
  z.object({ type: z.literal('semantic'), ...ruleCommonFields, config: z.object({ embeddingModelId: z.string(), examples: z.array(z.string()), threshold: z.number().min(0).max(1).optional(), fallbackModelIds: z.array(z.string()).optional() }) }),
  z.object({ type: z.literal('topic'), ...ruleCommonFields, config: z.object({ modelId: z.string().optional(), allowedTopics: z.string(), threshold: z.number().min(0).max(1).optional(), fallbackModelIds: z.array(z.string()).optional() }) }),
  z.object({ type: z.literal('moderation'), ...ruleCommonFields, config: z.object({ modelId: z.string().optional(), threshold: z.number().min(0).max(1).optional(), systemPrompt: z.string().optional(), fallbackModelIds: z.array(z.string()).optional() }) }),
]).superRefine((rule, ctx) => {
  const inject = (rule as { inject?: boolean }).inject === true;
  const canInject = rule.type === 'topic' || rule.type === 'moderation';
  // inject is a topic/moderation-only flag.
  if (inject && !canInject) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'inject is only valid for topic or moderation rules', path: ['inject'] });
  }
  // regex/semantic always scan a side; topic/moderation may skip the judge when injecting.
  if (!rule.target) {
    if (!canInject) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'target is required', path: ['target'] });
    } else if (!inject) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a topic/moderation rule must judge (set target) or inject', path: ['target'] });
    }
  }
  // Judge model is required whenever the judge runs (target set).
  if (canInject && rule.target && !(rule.config as { modelId?: string }).modelId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'config.modelId is required when a target is set', path: ['config', 'modelId'] });
  }
});

const guardrailConfigSchema = z.object({
  detectInjection: z.boolean().optional(),
  rules: z.array(guardrailRuleSchema),
});

const piiEntityEnum = z.enum(['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN']);

const piiPolicySchema = z.object({
  enabled: z.boolean().optional(),
  entities: z.array(piiEntityEnum).optional(),
  customPatterns: z.array(z.string()).optional(),
  target: z.enum(['request', 'response', 'both']),
  outputBufferSize: z.number().int().min(10).max(500).optional(),
});

const piiConfigSchema = z.object({
  policies: z.array(piiPolicySchema),
});

export const apiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('dashUser', null);

  // Initialize catalog fetcher with configured repos on startup
  readConfig('settings').then((s: Settings) => {
    if (s.providerRepos?.length) catalogFetcher.setRepos(s.providerRepos);
  }).catch(() => {});

  // ─── POST /api/auth/login ────────────────────────────────────────────────────
  fastify.post<{ Body: { email: string; password: string } }>('/api/auth/login', async (req, reply) => {
    const { email, password } = req.body;
    const [users, customRoles] = await Promise.all([readConfig('users'), readConfig('roles')]);
    const userIndex = users.findIndex(u => u.email === email);
    if (userIndex === -1) return reply.status(401).send({ error: 'Invalid credentials' });
    const { ok, upgradedHash } = await verifyPassword(password, users[userIndex]!.passwordHash);
    if (!ok) {
      void emitEvent('auth.login_failed', 'warning', { email, userId: users[userIndex]!.id }, { log: req.log });
      return reply.status(401).send({ error: 'Invalid credentials' });
    }
    const user = users[userIndex]!;

    // Migrate legacy hash on the fly
    if (upgradedHash) {
      users[userIndex] = { ...user, passwordHash: upgradedHash };
      await writeConfig('users', users);
    }

    // If 2FA is enabled, defer JWT issuance
    if (user.totpEnabled) {
      return reply.status(202).send({ requiresTotp: true, userId: user.id });
    }

    const allRoles = getEffectiveRoles(customRoles);
    const permissions = resolvePermissions(user.roleId, allRoles);
    const token = createSessionToken(user.id, user.roleId);
    // Issue a permanent refresh token and persist its hash
    const refreshToken = generateRawToken(40);
    users[userIndex] = {
      ...(users[userIndex]!),
      refreshTokenHash: hashToken(refreshToken),
    };
    await writeConfig('users', users);
    return reply.send({ token, refreshToken, user: { id: user.id, email: user.email, role: user.roleId, permissions, totpEnabled: !!user.totpEnabled } });
  });

  // ─── POST /api/auth/2fa/verify ───────────────────────────────────────────────
  fastify.post<{ Body: { userId: string; token?: string; backupCode?: string } }>('/api/auth/2fa/verify', async (req, reply) => {
    const { userId, token: totpToken, backupCode } = req.body;
    if (!userId || (!totpToken && !backupCode)) {
      return reply.status(400).send({ error: 'userId and either token or backupCode are required' });
    }
    const [users, customRoles] = await Promise.all([readConfig('users'), readConfig('roles')]);
    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) return reply.status(401).send({ error: 'Invalid credentials' });
    const user = users[userIndex]!;
    if (!user.totpEnabled || !user.totpSecret) {
      return reply.status(400).send({ error: '2FA is not enabled for this user' });
    }

    let verified = false;

    if (totpToken) {
      verified = verifyTotp(user.totpSecret, totpToken);
    } else if (backupCode) {
      const hash = hashBackupCode(backupCode);
      const idx = (user.backupCodes ?? []).indexOf(hash);
      if (idx !== -1) {
        // Consume the backup code (one-time use)
        const newCodes = [...(user.backupCodes ?? [])];
        newCodes.splice(idx, 1);
        users[userIndex] = { ...user, backupCodes: newCodes };
        await writeConfig('users', users);
        verified = true;
      }
    }

    if (!verified) return reply.status(401).send({ error: 'Invalid 2FA code' });

    const allRoles = getEffectiveRoles(customRoles);
    const permissions = resolvePermissions(user.roleId, allRoles);
    const sessionToken = createSessionToken(user.id, user.roleId);
    const refreshToken = generateRawToken(40);
    users[userIndex] = { ...(users[userIndex]!), refreshTokenHash: hashToken(refreshToken) };
    await writeConfig('users', users);
    return reply.send({ token: sessionToken, refreshToken, user: { id: user.id, email: user.email, role: user.roleId, permissions, totpEnabled: true } });
  });

  // ─── POST /api/auth/refresh ─────────────────────────────────────────────────
  fastify.post<{ Body: { refreshToken?: string } }>('/api/auth/refresh', async (req, reply) => {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) return reply.status(401).send({ error: 'Refresh token required' });

    const [users, customRoles] = await Promise.all([readConfig('users'), readConfig('roles')]);
    const userIndex = users.findIndex(u => u.refreshTokenHash === hashToken(refreshToken));
    if (userIndex === -1) return reply.status(401).send({ error: 'Invalid refresh token' });

    const user = users[userIndex]!;
    const allRoles = getEffectiveRoles(customRoles);
    const permissions = resolvePermissions(user.roleId, allRoles);
    const token = createSessionToken(user.id, user.roleId);

    // Rotate refresh token: issue a new one and invalidate the old
    const newRefreshToken = generateRawToken(40);
    users[userIndex] = { ...user, refreshTokenHash: hashToken(newRefreshToken) };
    await writeConfig('users', users);

    return reply.send({ token, refreshToken: newRefreshToken, user: { id: user.id, email: user.email, role: user.roleId, permissions } });
  });

  // ─── POST /api/auth/2fa/setup ────────────────────────────────────────────────
  fastify.post('/api/auth/2fa/setup', async (req, reply) => {
    const userId = req.dashUser!.id;
    const users = await readConfig('users');
    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) return reply.status(404).send({ error: 'User not found' });
    const user = users[userIndex]!;

    const secret = generateTotpSecret();
    const { plain, hashed } = generateBackupCodes();
    const qrUrl = `otpauth://totp/Routerly:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Routerly`;

    // Store secret and hashed backup codes — NOT enabled yet (requires confirm)
    users[userIndex] = { ...user, totpSecret: secret, backupCodes: hashed, totpEnabled: false };
    await writeConfig('users', users);

    return reply.send({ secret, qrUrl, backupCodes: plain });
  });

  // ─── POST /api/auth/2fa/confirm ──────────────────────────────────────────────
  fastify.post<{ Body: { token: string } }>('/api/auth/2fa/confirm', async (req, reply) => {
    const userId = req.dashUser!.id;
    const { token: totpToken } = req.body;
    if (!totpToken) return reply.status(400).send({ error: 'token is required' });

    const users = await readConfig('users');
    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) return reply.status(404).send({ error: 'User not found' });
    const user = users[userIndex]!;

    if (!user.totpSecret) return reply.status(400).send({ error: '2FA setup not started — call /api/auth/2fa/setup first' });
    if (!verifyTotp(user.totpSecret, totpToken)) return reply.status(400).send({ error: 'Invalid TOTP code' });

    users[userIndex] = { ...user, totpEnabled: true };
    await writeConfig('users', users);
    return reply.send({ ok: true });
  });

  // ─── POST /api/auth/2fa/disable ──────────────────────────────────────────────
  fastify.post<{ Body: { token?: string; backupCode?: string } }>('/api/auth/2fa/disable', async (req, reply) => {
    const userId = req.dashUser!.id;
    const { token: totpToken, backupCode } = req.body;
    if (!totpToken && !backupCode) return reply.status(400).send({ error: 'token or backupCode is required' });

    const users = await readConfig('users');
    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) return reply.status(404).send({ error: 'User not found' });
    const user = users[userIndex]!;

    if (!user.totpEnabled || !user.totpSecret) return reply.status(400).send({ error: '2FA is not enabled' });

    let verified = false;
    if (totpToken) {
      verified = verifyTotp(user.totpSecret, totpToken);
    } else if (backupCode) {
      const hash = hashBackupCode(backupCode);
      verified = (user.backupCodes ?? []).includes(hash);
    }
    if (!verified) return reply.status(401).send({ error: 'Invalid code' });

    const { totpSecret: _s, totpEnabled: _e, backupCodes: _b, ...rest } = user;
    users[userIndex] = rest;
    await writeConfig('users', users);
    return reply.send({ ok: true });
  });

  // ─── GET /api/auth/2fa/backup-codes ─────────────────────────────────────────
  fastify.post<{ Body: { token: string } }>('/api/auth/2fa/backup-codes', async (req, reply) => {
    const userId = req.dashUser!.id;
    const { token: totpToken } = req.body;
    if (!totpToken) return reply.status(400).send({ error: 'token is required' });

    const users = await readConfig('users');
    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) return reply.status(404).send({ error: 'User not found' });
    const user = users[userIndex]!;

    if (!user.totpEnabled || !user.totpSecret) return reply.status(400).send({ error: '2FA is not enabled' });
    if (!verifyTotp(user.totpSecret, totpToken)) return reply.status(401).send({ error: 'Invalid TOTP code' });

    const { plain, hashed } = generateBackupCodes();
    users[userIndex] = { ...user, backupCodes: hashed };
    await writeConfig('users', users);
    return reply.send({ backupCodes: plain });
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
      passwordHash: await hashPassword(password),
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
    if (req.url === '/api/auth/refresh') return;
    if (req.url === '/api/auth/2fa/verify') return;
    if (req.url.startsWith('/api/setup/')) return;
    if (req.url === '/api/system/info') return;

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const jwtToken = authHeader.slice(7);
    const payload = verifyToken(jwtToken);
    if (!payload) return reply.status(401).send({ error: 'Unauthorized' });

    const userId = payload['sub'] as string;
    const [users, customRoles] = await Promise.all([readConfig('users'), readConfig('roles')]);
    const user = users.find(u => u.id === userId);
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });

    const allRoles = getEffectiveRoles(customRoles);
    req.dashUser = { id: userId, email: user.email, roleId: user.roleId, permissions: resolvePermissions(user.roleId, allRoles) };
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // MODELS
  // ══════════════════════════════════════════════════════════════════════════════

  fastify.get('/api/models', async (_req, reply) => {
    const models = await readConfig('models');
    // Strip secrets before sending to client (use /api/models/:id/apikey to retrieve)
    return reply.send(models.map(m => ({ ...m, apiKey: undefined, cfClearance: undefined })));
  });

  fastify.post<{
    Body: {
      id: string; name?: string; provider: string; endpoint: string;
      apiKey?: string; cfClearance?: string; cloneFrom?: string; upstreamModelId?: string;
      inputPerMillion: number; outputPerMillion: number;
      cachePerMillion?: number;
      contextWindow?: number;
      pricingTiers?: PricingTier[];
      limits?: Limit[];
      capabilities?: ModelCapabilities;
      fieldOverrides?: Partial<Record<string, boolean>>;
      /** @deprecated use limits */ dailyBudget?: number;
      /** @deprecated use limits */ weeklyBudget?: number;
      /** @deprecated use limits */ monthlyBudget?: number;
    }
  }>('/api/models', async (req, reply) => {
    if (!requirePerm(req, 'model:write', reply)) return;
    const models = await readConfig('models');
    if (models.find(m => m.id === req.body.id)) {
      return reply.status(409).send({ error: `Model "${req.body.id}" already exists` });
    }

    // Resolve limits: prefer new limits array, fall back to legacy budget fields
    const resolvedLimits: Limit[] | undefined = req.body.limits?.length
      ? req.body.limits
      : (req.body.dailyBudget !== undefined || req.body.weeklyBudget !== undefined || req.body.monthlyBudget !== undefined)
        ? [
          ...(req.body.dailyBudget   !== undefined ? [{ metric: 'cost' as const, windowType: 'period' as const, period: 'daily'   as const, value: req.body.dailyBudget   }] : []),
          ...(req.body.weeklyBudget  !== undefined ? [{ metric: 'cost' as const, windowType: 'period' as const, period: 'weekly'  as const, value: req.body.weeklyBudget  }] : []),
          ...(req.body.monthlyBudget !== undefined ? [{ metric: 'cost' as const, windowType: 'period' as const, period: 'monthly' as const, value: req.body.monthlyBudget }] : []),
        ]
        : undefined;

    const model: ModelConfig = {
      id: req.body.id,
      name: req.body.name ?? req.body.id,
      provider: req.body.provider as Provider,
      endpoint: req.body.endpoint,
      apiKey: req.body.apiKey
        ? req.body.apiKey
        : req.body.cloneFrom
          ? (models.find(m => m.id === req.body.cloneFrom)?.apiKey ?? undefined)
          : undefined,
      cfClearance: req.body.cfClearance
        ? req.body.cfClearance
        : req.body.cloneFrom
          ? (models.find(m => m.id === req.body.cloneFrom)?.cfClearance ?? undefined)
          : undefined,
      cost: {
        inputPerMillion: req.body.inputPerMillion,
        outputPerMillion: req.body.outputPerMillion,
        ...(req.body.cachePerMillion !== undefined ? { cachePerMillion: req.body.cachePerMillion } : {}),
        ...(req.body.pricingTiers?.length ? { pricingTiers: req.body.pricingTiers } : {}),
      },
      ...(resolvedLimits?.length ? { limits: resolvedLimits } : {}),
      ...(req.body.contextWindow !== undefined ? { contextWindow: req.body.contextWindow } : {}),
      ...(req.body.upstreamModelId ? { upstreamModelId: req.body.upstreamModelId } : {}),
      ...(req.body.capabilities ? { capabilities: req.body.capabilities } : {}),
      ...(req.body.fieldOverrides ? { fieldOverrides: req.body.fieldOverrides } : {}),
    };
    models.push(model);
    await writeConfig('models', models);
    void emitEvent('config.model_added', 'info', { modelId: model.id, provider: model.provider }, { log: req.log });
    audit(req, 'model:create', 'success', { id: model.id });
    return reply.status(201).send({ ...model, apiKey: undefined, cfClearance: undefined });
  });

  fastify.put<{
    Params: { id: string };
    Body: {
      id?: string;
      name?: string; provider: string; endpoint: string;
      apiKey?: string; cfClearance?: string; upstreamModelId?: string;
      inputPerMillion: number; outputPerMillion: number;
      cachePerMillion?: number;
      contextWindow?: number;
      pricingTiers?: PricingTier[];
      limits?: Limit[];
      capabilities?: ModelCapabilities;
      fieldOverrides?: Partial<Record<string, boolean>>;
      /** @deprecated use limits */ dailyBudget?: number;
      /** @deprecated use limits */ weeklyBudget?: number;
      /** @deprecated use limits */ monthlyBudget?: number;
    }
  }>('/api/models/:id', async (req, reply) => {
    if (!requirePerm(req, 'model:write', reply)) return;
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

    // Resolve limits: prefer new limits array, fall back to legacy budget fields
    const resolvedLimits: Limit[] | undefined = req.body.limits?.length
      ? req.body.limits
      : (req.body.dailyBudget !== undefined || req.body.weeklyBudget !== undefined || req.body.monthlyBudget !== undefined)
        ? [
          ...(req.body.dailyBudget   !== undefined ? [{ metric: 'cost' as const, windowType: 'period' as const, period: 'daily'   as const, value: req.body.dailyBudget   }] : []),
          ...(req.body.weeklyBudget  !== undefined ? [{ metric: 'cost' as const, windowType: 'period' as const, period: 'weekly'  as const, value: req.body.weeklyBudget  }] : []),
          ...(req.body.monthlyBudget !== undefined ? [{ metric: 'cost' as const, windowType: 'period' as const, period: 'monthly' as const, value: req.body.monthlyBudget }] : []),
        ]
        : undefined;

    const { limits: _existingLimits, upstreamModelId: _existingUpstreamModelId, ...existingWithoutLimits } = existing;
    const model: ModelConfig = {
      ...existingWithoutLimits,
      id: newId,
      name: req.body.name ?? existing.name,
      provider: req.body.provider as Provider,
      endpoint: req.body.endpoint,
      apiKey: req.body.apiKey ? req.body.apiKey : existing.apiKey,
      cfClearance: req.body.cfClearance ? req.body.cfClearance : existing.cfClearance,
      cost: {
        inputPerMillion: req.body.inputPerMillion,
        outputPerMillion: req.body.outputPerMillion,
        ...(req.body.cachePerMillion !== undefined ? { cachePerMillion: req.body.cachePerMillion } : {}),
        ...(req.body.pricingTiers?.length ? { pricingTiers: req.body.pricingTiers } : {}),
      },
      // clear legacy field when updating
      globalThresholds: undefined,
      ...(req.body.contextWindow !== undefined ? { contextWindow: req.body.contextWindow } : existing.contextWindow !== undefined ? { contextWindow: existing.contextWindow } : {}),
      ...(resolvedLimits?.length ? { limits: resolvedLimits } : {}),
      // upstreamModelId: if explicitly provided keep it, if empty string clear it, if absent keep existing
      ...(req.body.upstreamModelId
        ? { upstreamModelId: req.body.upstreamModelId }
        : req.body.upstreamModelId === undefined && _existingUpstreamModelId !== undefined
          ? { upstreamModelId: _existingUpstreamModelId }
          : {}),
      // capabilities: if provided in body use it; if absent clear (unchecking the checkbox removes it)
      ...(req.body.capabilities ? { capabilities: req.body.capabilities } : {}),
      ...(req.body.fieldOverrides !== undefined
        ? { fieldOverrides: req.body.fieldOverrides }
        : existing.fieldOverrides !== undefined ? { fieldOverrides: existing.fieldOverrides } : {}),
      ...(existing.catalogDefaults !== undefined ? { catalogDefaults: existing.catalogDefaults } : {}),
    };
    models[index] = model;
    await writeConfig('models', models);

    // If the model ID changed, cascade the rename to all project references
    if (newId !== req.params.id) {
      const projects = await readConfig('projects');
      let projectsChanged = false;
      for (const project of projects) {
        for (const ref of (project.models ?? [])) {
          if (ref.modelId === req.params.id) {
            ref.modelId = newId;
            projectsChanged = true;
          }
        }
        for (const token of (project.tokens ?? [])) {
          for (const ref of (token.models ?? [])) {
            if (ref.modelId === req.params.id) {
              ref.modelId = newId;
              projectsChanged = true;
            }
          }
        }
      }
      if (projectsChanged) {
        await writeConfig('projects', projects);
      }
    }

    audit(req, 'model:update', 'success', { id: req.params.id });
    return reply.send({ ...model, apiKey: undefined, cfClearance: undefined });
  });

  fastify.get<{ Params: { id: string } }>('/api/models/:id/apikey', async (req, reply) => {
    if (!requirePerm(req, 'model:write', reply)) return;
    const models = await readConfig('models');
    const model = models.find(m => m.id === req.params.id);
    if (!model) return reply.status(404).send({ error: 'Not found' });
    return reply.send({ apiKey: model.apiKey ?? null });
  });

  fastify.post<{ Params: { id: string } }>('/api/models/:id/test', async (req, reply) => {
    if (!requirePerm(req, 'model:read', reply)) return;
    const models = await readConfig('models');
    const model = models.find((m: { id: string }) => m.id === req.params.id);
    if (!model) return reply.status(404).send({ error: 'Not found' });
    const t0 = Date.now();
    try {
      const adapter = getProviderAdapter(model);
      await adapter.chatCompletion({ model: model.id, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }, model);
      return reply.send({ ok: true, latencyMs: Date.now() - t0 });
    } catch (err) {
      return reply.send({ ok: false, latencyMs: Date.now() - t0, error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/api/models/:id', async (req, reply) => {
    if (!requirePerm(req, 'model:write', reply)) return;
    const models = await readConfig('models');
    const filtered = models.filter(m => m.id !== req.params.id);
    if (filtered.length === models.length) return reply.status(404).send({ error: 'Not found' });
    await writeConfig('models', filtered);
    void emitEvent('config.model_deleted', 'info', { modelId: req.params.id }, { log: req.log });
    audit(req, 'model:delete', 'success', { id: req.params.id });
    return reply.status(204).send();
  });

  // ── Model catalog (dynamic, cross-referenced with configured models) ─────────
  fastify.get('/api/models/catalog', async (req, reply) => {
    if (!requirePerm(req, 'model:read', reply)) return;
    const [catalog, configured] = await Promise.all([
      catalogFetcher.get(pkgVersion),
      readConfig('models'),
    ]);
    // Configured IDs use "provider/modelId" format; strip prefix for catalog lookup
    const configuredIds = new Set(configured.map((m: { id: string }) =>
      m.id.includes('/') ? m.id.split('/').slice(1).join('/') : m.id
    ));
    const entries = Object.entries(catalog).flatMap(([providerKey, providerData]) =>
      providerData.models
        .filter(m => !m.deprecated)
        .map(m => ({
          id: m.id,
          provider: providerKey,
          name: m.notes ?? m.id,
          contextWindow: m.contextWindow ?? 0,
          pricing: {
            inputPer1kTokens: m.input / 1000,
            outputPer1kTokens: m.output / 1000,
          },
          local: providerKey === 'ollama',
          embedding: m.capabilities?.embedding === true,
          isConfigured: configuredIds.has(m.id),
        }))
    );
    return reply.send(entries);
  });

  fastify.get('/api/providers', async (req, reply) => {
    if (!requirePerm(req, 'model:read', reply)) return;
    const catalog = await catalogFetcher.get(pkgVersion);
    return reply.send(catalog);
  });

  fastify.post('/api/catalog/refresh', async (req, reply) => {
    if (!requirePerm(req, 'settings:write', reply)) return;
    catalogFetcher.invalidate();
    try { await catalogFetcher.get(pkgVersion); } catch { /* best-effort */ }
    await syncModelsFromCatalog(pkgVersion).catch(() => {});
    audit(req, 'catalog:refresh', 'success');
    return reply.send(catalogFetcher.getStatus());
  });

  fastify.get('/api/catalog/status', async (req, reply) => {
    if (!requirePerm(req, 'settings:read', reply)) return;
    const current = catalogFetcher.getStatus();
    if (current.length > 0 && current.every(s => s.lastChecked === null && s.enabled !== false)) {
      try { await catalogFetcher.get(pkgVersion); } catch { /* best-effort */ }
      await syncModelsFromCatalog(pkgVersion).catch(() => {});
    }
    return reply.send(catalogFetcher.getStatus());
  });

  fastify.get('/api/catalog/probe', async (req, reply) => {
    if (!requirePerm(req, 'settings:write', reply)) return;
    const url = (req.query as { url?: string }).url;
    if (!url) return reply.status(400).send({ error: 'url required' });
    try {
      const base = url.endsWith('/') ? url : url + '/';
      const res = await fetch(base + 'index.json');
      if (!res.ok) return reply.send({ ok: false, error: `index.json: HTTP ${res.status}` });
      await res.json();
      return reply.send({ ok: true });
    } catch (e) {
      return reply.send({ ok: false, error: (e as Error).message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // PROJECTS
  // ══════════════════════════════════════════════════════════════════════════════

  fastify.get('/api/projects', async (_req, reply) => {
    const projects = await readConfig('projects');
    // Strip the full token; clients use tokenSnippet for display
    return reply.send(projects.map(p => ({
      ...p,
      tokens: p.tokens?.map(t => ({ ...t, token: undefined })) || []
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
      guardrails?: GuardrailConfig;
      pii?: PiiConfig;
    }
  }>('/api/projects', async (req, reply) => {
    if (!requirePerm(req, 'project:write', reply)) return;
    const projects = await readConfig('projects');
    const trimmedName = req.body.name.trim();
    if (!trimmedName) return reply.status(400).send({ error: 'Project name cannot be empty' });
    if (projects.some(p => p.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
      return reply.status(409).send({ error: `A project named "${trimmedName}" already exists` });
    }
    let guardrails: GuardrailConfig | undefined;
    if (req.body.guardrails !== undefined) {
      const parsed = guardrailConfigSchema.safeParse(req.body.guardrails);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid guardrails config', details: parsed.error.issues });
      guardrails = parsed.data as GuardrailConfig;
    }
    let pii: PiiConfig | undefined;
    if (req.body.pii !== undefined) {
      const parsed = piiConfigSchema.safeParse(req.body.pii);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid pii config', details: parsed.error.issues });
      pii = parsed.data as PiiConfig;
    }

    const rawToken = `sk-rt-${randomBytes(32).toString('hex')}`;
    const userId = req.dashUser!.id;

    const project: ProjectConfig = {
      id: uuidv4(),
      name: trimmedName,
      tokens: [{
        id: uuidv4(),
        token: rawToken,
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
      timeoutMs: req.body.timeoutMs ?? 5000,
      ...(guardrails ? { guardrails } : {}),
      ...(pii ? { pii } : {}),
    };
    projects.push(project);
    await writeConfig('projects', projects);
    void emitEvent('config.project_created', 'info', { projectId: project.id, name: project.name }, { projectId: project.id, log: req.log });
    audit(req, 'project:create', 'success', { id: project.id });
    return reply.status(201).send({ ...project, token: rawToken });
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
      guardrails?: GuardrailConfig | null;
      pii?: PiiConfig | null;
    };
  }>('/api/projects/:id', async (req, reply) => {
    if (!requirePerm(req, 'project:write', reply)) return;
    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Not found' });
    const trimmedName = req.body.name.trim();
    if (!trimmedName) return reply.status(400).send({ error: 'Project name cannot be empty' });
    if (projects.some(p => p.id !== req.params.id && p.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
      return reply.status(409).send({ error: `A project named "${trimmedName}" already exists` });
    }
    // Guardrails/PII: undefined = leave unchanged, null = clear, object = validate & set.
    let guardrailsUpdate: { guardrails?: GuardrailConfig } = {};
    if (req.body.guardrails === null) {
      guardrailsUpdate = {};
    } else if (req.body.guardrails !== undefined) {
      const parsed = guardrailConfigSchema.safeParse(req.body.guardrails);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid guardrails config', details: parsed.error.issues });
      guardrailsUpdate = { guardrails: parsed.data as GuardrailConfig };
    } else if (projects[index]!.guardrails) {
      guardrailsUpdate = { guardrails: projects[index]!.guardrails };
    }
    let piiUpdate: { pii?: PiiConfig } = {};
    if (req.body.pii === null) {
      piiUpdate = {};
    } else if (req.body.pii !== undefined) {
      const parsed = piiConfigSchema.safeParse(req.body.pii);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid pii config', details: parsed.error.issues });
      piiUpdate = { pii: parsed.data as PiiConfig };
    } else if (projects[index]!.pii) {
      piiUpdate = { pii: projects[index]!.pii };
    }

    const { guardrails: _g, pii: _p, notifications: _n, ...existing } = projects[index]!;
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
      timeoutMs: req.body.timeoutMs ?? existing.timeoutMs ?? 5000,
      ...guardrailsUpdate,
      ...piiUpdate,
    };
    projects[index] = updated;
    await writeConfig('projects', projects);
    audit(req, 'project:update', 'success', { id: req.params.id });
    return reply.send({
      ...updated,
      tokens: updated.tokens?.map(t => ({ ...t, token: undefined })) || []
    });
  });

  fastify.patch<{
    Params: { id: string };
    Body: { guardrails?: GuardrailConfig; pii?: PiiConfig };
  }>('/api/projects/:id/guardrails', async (req, reply) => {
    if (!requirePerm(req, 'project:write', reply)) return;
    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Not found' });
    const project = projects[index]!;
    let guardrailsUpdate: { guardrails?: GuardrailConfig } = project.guardrails ? { guardrails: project.guardrails } : {};
    let piiUpdate: { pii?: PiiConfig } = project.pii ? { pii: project.pii } : {};
    if (req.body.guardrails !== undefined) {
      const parsed = guardrailConfigSchema.safeParse(req.body.guardrails);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid guardrails config', details: parsed.error.issues });
      guardrailsUpdate = { guardrails: parsed.data as GuardrailConfig };
    }
    if (req.body.pii !== undefined) {
      const parsed = piiConfigSchema.safeParse(req.body.pii);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid pii config', details: parsed.error.issues });
      piiUpdate = { pii: parsed.data as PiiConfig };
    }
    const updated: ProjectConfig = { ...project, ...guardrailsUpdate, ...piiUpdate };
    projects[index] = updated;
    await writeConfig('projects', projects);
    audit(req, 'project:update', 'success', { id: req.params.id });
    return reply.send({ ...updated, tokens: updated.tokens?.map(t => ({ ...t, token: undefined })) || [] });
  });

  fastify.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    if (!requirePerm(req, 'project:write', reply)) return;
    const projects = await readConfig('projects');
    const deleted = projects.find(p => p.id === req.params.id);
    const filtered = projects.filter(p => p.id !== req.params.id);
    if (filtered.length === projects.length) return reply.status(404).send({ error: 'Not found' });
    await writeConfig('projects', filtered);
    void emitEvent('config.project_deleted', 'info', { projectId: req.params.id, name: deleted?.name }, { log: req.log });
    audit(req, 'project:delete', 'success', { id: req.params.id });
    return reply.status(204).send();
  });

  const tagsSchema = z.record(z.string().max(128), z.string().max(512))
    .optional()
    .superRefine((val, ctx) => {
      if (val && Object.keys(val).length > 50) {
        ctx.addIssue({ code: 'custom', message: 'tags: maximum 50 entries' });
      }
    });

  const createTokenBodySchema = z.object({
    labels: z.array(z.string()).optional(),
    tags: tagsSchema,
    expiresAt: z.string().datetime({ offset: true }).refine(
      v => new Date(v) > new Date(),
      { message: 'expiresAt must be in the future' }
    ).optional(),
  });

  const updateTokenBodySchema = z.object({
    models: z.array(z.object({
      modelId: z.string(),
      limits: z.array(z.any()).optional(),
    })).optional(),
    labels: z.array(z.string()).optional(),
    tags: tagsSchema,
  });

  fastify.post<{ Params: { id: string }, Body: { labels?: string[]; tags?: Record<string, string>; expiresAt?: string } }>('/api/projects/:id/tokens', async (req, reply) => {
    if (!requirePerm(req, 'project:write', reply)) return;

    const parsed = createTokenBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Not found' });

    const rawToken = `sk-rt-${randomBytes(32).toString('hex')}`;

    const newToken = {
      id: uuidv4(),
      token: rawToken,
      tokenSnippet: rawToken.substring(0, 10),
      createdAt: new Date().toISOString(),
      ...(parsed.data.labels ? { labels: parsed.data.labels } : {}),
      ...(parsed.data.tags ? { tags: parsed.data.tags } : {}),
      ...(parsed.data.expiresAt ? { expiresAt: parsed.data.expiresAt } : {}),
    };

    const updated = { ...projects[index]! };
    if (!updated.tokens) updated.tokens = [];
    updated.tokens.push(newToken);

    projects[index] = updated;
    await writeConfig('projects', projects);
    audit(req, 'token:create', 'success', { projectId: req.params.id });
    return reply.send({ token: rawToken, tokenInfo: { ...newToken, token: undefined } });
  });

  fastify.put<{ Params: { id: string, tokenId: string }; Body: { models?: TokenModelRef[], labels?: string[], tags?: Record<string, string> } }>('/api/projects/:id/tokens/:tokenId', async (req, reply) => {
    if (!requirePerm(req, 'project:write', reply)) return;

    const parsed = updateTokenBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Project not found' });

    const project = projects[index]!;
    if (!project.tokens) return reply.status(404).send({ error: 'Token not found' });

    const token = project.tokens.find(t => t.id === req.params.tokenId);
    if (!token) return reply.status(404).send({ error: 'Token not found' });

    if (parsed.data.models !== undefined) token.models = parsed.data.models as TokenModelRef[];
    if (parsed.data.labels !== undefined) token.labels = parsed.data.labels;
    if (parsed.data.tags !== undefined) token.tags = parsed.data.tags;
    await writeConfig('projects', projects);

    return reply.send({ ...token, token: undefined });
  });

  fastify.delete<{ Params: { id: string, tokenId: string } }>('/api/projects/:id/tokens/:tokenId', async (req, reply) => {
    if (!requirePerm(req, 'project:write', reply)) return;
    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Project not found' });

    const project = projects[index]!;
    if (!project.tokens) return reply.status(404).send({ error: 'Token not found' });

    const tokenIndex = project.tokens.findIndex(t => t.id === req.params.tokenId);
    if (tokenIndex === -1) return reply.status(404).send({ error: 'Token not found' });

    project.tokens.splice(tokenIndex, 1);
    await writeConfig('projects', projects);
    audit(req, 'token:delete', 'success', { projectId: req.params.id, tokenId: req.params.tokenId });
    return reply.status(204).send();
  });

  fastify.post<{ Params: { id: string }; Body: { userId: string; role: string } }>('/api/projects/:id/members', async (req, reply) => {
    if (!requirePerm(req, 'project:write', reply)) return;
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
    if (!requirePerm(req, 'project:write', reply)) return;
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
    if (!requirePerm(req, 'project:write', reply)) return;
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

  // ── Playground presets (#99) ──────────────────────────────────────────────

  fastify.get<{ Params: { id: string } }>('/api/projects/:id/playground-presets', async (req, reply) => {
    if (!requirePerm(req, 'project:read', reply)) return;
    const projects = await readConfig('projects');
    const project = projects.find(p => p.id === req.params.id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    return reply.send(project.playgroundPresets ?? []);
  });

  fastify.post<{
    Params: { id: string };
    Body: { name: string; systemPrompt: string; messages?: Array<{ role: 'user' | 'assistant'; content: string }> };
  }>('/api/projects/:id/playground-presets', async (req, reply) => {
    if (!requirePerm(req, 'project:write', reply)) return;
    const { name, systemPrompt, messages } = req.body;
    if (!name?.trim()) return reply.status(400).send({ error: 'name is required' });
    if (systemPrompt === undefined) return reply.status(400).send({ error: 'systemPrompt is required' });
    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Project not found' });
    const preset = { id: randomUUID(), name: name.trim(), systemPrompt, ...(messages ? { messages } : {}) };
    const project = projects[index]!;
    project.playgroundPresets = [...(project.playgroundPresets ?? []), preset];
    await writeConfig('projects', projects);
    return reply.status(201).send(preset);
  });

  fastify.delete<{ Params: { id: string; presetId: string } }>('/api/projects/:id/playground-presets/:presetId', async (req, reply) => {
    if (!requirePerm(req, 'project:write', reply)) return;
    const projects = await readConfig('projects');
    const index = projects.findIndex(p => p.id === req.params.id);
    if (index === -1) return reply.status(404).send({ error: 'Project not found' });
    const project = projects[index]!;
    const before = (project.playgroundPresets ?? []).length;
    project.playgroundPresets = (project.playgroundPresets ?? []).filter(p => p.id !== req.params.presetId);
    if (project.playgroundPresets.length === before) return reply.status(404).send({ error: 'Preset not found' });
    await writeConfig('projects', projects);
    return reply.status(204).send();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // CURRENT USER (me)
  // ══════════════════════════════════════════════════════════════════════════════

  fastify.get('/api/me', async (req, reply) => {
    const userId = req.dashUser!.id;
    const users = await readConfig('users');
    const user = users.find(u => u.id === userId);
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return reply.send({ id: user.id, email: user.email, roleId: user.roleId });
  });

  fastify.put<{
    Body: { currentPassword: string; newEmail?: string; newPassword?: string };
  }>('/api/me', async (req, reply) => {
    const userId = req.dashUser!.id;
    const { currentPassword, newEmail, newPassword } = req.body;
    if (!currentPassword) return reply.status(400).send({ error: 'Current password is required' });
    const users = await readConfig('users');
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return reply.status(404).send({ error: 'User not found' });
    const user = users[idx]!;
    const { ok: pwOk } = await verifyPassword(currentPassword, user.passwordHash);
    if (!pwOk) return reply.status(401).send({ error: 'Current password is incorrect' });
    if (newEmail && newEmail !== user.email) {
      if (users.find(u => u.email === newEmail)) {
        return reply.status(409).send({ error: 'Email already in use' });
      }
      users[idx] = { ...user, email: newEmail };
    }
    if (newPassword) {
      if (newPassword.length < 8) return reply.status(400).send({ error: 'Password must be at least 8 characters' });
      users[idx] = { ...users[idx]!, passwordHash: await hashPassword(newPassword) };
    }
    await writeConfig('users', users);
    const updated = users[idx]!;
    return reply.send({ id: updated.id, email: updated.email, roleId: updated.roleId });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // USERS
  // ══════════════════════════════════════════════════════════════════════════════

  fastify.get('/api/users', async (req, reply) => {
    if (!requirePerm(req, 'user:read', reply)) return;
    const users = await readConfig('users');
    return reply.send(users.map(u => ({ ...u, passwordHash: undefined })));
  });

  fastify.post<{
    Body: { email: string; password: string; roleId?: string; projectIds?: string[] }
  }>('/api/users', async (req, reply) => {
    if (!requirePerm(req, 'user:write', reply)) return;
    const users = await readConfig('users');
    if (users.find(u => u.email === req.body.email)) {
      return reply.status(409).send({ error: 'Email already exists' });
    }
    const user: UserConfig = {
      id: uuidv4(),
      email: req.body.email,
      passwordHash: await hashPassword(req.body.password),
      roleId: req.body.roleId ?? 'viewer',
      projectIds: req.body.projectIds ?? [],
    };
    users.push(user);
    await writeConfig('users', users);
    audit(req, 'user:create', 'success', { email: user.email });
    return reply.status(201).send({ ...user, passwordHash: undefined });
  });

  fastify.put<{
    Params: { id: string };
    Body: { email?: string; roleId?: string; newPassword?: string };
  }>('/api/users/:id', async (req, reply) => {
    if (!requirePerm(req, 'user:write', reply)) return;
    const users = await readConfig('users');
    const idx = users.findIndex(u => u.id === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: 'User not found' });
    const user = users[idx]!;
    const { email, roleId, newPassword } = req.body;
    if (email && email !== user.email) {
      if (users.find(u => u.email === email)) return reply.status(409).send({ error: 'Email already in use' });
      users[idx] = { ...users[idx]!, email };
    }
    if (roleId) {
      // Ensure at least one admin remains
      const isLastAdmin = user.roleId === 'admin' && roleId !== 'admin' &&
        users.filter(u => u.roleId === 'admin').length === 1;
      if (isLastAdmin) {
        return reply.status(409).send({ error: 'Cannot change role: this is the last admin account' });
      }
      users[idx] = { ...users[idx]!, roleId };
    }
    if (newPassword) {
      if (newPassword.length < 8) return reply.status(400).send({ error: 'Password must be at least 8 characters' });
      users[idx] = { ...users[idx]!, passwordHash: await hashPassword(newPassword) };
    }
    await writeConfig('users', users);
    const updated = users[idx]!;
    audit(req, 'user:update', 'success', { id: req.params.id });
    return reply.send({ id: updated.id, email: updated.email, roleId: updated.roleId, projectIds: updated.projectIds });
  });

  fastify.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    if (!requirePerm(req, 'user:write', reply)) return;
    const users = await readConfig('users');
    const target = users.find(u => u.id === req.params.id);
    if (!target) return reply.status(404).send({ error: 'Not found' });
    // Ensure at least one admin remains
    if (target.roleId === 'admin' && users.filter(u => u.roleId === 'admin').length === 1) {
      return reply.status(409).send({ error: 'Cannot delete the last admin account' });
    }
    await writeConfig('users', users.filter(u => u.id !== req.params.id));
    audit(req, 'user:delete', 'success', { id: req.params.id });
    return reply.status(204).send();
  });

  // ─── POST /api/users/:id/2fa/reset ──────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/api/users/:id/2fa/reset', async (req, reply) => {
    if (!requirePerm(req, 'user:write', reply)) return;
    const users = await readConfig('users');
    const userIndex = users.findIndex(u => u.id === req.params.id);
    if (userIndex === -1) return reply.status(404).send({ error: 'User not found' });
    const user = users[userIndex]!;
    const { totpSecret: _s, totpEnabled: _e, backupCodes: _b, ...rest } = user;
    users[userIndex] = rest;
    await writeConfig('users', users);
    req.log.info({ adminId: req.dashUser!.id, targetUserId: req.params.id }, '2FA reset by admin');
    return reply.send({ ok: true });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // USAGE STATS
  // ══════════════════════════════════════════════════════════════════════════════

  fastify.get<{ Querystring: { period?: string; projectId?: string; projectIds?: string; modelIds?: string; callType?: string; outcome?: string; from?: string; to?: string; page?: string; pageSize?: string; endUserId?: string; sessionId?: string; [key: string]: string | undefined } }>('/api/usage', async (req, reply) => {
    if (!requirePerm(req, 'report:read', reply)) return;
    const records = await readConfig('usage');
    const { period = 'monthly', projectId, projectIds, modelIds, callType, outcome, from, to, endUserId, sessionId } = req.query;
    const page = Math.max(1, parseInt(req.query.page ?? '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize ?? '100', 10) || 100));
    // Parse tag filters: ?tag[customer]=acme
    const tagFilters: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query)) {
      const m = k.match(/^tag\[(.+)\]$/);
      if (m && v) tagFilters[m[1]!] = v;
    }

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
      if (from) {
        since = new Date(from);
        // Only normalize to day boundary for date-only strings (YYYY-MM-DD)
        if (from.length <= 10) since.setHours(0, 0, 0, 0);
      }
      if (to) {
        until = new Date(to);
        if (to.length <= 10) until.setHours(23, 59, 59, 999);
      }
    }

    let filtered = records.filter(r => {
      const ts = new Date(r.timestamp);
      return ts >= since && ts <= until;
    });
    if (projectId) filtered = filtered.filter(r => r.projectId === projectId);
    if (endUserId) filtered = filtered.filter(r => r.endUserId === endUserId);
    if (sessionId) filtered = filtered.filter(r => r.sessionId === sessionId);
    if (Object.keys(tagFilters).length > 0) {
      filtered = filtered.filter(r => r.tags && Object.entries(tagFilters).every(([k, v]) => r.tags![k] === v));
    }

    // Dashboard filters (multiselect + type/outcome) — applied to records, byModel, summary and timeline alike (#80).
    const csv = (s?: string) => (s ? new Set(s.split(',').map(v => v.trim()).filter(Boolean)) : null);
    const projectIdSet = csv(projectIds);
    if (projectIdSet) filtered = filtered.filter(r => projectIdSet.has(r.projectId));
    const modelIdSet = csv(modelIds);
    if (modelIdSet) filtered = filtered.filter(r => modelIdSet.has(r.modelId));
    if (callType && callType !== 'all') {
      // 'completion' covers legacy records that carry no callType.
      filtered = callType === 'completion'
        ? filtered.filter(r => r.callType !== 'routing' && r.callType !== 'guardrail')
        : filtered.filter(r => r.callType === callType);
    }
    if (outcome && outcome !== 'all') {
      // 'error' is any outcome that is neither success nor blocked.
      filtered = outcome === 'error'
        ? filtered.filter(r => r.outcome !== 'success' && r.outcome !== 'blocked')
        : filtered.filter(r => r.outcome === outcome);
    }

    // Aggregate by model. Latencies collected per model to derive avg + p95 (leaderboard metrics, #80).
    const byModelAcc: Record<string, Omit<UsageByModelEntry, 'avgLatencyMs' | 'p95LatencyMs'> & { latencies: number[] }> = {};
    for (const r of filtered) {
      const entry = byModelAcc[r.modelId] ?? { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cost: 0, errors: 0, success: 0, latencies: [] };
      entry.calls++;
      entry.inputTokens += r.inputTokens;
      entry.outputTokens += r.outputTokens;
      entry.cachedInputTokens += r.cachedInputTokens ?? 0;
      entry.cost += r.cost;
      if (r.outcome === 'success') entry.success++;
      // A guardrail-blocked request is neither a success nor a model error — exclude it from the error count (#77).
      if (r.outcome !== 'success' && r.outcome !== 'blocked') entry.errors++;
      if (typeof r.latencyMs === 'number') entry.latencies.push(r.latencyMs);
      byModelAcc[r.modelId] = entry;
    }
    const byModel: Record<string, UsageByModelEntry> = {};
    for (const [modelId, { latencies, ...rest }] of Object.entries(byModelAcc)) {
      const avgLatencyMs = latencies.length > 0 ? latencies.reduce((s, n) => s + n, 0) / latencies.length : 0;
      byModel[modelId] = { ...rest, avgLatencyMs, p95LatencyMs: p95(latencies) };
    }

    // Aggregate by callType — routing / guardrail / completion are distinct sub-activities (#77, BUG-5).
    // Records without callType default to completion (legacy data).
    const routingCalls = filtered.filter(r => r.callType === 'routing').length;
    const guardrailCalls = filtered.filter(r => r.callType === 'guardrail').length;
    const completionCalls = filtered.filter(r => r.callType !== 'routing' && r.callType !== 'guardrail').length;
    const succ = (r: typeof filtered[number]) => r.outcome === 'success';
    const routingCost = filtered.filter(r => r.callType === 'routing' && succ(r)).reduce((s, r) => s + r.cost, 0);
    const guardrailCost = filtered.filter(r => r.callType === 'guardrail' && succ(r)).reduce((s, r) => s + r.cost, 0);
    const completionCost = filtered.filter(r => r.callType !== 'routing' && r.callType !== 'guardrail' && succ(r)).reduce((s, r) => s + r.cost, 0);

    // Timeline for the selected period (hourly for daily, daily otherwise)
    const timeline: Record<string, number> = {};
    for (const r of filtered.filter(r => r.outcome === 'success')) {
      const key = period === 'daily' ? r.timestamp.slice(0, 13) : r.timestamp.slice(0, 10);
      timeline[key] = (timeline[key] ?? 0) + r.cost;
    }

    const totalCost = filtered.filter(r => r.outcome === 'success').reduce((s, r) => s + r.cost, 0);
    const totalCalls = filtered.length;
    const successCalls = filtered.filter(r => r.outcome === 'success').length;
    // Guardrail blocks are a distinct outcome — not a model error (#77).
    const blockedCalls = filtered.filter(r => r.outcome === 'blocked').length;

    // Paginate records (most recent first)
    const sorted = [...filtered].reverse();
    const totalRecords = sorted.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    const safePage = Math.min(page, totalPages);
    const startIdx = (safePage - 1) * pageSize;
    const paged = sorted.slice(startIdx, startIdx + pageSize);

    return reply.send({
      summary: { totalCost, totalCalls, successCalls, blockedCalls, errorCalls: totalCalls - successCalls - blockedCalls, routingCalls, completionCalls, guardrailCalls, routingCost, completionCost, guardrailCost },
      byModel,
      timeline: Object.entries(timeline).sort(([a], [b]) => a.localeCompare(b)).slice(-30),
      // Strip trace from list response to keep payload small
      records: paged.map(({ trace: _trace, ...r }) => r),
      pagination: { page: safePage, pageSize, totalRecords, totalPages },
    });
  });

  // ─── GET /api/usage/:id ────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/usage/:id', async (req, reply) => {    if (!requirePerm(req, 'report:read', reply)) return;    const records = await readConfig('usage');
    const record = records.find(r => r.id === req.params.id);
    if (!record) return reply.status(404).send({ error: 'Record not found' });
    return reply.send(record);
  });

  // ─── GET /api/sessions (#94) ──────────────────────────────────────────────
  fastify.get<{ Querystring: { projectId?: string; limit?: string; cursor?: string } }>('/api/sessions', async (req, reply) => {
    if (!requirePerm(req, 'report:read', reply)) return;
    const records = await readConfig('usage');
    const { projectId, limit: limitStr, cursor } = req.query;
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '20', 10) || 20));

    // Build session map from usage records
    const sessionMap = new Map<string, { sessionId: string; projectId: string; firstSeen: string; lastSeen: string; requests: number; totalCost: number; totalTokens: number }>();
    for (const r of records) {
      if (!r.sessionId) continue;
      if (projectId && r.projectId !== projectId) continue;
      const s = sessionMap.get(r.sessionId) ?? { sessionId: r.sessionId, projectId: r.projectId, firstSeen: r.timestamp, lastSeen: r.timestamp, requests: 0, totalCost: 0, totalTokens: 0 };
      s.requests++;
      s.totalCost += r.cost;
      s.totalTokens += r.inputTokens + r.outputTokens;
      if (r.timestamp < s.firstSeen) s.firstSeen = r.timestamp;
      if (r.timestamp > s.lastSeen) s.lastSeen = r.timestamp;
      sessionMap.set(r.sessionId, s);
    }

    const sessions = [...sessionMap.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    const startIdx = cursor ? sessions.findIndex(s => s.sessionId === cursor) + 1 : 0;
    const page = sessions.slice(startIdx, startIdx + limit);
    const nextCursor = page.length === limit ? page.at(-1)?.sessionId : undefined;
    return reply.send({ sessions: page, nextCursor });
  });

  // ─── GET /api/sessions/:id/requests (#94) ────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/sessions/:id/requests', async (req, reply) => {
    if (!requirePerm(req, 'report:read', reply)) return;
    const records = await readConfig('usage');
    const requests = records
      .filter(r => r.sessionId === req.params.id)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map(({ trace: _trace, ...r }) => r);
    return reply.send({ sessionId: req.params.id, requests });
  });

  // ─── GET /api/end-users (#96) ─────────────────────────────────────────────
  fastify.get<{ Querystring: { projectId?: string } }>('/api/end-users', async (req, reply) => {
    if (!requirePerm(req, 'report:read', reply)) return;
    const records = await readConfig('usage');
    const { projectId } = req.query;

    const userMap = new Map<string, { userId: string; projectId: string; firstSeen: string; lastSeen: string; requests: number; totalCost: number; totalTokens: number }>();
    for (const r of records) {
      if (!r.endUserId) continue;
      if (projectId && r.projectId !== projectId) continue;
      const u = userMap.get(r.endUserId) ?? { userId: r.endUserId, projectId: r.projectId, firstSeen: r.timestamp, lastSeen: r.timestamp, requests: 0, totalCost: 0, totalTokens: 0 };
      u.requests++;
      u.totalCost += r.cost;
      u.totalTokens += r.inputTokens + r.outputTokens;
      if (r.timestamp < u.firstSeen) u.firstSeen = r.timestamp;
      if (r.timestamp > u.lastSeen) u.lastSeen = r.timestamp;
      userMap.set(r.endUserId, u);
    }

    const users = [...userMap.values()].sort((a, b) => b.totalCost - a.totalCost);
    return reply.send({ users });
  });

  // ─── GET /api/system/info ───────────────────────────────────────────────────
  fastify.get('/api/system/info', async (_req, reply) => {
    const settings = await readConfig('settings');
    return reply.send({
      version: pkgVersion,
      nodeVersion: process.version,
      platform: process.platform,
      configDir: CONFIG_PATHS.config,
      dataDir: CONFIG_PATHS.data,
      uptimeSeconds: Math.floor(process.uptime()),
      channel: settings.channel ?? 'latest',
      isDocker: process.env['ROUTERLY_DOCKER'] === '1',
      updateInfo: updateChecker.getLastResult(),
    });
  });

  // ─── GET /api/system/releases ────────────────────────────────────────────
  fastify.get('/api/system/releases', async (req, reply) => {
    if (!req.dashUser) return reply.status(401).send({ error: 'Unauthorized' });
    return reply.send(await updateChecker.getAvailableReleases());
  });

  // ─── GET /api/system/update-check ───────────────────────────────────────
  fastify.get('/api/system/update-check', async (req, reply) => {
    if (!req.dashUser) return reply.status(401).send({ error: 'Unauthorized' });
    const result = await updateChecker.check();
    return reply.send(result);
  });

  // ─── POST /api/system/update ───────────────────────────────────────────
  fastify.post('/api/system/update', async (req, reply) => {
    if (!req.dashUser || req.dashUser.roleId !== 'admin') {
      return reply.status(403).send({ error: 'Admin only' });
    }
    if (process.env['ROUTERLY_DOCKER'] === '1') {
      return reply.status(403).send({ error: 'In-app update is not available in Docker. Pull the latest image instead.' });
    }
    if (process.platform === 'win32') {
      return reply.status(400).send({ error: 'In-app update is not supported on Windows. Run the installer manually.' });
    }
    const settings = await readConfig('settings');
    const channel = settings.channel ?? 'latest';
    const installCmd = `curl -fsSL https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/scripts/install.sh | bash -s -- --channel=${channel}`;
    const child = spawn('bash', ['-c', installCmd], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return reply.status(202).send({ message: 'Update started. The service will restart shortly.' });
  });

  // ─── GET /api/settings ─────────────────────────────────────────────────────
  fastify.get('/api/settings', async (req, reply) => {
    if (!requirePerm(req, 'settings:read', reply)) return;
    const settings = await readConfig('settings');
    const localAddresses = Object.values(networkInterfaces())
      .flat()
      .filter((n): n is NonNullable<typeof n> => n !== undefined && n.family === 'IPv4' && !n.internal)
      .map(n => n.address);
    return reply.send({ ...settings, localAddresses });
  });

  // ─── PUT /api/settings ─────────────────────────────────────────────────────
  fastify.put<{
    Body: Partial<Settings>;
  }>('/api/settings', async (req, reply) => {
    if (!requirePerm(req, 'settings:write', reply)) return;
    // Validate notifications config when present (U5: channels/events/targets).
    const notifPatch = (req.body as Partial<Settings>).notifications;
    if (notifPatch !== undefined) {
      const parsed = notificationsConfigSchema.safeParse(notifPatch);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]!.message });
      }
    }
    const providerReposPatch = (req.body as Partial<Settings>).providerRepos;
    if (providerReposPatch !== undefined) {
      const repoSchema = z.array(z.object({
        url: z.string().url(),
        channel: z.string().optional(),
        enabled: z.boolean(),
      }));
      const parsed = repoSchema.safeParse(providerReposPatch);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]!.message });
      }
    }
    const current = await readConfig('settings');
    const allowed: (keyof Settings)[] = [
      'defaultTimeoutMs',
      'logLevel',
      'dashboardEnabled',
      'notifications',
      'publicUrl',
      'channel',
      'requireMfa',
      'providerRepos',
    ];
    const updated = { ...current };
    for (const key of allowed) {
      if ((req.body as Partial<Settings>)[key] !== undefined) {
        (updated as any)[key] = (req.body as Partial<Settings>)[key];
      }
    }
    // Telemetry is handled separately: server controls installId generation
    const telemetryPatch = (req.body as Partial<Settings>).telemetry;
    if (telemetryPatch !== undefined) {
      const wasEnabled = current.telemetry?.enabled === true;
      if (telemetryPatch.enabled) {
        const installId = current.telemetry?.installId || randomUUID();
        updated.telemetry = {
          enabled: true,
          installId,
          lastPingedVersion: pkgVersion, // ponytail: marks current version as pinged, prevents double-install on next startup
        };
        if (!wasEnabled) pingTelemetry(installId, 'install');
      } else {
        updated.telemetry = { enabled: false, installId: current.telemetry?.installId ?? '' };
      }
    }
    await writeConfig('settings', updated);
    if ((req.body as Partial<Settings>).channel !== undefined) {
      updateChecker.updateChannel(updated.channel ?? 'latest');
    }
    if ((req.body as Partial<Settings>).providerRepos !== undefined) {
      catalogFetcher.setRepos((updated as Settings).providerRepos ?? []);
    }
    audit(req, 'settings:update', 'success');
    return reply.send(updated);
  });

  // ─── POST /api/notifications/test ─────────────────────────────────────────
  fastify.post<{ Body: { channelId: string; to: string } }>('/api/notifications/test', async (req, reply) => {
    if (!requirePerm(req, 'notification:write', reply)) return;
    const { channelId, to } = req.body;
    if (!channelId) return reply.status(400).send({ error: 'channelId is required' });

    const settings = await readConfig('settings');
    const channels  = ((settings.notifications?.channels ?? []) as unknown) as Array<{ id: string; provider: string; [k: string]: unknown }>;
    const channel   = channels.find(ch => ch.id === channelId);
    if (!channel) return reply.status(400).send({ error: `Channel "${channelId}" not found` });

    try {
      const recipient = resolveTestRecipient(channel.provider, to, req.dashUser!.email);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await sendTestNotification(channel as any, recipient, req.dashUser!.id);
      return reply.send(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.send({ ok: false, message: msg });
    }
  });

  // ─── GET /api/notifications/inbox ─────────────────────────────────────────
  // Per-user in-app notification inbox (#91). Available to any authenticated user.
  fastify.get<{ Querystring: { limit?: string; unreadOnly?: string; page?: string; pageSize?: string; severity?: string; event?: string; from?: string; to?: string } }>('/api/notifications/inbox', async (req, reply) => {
    const userId = req.dashUser!.id;
    const unreadOnly = req.query.unreadOnly === 'true';
    const [all, settings] = await Promise.all([
      readConfig('notifications'),
      readConfig('settings'),
    ]);
    // In-app inbox is opt-in: active only when a `dashboard`-provider channel exists.
    const channels = settings.notifications?.channels ?? [];
    const enabled = channels.some(c => c.provider === 'dashboard');
    // Per-user audience filter (U5): item.recipients undefined = everyone.
    // Per-user soft delete: items the user dismissed are hidden from their inbox.
    const mine = all.filter(n =>
      (n.recipients === undefined || n.recipients.includes(userId)) &&
      !(n.deletedBy ?? []).includes(userId));
    // Newest first
    const sorted = [...mine].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    // unreadCount reflects the user's whole inbox, independent of the active filters.
    const unreadCount = sorted.filter(n => !n.readBy.includes(userId)).length;
    const toDto = (n: typeof sorted[number]) => ({
      id: n.id, event: n.event, severity: n.severity, timestamp: n.timestamp,
      details: n.details, read: n.readBy.includes(userId),
    });

    // Apply filters (used by both the legacy limit slice and paginated views).
    const severity = req.query.severity;
    const eventQ = req.query.event?.trim().toLowerCase();
    let filtered = sorted;
    if (unreadOnly) filtered = filtered.filter(n => !n.readBy.includes(userId));
    if (severity && severity !== 'all') filtered = filtered.filter(n => n.severity === severity);
    if (eventQ) filtered = filtered.filter(n => n.event.toLowerCase().includes(eventQ));
    // Timestamp range filter. A date-only `from`/`to` (YYYY-MM-DD) spans the full day.
    const from = req.query.from?.trim();
    const to = req.query.to?.trim();
    if (from) {
      const since = new Date(from);
      if (from.length <= 10) since.setHours(0, 0, 0, 0);
      if (!Number.isNaN(since.getTime())) filtered = filtered.filter(n => new Date(n.timestamp) >= since);
    }
    if (to) {
      const until = new Date(to);
      if (to.length <= 10) until.setHours(23, 59, 59, 999);
      if (!Number.isNaN(until.getTime())) filtered = filtered.filter(n => new Date(n.timestamp) <= until);
    }

    // Back-compat: `limit` without `page` keeps the flat-list shape (NotificationBell).
    if (req.query.limit !== undefined && req.query.page === undefined) {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      return reply.send({ items: filtered.slice(0, limit).map(toDto), unreadCount, enabled });
    }

    // Server-side pagination (portal convention).
    const totalRecords = filtered.length;
    const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? '20') || 20, 1), 100);
    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    const page = Math.min(Math.max(Number(req.query.page ?? '1') || 1, 1), totalPages);
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize).map(toDto);
    return reply.send({ items, pagination: { page, pageSize, totalRecords, totalPages }, unreadCount, enabled });
  });

  // ─── GET /api/notifications/inbox/:id ──────────────────────────────────────
  // Single in-app notification (detail view). Audience-checked: a user can only
  // read items addressed to them (recipients undefined = everyone).
  fastify.get<{ Params: { id: string } }>('/api/notifications/inbox/:id', async (req, reply) => {
    const userId = req.dashUser!.id;
    const all = await readConfig('notifications');
    const n = all.find(x => x.id === req.params.id &&
      (x.recipients === undefined || x.recipients.includes(userId)) &&
      !(x.deletedBy ?? []).includes(userId));
    if (!n) return reply.status(404).send({ error: 'Notification not found' });
    return reply.send({
      id: n.id, event: n.event, severity: n.severity, timestamp: n.timestamp,
      details: n.details, read: n.readBy.includes(userId),
    });
  });

  // ─── POST /api/notifications/inbox/read ────────────────────────────────────
  const inboxReadSchema = z.object({
    ids: z.array(z.string()).max(500).optional(),
    all: z.boolean().optional(),
  }).refine(b => b.all === true || (b.ids?.length ?? 0) > 0, { message: 'Provide ids[] or all:true' });

  fastify.post<{ Body: { ids?: string[]; all?: boolean } }>('/api/notifications/inbox/read', async (req, reply) => {
    const parsed = inboxReadSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]!.message });
    const userId = req.dashUser!.id;
    const { ids, all } = parsed.data;
    const items = await readConfig('notifications');
    const idSet = new Set(ids); // ponytail: ids is always defined when all=false (Zod refine ensures either ids or all)
    let updated = 0;
    for (const n of items) {
      // Audience filter (U5): a user can only mark items addressed to them.
      const visibleToUser = n.recipients === undefined || n.recipients.includes(userId);
      // Already-dismissed items are out of the user's inbox; don't touch them.
      const dismissed = (n.deletedBy ?? []).includes(userId);
      if (visibleToUser && !dismissed && (all || idSet.has(n.id)) && !n.readBy.includes(userId)) {
        n.readBy.push(userId);
        updated++;
      }
    }
    if (updated > 0) await writeConfig('notifications', items);
    audit(req, 'notification:read', 'success', all ? { all: true, updated } : { ids: ids!, updated }); // ponytail: when !all, Zod ensures ids is defined
    return reply.send({ updated });
  });

  // ─── POST /api/notifications/inbox/unread ──────────────────────────────────
  // Inverse of /read: clears the current user's read mark. Self-service.
  const inboxUnreadSchema = z.object({
    ids: z.array(z.string()).max(500).optional(),
    all: z.boolean().optional(),
  }).refine(b => b.all === true || (b.ids?.length ?? 0) > 0, { message: 'Provide ids[] or all:true' });

  fastify.post<{ Body: { ids?: string[]; all?: boolean } }>('/api/notifications/inbox/unread', async (req, reply) => {
    const parsed = inboxUnreadSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]!.message });
    const userId = req.dashUser!.id;
    const { ids, all } = parsed.data;
    const items = await readConfig('notifications');
    const idSet = new Set(ids);
    let updated = 0;
    for (const n of items) {
      const visibleToUser = n.recipients === undefined || n.recipients.includes(userId);
      const dismissed = (n.deletedBy ?? []).includes(userId);
      if (visibleToUser && !dismissed && (all || idSet.has(n.id)) && n.readBy.includes(userId)) {
        n.readBy = n.readBy.filter(u => u !== userId);
        updated++;
      }
    }
    if (updated > 0) await writeConfig('notifications', items);
    audit(req, 'notification:unread', 'success', all ? { all: true, updated } : { ids: ids!, updated });
    return reply.send({ updated });
  });

  // ─── POST /api/notifications/inbox/delete ──────────────────────────────────
  // Per-user dismiss: marks items as deleted for the calling user only (never
  // global). Self-service — no permission gate, mirrors the read endpoint.
  const inboxDeleteSchema = z.object({
    ids: z.array(z.string()).max(500).optional(),
    all: z.boolean().optional(),
  }).refine(b => b.all === true || (b.ids?.length ?? 0) > 0, { message: 'Provide ids[] or all:true' });

  fastify.post<{ Body: { ids?: string[]; all?: boolean } }>('/api/notifications/inbox/delete', async (req, reply) => {
    const parsed = inboxDeleteSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0]!.message });
    const userId = req.dashUser!.id;
    const { ids, all } = parsed.data;
    const items = await readConfig('notifications');
    const idSet = new Set(ids);
    let deleted = 0;
    for (const n of items) {
      // Audience filter (U5): a user can only dismiss items addressed to them.
      const visibleToUser = n.recipients === undefined || n.recipients.includes(userId);
      const already = (n.deletedBy ?? []).includes(userId);
      if (visibleToUser && !already && (all || idSet.has(n.id))) {
        (n.deletedBy ??= []).push(userId);
        deleted++;
      }
    }
    if (deleted > 0) await writeConfig('notifications', items);
    audit(req, 'notification:delete', 'success', all ? { all: true, deleted } : { ids: ids!, deleted });
    return reply.send({ deleted });
  });

  // ─── POST /api/test/openai-oauth ─────────────────────────────────────────────
  fastify.post<{ Body: { authFilePath?: string } }>('/api/test/openai-oauth', async (req, reply) => {
    if (!requirePerm(req, 'model:read', reply)) return;
    const { resolveCodexToken } = await import('./openaiOAuthForward.js');
    const authFilePath = req.body?.authFilePath || '~/.codex/auth.json';
    try {
      const { accessToken, accountId } = await resolveCodexToken(authFilePath, req.log);
      const payloadB64 = accessToken.split('.')[1] ?? '';
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as Record<string, unknown>;
      const exp = typeof payload['exp'] === 'number' ? payload['exp'] : 0;
      const expiresAt = exp > 0 ? new Date(exp * 1000).toISOString() : null;
      return reply.send({ ok: true, accountId, expiresAt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.send({ ok: false, error: msg });
    }
  });

  // ─── GET /api/health/providers ───────────────────────────────────────────────
  // Real-time per-model operational status computed from recent usage records.
  fastify.get('/api/health/providers', async (req, reply) => {
    if (!requirePerm(req, 'report:read', reply)) return;
    const [models, records] = await Promise.all([readConfig('models'), readConfig('usage')]);

    const now = Date.now();
    const fiveMinAgo = now - 300_000;
    const oneHourAgo = now - 3_600_000;

    const providers = models.map(model => {
      const mine = records.filter(r => r.modelId === model.id);
      // Guardrail blocks aren't model errors — exclude them from health entirely (#77).
      const recent = mine.filter(r => new Date(r.timestamp).getTime() >= fiveMinAgo && r.outcome !== 'blocked');
      const total = recent.length;
      const errors = recent.filter(r => r.outcome !== 'success').length;
      const errorRate = total > 0 ? errors / total : 0;

      const requestsLastHour = mine.filter(r => new Date(r.timestamp).getTime() >= oneHourAgo).length;

      // p95 latency over the last hour (null when no sample — health distinguishes "no data" from 0ms)
      const lastHourNonBlocked = mine.filter(r => new Date(r.timestamp).getTime() >= oneHourAgo && r.outcome !== 'blocked');
      const latencies = lastHourNonBlocked.map(r => r.latencyMs).filter((n): n is number => typeof n === 'number');
      const p95LatencyMs = latencies.length > 0 ? p95(latencies) : null;

      const lastSuccess = [...mine].reverse().find(r => r.outcome === 'success');
      const lastSuccessAt = lastSuccess ? lastSuccess.timestamp : null;

      let status: 'healthy' | 'degraded' | 'unavailable';
      if (errorRate < 0.05) status = 'healthy';
      else if (errorRate < 0.5) status = 'degraded';
      else status = 'unavailable';

      return {
        modelId: model.id,
        name: model.name,
        provider: model.provider,
        status,
        errorRate,
        p95LatencyMs,
        requestsLastHour,
        lastSuccessAt,
        // ponytail: cooldown lives in in-memory router state, not persisted; wire later if surfaced
        cooldownUntil: null as string | null,
      };
    });

    return reply.send({ providers });
  });

  // ─── GET /api/leaderboard (#80) ──────────────────────────────────────────────
  // Ranks models by real-world cost-performance using local usage records only.
  fastify.get<{ Querystring: { period?: string; projectId?: string; from?: string; to?: string } }>('/api/leaderboard', async (req, reply) => {
    if (!requirePerm(req, 'report:read', reply)) return;
    const [models, records] = await Promise.all([readConfig('models'), readConfig('usage')]);
    const { period = 'monthly', projectId, from, to } = req.query;

    const now = new Date();
    let since = new Date(0);
    let until = new Date(now.getTime() + 86400000);
    if (period === 'daily') { since = new Date(now); since.setHours(0, 0, 0, 0); }
    else if (period === 'weekly') {
      since = new Date(now);
      const d = since.getDay();
      since.setDate(since.getDate() - (d === 0 ? 6 : d - 1));
      since.setHours(0, 0, 0, 0);
    } else if (period === 'monthly') { since = new Date(now); since.setDate(1); since.setHours(0, 0, 0, 0); }
    else if (period === 'custom') {
      if (from) { since = new Date(from); if (from.length <= 10) since.setHours(0, 0, 0, 0); }
      if (to) { until = new Date(to); if (to.length <= 10) until.setHours(23, 59, 59, 999); }
    }

    let filtered = records.filter(r => {
      const ts = new Date(r.timestamp);
      return ts >= since && ts <= until;
    });
    if (projectId) filtered = filtered.filter(r => r.projectId === projectId);

    const providerByModel = new Map(models.map(m => [m.id, m.provider]));

    const trendKeys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      trendKeys.push(new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10));
    }

    type Acc = {
      totalRequests: number; success: number; totalCost: number;
      totalTokens: number; latencies: number[]; totalLatencyMs: number;
      trend: Record<string, number>;
    };
    const byModel = new Map<string, Acc>();
    for (const r of filtered) {
      if (r.outcome === 'blocked') continue;
      const a = byModel.get(r.modelId) ?? {
        totalRequests: 0, success: 0, totalCost: 0, totalTokens: 0,
        latencies: [], totalLatencyMs: 0, trend: {},
      };
      a.totalRequests++;
      const ok = r.outcome === 'success';
      if (ok) {
        a.success++;
        a.totalCost += r.cost;
        a.totalTokens += r.inputTokens + r.outputTokens;
        if (typeof r.latencyMs === 'number') { a.latencies.push(r.latencyMs); a.totalLatencyMs += r.latencyMs; }
        const day = r.timestamp.slice(0, 10);
        a.trend[day] = (a.trend[day] ?? 0) + r.cost;
      }
      byModel.set(r.modelId, a);
    }

    const leaderboard = [...byModel.entries()].map(([modelId, a]) => {
      const successRate = a.success / a.totalRequests; // ponytail: totalRequests >= 1 for every byModel entry (incremented before insert)
      const errorRate = 1 - successRate;
      const avgLatencyMs = a.latencies.length > 0 ? a.totalLatencyMs / a.latencies.length : 0;
      const p95LatencyMs = p95(a.latencies);
      const avgCostPer1kTokens = a.totalTokens > 0 ? (a.totalCost / a.totalTokens) * 1000 : 0;
      const totalLatencySec = a.totalLatencyMs / 1000;
      const tokensPerSec = totalLatencySec > 0 ? a.totalTokens / totalLatencySec : 0;
      return {
        modelId,
        provider: providerByModel.get(modelId) ?? 'unknown',
        totalRequests: a.totalRequests,
        successRate,
        avgLatencyMs,
        p95LatencyMs,
        avgCostPer1kTokens,
        totalCost: a.totalCost,
        totalTokens: a.totalTokens,
        tokensPerSec,
        errorRate,
        trend: trendKeys.map(date => ({ date, cost: a.trend[date] ?? 0 })),
      };
    });

    const ratio = (m: typeof leaderboard[number]) =>
      m.successRate > 0 ? m.avgCostPer1kTokens / m.successRate : Number.POSITIVE_INFINITY;
    leaderboard.sort((a, b) => ratio(a) - ratio(b));

    return reply.send(leaderboard);
  });

  // ─── GET /api/notifications/channels ─────────────────────────────────────────
  fastify.get('/api/notifications/channels', async (req, reply) => {
    if (!requirePerm(req, 'notification:write', reply)) return;
    const settings = await readConfig('settings');
    const channels = (settings.notifications?.channels ?? []) as unknown as Record<string, unknown>[];
    return reply.send(channels.map(redactChannel));
  });

  // ─── GET /api/notifications/channels/:id ─────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/notifications/channels/:id', async (req, reply) => {
    if (!requirePerm(req, 'notification:write', reply)) return;
    const settings = await readConfig('settings');
    const channels = (settings.notifications?.channels ?? []) as unknown as Record<string, unknown>[];
    const channel  = channels.find(ch => ch['id'] === req.params.id);
    if (!channel) return reply.status(404).send({ error: `Channel "${req.params.id}" not found` });
    return reply.send(redactChannel(channel));
  });

  // ─── PATCH /api/notifications/channels/:id ───────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/notifications/channels/:id', async (req, reply) => {
    if (!requirePerm(req, 'notification:write', reply)) return;
    const settings = await readConfig('settings');
    const channels = ((settings.notifications?.channels ?? []) as unknown) as Record<string, unknown>[];
    const idx = channels.findIndex(ch => ch['id'] === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: `Channel "${req.params.id}" not found` });
    const stored = channels[idx]!;
    const body = req.body; // ponytail: Fastify always provides body as Record<string,unknown> for JSON content-type
    // Reject provider change
    if ('provider' in body && body['provider'] !== stored['provider']) {
      return reply.status(400).send({ error: 'Provider cannot be changed' });
    }
    const provider = stored['provider'] as ChannelProvider | undefined;
    const secrets = provider ? (CHANNEL_SECRET_FIELDS[provider] ?? []) : [];
    // Build merged channel: start with stored, apply non-secret fields from body,
    // then for each secret field update only when body provides a non-empty string.
    const merged: Record<string, unknown> = { ...stored };
    for (const [key, val] of Object.entries(body)) {
      if (key === 'id' || key === 'provider') continue; // immutable
      if (secrets.includes(key)) {
        // Secret: update only when non-empty string provided
        if (typeof val === 'string' && val.length > 0) {
          merged[key] = val;
        }
        // else keep stored value (empty string or absent = no change)
      } else {
        merged[key] = val;
      }
    }
    const updatedChannels = [...channels];
    updatedChannels[idx] = merged;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await writeConfig('settings', { ...settings, notifications: { ...settings.notifications, channels: updatedChannels } } as any); // ponytail: notifications always defined when channel was found
    return reply.send(redactChannel(merged));
  });

  // ─── POST /api/notifications/channels ────────────────────────────────────────
  fastify.post<{ Body: Record<string, unknown> }>('/api/notifications/channels', async (req, reply) => {
    if (!requirePerm(req, 'notification:write', reply)) return;
    const parsed = notificationChannelSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]!.message });
    }
    const channel = { ...parsed.data, id: parsed.data.id ?? randomUUID() };
    const settings  = await readConfig('settings');
    const existing  = settings.notifications ?? {};
    const channels  = existing.channels ?? [];
    const updated   = {
      ...settings,
      notifications: { ...existing, channels: [...channels, channel] },
    };
    await writeConfig('settings', updated as Settings);
    return reply.status(201).send(redactChannel(channel as unknown as Record<string, unknown>));
  });

  // ─── DELETE /api/notifications/channels/:id ──────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/api/notifications/channels/:id', async (req, reply) => {
    if (!requirePerm(req, 'notification:write', reply)) return;
    const settings = await readConfig('settings');
    const channels = settings.notifications?.channels ?? [];
    const filtered = channels.filter(ch => (ch as unknown as { id: string }).id !== req.params.id);
    if (filtered.length === channels.length) {
      return reply.status(404).send({ error: `Channel "${req.params.id}" not found` });
    }
    await writeConfig('settings', {
      ...settings,
      notifications: { ...settings.notifications, channels: filtered }, // ponytail: settings.notifications is always defined when filtered.length < channels.length
    });
    return reply.status(204).send();
  });

  // ─── POST /api/notifications/channels/:id/test ───────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { to?: string } }>('/api/notifications/channels/:id/test', async (req, reply) => {
    if (!requirePerm(req, 'notification:write', reply)) return;
    const settings = await readConfig('settings');
    const channels = ((settings.notifications?.channels ?? []) as unknown) as Array<{ id: string; provider: string; [k: string]: unknown }>;
    const channel  = channels.find(ch => ch.id === req.params.id);
    if (!channel) return reply.status(404).send({ error: `Channel "${req.params.id}" not found` });
    try {
      const recipient = resolveTestRecipient(channel.provider, req.body?.to, req.dashUser!.email);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await sendTestNotification(channel as any, recipient, req.dashUser!.id);
      return reply.send(result);
    } catch (e) {
      return reply.send({ ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  });

  // ─── Integration CRUD ─────────────────────────────────────────────────────────

  /** Secret fields per integration type — redacted to '' on read, skipped if '' on update. */
  const INTEGRATION_SECRET_FIELDS: Record<string, string[]> = {
    prometheus: ['authToken'],
    otel:       [],
    datadog:    ['apiKey'],
    grafana:    ['apiKey'],
    influxdb:   ['token'],
    webhook:    ['secret'],
  };

  function redactIntegration(intg: Record<string, unknown>): Record<string, unknown> {
    const secrets = INTEGRATION_SECRET_FIELDS[intg['type'] as string] ?? [];
    const out: Record<string, unknown> = { ...intg };
    for (const field of secrets) {
      const v = out[field];
      if (v && typeof v === 'string' && v.length > 0) {
        out[field] = REDACT_MARKER;
      } else if (v === undefined || v === '') {
        delete out[field];
      }
    }
    return out;
  }

  const integrationSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('prometheus'), enabled: z.boolean().optional(), authToken: z.string().optional() }).passthrough(),
    z.object({ type: z.literal('otel'),       enabled: z.boolean().optional(), endpoint: z.string().min(1), protocol: z.enum(['http', 'grpc']), headers: z.record(z.string(), z.string()).optional() }).passthrough(),
    z.object({ type: z.literal('datadog'),    enabled: z.boolean().optional(), apiKey: z.string().min(1), site: z.enum(['datadoghq.com', 'datadoghq.eu', 'us3.datadoghq.com', 'us5.datadoghq.com', 'ddog-gov.com']) }).passthrough(),
    z.object({ type: z.literal('grafana'),    enabled: z.boolean().optional(), url: z.string().min(1), username: z.string().min(1), apiKey: z.string().min(1) }).passthrough(),
    z.object({ type: z.literal('influxdb'),   enabled: z.boolean().optional(), url: z.string().min(1), token: z.string().min(1), org: z.string().min(1), bucket: z.string().min(1) }).passthrough(),
    z.object({ type: z.literal('webhook'),    enabled: z.boolean().optional(), url: z.string().min(1), secret: z.string().optional(), headers: z.record(z.string(), z.string()).optional() }).passthrough(),
  ]);

  // ─── GET /api/integrations ────────────────────────────────────────────────────
  fastify.get('/api/integrations', async (req, reply) => {
    if (!requirePerm(req, 'settings:write', reply)) return;
    const settings = await readConfig('settings');
    const integrations = (settings.integrations ?? []) as unknown as Record<string, unknown>[];
    return reply.send(integrations.map(redactIntegration));
  });

  // ─── GET /api/integrations/:id ───────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/integrations/:id', async (req, reply) => {
    if (!requirePerm(req, 'settings:write', reply)) return;
    const settings = await readConfig('settings');
    const integrations = (settings.integrations ?? []) as unknown as Record<string, unknown>[];
    const intg = integrations.find(i => i['id'] === req.params.id);
    if (!intg) return reply.status(404).send({ error: `Integration "${req.params.id}" not found` });
    return reply.send(redactIntegration(intg));
  });

  // ─── POST /api/integrations ───────────────────────────────────────────────────
  fastify.post<{ Body: Record<string, unknown> }>('/api/integrations', async (req, reply) => {
    if (!requirePerm(req, 'settings:write', reply)) return;
    const parsed = integrationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]!.message });
    }
    const intg = { ...parsed.data, id: randomUUID(), enabled: parsed.data.enabled ?? true };
    const settings = await readConfig('settings');
    await writeConfig('settings', { ...settings, integrations: [...(settings.integrations ?? []), intg] } as Settings);
    return reply.status(201).send(redactIntegration(intg as unknown as Record<string, unknown>));
  });

  // ─── PATCH /api/integrations/:id ─────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/integrations/:id', async (req, reply) => {
    if (!requirePerm(req, 'settings:write', reply)) return;
    const settings = await readConfig('settings');
    const integrations = ((settings.integrations ?? []) as unknown) as Record<string, unknown>[];
    const idx = integrations.findIndex(i => i['id'] === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: `Integration "${req.params.id}" not found` });
    const stored = integrations[idx]!;
    const secrets = INTEGRATION_SECRET_FIELDS[stored['type'] as string] ?? []; // stored type always in schema
    const body = req.body;
    const merged: Record<string, unknown> = { ...stored };
    for (const [key, val] of Object.entries(body)) {
      if (key === 'id' || key === 'type') continue;
      if (secrets.includes(key)) {
        if (typeof val === 'string' && val.length > 0) merged[key] = val;
      } else {
        merged[key] = val;
      }
    }
    const updated = [...integrations];
    updated[idx] = merged;
    await writeConfig('settings', { ...settings, integrations: updated } as unknown as Settings);
    return reply.send(redactIntegration(merged));
  });

  // ─── DELETE /api/integrations/:id ────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/api/integrations/:id', async (req, reply) => {
    if (!requirePerm(req, 'settings:write', reply)) return;
    const settings = await readConfig('settings');
    const integrations = settings.integrations ?? [];
    const filtered = integrations.filter(i => (i as unknown as { id: string }).id !== req.params.id);
    if (filtered.length === integrations.length) {
      return reply.status(404).send({ error: `Integration "${req.params.id}" not found` });
    }
    await writeConfig('settings', { ...settings, integrations: filtered } as Settings);
    return reply.status(204).send();
  });

  // ─── POST /api/integrations/:id/test ─────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/api/integrations/:id/test', async (req, reply) => {
    if (!requirePerm(req, 'settings:write', reply)) return;
    const settings = await readConfig('settings');
    const intg = (settings.integrations ?? []).find(i => (i as unknown as { id: string }).id === req.params.id) as Record<string, unknown> | undefined;
    if (!intg) return reply.status(404).send({ error: `Integration "${req.params.id}" not found` });

    const type = intg['type'] as string;

    if (type === 'prometheus') {
      const enabled = intg['enabled'] as boolean | undefined;
      return reply.send(enabled
        ? { ok: true,  message: 'Prometheus metrics endpoint is enabled.' }
        : { ok: false, message: 'Integration is disabled.' });
    }

    if (type === 'otel') {
      const endpoint = intg['endpoint'] as string;
      const headers = (intg['headers'] as Record<string, string> | undefined) ?? {};
      try {
        const res = await fetch(`${endpoint}/v1/metrics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ resourceMetrics: [] }),
        });
        return reply.send(res.ok
          ? { ok: true,  message: 'OTEL endpoint is reachable.' }
          : { ok: false, message: `OTEL endpoint returned HTTP ${res.status}` });
      } catch (err) {
        return reply.send({ ok: false, message: (err as Error).message });
      }
    }

    if (type === 'datadog') {
      const apiKey = intg['apiKey'] as string;
      const site   = intg['site']   as string;
      try {
        const res = await fetch(`https://api.${site}/api/v1/validate`, {
          headers: { 'DD-API-KEY': apiKey },
        });
        if (res.status === 200)  return reply.send({ ok: true,  message: 'Datadog API key is valid.' });
        if (res.status === 403)  return reply.send({ ok: false, message: 'Invalid Datadog API key.' });
        return reply.send({ ok: false, message: `Datadog API returned HTTP ${res.status}` });
      } catch (err) {
        return reply.send({ ok: false, message: (err as Error).message });
      }
    }

    if (type === 'grafana') {
      const url      = intg['url']      as string;
      const username = intg['username'] as string;
      const apiKey   = intg['apiKey']   as string;
      const basicAuth = Buffer.from(`${username}:${apiKey}`).toString('base64');
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-protobuf',
            'X-Prometheus-Remote-Write-Version': '0.1.0',
            'Authorization': `Basic ${basicAuth}`,
          },
          body: '',
        });
        // 400/415 means endpoint exists but rejects empty payload — still reachable
        const reachable = res.ok || res.status === 400 || res.status === 415;
        return reply.send(reachable
          ? { ok: true,  message: 'Grafana remote_write endpoint is reachable.' }
          : { ok: false, message: `Grafana endpoint returned HTTP ${res.status}` });
      } catch (err) {
        return reply.send({ ok: false, message: (err as Error).message });
      }
    }

    if (type === 'influxdb') {
      const url = intg['url'] as string;
      try {
        const res = await fetch(`${url}/health`);
        if (!res.ok) return reply.send({ ok: false, message: `InfluxDB health check returned HTTP ${res.status}` });
        const body = await res.json() as { status?: string };
        return reply.send(body.status === 'pass'
          ? { ok: true,  message: 'InfluxDB is healthy.' }
          : { ok: false, message: `InfluxDB health status: ${body.status ?? 'unknown'}` });
      } catch (err) {
        return reply.send({ ok: false, message: (err as Error).message });
      }
    }

    if (type === 'webhook') {
      const url    = intg['url']    as string;
      const secret = intg['secret'] as string | undefined;
      const headers = (intg['headers'] as Record<string, string> | undefined) ?? {};
      const payload = JSON.stringify({ type: 'test', source: 'routerly' });
      const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json', ...headers };
      if (secret) {
        reqHeaders['X-Routerly-Signature'] = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
      }
      try {
        const res = await fetch(url, { method: 'POST', headers: reqHeaders, body: payload });
        return reply.send(res.ok
          ? { ok: true,  message: 'Webhook responded successfully.' }
          : { ok: false, message: `Webhook returned HTTP ${res.status}` });
      } catch (err) {
        return reply.send({ ok: false, message: (err as Error).message });
      }
    }

    return reply.status(400).send({ error: `Unknown integration type: ${type}` });
  });

  // ─── GET /api/traces/:id ─────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/traces/:id', async (req, reply) => {
    if (!requirePerm(req, 'report:read', reply)) return;
    const trace = getTrace(req.params.id);
    if (!trace) return reply.status(404).send({ error: 'Trace not found' });
    return reply.send({ trace });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // ROLES
  // ══════════════════════════════════════════════════════════════════════════════

  fastify.get('/api/roles', async (req, reply) => {
    if (!requirePerm(req, 'user:read', reply)) return;
    const customRoles = await readConfig('roles');
    const allRoles = getEffectiveRoles(customRoles);
    return reply.send(allRoles.map(r => ({ ...r, builtin: BUILT_IN_ROLES.some(b => b.id === r.id) })));
  });

  fastify.post<{ Body: { id: string; name: string; permissions: Permission[] } }>('/api/roles', async (req, reply) => {
    if (!requirePerm(req, 'user:write', reply)) return;
    const { id, name, permissions } = req.body;
    if (!id || !name) return reply.status(400).send({ error: 'id and name are required' });
    if (BUILT_IN_ROLES.some(r => r.id === id)) {
      return reply.status(409).send({ error: `"${id}" is a built-in role and cannot be created` });
    }
    const customRoles = await readConfig('roles');
    if (customRoles.find(r => r.id === id)) return reply.status(409).send({ error: `Role "${id}" already exists` });
    const role: RoleConfig = { id, name, permissions: permissions ?? [] };
    customRoles.push(role);
    await writeConfig('roles', customRoles);
    audit(req, 'role:create', 'success', { id: role.id });
    return reply.status(201).send({ ...role, builtin: false });
  });

  fastify.put<{ Params: { id: string }; Body: { name?: string; permissions?: Permission[] } }>('/api/roles/:id', async (req, reply) => {
    if (!requirePerm(req, 'user:write', reply)) return;
    if (BUILT_IN_ROLES.some(r => r.id === req.params.id)) {
      return reply.status(403).send({ error: `Built-in role "${req.params.id}" cannot be modified` });
    }
    const customRoles = await readConfig('roles');
    const idx = customRoles.findIndex(r => r.id === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: 'Role not found' });
    const role = customRoles[idx]!;
    if (req.body.name) role.name = req.body.name;
    if (req.body.permissions) role.permissions = req.body.permissions;
    customRoles[idx] = role;
    await writeConfig('roles', customRoles);
    audit(req, 'role:update', 'success', { id: req.params.id });
    return reply.send({ ...role, builtin: false });
  });

  fastify.delete<{ Params: { id: string } }>('/api/roles/:id', async (req, reply) => {
    if (!requirePerm(req, 'user:write', reply)) return;
    if (BUILT_IN_ROLES.some(r => r.id === req.params.id)) {
      return reply.status(403).send({ error: `Built-in role "${req.params.id}" cannot be deleted` });
    }
    const customRoles = await readConfig('roles');
    const filtered = customRoles.filter(r => r.id !== req.params.id);
    if (filtered.length === customRoles.length) return reply.status(404).send({ error: 'Role not found' });
    await writeConfig('roles', filtered);
    audit(req, 'role:delete', 'success', { id: req.params.id });
    return reply.status(204).send();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // AUDIT LOG
  // ══════════════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: { userId?: string; action?: string; result?: string; from?: string; to?: string; page?: string; pageSize?: string };
  }>('/api/audit', async (req, reply) => {
    if (!requirePerm(req, 'audit:read', reply)) return;
    const entries = await readConfig('audit');
    const { userId, action, result, from, to, page, pageSize } = req.query;
    const size = Math.min(200, Math.max(1, parseInt(pageSize ?? '50', 10) || 50));
    const p    = Math.max(1, parseInt(page ?? '1', 10) || 1);

    let filtered = [...entries].reverse(); // most recent first
    if (userId) filtered = filtered.filter(e => e.userId === userId || e.email?.includes(userId));
    if (action) filtered = filtered.filter(e => e.action.includes(action));
    if (result && result !== 'all') filtered = filtered.filter(e => e.result === result);
    if (from) filtered = filtered.filter(e => e.timestamp >= from);
    if (to) filtered = filtered.filter(e => e.timestamp <= to);

    const totalRecords = filtered.length;
    const totalPages   = Math.max(1, Math.ceil(totalRecords / size));
    const clampedPage  = Math.min(p, totalPages);
    const data         = filtered.slice((clampedPage - 1) * size, clampedPage * size);

    return reply.send({
      entries: data,
      pagination: { page: clampedPage, pageSize: size, totalRecords, totalPages },
    });
  });

};
