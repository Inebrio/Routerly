import type { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import type { ModelConfig } from '@routerly/shared';
import { buildUpstreamUrl } from './passthrough.js';
import { trackUsage } from '../cost/tracker.js';

/**
 * Faithful pass-through for subscription / OAuth models (Flow A).
 *
 * When a model's credential is a subscription OAuth token (e.g. a Claude
 * Pro/Max token from `claude setup-token`) the request must be forwarded to the
 * provider **verbatim** — bypassing the SDK adapter, which reconstructs the body
 * and would corrupt the `system` block / tool-use content. The client (real
 * Claude Code, pointed at Routerly) supplies its own system block; Routerly only
 * swaps the inbound tenant `Authorization` for the stored OAuth token and adds
 * the headers Anthropic expects for OAuth credentials. Nothing in the body is
 * altered and no identity is injected.
 */

/** Anthropic OAuth beta header value required for `sk-ant-oat…` credentials. */
const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20';

/**
 * Request headers we never forward upstream: true hop-by-hop headers plus the
 * inbound tenant-auth headers (the Routerly project token), which we replace
 * with the stored OAuth credential.
 */
const DROP_REQUEST = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'authorization',
  'x-api-key',
]);

/** Response headers that must not be copied back when re-streaming. */
const HOP_BY_HOP_RESPONSE = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
]);

/**
 * Clone the incoming headers, drop hop-by-hop + inbound tenant auth, and inject
 * the stored OAuth credential as `Authorization: Bearer`. Ensures the Anthropic
 * OAuth beta is present (merged with the client's `anthropic-beta`, never
 * clobbering it) and defaults `anthropic-version` when the client omitted it.
 */
export function buildOAuthForwardHeaders(
  model: ModelConfig,
  incoming: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (DROP_REQUEST.has(lower)) continue;
    out[lower] = Array.isArray(value) ? value.join(', ') : value;
  }

  out['authorization'] = `Bearer ${model.apiKey ?? ''}`;
  out['anthropic-dangerous-direct-browser-access'] = 'true';

  const betas = out['anthropic-beta']
    ? out['anthropic-beta'].split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  if (!betas.includes(ANTHROPIC_OAUTH_BETA)) betas.push(ANTHROPIC_OAUTH_BETA);
  out['anthropic-beta'] = betas.join(',');

  if (!out['anthropic-version']) out['anthropic-version'] = '2023-06-01';

  return out;
}

/**
 * Forward the current request verbatim to the model's upstream endpoint using
 * the stored OAuth credential, then stream the response back to the client.
 */
export async function forwardAnthropicOAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  model: ModelConfig,
): Promise<unknown> {
  const startMs = Date.now();
  const projectId = request.project?.id ?? '';
  const { method, url } = request;
  const targetUrl = buildUpstreamUrl(model, url);
  const headers = buildOAuthForwardHeaders(model, request.headers);

  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD' && request.body != null) {
    body =
      typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method,
      headers,
      ...(body !== undefined ? { body, duplex: 'half' } : {}),
    } as RequestInit);
  } catch (err) {
    request.log.error({ err, url: targetUrl }, 'oauth pass-through upstream error');
    if (projectId) {
      void trackUsage({ projectId, model, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - startMs, outcome: 'error', callType: 'completion' }).catch(() => {});
    }
    return reply.code(502).send({
      type: 'error',
      error: {
        type: 'api_error',
        message: err instanceof Error ? err.message : 'upstream request failed',
      },
    });
  }

  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_RESPONSE.has(key.toLowerCase())) reply.header(key, value);
  });

  request.log.info(
    {
      oauth: true,
      provider: model.provider,
      modelId: model.id,
      path: url,
      upstreamHost: new URL(targetUrl).host,
      status: upstream.status,
      projectId: request.project ? request.project.id : undefined,
    },
    'oauth pass-through',
  );

  if (projectId) {
    void trackUsage({ projectId, model, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - startMs, outcome: upstream.ok ? 'success' : 'error', callType: 'completion' }).catch(() => {});
  }

  reply.code(upstream.status);
  if (upstream.body) {
    return reply.send(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]));
  }
  return reply.send();
}
