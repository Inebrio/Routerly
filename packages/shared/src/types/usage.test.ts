import { describe, it, expect } from 'vitest';
import { REQUEST_TYPES, requestTypeFromPath, requestTypeLabel } from './usage.js';

describe('requestTypeFromPath', () => {
  it('maps the chat-shaped endpoints to chat', () => {
    expect(requestTypeFromPath('/v1/chat/completions')).toBe('chat');
    expect(requestTypeFromPath('/v1/responses')).toBe('chat');
    expect(requestTypeFromPath('/v1/messages')).toBe('chat');
    expect(requestTypeFromPath('/v1/messages/count_tokens')).toBe('chat');
  });

  it('keeps the legacy text-completion API distinct from chat', () => {
    expect(requestTypeFromPath('/v1/completions')).toBe('completion');
  });

  it('maps the non-chat model APIs', () => {
    expect(requestTypeFromPath('/v1/embeddings')).toBe('embedding');
    expect(requestTypeFromPath('/v1/rerank')).toBe('rerank');
    expect(requestTypeFromPath('/v1/images/generations')).toBe('image');
    expect(requestTypeFromPath('/v1/audio/speech')).toBe('audio');
  });

  it('ignores the query string and the path prefix', () => {
    expect(requestTypeFromPath('/openai/v1/embeddings?encoding_format=float')).toBe('embedding');
    expect(requestTypeFromPath('/V1/EMBEDDINGS')).toBe('embedding');
  });

  it('returns undefined for paths that are not model API calls', () => {
    expect(requestTypeFromPath('/favicon.ico')).toBeUndefined();
    expect(requestTypeFromPath('/v1/models')).toBeUndefined();
    expect(requestTypeFromPath('')).toBeUndefined();
  });
});

describe('requestTypeLabel', () => {
  it('labels every request type, keeping "completion" distinct from the callType label', () => {
    expect(REQUEST_TYPES.map(requestTypeLabel)).toEqual([
      'Chat', 'Text Completion', 'Embedding', 'Rerank', 'Image', 'Audio',
    ]);
  });
});
