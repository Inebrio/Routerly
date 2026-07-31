import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Permission } from '@routerly/shared';
import { logAudit } from '../audit/logger.js';
import type { AuditEntry } from '../audit/logger.js';
import { MCP_TOOLS } from '../../core/tokens.js';
import type { McpToolEntry } from '../mcp/registry.js';

// ── Route-local auth helpers (mirrors api.ts/connections.ts/profiles.ts; no shared route-helper module exists) ──

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

const listQuerySchema = z.object({ scope: z.enum(['read', 'write']).optional() });

/** Dashboard-facing view of a registry entry. Never exposes the handler or DI token. */
interface McpToolView {
  name: string;
  scope: 'read' | 'write';
  description: string;
  sourceModule: string;
  enabled: boolean;
}

function toView(entry: McpToolEntry): McpToolView {
  return {
    name: entry.name,
    scope: entry.scope,
    description: entry.description,
    // The DI token key is the backing module marker (e.g. 'catalog.registry').
    sourceModule: entry.requires.key,
    // ponytail: always true until mcp:manage adds real per-tool toggling. Today a
    // disabled module's tool is absent from the registry (Task 5 composition gate),
    // so every entry present here is by definition enabled.
    enabled: true,
  };
}

/**
 * Read-only dashboard management surface over the MCP tool registry. Distinct from
 * the MCP protocol surface (/mcp), which is gated by project-token scopes. These
 * routes are gated by dashboard permissions (mcp:read). Registered INSIDE apiRoutes
 * so the JWT preHandler (which populates req.dashUser) applies.
 * mcp:manage is reserved for a future enable/disable feature; no route enforces it yet.
 * // ponytail: no manage mutation yet.
 */
export const mcpApiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { scope?: string } }>('/api/mcp/tools', async (req, reply) => {
    if (!requirePerm(req, 'mcp:read', reply)) return;
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    // tryResolve, not resolve: mounting apiRoutes without a bootstrapped kernel
    // (some route tests) must yield an empty list, never throw.
    const registry = fastify.kernel?.container.tryResolve(MCP_TOOLS);
    const entries = registry?.ordered() ?? [];
    const scope = parsed.data.scope;
    const view = entries
      .filter(e => scope === undefined || e.scope === scope)
      .map(toView);
    return reply.send(view);
  });

  fastify.get<{ Params: { name: string } }>('/api/mcp/tools/:name', async (req, reply) => {
    if (!requirePerm(req, 'mcp:read', reply)) return;
    const registry = fastify.kernel?.container.tryResolve(MCP_TOOLS);
    const entry = registry?.ordered().find(e => e.name === req.params.name);
    if (!entry) return reply.status(404).send({ error: 'Not found' });
    return reply.send(toView(entry));
  });
};
