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
  it('for anthropic client produces settings.json with nested env, ANTHROPIC_BASE_URL/AUTH_TOKEN, and no fabricated keys', () => {
    const claudeCodeMeta = CLIENT_REGISTRY.find((c) => c.id === 'claude-code')!;
    const baseUrl = 'https://routerly.example.com';
    const token = 'sk-test-token-123';

    const snippet = buildSnippet(claudeCodeMeta, baseUrl, token);
    const parsed = JSON.parse(snippet);

    // Correct Claude Code settings.json shape: { env: { ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN } }
    expect(parsed).toHaveProperty('env');
    expect(parsed.env.ANTHROPIC_BASE_URL).toBe(baseUrl);
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe(token);

    // Regression guards: the old fabricated shape and wrong auth var must never come back.
    expect(parsed).not.toHaveProperty('claude_code');
    expect(parsed.env).not.toHaveProperty('apiKey');
    expect(parsed.env).not.toHaveProperty('baseUrl');
    expect(parsed.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(snippet).not.toContain('claude_code');
    expect(snippet).not.toContain('ANTHROPIC_API_KEY');
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
