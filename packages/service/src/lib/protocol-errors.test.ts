import { describe, it, expect } from 'vitest';
import { protocolError, protocolForUrl } from './protocol-errors.js';

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
});
