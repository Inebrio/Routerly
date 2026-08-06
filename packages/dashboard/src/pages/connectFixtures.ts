/** Shared fixtures for the Connect page tests (list and per-client detail). */
import type { ClientListItem } from '../api';

export function apiError(message: string, status: number) {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
}

const CLIENTS: ClientListItem[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    supportState: 'auto-configurable',
    wireFormat: 'anthropic',
    docSlug: 'integrations/clients/claude-code',
    configKind: 'json',
    configPathHint: '~/.claude/settings.json',
    modes: ['llm', 'mcp'],
    baseUrl: 'http://localhost:3000',
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
    baseUrl: 'http://localhost:3000',
  },
  {
    id: 'cline',
    label: 'Cline',
    supportState: 'documented',
    wireFormat: 'openai',
    docSlug: 'integrations/clients/cline',
    configKind: 'ui',
    configPathHint: 'VS Code Settings (Cline panel), no file',
    modes: ['llm'],
    baseUrl: 'http://localhost:3000',
  },
];

export function makeClients() {
  return { enabled: true, advertisedAddresses: ['192.168.1.50'], clients: CLIENTS };
}
