import React, { useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { CLIENT_REGISTRY, buildMcpSnippet, type ClientMeta } from '@routerly/shared';
import { ClientLogo } from './ClientLogo';
import { CopyBlock } from './CopyBlock';
import { SearchableSelect } from './SearchableSelect';

const hintCodeComponents = { code: <code /> };

/** Where each client expects its MCP configuration, and anything it needs done
 *  besides pasting the snippet. Verified against each client's own docs. */
const CLIENT_HINT_KEYS: Record<string, string> = {
  'claude-code': 'common.mcpClientGuide.hints.claudeCode',
  'claude-desktop': 'common.mcpClientGuide.hints.claudeDesktop',
  codex: 'common.mcpClientGuide.hints.codex',
  opencode: 'common.mcpClientGuide.hints.opencode',
  openclaw: 'common.mcpClientGuide.hints.openclaw',
  cursor: 'common.mcpClientGuide.hints.cursor',
  cline: 'common.mcpClientGuide.hints.cline',
  zed: 'common.mcpClientGuide.hints.zed',
};

const MCP_CLIENTS: readonly ClientMeta[] = CLIENT_REGISTRY.filter(c => c.modes.includes('mcp'));

/**
 * Per-client wiring for Routerly's MCP server: pick a client, get the snippet
 * with the token already in it.
 *
 * `token` is the freshly minted value on the creation page and a placeholder in
 * the profile tab, which never holds a token after the one-time reveal.
 */
export function McpClientGuide({ token }: { token: string }) {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState(MCP_CLIENTS[0]?.id ?? '');
  const client = MCP_CLIENTS.find(c => c.id === clientId);
  if (!client) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <ClientLogo id={client.id} label={client.label} size={32} />
        <SearchableSelect
          options={MCP_CLIENTS.map(c => ({ value: c.id, label: c.label }))}
          value={clientId}
          onChange={setClientId}
          ariaLabel={t('common.mcpClientGuide.clientAriaLabel')}
          style={{ maxWidth: 260 }}
        />
      </div>

      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
        <Trans i18nKey={CLIENT_HINT_KEYS[client.id] ?? ''} components={hintCodeComponents} />
      </p>

      <CopyBlock text={buildMcpSnippet(client, window.location.origin, token)} />
    </div>
  );
}
