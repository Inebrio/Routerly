import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Permission, ResilienceKey } from '@routerly/shared';
import { logAudit } from '../audit/logger.js';
import type { AuditEntry } from '../audit/logger.js';
import { getResilienceStore } from './index.js';

// ── Route-local auth helpers (mirrors api.ts/connections.ts; no shared route-helper module exists) ──

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

const resetBodySchema = z.object({
  level: z.enum(['provider', 'connection', 'model']).optional(),
  id: z.string().optional(),
});

/** GET /api/resilience — contributed to API_ROUTES by resilienceModule.register() (index.ts). */
export async function getResilienceHandler(request: unknown, reply: unknown): Promise<unknown> {
  const req = request as FastifyRequest;
  const rep = reply as FastifyReply;
  if (!requirePerm(req, 'resilience:read', rep)) return;

  const store = getResilienceStore();
  // Defensive only: register() always calls setResilienceStore() before any request is served
  // (dependsOn: { api } + the kernel's real start order guarantee this in production).
  if (!store) return rep.status(500).send({ error: 'resilience store unavailable' });

  return rep.send(store.snapshot());
}

/** POST /api/resilience/reset — contributed to API_ROUTES by resilienceModule.register() (index.ts). */
export async function resetResilienceHandler(request: unknown, reply: unknown): Promise<unknown> {
  const req = request as FastifyRequest;
  const rep = reply as FastifyReply;
  if (!requirePerm(req, 'resilience:manage', rep)) return;

  const parsed = resetBodySchema.safeParse(req.body);
  if (!parsed.success) return rep.status(400).send({ error: 'Invalid resilience reset body', details: parsed.error.issues });

  const store = getResilienceStore();
  if (!store) return rep.status(500).send({ error: 'resilience store unavailable' });

  const { level, id } = parsed.data;
  const key: ResilienceKey | undefined = level !== undefined && id !== undefined ? { level, id } : undefined;
  store.reset(key);
  audit(req, 'resilience:reset', 'success', key ? { key } : { key: 'all' });
  return rep.send({ ok: true });
}
