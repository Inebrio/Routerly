import { describe, it, expect } from 'vitest';
import { CLIENT_REGISTRY, buildSnippet } from './registry.js';

describe('CLIENT_REGISTRY', () => {
  it('contains all five clients', () => {
    const ids = CLIENT_REGISTRY.map((c) => c.id);
    expect(ids).toEqual(['claude-code', 'codex', 'opencode', 'continue', 'cline']);
  });

  it('each client has non-empty label', () => {
    CLIENT_REGISTRY.forEach((c) => {
      expect(c.label).toBeTruthy();
      expect(c.label.length).toBeGreaterThan(0);
    });
  });

  it('each client has non-empty docSlug', () => {
    CLIENT_REGISTRY.forEach((c) => {
      expect(c.docSlug).toBeTruthy();
      expect(c.docSlug.length).toBeGreaterThan(0);
    });
  });

  it('each client has non-empty configPathHint', () => {
    CLIENT_REGISTRY.forEach((c) => {
      expect(c.configPathHint).toBeTruthy();
      expect(c.configPathHint.length).toBeGreaterThan(0);
    });
  });

  it('claude-code has anthropic wire format, others have openai', () => {
    const claudeCode = CLIENT_REGISTRY.find((c) => c.id === 'claude-code');
    expect(claudeCode?.wireFormat).toBe('anthropic');

    const others = CLIENT_REGISTRY.filter((c) => c.id !== 'claude-code');
    others.forEach((c) => {
      expect(c.wireFormat).toBe('openai');
    });
  });
});

describe('buildSnippet', () => {
  it('for anthropic client embeds base URL and token and mentions ANTHROPIC_BASE_URL', () => {
    const claudeCodeMeta = CLIENT_REGISTRY.find((c) => c.id === 'claude-code')!;
    const baseUrl = 'https://routerly.example.com';
    const token = 'sk-test-token-123';

    const snippet = buildSnippet(claudeCodeMeta, baseUrl, token);
    expect(snippet).toContain(baseUrl);
    expect(snippet).toContain(token);
    expect(snippet).toContain('ANTHROPIC_BASE_URL');
  });

  it('for openai client embeds base URL verbatim (no /v1 auto-append) and token', () => {
    const openCodeMeta = CLIENT_REGISTRY.find((c) => c.id === 'opencode')!;
    const baseUrl = 'https://routerly.example.com';
    const token = 'sk-test-token-456';

    const snippet = buildSnippet(openCodeMeta, baseUrl, token);
    expect(snippet).toContain(baseUrl);
    expect(snippet).toContain(token);
    // Verify /v1 is NOT auto-appended to the base URL in the snippet
    expect(snippet).not.toContain(baseUrl + '/v1');
  });
});
