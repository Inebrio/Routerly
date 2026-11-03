import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { logAudit } from '../audit/logger.js';
import type { AuditEntry } from '../audit/logger.js';
import { MCP_TOOLS } from '../../core/tokens.js';
import { readConfig, writeConfig } from '../config/loader.js';
import { mintMcpToken } from '../mcp/tokens.js';
import type { McpToolEntry } from '../mcp/registry.js';

// ── Route-local audit helper (mirrors api.ts/connections.ts/profiles.ts; no shared route-helper module exists) ──

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

const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(60),
  expiresAt: z.string().datetime().optional(),
}).strict();

/** Dashboard-facing view of a registry entry. Never exposes the handler or DI token. */
interface McpToolView {
  name: string;
  scope: 'read' | 'write';
  description: string;
  sourceModule: string;
  permission: string;
}

function toView(entry: McpToolEntry): McpToolView {
  return {
    name: entry.name,
    scope: entry.scope,
    description: entry.description,
    // The DI token key is the backing module marker (e.g. 'catalog.registry').
    sourceModule: entry.requires.key,
    permission: entry.permission,
  };
}

/**
 * Personal MCP surface, mounted inside apiRoutes so the JWT preHandler (which
 * populates req.dashUser) applies.
 *
 * MCP is per-user, not per-router: a token grants exactly its owner's
 * permissions, so these routes need no permission of their own beyond being
 * authenticated, exactly like the rest of `/api/me`. The tool list is the list
 * the caller's own token would expose, filtered by the caller's permissions.
 */
export const mcpApiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/me/mcp-tools', async (req, reply) => {
    // tryResolve, not resolve: mounting apiRoutes without a bootstrapped kernel
    // (some route tests) must yield an empty list, never throw.
    const registry = fastify.kernel?.container.tryResolve(MCP_TOOLS);
    const permissions = req.dashUser?.permissions ?? [];
    const view = (registry?.ordered() ?? [])
      .filter(e => permissions.includes(e.permission))
      .map(toView);
    return reply.send(view);
  });

  fastify.get('/api/me/mcp-tokens', async (req, reply) => {
    const users = await readConfig('users');
    const user = users.find(u => u.id === req.dashUser!.id);
    if (!user) return reply.status(404).send({ error: 'User not found' });
    // tokenHash never leaves the service: the snippet is the display identity.
    return reply.send((user.mcpTokens ?? []).map(({ tokenHash: _h, ...rest }) => rest));
  });

  fastify.post<{ Body: unknown }>('/api/me/mcp-tokens', async (req, reply) => {
    const parsed = createTokenSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const users = await readConfig('users');
    const index = users.findIndex(u => u.id === req.dashUser!.id);
    if (index === -1) return reply.status(404).send({ error: 'User not found' });
    const user = users[index]!;
    const existing = user.mcpTokens ?? [];
    if (existing.some(t => t.name.toLowerCase() === parsed.data.name.toLowerCase())) {
      return reply.status(409).send({ error: `An MCP token named "${parsed.data.name}" already exists` });
    }

    const { raw, token } = mintMcpToken(parsed.data.name, parsed.data.expiresAt);
    users[index] = { ...user, mcpTokens: [...existing, token] };
    await writeConfig('users', users);
    audit(req, 'mcp:token_create', 'success', { tokenId: token.id, name: token.name });

    // The raw token is returned once, here, and never again: only its hash is stored.
    const { tokenHash: _h, ...view } = token;
    return reply.status(201).send({ ...view, token: raw });
  });

  fastify.delete<{ Params: { id: string } }>('/api/me/mcp-tokens/:id', async (req, reply) => {
    const users = await readConfig('users');
    const index = users.findIndex(u => u.id === req.dashUser!.id);
    if (index === -1) return reply.status(404).send({ error: 'User not found' });
    const user = users[index]!;
    const remaining = (user.mcpTokens ?? []).filter(t => t.id !== req.params.id);
    if (remaining.length === (user.mcpTokens ?? []).length) {
      return reply.status(404).send({ error: 'Token not found' });
    }
    users[index] = { ...user, mcpTokens: remaining };
    await writeConfig('users', users);
    audit(req, 'mcp:token_revoke', 'success', { tokenId: req.params.id });
    return reply.status(204).send();
  });
};
