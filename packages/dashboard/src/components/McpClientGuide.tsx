import React, { useState } from 'react';
import { CLIENT_REGISTRY, buildMcpSnippet, type ClientMeta } from '@routerly/shared';
import { ClientLogo } from './ClientLogo';
import { CopyBlock } from './CopyBlock';
import { SearchableSelect } from './SearchableSelect';

/** Where each client expects its MCP configuration, and anything it needs done
 *  besides pasting the snippet. Verified against each client's own docs. */
const CLIENT_HINTS: Record<string, React.ReactNode> = {
  'claude-code': <>Run this once, anywhere. Claude Code stores the server in <code>~/.claude.json</code>.</>,
  'claude-desktop': <>Put this in <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (on Windows, <code>%APPDATA%\Claude\claude_desktop_config.json</code>), then restart the app. It spawns the CLI, so <code>routerly</code> must be on your PATH.</>,
  codex: <>Put this in <code>~/.codex/config.toml</code>. Codex reads the token from the environment, so export it in the shell you start Codex from.</>,
  opencode: <>Put this in <code>~/.config/opencode/opencode.json</code>.</>,
  openclaw: <>Run this once. OpenClaw defaults to the sse transport, which Routerly does not serve, so the transport is set explicitly.</>,
  cursor: <>Put this in <code>~/.cursor/mcp.json</code>, or in <code>.cursor/mcp.json</code> to scope it to one project.</>,
  cline: <>Put this in <code>~/.cline/mcp.json</code>, or paste it into Configure MCP Servers in the Cline panel.</>,
  zed: <>Put this in your Zed <code>settings.json</code>, alongside any other context server.</>,
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
          ariaLabel="MCP client"
          style={{ maxWidth: 260 }}
        />
      </div>

      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
        {CLIENT_HINTS[client.id]}
      </p>

      <CopyBlock text={buildMcpSnippet(client, window.location.origin, token)} />
    </div>
  );
}
