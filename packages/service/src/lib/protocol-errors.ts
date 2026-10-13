/**
 * Provider-shaped error bodies for the /v1/* proxy surface, so official OpenAI / Anthropic
 * SDKs parse Routerly's own errors (auth, bad JSON, no candidate) like a provider error.
 */
export type ErrorProtocol = 'openai' | 'anthropic';

export function protocolForUrl(url: string): ErrorProtocol {
  return url.split('?')[0]!.startsWith('/v1/messages') ? 'anthropic' : 'openai';
}

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
