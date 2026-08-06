import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { fastifyPlugin as fp } from 'fastify-plugin';
import type { RouterConfig, RouterToken } from '@routerly/shared';
import { readConfig, writeConfig } from '../config/loader.js';
import { emitEvent } from '../notifications/emitter.js';
import { applyProfiles } from '../routing/profiles/store.js';
import { resolveExperimentRequest } from '../experiments/resolve.js';
import { conversationPrefix } from '../experiments/rotation.js';

// Augment FastifyRequest to carry the resolved router and token
declare module 'fastify' {
  interface FastifyRequest {
    router: RouterConfig;
    token: RouterToken;
    /** Set only when the caller used an experiment token: which test picked this router (T71). */
    experiment?: { id: string; variantId: string };
  }
}

/**
 * Extract the router token from the request headers, accepting either auth
 * style so SDK clients work drop-in (wire transparency, CLAUDE.md):
 *  - `Authorization: Bearer <token>` (OpenAI SDK), takes precedence;
 *  - `x-api-key: <token>` (Anthropic SDK).
 * Returns null if neither carries a usable token.
 */
export function extractRouterToken(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const authHeader = headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }
  const apiKey = headers['x-api-key'];
  const key = Array.isArray(apiKey) ? apiKey[0] : apiKey;
  if (typeof key === 'string' && key.trim()) return key.trim();
  return null;
}

/**
 * Resolve a raw bearer token to its owning router and token entry.
 * Returns null if no router owns the token. Shared by the auth preHandler
 * and the pass-through proxy handler so both authenticate identically.
 */
export async function resolveRouterByToken(
  incomingToken: string,
): Promise<{ router: RouterConfig; token: RouterToken } | null> {
  const routers = await readConfig('routers');
  for (const router of routers) {
    for (const token of router.tokens || []) {
      if (token.token === incomingToken) {
        return { router, token };
      }
    }
  }
  return null;
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('router', null as unknown as RouterConfig);
  fastify.decorateRequest('token', null as unknown as RouterToken);

  fastify.addHook('preHandler', async (request: FastifyRequest, reply) => {
    // Skip auth for non-LLM-proxy routes (health check, dashboard UI, dashboard API)
    const url = request.url;
    // /mcp is self-authenticating (see modules/mcp/http.ts): it resolves the
    // router token and enforces the mcp scope itself, so skip the proxy auth here.
    if (url === '/' || url === '/health' || url === '/metrics' || url.startsWith('/dashboard') || url.startsWith('/api/') || url.startsWith('/mcp')) return;

    const incomingToken = extractRouterToken(request.headers);
    if (!incomingToken) {
      return reply.status(401).send({
        error: 'unauthorized',
        message: 'Missing or invalid Authorization header. Expected: Bearer <router-token>',
      });
    }

    const resolved = await resolveRouterByToken(incomingToken);
    if (resolved) {
      const { router, token } = resolved;

      // Enforce expiry
      if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
        void emitEvent('auth.token_invalid', 'warning', { routerId: router.id, reason: 'expired' }, {});
        return reply.status(401).send({ error: 'Token expired' });
      }

      // Track lastUsedAt — fire-and-forget, don't block the request
      token.lastUsedAt = new Date().toISOString();
      const routers = await readConfig('routers');
      const pi = routers.findIndex(p => p.id === router.id);
      if (pi !== -1) {
        const ti = routers[pi]!.tokens?.findIndex(t => t.token === incomingToken) ?? -1;
        if (ti !== -1) routers[pi]!.tokens![ti]!.lastUsedAt = token.lastUsedAt;
        writeConfig('routers', routers).catch(() => { /* non-fatal */ });
      }

      // Bound optimizer/security profiles are folded into the router once, here,
      // so every downstream consumer keeps reading router.optimizers /
      // .guardrails / .pii and needs no knowledge of profiles at all.
      request.router = await applyProfiles(router);
      request.token = token;
      return;
    }

    // Not a router token: it may be an experiment's own token, in which case
    // the experiment picks one of its variant routers and the request
    // continues as if that router's token had been used (T71).
    const body = request.body as { user?: unknown } | undefined;
    const experiment = await resolveExperimentRequest(incomingToken, {
      ...(typeof body?.user === 'string' ? { endUserId: body.user } : {}),
      ...(conversationPrefix(request.body) ? { conversationPrefix: conversationPrefix(request.body)! } : {}),
      ...(request.ip ? { ip: request.ip } : {}),
      ...(typeof request.headers['user-agent'] === 'string' ? { userAgent: request.headers['user-agent'] } : {}),
    });

    if (experiment) {
      if (experiment.status === 'expired') {
        void emitEvent('auth.token_invalid', 'warning', { experimentId: experiment.experiment.id, reason: 'expired' }, {});
        return reply.status(401).send({ error: 'Token expired' });
      }
      if (experiment.status === 'misconfigured') {
        return reply.status(503).send({
          error: 'experiment_misconfigured',
          message: `Experiment "${experiment.experiment.name}" has no variant pointing at an existing router.`,
        });
      }
      request.router = await applyProfiles(experiment.router);
      request.token = experiment.token;
      request.experiment = { id: experiment.experiment.id, variantId: experiment.variant.id };
      return;
    }

    void emitEvent('auth.token_invalid', 'warning', { reason: 'not_found' }, {});
    return reply.status(401).send({
      error: 'unauthorized',
      message: 'Invalid router token.',
    });
  });
};

export default fp(authPlugin, { name: 'auth' });
