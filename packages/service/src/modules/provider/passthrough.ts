/**
 * Wire-transparency helpers shared by the OpenAI-compatible adapters and the
 * OpenAI lane: which client headers reach the provider, which provider headers
 * reach the client.
 */

/** Per-call options an adapter may honour. Adapters that ignore them stay valid. */
export interface CallOptions {
  /** Client request headers to forward to the provider (already filtered). */
  headers?: Record<string, string>;
  /** Called with the provider's response headers (already filtered) once known. */
  onResponseHeaders?: (headers: Record<string, string>) => void;
}

/**
 * Client headers never forwarded upstream: credentials (replaced by the
 * model's own key), connection-level headers owned by the HTTP stack, and
 * Routerly's own control headers.
 */
const DROP_REQUEST = new Set([
  'authorization', 'proxy-authorization', 'x-api-key', 'api-key', 'cookie',
  'host', 'content-length', 'content-type', 'accept-encoding',
  'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade',
]);

export function forwardableRequestHeaders(
  incoming: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    const lower = key.toLowerCase();
    if (value === undefined || DROP_REQUEST.has(lower) || lower.startsWith('x-routerly-')) continue;
    out[lower] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/** Provider response headers that describe the provider's own transfer, not the payload. */
const DROP_RESPONSE = new Set([
  'content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive',
]);

export function forwardableResponseHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = typeof (headers as Headers).forEach === 'function'
    ? (cb: (v: string, k: string) => void) => (headers as Headers).forEach(cb)
    : (cb: (v: string, k: string) => void) => Object.entries(headers).forEach(([k, v]) => cb(v, k));
  entries((value, key) => {
    const lower = key.toLowerCase();
    if (!DROP_RESPONSE.has(lower)) out[lower] = value;
  });
  return out;
}
