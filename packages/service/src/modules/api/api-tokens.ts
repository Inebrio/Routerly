import { createHash, randomBytes } from 'node:crypto';
import type { FastifyPluginAsync, FastifyBaseLogger, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { ApiToken, Permission, UserConfig } from '@routerly/shared';
import { readConfig, writeConfig } from '../config/loader.js';
import { getEffectiveRoles, ALL_PERMISSIONS } from '../auth/roles.js';
import { logAudit } from '../audit/logger.js';

/** Distinct from `sk-rt-` (router) and `sk-rt-mcp-` (MCP) tokens. */
export const API_TOKEN_PREFIX = 'sk-rt-api-';
export const API_TOKEN_MAX_DAYS = 365;
/** Tokens expiring within this window are flagged in the log and the dashboard. */
export const API_TOKEN_WARN_DAYS = 7;
const TOUCH_INTERVAL_MS = 60_000;
const DAY_MS = 86_400_000;

export const hashApiToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

const lastTouch = new Map<string, number>();

function permissionsOf(user: UserConfig, roles: ReturnType<typeof getEffectiveRoles>): Permission[] {
  return roles.find(r => r.id === user.roleId)?.permissions ?? [];
}

export type ApiTokenAuth =
  | { ok: true; user: UserConfig; token: ApiToken; permissions: Permission[] }
  | { ok: false };

/** Resolve a raw `sk-rt-api-` bearer: known, unexpired. Permissions = scope ∩ owner's current role. */
export async function authenticateApiToken(raw: string): Promise<ApiTokenAuth> {
  if (!raw.startsWith(API_TOKEN_PREFIX)) return { ok: false };
  const hash = hashApiToken(raw);
  const [users, customRoles] = await Promise.all([readConfig('users'), readConfig('roles')]);
  for (const user of users) {
    const token = user.apiTokens?.find(t => t.tokenHash === hash);
    if (!token) continue;
    if (new Date(token.expiresAt).getTime() <= Date.now()) return { ok: false };
    const held = permissionsOf(user, getEffectiveRoles(customRoles));
    return { ok: true, user, token, permissions: token.permissions.filter(p => held.includes(p)) };
  }
  return { ok: false };
}

/** Audit every use and refresh lastUsedAt (at most once a minute per token). Never throws. */
export async function recordApiTokenUse(req: FastifyRequest, user: UserConfig, token: ApiToken): Promise<void> {
  void logAudit({
    userId: user.id,
    email: user.email,
    endpoint: `${req.method} ${req.url}`,
    action: 'api_token:use',
    result: 'success',
    details: { tokenId: token.id, tokenName: token.name },
  });
  const now = Date.now();
  if (now - (lastTouch.get(token.id) ?? 0) < TOUCH_INTERVAL_MS) return;
  lastTouch.set(token.id, now);
  try {
    const users = await readConfig('users');
    const t = users.find(u => u.id === user.id)?.apiTokens?.find(x => x.id === token.id);
    if (!t) return;
    t.lastUsedAt = new Date(now).toISOString();
    await writeConfig('users', users);
  } catch { /* non-fatal */ }
}

/** Log a warning for every token that expires within the warning window. Returns how many. */
export async function warnExpiringApiTokens(log: Pick<FastifyBaseLogger, 'warn'>): Promise<number> {
  const limit = Date.now() + API_TOKEN_WARN_DAYS * DAY_MS;
  let n = 0;
  for (const user of await readConfig('users')) {
    for (const t of user.apiTokens ?? []) {
      const exp = new Date(t.expiresAt).getTime();
      if (exp > Date.now() && exp <= limit) {
        n++;
        log.warn(`[api-token] token "${t.name}" of ${user.email} expires on ${t.expiresAt}; create a replacement and revoke this one`);
      }
    }
  }
  return n;
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  expiresAt: z.string().datetime(),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).min(1).max(200),
}).strict();

const view = ({ tokenHash: _h, ...rest }: ApiToken) => rest;

/** Per-user token management. Mounted inside apiRoutes so the auth preHandler applies. */
export const apiTokenRoutes: FastifyPluginAsync = async (fastify) => {
  const audit = (req: FastifyRequest, action: string, details: Record<string, unknown>) =>
    void logAudit({
      userId: req.dashUser!.id, email: req.dashUser!.email,
      endpoint: `${req.method} ${req.url}`, action, result: 'success', details,
    });

  fastify.get('/api/me/api-tokens', async (req, reply) => {
    const user = (await readConfig('users')).find(u => u.id === req.dashUser!.id);
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return reply.send((user.apiTokens ?? []).map(view));
  });

  fastify.post<{ Body: unknown }>('/api/me/api-tokens', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { name, expiresAt, permissions } = parsed.data;
    const exp = new Date(expiresAt).getTime();
    if (exp <= Date.now()) return reply.status(400).send({ error: 'expiresAt must be in the future' });
    if (exp > Date.now() + API_TOKEN_MAX_DAYS * DAY_MS) {
      return reply.status(400).send({ error: `expiresAt must be within ${API_TOKEN_MAX_DAYS} days` });
    }
    const held = req.dashUser!.permissions;
    const missing = permissions.filter(p => !held.includes(p as Permission));
    if (missing.length > 0) {
      return reply.status(403).send({ error: 'Forbidden', message: `Cannot grant permissions you do not hold: ${missing.join(', ')}` });
    }

    const users = await readConfig('users');
    const index = users.findIndex(u => u.id === req.dashUser!.id);
    if (index === -1) return reply.status(404).send({ error: 'User not found' });
    const user = users[index]!;
    const existing = user.apiTokens ?? [];
    if (existing.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      return reply.status(409).send({ error: `An API token named "${name}" already exists` });
    }

    const raw = `${API_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;
    const token: ApiToken = {
      id: uuidv4(), name, tokenHash: hashApiToken(raw), tokenSnippet: raw.substring(0, 14),
      createdAt: new Date().toISOString(), expiresAt, permissions: permissions as Permission[],
    };
    users[index] = { ...user, apiTokens: [...existing, token] };
    await writeConfig('users', users);
    audit(req, 'api_token:create', { tokenId: token.id, name, expiresAt, permissions });
    // The raw value is returned once, here; only its hash is stored.
    return reply.status(201).send({ ...view(token), token: raw });
  });

  fastify.delete<{ Params: { id: string } }>('/api/me/api-tokens/:id', async (req, reply) => {
    const users = await readConfig('users');
    const index = users.findIndex(u => u.id === req.dashUser!.id);
    if (index === -1) return reply.status(404).send({ error: 'User not found' });
    const user = users[index]!;
    const remaining = (user.apiTokens ?? []).filter(t => t.id !== req.params.id);
    if (remaining.length === (user.apiTokens ?? []).length) return reply.status(404).send({ error: 'Token not found' });
    users[index] = { ...user, apiTokens: remaining };
    await writeConfig('users', users);
    audit(req, 'api_token:revoke', { tokenId: req.params.id });
    return reply.status(204).send();
  });
};
