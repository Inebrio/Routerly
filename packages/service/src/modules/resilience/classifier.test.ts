import { describe, it, expect } from 'vitest';
import { classifyUpstreamError } from './classifier.js';

describe('classifyUpstreamError', () => {
  // ── auth ──────────────────────────────────────────────────────────────────
  it('classifies OpenAI 401 as auth', () => {
    expect(
      classifyUpstreamError(null, {
        status: 401,
        body: { error: { message: 'Incorrect API key provided', type: 'invalid_request_error', param: null, code: 'invalid_api_key' } },
      }),
    ).toEqual({ category: 'auth' });
  });

  it('classifies Anthropic 401 authentication_error as auth', () => {
    expect(
      classifyUpstreamError(null, { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }),
    ).toEqual({ category: 'auth' });
  });

  it('classifies Anthropic 403 permission_error as auth', () => {
    expect(
      classifyUpstreamError(null, { status: 403, body: { type: 'error', error: { type: 'permission_error', message: 'no access' } } }),
    ).toEqual({ category: 'auth' });
  });

  // ── rate-limit ───────────────────────────────────────────────────────────
  it('classifies OpenAI 429 with retry-after seconds as rate-limit', () => {
    expect(classifyUpstreamError(null, { status: 429, headers: { 'retry-after': '30' } })).toMatchObject({
      category: 'rate-limit',
      retryAfterMs: 30000,
    });
  });

  it('prefers OpenAI-specific retry-after-ms header over retry-after', () => {
    expect(
      classifyUpstreamError(null, { status: 429, headers: { 'retry-after-ms': '1500', 'retry-after': '30' } }),
    ).toMatchObject({ category: 'rate-limit', retryAfterMs: 1500 });
  });

  it('parses HTTP-date retry-after into retryAfterMs', () => {
    const future = new Date(Date.now() + 20000).toUTCString();
    const fault = classifyUpstreamError(null, { status: 429, headers: { 'retry-after': future } });
    expect(fault.category).toBe('rate-limit');
    expect(fault.retryAfterMs).toBeGreaterThan(15000);
    expect(fault.retryAfterMs).toBeLessThanOrEqual(20000);
  });

  it('classifies Anthropic 429 rate_limit_error as rate-limit', () => {
    expect(
      classifyUpstreamError(null, {
        status: 429,
        headers: { 'retry-after': '10' },
        body: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } },
      }),
    ).toMatchObject({ category: 'rate-limit', retryAfterMs: 10000 });
  });

  // ── quota ────────────────────────────────────────────────────────────────
  it('classifies OpenAI insufficient_quota (429) as quota', () => {
    expect(
      classifyUpstreamError(null, {
        status: 429,
        body: {
          error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', param: null, code: 'insufficient_quota' },
        },
      }),
    ).toEqual({ category: 'quota' });
  });

  it('classifies OpenAI insufficient_quota with retry-after into retryAfterMs + resetAt', () => {
    const fault = classifyUpstreamError(null, {
      status: 429,
      headers: { 'retry-after': '60' },
      body: { error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'quota exceeded' } },
    });
    expect(fault.category).toBe('quota');
    expect(fault.retryAfterMs).toBe(60000);
    expect(fault.resetAt).toBeGreaterThan(Date.now());
  });

  it('classifies Anthropic 402 billing_error as quota', () => {
    expect(
      classifyUpstreamError(null, { status: 402, body: { type: 'error', error: { type: 'billing_error', message: 'payment required' } } }),
    ).toEqual({ category: 'quota' });
  });

  // ── timeout ──────────────────────────────────────────────────────────────
  it('classifies ETIMEDOUT network error as timeout', () => {
    expect(classifyUpstreamError(new Error('ETIMEDOUT'))).toEqual({ category: 'timeout' });
  });

  it('classifies ECONNRESET network error as timeout', () => {
    expect(classifyUpstreamError(new Error('socket hang up ECONNRESET'))).toEqual({ category: 'timeout' });
  });

  it('classifies AbortError as timeout', () => {
    expect(classifyUpstreamError(new Error('The operation was aborted'))).toEqual({ category: 'timeout' });
  });

  it('classifies Anthropic 504 timeout_error as timeout', () => {
    expect(
      classifyUpstreamError(null, { status: 504, body: { type: 'error', error: { type: 'timeout_error', message: 'timed out' } } }),
    ).toEqual({ category: 'timeout' });
  });

  // ── server ───────────────────────────────────────────────────────────────
  it('classifies a bare 503 as server', () => {
    expect(classifyUpstreamError(null, { status: 503 })).toEqual({ category: 'server' });
  });

  it('classifies OpenAI 500 as server', () => {
    expect(classifyUpstreamError(null, { status: 500, body: { error: { message: 'internal error', type: 'server_error' } } })).toEqual({
      category: 'server',
    });
  });

  it('classifies Anthropic 500 api_error as server', () => {
    expect(
      classifyUpstreamError(null, { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'internal error' } } }),
    ).toEqual({ category: 'server' });
  });

  it('classifies Anthropic 529 overloaded_error as server', () => {
    expect(
      classifyUpstreamError(null, { status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } } }),
    ).toEqual({ category: 'server' });
  });

  it('falls back to server for an unrecognized error with no response', () => {
    expect(classifyUpstreamError(new Error('something exploded'))).toEqual({ category: 'server' });
  });

  it('falls back to rate-limit via message regex when no response is present', () => {
    expect(classifyUpstreamError(new Error('429 Too Many Requests'))).toEqual({ category: 'rate-limit' });
  });

  // ── invalid-request ──────────────────────────────────────────────────────
  it('classifies OpenAI 400 unknown_parameter as invalid-request', () => {
    expect(
      classifyUpstreamError(null, {
        status: 400,
        body: { error: { message: "Unrecognized request argument supplied: foo", type: 'invalid_request_error', param: 'foo', code: 'unknown_parameter' } },
      }),
    ).toEqual({ category: 'invalid-request' });
  });

  it('classifies Anthropic 400 invalid_request_error as invalid-request', () => {
    expect(
      classifyUpstreamError(null, { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'bad request' } } }),
    ).toEqual({ category: 'invalid-request' });
  });

  it('classifies Anthropic 409 conflict_error as invalid-request', () => {
    expect(
      classifyUpstreamError(null, { status: 409, body: { type: 'error', error: { type: 'conflict_error', message: 'conflict' } } }),
    ).toEqual({ category: 'invalid-request' });
  });

  it('classifies Anthropic 413 request_too_large as invalid-request', () => {
    expect(
      classifyUpstreamError(null, { status: 413, body: { type: 'error', error: { type: 'request_too_large', message: 'too large' } } }),
    ).toEqual({ category: 'invalid-request' });
  });

  // ── model-not-found ──────────────────────────────────────────────────────
  it('classifies OpenAI 404 model_not_found as model-not-found', () => {
    expect(
      classifyUpstreamError(null, {
        status: 404,
        body: { message: 'The model: `gpt-4` does not exist', type: 'invalid_request_error', param: null, code: 'model_not_found' },
      }),
    ).toEqual({ category: 'model-not-found' });
  });

  it('classifies Anthropic 404 not_found_error as model-not-found', () => {
    expect(
      classifyUpstreamError(null, { status: 404, body: { type: 'error', error: { type: 'not_found_error', message: 'model not found' } } }),
    ).toEqual({ category: 'model-not-found' });
  });

  // ── content-safety ───────────────────────────────────────────────────────
  it('classifies OpenAI content_policy_violation (400) as content-safety', () => {
    expect(
      classifyUpstreamError(null, {
        status: 400,
        body: { error: { code: 'content_policy_violation', message: 'Your request was rejected as a result of our safety system.', param: null, type: 'invalid_request_error' } },
      }),
    ).toEqual({ category: 'content-safety' });
  });

  it('classifies a content_filter code (400) as content-safety', () => {
    expect(
      classifyUpstreamError(null, { status: 400, body: { error: { code: 'content_filter', type: 'invalid_request_error', message: 'blocked' } } }),
    ).toEqual({ category: 'content-safety' });
  });

  it('classifies a synthetic Anthropic refusal (stop_reason on the failure path) as content-safety', () => {
    expect(classifyUpstreamError(null, { body: { stop_reason: 'refusal' } })).toEqual({ category: 'content-safety' });
  });

  // ── defensive status-only fallback (no recognized body shape) ───────────
  it('falls back to auth for an unrecognized 401 body shape', () => {
    expect(classifyUpstreamError(null, { status: 401, body: { weird: 'shape' } })).toEqual({ category: 'auth' });
  });

  it('falls back to invalid-request for an unrecognized 400 body shape', () => {
    expect(classifyUpstreamError(null, { status: 400 })).toEqual({ category: 'invalid-request' });
  });
});
