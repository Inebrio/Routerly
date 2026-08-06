import type { SupportState } from '../api';

export { AUTO_MODEL } from '@routerly/shared';

/** Docs site root; every client meta carries the slug to append. */
export const DOCS_BASE = 'https://doc.routerly.ai/next/';

/** The dashboard never holds a project's raw token, so snippets ship a placeholder. */
export const PLACEHOLDER_TOKEN = 'sk-rt-YOUR_TOKEN';

/** MCP tokens are personal and minted separately, hence a second placeholder. */
export const PLACEHOLDER_MCP_TOKEN = '<YOUR_MCP_TOKEN>';

export const SUPPORT_BADGE: Record<SupportState, string> = {
  'auto-configurable': 'badge-success',
  launchable: 'badge-success',
  documented: 'badge-warning',
  partial: 'badge-warning',
  stale: 'badge-error',
};

/** What the support state means for the person setting the client up. */
export const SUPPORT_LABEL: Record<SupportState, string> = {
  'auto-configurable': 'CLI setup',
  launchable: 'CLI setup',
  documented: 'Manual setup',
  partial: 'Partial support',
  stale: 'Out of date',
};

/** What each connect mode buys you. Spelled out on the grid, on hover elsewhere. */
export const MODE_HINT: Record<string, string> = {
  llm: 'Routes the client model traffic through Routerly',
  mcp: 'Loads Routerly as an MCP tool server',
};

/** Gateway root without its trailing slash, so `${root}/v1` never doubles up. */
export function gatewayRoot(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

/** These two states are the ones `routerly clients configure` can write for you. */
export function isAutoConfigurable(state: SupportState): boolean {
  return state === 'auto-configurable' || state === 'launchable';
}
