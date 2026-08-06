import { describe, it, expect } from 'vitest';
import { CLIENT_REGISTRY, buildSnippet, buildMcpSnippet } from './registry.js';

const BASE_URL = 'https://routerly.example.com';
const TOKEN = 'sk-rt-test-token';
const MCP_TOKEN = 'sk-rt-mcp-test-token';

function meta(id: string) {
  const found = CLIENT_REGISTRY.find((c) => c.id === id);
  expect(found, `registry entry "${id}"`).toBeDefined();
  return found!;
}

describe('CLIENT_REGISTRY', () => {
  it('contains every connectable client', () => {
    const ids = CLIENT_REGISTRY.map((c) => c.id);
    expect(ids).toEqual([
      'claude-code',
      'claude-desktop',
      'codex',
      'opencode',
      'openclaw',
      'continue',
      'cursor',
      'cline',
      'zed',
      'generic-openai',
      'generic-anthropic',
    ]);
  });

  it('each client has non-empty label, docSlug and configPathHint', () => {
    CLIENT_REGISTRY.forEach((c) => {
      expect(c.label).toBeTruthy();
      expect(c.docSlug).toBeTruthy();
      expect(c.configPathHint).toBeTruthy();
    });
  });

  it('each client declares at least one connect mode', () => {
    CLIENT_REGISTRY.forEach((c) => {
      expect(c.modes.length).toBeGreaterThan(0);
      c.modes.forEach((mode) => expect(['llm', 'mcp']).toContain(mode));
    });
  });

  it('anthropic wire format only for the Anthropic-SDK clients', () => {
    const anthropic = CLIENT_REGISTRY.filter((c) => c.wireFormat === 'anthropic').map((c) => c.id);
    expect(anthropic).toEqual(['claude-code', 'claude-desktop', 'generic-anthropic']);
  });

  it('claude-desktop is MCP only: it has no base URL override to configure', () => {
    expect(meta('claude-desktop').modes).toEqual(['mcp']);
  });

  it('ids are unique', () => {
    const ids = CLIENT_REGISTRY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildSnippet', () => {
  it('claude-code: settings.json with nested env, ANTHROPIC_BASE_URL/AUTH_TOKEN, no fabricated keys', () => {
    const snippet = buildSnippet(meta('claude-code'), BASE_URL, TOKEN);
    const parsed = JSON.parse(snippet);

    expect(parsed.env.ANTHROPIC_BASE_URL).toBe(BASE_URL);
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe(TOKEN);

    // Regression guards: the old fabricated shape and wrong auth var must never come back.
    expect(parsed).not.toHaveProperty('claude_code');
    expect(parsed.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(snippet).not.toContain('ANTHROPIC_API_KEY');
  });

  it('claude-code: a trailing slash on the base URL is not doubled', () => {
    const parsed = JSON.parse(buildSnippet(meta('claude-code'), `${BASE_URL}/`, TOKEN));
    expect(parsed.env.ANTHROPIC_BASE_URL).toBe(BASE_URL);
  });

  it('opencode: provider.routerly.options.{baseURL,apiKey} with /v1 appended', () => {
    const entry = meta('opencode');
    expect(entry.configKind).toBe('json');
    expect(entry.configPathHint).toBe('~/.config/opencode/opencode.json');

    const parsed = JSON.parse(buildSnippet(entry, BASE_URL, TOKEN));

    expect(parsed.$schema).toBe('https://opencode.ai/config.json');
    expect(parsed.provider.routerly.npm).toBe('@ai-sdk/openai-compatible');
    expect(parsed.provider.routerly.options.baseURL).toBe(`${BASE_URL}/v1`);
    expect(parsed.provider.routerly.options.apiKey).toBe(TOKEN);
    expect(parsed.provider.routerly.models).toHaveProperty('routerly/ada');

    // Regression guard: the old fabricated generic shape must never come back.
    expect(parsed).not.toHaveProperty('opencode');
    expect(parsed.provider.routerly).not.toHaveProperty('baseUrl');
  });

  it('codex: model_provider selector, [model_providers.routerly] table, /v1 base_url, literal bearer token', () => {
    const entry = meta('codex');
    expect(entry.configPathHint).toBe('~/.codex/config.toml');

    const lines = buildSnippet(entry, BASE_URL, TOKEN).split('\n');

    expect(lines).toContain('model_provider = "routerly"');
    expect(lines).toContain('[model_providers.routerly]');
    expect(lines).toContain('name = "Routerly"');
    expect(lines).toContain(`base_url = "${BASE_URL}/v1"`);
    expect(lines).toContain('wire_api = "responses"');
    expect(lines).toContain(`experimental_bearer_token = "${TOKEN}"`);
    expect(lines).not.toContain('env_key');
  });

  it('openclaw: models.providers.routerly with baseUrl/apiKey and a routerly/ada default', () => {
    const entry = meta('openclaw');
    expect(entry.configPathHint).toBe('~/.openclaw/openclaw.json');

    const parsed = JSON.parse(buildSnippet(entry, BASE_URL, TOKEN));

    expect(parsed.models.providers.routerly.baseUrl).toBe(`${BASE_URL}/v1`);
    expect(parsed.models.providers.routerly.apiKey).toBe(TOKEN);
    expect(parsed.models.providers.routerly.models).toEqual([{ id: 'ada' }]);
    // "<provider>/<model id>" reference, which lands on Routerly's own sentinel.
    expect(parsed.agents.defaults.model.primary).toBe('routerly/ada');
  });

  it('continue: name/version/schema header plus a models array entry', () => {
    const lines = buildSnippet(meta('continue'), BASE_URL, TOKEN).split('\n');

    expect(lines).toContain('name: Routerly');
    expect(lines).toContain('schema: v1');
    expect(lines).toContain('models:');
    expect(lines).toContain('    provider: openai');
    expect(lines).toContain('    model: routerly/ada');
    expect(lines).toContain(`    apiBase: ${BASE_URL}/v1`);
    expect(lines).toContain(`    apiKey: ${TOKEN}`);
  });

  it('zed: language_models.openai_compatible entry, and never the API key', () => {
    const entry = meta('zed');
    expect(entry.configPathHint).toBe('~/.config/zed/settings.json');

    const snippet = buildSnippet(entry, BASE_URL, TOKEN);
    const parsed = JSON.parse(snippet);
    const provider = parsed.language_models.openai_compatible.Routerly;

    expect(provider.api_url).toBe(`${BASE_URL}/v1`);
    expect(provider.available_models[0].name).toBe('routerly/ada');
    // Zed keeps provider keys in the system keychain, not in settings.json:
    // writing the token here would be both wrong and a leak.
    expect(snippet).not.toContain(TOKEN);
    expect(snippet).not.toContain('api_key');
  });

  it('cursor and cline: manual steps carrying the real base URL, not file content', () => {
    for (const id of ['cursor', 'cline']) {
      const snippet = buildSnippet(meta(id), BASE_URL, TOKEN);
      expect(snippet).toContain(`${BASE_URL}/v1`);
      expect(snippet).toContain(TOKEN);
      expect(() => JSON.parse(snippet)).toThrow();
    }
  });

  it('claude-desktop: says plainly that chat traffic cannot be routed', () => {
    const snippet = buildSnippet(meta('claude-desktop'), BASE_URL, TOKEN);
    expect(snippet).toContain('no base URL override');
    expect(snippet).not.toContain(TOKEN);
  });

  it('generic clients: the environment variables their own SDK reads', () => {
    expect(buildSnippet(meta('generic-openai'), BASE_URL, TOKEN)).toBe(
      `OPENAI_BASE_URL=${BASE_URL}/v1\nOPENAI_API_KEY=${TOKEN}`
    );
    expect(buildSnippet(meta('generic-anthropic'), BASE_URL, TOKEN)).toBe(
      `ANTHROPIC_BASE_URL=${BASE_URL}\nANTHROPIC_AUTH_TOKEN=${TOKEN}`
    );
  });
});

describe('buildMcpSnippet', () => {
  it('returns empty for clients without a verified MCP wiring', () => {
    for (const id of ['continue', 'generic-openai', 'generic-anthropic']) {
      expect(buildMcpSnippet(meta(id), BASE_URL, MCP_TOKEN)).toBe('');
    }
  });

  it('claude-code: the CLI one-liner with the Authorization header', () => {
    const snippet = buildMcpSnippet(meta('claude-code'), BASE_URL, MCP_TOKEN);
    expect(snippet).toContain('claude mcp add --transport http routerly');
    expect(snippet).toContain(`${BASE_URL}/mcp`);
    expect(snippet).toContain(`Authorization: Bearer ${MCP_TOKEN}`);
  });

  it('claude-desktop: mcpServers entry spawning the CLI stdio bridge', () => {
    const parsed = JSON.parse(buildMcpSnippet(meta('claude-desktop'), BASE_URL, MCP_TOKEN));
    expect(parsed.mcpServers.routerly.command).toBe('routerly');
    expect(parsed.mcpServers.routerly.args).toEqual(['mcp', 'serve']);
    expect(parsed.mcpServers.routerly.env.ROUTERLY_MCP_TOKEN).toBe(MCP_TOKEN);
  });

  it('codex: mcp_servers table reading the token from the environment', () => {
    const lines = buildMcpSnippet(meta('codex'), BASE_URL, MCP_TOKEN).split('\n');
    expect(lines).toContain('[mcp_servers.routerly]');
    expect(lines).toContain(`url = "${BASE_URL}/mcp"`);
    expect(lines).toContain('bearer_token_env_var = "ROUTERLY_MCP_TOKEN"');
  });

  it('opencode: remote mcp entry with the Authorization header', () => {
    const parsed = JSON.parse(buildMcpSnippet(meta('opencode'), BASE_URL, MCP_TOKEN));
    expect(parsed.mcp.routerly.type).toBe('remote');
    expect(parsed.mcp.routerly.url).toBe(`${BASE_URL}/mcp`);
    expect(parsed.mcp.routerly.headers.Authorization).toBe(`Bearer ${MCP_TOKEN}`);
  });

  it('openclaw: streamable-http transport, since sse is the default and is not served', () => {
    const snippet = buildMcpSnippet(meta('openclaw'), BASE_URL, MCP_TOKEN);
    expect(snippet).toContain('openclaw mcp add routerly');
    expect(snippet).toContain('--transport streamable-http');
    expect(snippet).toContain(`--url ${BASE_URL}/mcp`);
  });

  it('cursor: mcpServers entry with url and the Authorization header', () => {
    const parsed = JSON.parse(buildMcpSnippet(meta('cursor'), BASE_URL, MCP_TOKEN));
    expect(parsed.mcpServers.routerly.url).toBe(`${BASE_URL}/mcp`);
    expect(parsed.mcpServers.routerly.headers.Authorization).toBe(`Bearer ${MCP_TOKEN}`);
  });

  it('cline: streamableHttp type, since a missing type means legacy sse', () => {
    const parsed = JSON.parse(buildMcpSnippet(meta('cline'), BASE_URL, MCP_TOKEN));
    expect(parsed.mcpServers.routerly.type).toBe('streamableHttp');
    expect(parsed.mcpServers.routerly.url).toBe(`${BASE_URL}/mcp`);
    expect(parsed.mcpServers.routerly.headers.Authorization).toBe(`Bearer ${MCP_TOKEN}`);
  });

  it('zed: context_servers entry with the Authorization header', () => {
    const parsed = JSON.parse(buildMcpSnippet(meta('zed'), BASE_URL, MCP_TOKEN));
    expect(parsed.context_servers.routerly.url).toBe(`${BASE_URL}/mcp`);
    expect(parsed.context_servers.routerly.headers.Authorization).toBe(`Bearer ${MCP_TOKEN}`);
  });
});
