export type SupportState = 'documented' | 'auto-configurable' | 'launchable' | 'partial' | 'stale';
export type WireFormat = 'openai' | 'anthropic';

export interface ClientMeta {
  id: string;
  label: string;
  supportState: SupportState;
  wireFormat: WireFormat;
  docSlug: string;
  configKind: 'env' | 'toml' | 'json' | 'yaml';
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
    supportState: 'documented',
    wireFormat: 'openai',
    docSlug: 'integrations/clients/codex',
    configKind: 'toml',
    configPathHint: '~/.codex/config.toml',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    supportState: 'documented',
    wireFormat: 'openai',
    docSlug: 'integrations/clients/opencode',
    configKind: 'yaml',
    configPathHint: '~/.opencode/config.yaml',
  },
  {
    id: 'continue',
    label: 'Continue',
    supportState: 'launchable',
    wireFormat: 'openai',
    docSlug: 'integrations/clients/continue',
    configKind: 'json',
    configPathHint: '~/.continue/config.json',
  },
  {
    id: 'cline',
    label: 'Cline',
    supportState: 'auto-configurable',
    wireFormat: 'openai',
    docSlug: 'integrations/clients/cline',
    configKind: 'json',
    configPathHint: '~/.cline/config.json',
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
  return JSON.stringify(
    {
      [meta.id]: {
        baseUrl,
        apiKey: token,
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
  return `${meta.id}:\n  baseUrl: ${baseUrl}\n  apiKey: ${token}`;
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
