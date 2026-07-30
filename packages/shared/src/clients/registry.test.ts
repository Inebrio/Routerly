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

  it('for opencode produces the real config shape: provider.routerly.options.{baseURL,apiKey}, /v1 appended, and no fabricated top-level shape', () => {
    const openCodeMeta = CLIENT_REGISTRY.find((c) => c.id === 'opencode')!;
    expect(openCodeMeta.configKind).toBe('json');
    expect(openCodeMeta.configPathHint).toBe('~/.config/opencode/opencode.json');

    const baseUrl = 'https://routerly.example.com';
    const token = 'sk-test-token-456';

    const snippet = buildSnippet(openCodeMeta, baseUrl, token);
    const parsed = JSON.parse(snippet);

    expect(parsed.$schema).toBe('https://opencode.ai/config.json');
    expect(parsed.provider.routerly.npm).toBe('@ai-sdk/openai-compatible');
    expect(parsed.provider.routerly.name).toBe('Routerly');
    expect(parsed.provider.routerly.options.baseURL).toBe(`${baseUrl}/v1`);
    expect(parsed.provider.routerly.options.apiKey).toBe(token);
    expect(parsed.provider.routerly.models).toHaveProperty('routerly/ada');

    // Regression guards: the old fabricated generic {opencode:{baseUrl,apiKey}}
    // shape (and any env-var-reference apiKey) must never come back.
    expect(parsed).not.toHaveProperty('opencode');
    expect(parsed.provider.routerly).not.toHaveProperty('baseUrl');
    expect(parsed.provider).not.toHaveProperty('opencode');
    expect(snippet).not.toContain('{env:');
  });

  it('for codex produces the real config.toml shape: model_provider selector, [model_providers.routerly] table, /v1 base_url, and literal bearer token', () => {
    const codexMeta = CLIENT_REGISTRY.find((c) => c.id === 'codex')!;
    expect(codexMeta.configKind).toBe('toml');
    expect(codexMeta.configPathHint).toBe('~/.codex/config.toml');

    const baseUrl = 'https://routerly.example.com';
    const token = 'sk-test-token-789';

    const snippet = buildSnippet(codexMeta, baseUrl, token);
    const lines = snippet.split('\n');

    // Structural assertions, not just substring matches.
    expect(lines).toContain('model_provider = "routerly"');
    expect(lines).toContain('[model_providers.routerly]');
    expect(lines).toContain('name = "Routerly"');
    expect(lines).toContain(`base_url = "${baseUrl}/v1"`);
    expect(lines).toContain('wire_api = "responses"');
    expect(lines).toContain(`experimental_bearer_token = "${token}"`);

    // Regression guards: the old fabricated generic [codex]\nbaseUrl=/apiKey=
    // shape must never come back, and env_key (which would require a manual
    // export step) must not silently replace the literal-token mechanism.
    expect(snippet).not.toContain('[codex]');
    expect(snippet).not.toContain('baseUrl =');
    expect(snippet).not.toContain('apiKey =');
    expect(snippet).not.toContain('env_key');
  });
});
