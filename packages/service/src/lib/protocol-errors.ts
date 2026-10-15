/**
 * Provider-shaped error bodies for the /v1/* proxy surface, so official OpenAI / Anthropic
 * SDKs parse Routerly's own errors (auth, bad JSON, no candidate) like a provider error.
 */
export type ErrorProtocol = 'openai' | 'anthropic';

export function protocolForUrl(url: string): ErrorProtocol {
  return url.split('?')[0]!.startsWith('/v1/messages') ? 'anthropic' : 'openai';
}

/** Upstream statuses that are deterministic for the request/credential: returned to the client when no candidate succeeds (429/5xx stay a generic 503 so fallback semantics are unchanged). */
export const UPSTREAM_PASSTHROUGH_STATUS = [400, 401, 403, 404, 413, 422];

const ANTHROPIC_TYPES: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  413: 'request_too_large',
  429: 'rate_limit_error',
  503: 'overloaded_error',
};

const OPENAI_TYPES: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'invalid_request_error',
  403: 'permission_error',
  404: 'invalid_request_error',
  413: 'invalid_request_error',
  429: 'rate_limit_error',
};

export function protocolError(
  protocol: ErrorProtocol,
  status: number,
  message: string,
  code?: string,
): Record<string, unknown> {
  if (protocol === 'anthropic') {
    return { type: 'error', error: { type: ANTHROPIC_TYPES[status] ?? 'api_error', message } };
  }
  return { error: { message, type: OPENAI_TYPES[status] ?? 'server_error', param: null, code: code ?? null } };
}

/**
 * Body for an upstream provider error returned to the client as-is: kept untouched when it is
 * already in the client protocol's shape, otherwise rebuilt from its message (a provider of the
 * other protocol sits behind the lane, e.g. an Anthropic 401 reached through /v1/chat/completions).
 */
export function upstreamErrorBody(protocol: ErrorProtocol, status: number, body: unknown): unknown {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
  const inner = b?.['error'] && typeof b['error'] === 'object' ? (b['error'] as Record<string, unknown>) : undefined;
  // The OpenAI SDK exposes the inner `error` object only: restore the wire envelope.
  if (protocol === 'openai' && inner === undefined && typeof b?.['message'] === 'string') return { error: b };
  const isAnthropicShape = b?.['type'] === 'error' && inner !== undefined;
  if (inner !== undefined && (protocol === 'anthropic') === isAnthropicShape) return b;
  const msg = typeof inner?.['message'] === 'string' ? inner['message'] : typeof b?.['message'] === 'string' ? b['message'] : typeof body === 'string' ? body : 'Upstream provider error';
  return protocolError(protocol, status, msg);
}
