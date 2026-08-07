export type SupportState = 'documented' | 'auto-configurable' | 'launchable' | 'partial' | 'stale';
export type WireFormat = 'openai' | 'anthropic';

/**
 * How a client can reach Routerly.
 *
 * `llm`: it can be pointed at the gateway as an OpenAI/Anthropic endpoint.
 * `mcp`: it can consume Routerly's MCP server (see docs/concepts/mcp.md).
 *
 * They are independent: Claude Desktop has no base-URL override at all and is
 * `mcp` only, Continue has no verified MCP wiring here and is `llm` only.
 */
export type ConnectMode = 'llm' | 'mcp';

export interface ClientMeta {
  id: string;
  label: string;
  supportState: SupportState;
  wireFormat: WireFormat;
  docSlug: string;
  configKind: 'env' | 'toml' | 'json' | 'yaml' | 'ui';
  configPathHint: string;
  /** Modes this client can use, in the order the UI should present them. */
  modes: readonly ConnectMode[];
}

export const CLIENT_REGISTRY: readonly ClientMeta[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    supportState: 'auto-configurable',
    wireFormat: 'anthropic',
    docSlug: 'integrations/clients/claude-code',
    configKind: 'json',
    configPathHint: '~/.claude/settings.json',
    modes: ['llm', 'mcp'],
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    supportState: 'documented',
    wireFormat: 'anthropic',
    docSlug: 'integrations/clients/claude-desktop',
    configKind: 'json',
    configPathHint: '~/Library/Application Support/Claude/claude_desktop_config.json',
    // MCP only: the desktop app talks to Anthropic's own backend and exposes no
    // base-URL override, so it cannot be routed through the gateway.
    modes: ['mcp'],
  },
  {
    id: 'codex',
    label: 'Codex',
    supportState: 'auto-configurable',
    wireFormat: 'openai',
    docSlug: 'integrations/clients/codex',
    configKind: 'toml',
    configPathHint: '~/.codex/config.toml',
    modes: ['llm', 'mcp'],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    supportState: 'auto-configurable',
    wireFormat: 'openai',
    docSlug: 'integrations/clients/opencode',
    configKind: 'json',
    configPathHint: '~/.config/opencode/opencode.json',
    modes: ['llm', 'mcp'],
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    supportState: 'documented',
    wireFormat: 'openai',
    docSlug: 'integrations/openclaw',
    configKind: 'json',
    configPathHint: '~/.openclaw/openclaw.json',
    modes: ['llm', 'mcp'],
  },
  {
    id: 'continue',
    label: 'Continue',
    supportState: 'auto-configurable',
    wireFormat: 'openai',
    docSlug: 'integrations/clients/continue',
    configKind: 'yaml',
    configPathHint: '~/.continue/config.yaml',
    modes: ['llm'],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    supportState: 'documented',
    wireFormat: 'openai',
    docSlug: 'integrations/cursor',
    configKind: 'ui',
    configPathHint: 'Cursor Settings > Models, no file',
    // The LLM side is UI-only, the MCP side is a file: ~/.cursor/mcp.json.
    modes: ['llm', 'mcp'],
  },
  {
    id: 'cline',
    label: 'Cline',
    supportState: 'documented',
    wireFormat: 'openai',
    docSlug: 'integrations/clients/cline',
    configKind: 'ui',
    configPathHint: 'VS Code Settings (Cline panel), no file',
    // MCP lives in ~/.cline/mcp.json, or in the panel's "Configure MCP Servers".
    modes: ['llm', 'mcp'],
  },
  {
    id: 'zed',
    label: 'Zed',
    supportState: 'documented',
    wireFormat: 'openai',
    docSlug: 'integrations/clients/zed',
    configKind: 'json',
    configPathHint: '~/.config/zed/settings.json',
    // MCP servers live in the same settings.json, under `context_servers`.
    modes: ['llm', 'mcp'],
  },
  {
    id: 'generic-openai',
    label: 'Any OpenAI SDK app',
    supportState: 'documented',
    wireFormat: 'openai',
    docSlug: 'integrations/generic-openai',
    configKind: 'env',
    configPathHint: 'Environment variables, no file',
    modes: ['llm'],
  },
  {
    id: 'generic-anthropic',
    label: 'Any Anthropic SDK app',
    supportState: 'documented',
    wireFormat: 'anthropic',
    docSlug: 'integrations/generic-anthropic',
    configKind: 'env',
    configPathHint: 'Environment variables, no file',
    modes: ['llm'],
  },
];

/**
 * Virtual model id that hands the model choice back to Routerly's router.
 * The snippets below embed it wherever a client insists on a model name.
 */
export const AUTO_MODEL = 'routerly/ada';

/** Strips a trailing slash so `${root}/v1` never doubles up. */
function normalize(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

/**
 * Builds the config snippet that points a client's LLM traffic at Routerly:
 * what `clients configure` writes, and what the dashboard shows with a
 * placeholder token.
 *
 * Dispatch is per client id, not per `configKind`: two clients can share a
 * format and still expect completely different keys (opencode.json and
 * openclaw.json are both JSON and have nothing else in common). Every shape
 * below was verified against that client's own documentation; see the CLI
 * writer in packages/cli/src/clients/ for the ones that are auto-configurable.
 */
export function buildSnippet(meta: ClientMeta, baseUrl: string, token: string): string {
  const root = normalize(baseUrl);
  const v1 = `${root}/v1`;

  switch (meta.id) {
    case 'claude-code': {
      // Environment overrides live under an "env" object in settings.json.
      // ANTHROPIC_AUTH_TOKEN sends `Authorization: Bearer`, which is what
      // Routerly's inbound auth reads; ANTHROPIC_API_KEY sends X-Api-Key.
      return JSON.stringify({ env: { ANTHROPIC_BASE_URL: root, ANTHROPIC_AUTH_TOKEN: token } }, null, 2);
    }
    case 'claude-desktop': {
      return [
        'Claude Desktop always talks to Anthropic and has no base URL override,',
        'so it cannot send its chat traffic through Routerly.',
        'Connect it over MCP instead: see the MCP tab.',
      ].join('\n');
    }
    case 'codex': {
      return [
        'model_provider = "routerly"',
        '',
        '[model_providers.routerly]',
        'name = "Routerly"',
        `base_url = "${v1}"`,
        'wire_api = "responses"',
        `experimental_bearer_token = "${token}"`,
      ].join('\n');
    }
    case 'opencode': {
      // OpenCode custom-provider format. The provider id is `routerly`, not
      // meta.id, to avoid colliding with OpenCode's built-in providers.
      return JSON.stringify(
        {
          $schema: 'https://opencode.ai/config.json',
          provider: {
            routerly: {
              npm: '@ai-sdk/openai-compatible',
              name: 'Routerly',
              options: { baseURL: v1, apiKey: token },
              models: { 'routerly/ada': { name: 'Routerly (auto-routed)' } },
            },
          },
        },
        null,
        2
      );
    }
    case 'openclaw': {
      // openclaw.json: custom providers live under models.providers.<id>, and
      // an agent selects one with the "<provider>/<model id>" reference. The
      // model id is `ada`, so the reference reads `routerly/ada`, Routerly's
      // own auto-routing sentinel.
      return JSON.stringify(
        {
          models: {
            providers: {
              routerly: { baseUrl: v1, apiKey: token, models: [{ id: 'ada' }] },
            },
          },
          agents: { defaults: { model: { primary: 'routerly/ada' } } },
        },
        null,
        2
      );
    }
    case 'continue': {
      return [
        'name: Routerly',
        'version: 0.0.1',
        'schema: v1',
        '',
        'models:',
        '  - name: Routerly (auto-routed)',
        '    provider: openai',
        '    model: routerly/ada',
        `    apiBase: ${v1}`,
        `    apiKey: ${token}`,
      ].join('\n');
    }
    case 'zed': {
      // Zed never stores provider keys in settings.json: they go into the
      // system keychain via the agent settings UI, or into the
      // <PROVIDER>_API_KEY environment variable. The file only declares the
      // endpoint and the models it offers.
      return JSON.stringify(
        {
          language_models: {
            openai_compatible: {
              Routerly: {
                api_url: v1,
                available_models: [
                  { name: 'routerly/ada', display_name: 'Routerly (auto-routed)', max_tokens: 128000 },
                ],
              },
            },
          },
        },
        null,
        2
      );
    }
    case 'cursor': {
      return [
        'Cursor Settings > Models:',
        `1. Paste ${token} into the OpenAI API Key field.`,
        `2. Enable Override OpenAI Base URL and set it to ${v1}.`,
        '3. Click Verify.',
      ].join('\n');
    }
    case 'cline': {
      return [
        'Cline panel > settings (gear icon):',
        '1. API Provider: OpenAI Compatible.',
        `2. Base URL: ${v1}`,
        `3. API Key: ${token}`,
        '4. Model ID: routerly/ada, or any model registered in your router.',
      ].join('\n');
    }
    default: {
      // Any other SDK app: the two environment variables its official SDK reads.
      if (meta.wireFormat === 'anthropic') {
        return `ANTHROPIC_BASE_URL=${root}\nANTHROPIC_AUTH_TOKEN=${token}`;
      }
      return `OPENAI_BASE_URL=${v1}\nOPENAI_API_KEY=${token}`;
    }
  }
}

/**
 * Builds the snippet that wires a client to Routerly's MCP server, for the
 * clients whose MCP configuration was verified against their own docs
 * (`modes` contains `mcp`). Returns `''` for the others, so a caller can
 * simply hide the section.
 *
 * `mcpToken` is a personal MCP token (`sk-rt-mcp-…`), never a router token:
 * the MCP surface only accepts the former.
 */
export function buildMcpSnippet(meta: ClientMeta, baseUrl: string, mcpToken: string): string {
  if (!meta.modes.includes('mcp')) return '';
  const endpoint = `${normalize(baseUrl)}/mcp`;

  switch (meta.id) {
    case 'claude-code': {
      return `claude mcp add --transport http routerly ${endpoint} \\\n  --header "Authorization: Bearer ${mcpToken}"`;
    }
    case 'claude-desktop': {
      // The desktop app spawns a local command, so it goes through the CLI's
      // stdio bridge and reads the token from the environment.
      return JSON.stringify(
        {
          mcpServers: {
            routerly: {
              command: 'routerly',
              args: ['mcp', 'serve'],
              env: { ROUTERLY_MCP_TOKEN: mcpToken },
            },
          },
        },
        null,
        2
      );
    }
    case 'codex': {
      return [
        `# export ROUTERLY_MCP_TOKEN="${mcpToken}" in your shell first`,
        '[mcp_servers.routerly]',
        `url = "${endpoint}"`,
        'bearer_token_env_var = "ROUTERLY_MCP_TOKEN"',
      ].join('\n');
    }
    case 'opencode': {
      return JSON.stringify(
        {
          $schema: 'https://opencode.ai/config.json',
          mcp: {
            routerly: {
              type: 'remote',
              url: endpoint,
              enabled: true,
              headers: { Authorization: `Bearer ${mcpToken}` },
            },
          },
        },
        null,
        2
      );
    }
    case 'openclaw': {
      // OpenClaw defaults to the sse transport, which Routerly does not serve.
      return `openclaw mcp add routerly \\\n  --url ${endpoint} \\\n  --transport streamable-http \\\n  --header "Authorization: Bearer ${mcpToken}"`;
    }
    case 'cursor': {
      // ~/.cursor/mcp.json (or .cursor/mcp.json in a project). A `url` entry is
      // remote by definition, so Cursor's format carries no transport field.
      return JSON.stringify(
        {
          mcpServers: {
            routerly: { url: endpoint, headers: { Authorization: `Bearer ${mcpToken}` } },
          },
        },
        null,
        2
      );
    }
    case 'cline': {
      // Cline falls back to the legacy sse transport when `type` is missing,
      // so the streamableHttp value is written out.
      return JSON.stringify(
        {
          mcpServers: {
            routerly: {
              type: 'streamableHttp',
              url: endpoint,
              headers: { Authorization: `Bearer ${mcpToken}` },
              disabled: false,
              autoApprove: [],
            },
          },
        },
        null,
        2
      );
    }
    case 'zed': {
      // Zed calls MCP servers context servers, in the same settings.json the
      // LLM provider lives in. Without an Authorization header it would start
      // its own OAuth flow, which Routerly's MCP surface does not serve.
      return JSON.stringify(
        {
          context_servers: {
            routerly: { url: endpoint, headers: { Authorization: `Bearer ${mcpToken}` } },
          },
        },
        null,
        2
      );
    }
    default: {
      return '';
    }
  }
}
