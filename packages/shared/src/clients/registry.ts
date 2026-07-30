export type SupportState = 'documented' | 'auto-configurable' | 'launchable' | 'partial' | 'stale';
export type WireFormat = 'openai' | 'anthropic';

export interface ClientMeta {
  id: string;
  label: string;
  supportState: SupportState;
  wireFormat: WireFormat;
  docSlug: string;
  configKind: 'env' | 'toml' | 'json' | 'yaml' | 'ui';
  configPathHint: string;
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
  },
  {
    id: 'codex',
    label: 'Codex',
    supportState: 'auto-configurable',
    wireFormat: 'openai',
    docSlug: 'integrations/clients/codex',
    configKind: 'toml',
    configPathHint: '~/.codex/config.toml',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    supportState: 'auto-configurable',
    wireFormat: 'openai',
    docSlug: 'integrations/clients/opencode',
    configKind: 'json',
    configPathHint: '~/.config/opencode/opencode.json',
  },
  {
    id: 'continue',
    label: 'Continue',
    supportState: 'auto-configurable',
    wireFormat: 'openai',
    docSlug: 'integrations/clients/continue',
    configKind: 'yaml',
    configPathHint: '~/.continue/config.yaml',
  },
  {
    id: 'cline',
    label: 'Cline',
    supportState: 'documented',
    wireFormat: 'openai',
    docSlug: 'integrations/clients/cline',
    configKind: 'ui',
    configPathHint: 'VS Code Settings (Cline panel), no file',
  },
];

/**
 * Builds the copyable config snippet a user pastes / the file body apply() writes.
 * Returns the display/reference form; exact per-file body is refined in later tasks.
 */
export function buildSnippet(meta: ClientMeta, baseUrl: string, token: string): string {
  switch (meta.configKind) {
    case 'env': {
      return buildEnvSnippet(meta, baseUrl, token);
    }
    case 'json': {
      return buildJsonSnippet(meta, baseUrl, token);
    }
    case 'yaml': {
      return buildYamlSnippet(meta, baseUrl, token);
    }
    case 'toml': {
      return buildTomlSnippet(meta, baseUrl, token);
    }
    case 'ui': {
      return buildUiSnippet(meta);
    }
    default: {
      const _exhaustive: never = meta.configKind;
      return _exhaustive;
    }
  }
}

function buildEnvSnippet(meta: ClientMeta, baseUrl: string, token: string): string {
  if (meta.wireFormat === 'anthropic') {
    return `ANTHROPIC_BASE_URL=${baseUrl}\nANTHROPIC_AUTH_TOKEN=${token}`;
  }
  return `OPENAI_BASE_URL=${baseUrl}\nOPENAI_API_KEY=${token}`;
}

function buildJsonSnippet(meta: ClientMeta, baseUrl: string, token: string): string {
  if (meta.wireFormat === 'anthropic') {
    return JSON.stringify(
      {
        env: {
          ANTHROPIC_BASE_URL: baseUrl,
          ANTHROPIC_AUTH_TOKEN: token,
        },
      },
      null,
      2
    );
  }
  // OpenCode is currently the only fully-implemented openai/json registry
  // entry. Shape mirrors packages/cli/src/clients/opencode.ts (the actual
  // file writer): OpenCode's custom-provider config format,
  // `provider.routerly.{npm,name,options:{baseURL,apiKey},models}`, with
  // baseURL = Routerly's `<serverUrl>/v1` endpoint and the literal token.
  // The provider id is `routerly`, not `meta.id`, to avoid conflicting with
  // OpenCode's built-in providers (same choice codex.ts makes for its
  // `[model_providers.routerly]` table).
  const resolvedBaseUrl = `${baseUrl.replace(/\/$/, '')}/v1`;
  return JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        routerly: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Routerly',
          options: {
            baseURL: resolvedBaseUrl,
            apiKey: token,
          },
          models: {
            'routerly/ada': { name: 'Routerly (auto-routed)' },
          },
        },
      },
    },
    null,
    2
  );
}

function buildYamlSnippet(meta: ClientMeta, baseUrl: string, token: string): string {
  if (meta.wireFormat === 'anthropic') {
    return `claude_code:\n  baseUrl: ${baseUrl}\n  apiKey: ${token}`;
  }
  // Continue is currently the only openai/yaml registry entry. Shape mirrors
  // packages/cli/src/clients/continue.ts (the actual file writer): Continue's
  // required top-level `name`/`version`/`schema: v1` plus a `models` array
  // with one OpenAI-compatible entry (`provider: openai`, `apiBase` =
  // Routerly's `<serverUrl>/v1` endpoint, literal `apiKey`, and
  // `model: routerly/ada`, the same auto-routing sentinel convention
  // opencode.ts uses).
  const resolvedBaseUrl = `${baseUrl.replace(/\/$/, '')}/v1`;
  return [
    'name: Routerly',
    'version: 0.0.1',
    'schema: v1',
    '',
    'models:',
    '  - name: Routerly (auto-routed)',
    '    provider: openai',
    '    model: routerly/ada',
    `    apiBase: ${resolvedBaseUrl}`,
    `    apiKey: ${token}`,
  ].join('\n');
}

function buildUiSnippet(meta: ClientMeta): string {
  // No config file to write. Point the user at the settings UI instead of
  // fabricating file content that doesn't exist.
  return `No config file. Configure via ${meta.configPathHint}. See docs.`;
}

function buildTomlSnippet(meta: ClientMeta, baseUrl: string, token: string): string {
  if (meta.wireFormat === 'anthropic') {
    return `[claude_code]\nbaseUrl = "${baseUrl}"\napiKey = "${token}"`;
  }
  // Codex is currently the only openai/toml registry entry. Shape mirrors
  // packages/cli/src/clients/codex.ts (the actual file writer): top-level
  // `model_provider` selector plus a `[model_providers.routerly]` table with
  // `base_url` (Routerly's /v1 endpoint), `wire_api = "responses"`, and the
  // literal bearer token in `experimental_bearer_token`.
  const resolvedBaseUrl = `${baseUrl.replace(/\/$/, '')}/v1`;
  return [
    'model_provider = "routerly"',
    '',
    '[model_providers.routerly]',
    'name = "Routerly"',
    `base_url = "${resolvedBaseUrl}"`,
    'wire_api = "responses"',
    `experimental_bearer_token = "${token}"`,
  ].join('\n');
}
