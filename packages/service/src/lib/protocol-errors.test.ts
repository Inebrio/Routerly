import { describe, it, expect } from 'vitest';
import { protocolError, protocolForUrl, upstreamErrorBody } from './protocol-errors.js';

describe('protocol-errors', () => {
  it('picks protocol by url', () => {
    expect(protocolForUrl('/v1/messages?x=1')).toBe('anthropic');
    expect(protocolForUrl('/v1/chat/completions')).toBe('openai');
  });
  it('shapes openai', () => {
    expect(protocolError('openai', 401, 'm', 'invalid_api_key')).toEqual({
      error: { message: 'm', type: 'invalid_request_error', param: null, code: 'invalid_api_key' },
    });
  });
  it('shapes anthropic', () => {
    expect(protocolError('anthropic', 401, 'm')).toEqual({
      type: 'error', error: { type: 'authentication_error', message: 'm' },
    });
  });
  it('keeps an upstream body already in the client protocol shape', () => {
    const b = { error: { message: 'bad key', type: 'invalid_request_error', param: null, code: 'invalid_api_key' } };
    expect(upstreamErrorBody('openai', 401, b)).toBe(b);
    const a = { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } };
    expect(upstreamErrorBody('anthropic', 401, a)).toBe(a);
  });
  it('rebuilds an upstream body of the other protocol keeping the provider message', () => {
    const a = { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } };
    expect(upstreamErrorBody('openai', 401, a)).toEqual(protocolError('openai', 401, 'invalid x-api-key'));
    expect(upstreamErrorBody('anthropic', 403, { error: { message: 'nope' } })).toEqual(protocolError('anthropic', 403, 'nope'));
    expect(upstreamErrorBody('openai', 403, undefined)).toEqual(protocolError('openai', 403, 'Upstream provider error'));
  });
  it('wraps the flat inner error object the OpenAI SDK exposes', () => {
    const inner = { message: 'Incorrect API key', type: 'invalid_request_error', param: null, code: 'invalid_api_key' };
    expect(upstreamErrorBody('openai', 401, inner)).toEqual({ error: inner });
  });
});
