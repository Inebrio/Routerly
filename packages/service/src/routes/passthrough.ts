import type { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import type { ModelConfig, ProjectConfig } from '@routerly/shared';
import { readConfig } from '../config/loader.js';
import { resolveProjectByToken } from '../plugins/auth.js';

/**
 * Transparent pass-through proxy.
 *
 * Any path Routerly does not explicitly handle is forwarded to the project's
 * upstream provider with only the API key swapped, making Routerly a drop-in
 * replacement for provider endpoints beyond chat completions (embeddings,
 * audio, files, future APIs). Reserved namespaces (`/`, `/health`, `/api/*`,
 * `/dashboard*`) are never proxied.
 */

/** Incoming request bodies may be parsed JSON, a raw Buffer, a string, or absent. */
type IncomingBody = { model?: unknown } | Buffer | string | undefined | null;

/**
 * Choose which configured model (and therefore provider/endpoint/key) to
 * forward to. If the request body names a `model` matching one of the
 * project's models, use it; otherwise fall back to the first configured model.
 * Returns null when the project has no resolvable models.
 */
export function pickUpstreamModel(
  project: ProjectConfig,
  allModels: ModelConfig[],
  body: IncomingBody,
): ModelConfig | null {
  const resolved = project.models
    .map((ref) => allModels.find((m) => m.id === ref.modelId))
    .filter((m): m is ModelConfig => m !== undefined);

  if (resolved.length === 0) return null;

  const wanted =
    body && !Buffer.isBuffer(body) && typeof body === 'object' && typeof body.model === 'string'
      ? body.model
      : undefined;

  if (wanted) {
    const match = resolved.find(
      (m) => m.id === wanted || m.upstreamModelId === wanted || m.id.endsWith(`/${wanted}`),
    );
    if (match) return match;
  }

  return resolved[0] ?? null;
}

/**
 * Build the upstream URL: the origin of the model's configured endpoint plus
 * the full incoming path and query. e.g. endpoint `https://api.openai.com/v1`
 * + `/v1/embeddings` → `https://api.openai.com/v1/embeddings`.
 */
export function buildUpstreamUrl(model: ModelConfig, requestUrl: string): string {
  return new URL(model.endpoint).origin + requestUrl;
}

const HOP_BY_HOP_REQUEST = new Set([
  'host',
  'content-length',
  'connection',
  'authorization',
  'x-api-key',
]);

/**
 * Clone the incoming headers, drop hop-by-hop and inbound auth headers, and
 * inject the upstream provider's API key in the right format (`x-api-key` for
 * Anthropic, `Authorization: Bearer` for everything else).
 */
export function buildUpstreamHeaders(
  model: ModelConfig,
  incoming: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_REQUEST.has(lower)) continue;
    out[lower] = Array.isArray(value) ? value.join(', ') : value;
  }

  const apiKey = model.apiKey ?? '';
  if (model.provider === 'anthropic' || model.provider === 'anthropic-web') {
    out['x-api-key'] = apiKey;
  } else {
    out['authorization'] = `Bearer ${apiKey}`;
  }
  return out;
}

const HOP_BY_HOP_RESPONSE = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
]);

function isReservedPath(path: string): boolean {
  return (
    path === '/' ||
    path === '/health' ||
    path === '/api' ||
    path.startsWith('/api/') ||
    path.startsWith('/dashboard')
  );
}

/**
 * Fastify not-found handler that proxies unmatched paths to the project's
 * upstream provider. Authenticates explicitly (never relying solely on the
 * auth preHandler firing for the 404 lifecycle) so the proxy can never run
 * unauthenticated.
 */
export async function passthroughHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const { method, url } = request;
  const path = url.split('?')[0] ?? url;

  // Reserved namespaces are never proxied — return a normal 404.
  if (isReservedPath(path)) {
    return reply.code(404).send({ error: 'not_found', message: `Route ${method}:${url} not found` });
  }

  // Authenticate. The auth preHandler usually resolves request.project already;
  // resolve here too as a safeguard for the not-found lifecycle.
  let project = request.project;
  if (!project) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Missing or invalid Authorization header. Expected: Bearer <project-token>',
      });
    }
    const resolved = await resolveProjectByToken(authHeader.slice(7).trim());
    if (!resolved) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Invalid project token.' });
    }
    project = resolved.project;
  }

  const allModels = await readConfig('models');
  const model = pickUpstreamModel(project, allModels, request.body as IncomingBody);
  if (!model || !model.endpoint) {
    return reply.code(502).send({
      error: 'no_upstream',
      message: 'project has no resolvable models for pass-through',
    });
  }

  const targetUrl = buildUpstreamUrl(model, url);
  const headers = buildUpstreamHeaders(model, request.headers);

  let body: Buffer | string | undefined;
  if (method !== 'GET' && method !== 'HEAD' && request.body != null) {
    if (Buffer.isBuffer(request.body)) body = request.body;
    else if (typeof request.body === 'string') body = request.body;
    else body = JSON.stringify(request.body);
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method,
      headers,
      ...(body !== undefined ? { body, duplex: 'half' } : {}),
    } as RequestInit);
  } catch (err) {
    request.log.error({ err, url: targetUrl }, 'pass-through upstream error');
    return reply.code(502).send({
      error: 'upstream_error',
      message: err instanceof Error ? err.message : 'upstream request failed',
    });
  }

  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_RESPONSE.has(key.toLowerCase())) reply.header(key, value);
  });

  request.log.info(
    {
      passthrough: true,
      method,
      path,
      upstreamHost: new URL(targetUrl).host,
      status: upstream.status,
      projectId: project.id,
    },
    'pass-through',
  );

  reply.code(upstream.status);
  if (upstream.body) {
    return reply.send(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]));
  }
  return reply.send();
}
