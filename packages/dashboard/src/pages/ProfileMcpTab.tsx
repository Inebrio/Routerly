import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Key, Wrench } from 'lucide-react';
import {
  getMyMcpTokens, getMyMcpTools, deleteMyMcpToken,
  type McpTokenRow, type McpToolRow,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CopyBlock } from '../components/CopyBlock';
import { McpClientGuide } from '../components/McpClientGuide';
import { PLACEHOLDER_MCP_TOKEN } from './connectShared';

const HTTP_ENDPOINT = `${window.location.origin}/mcp`;

const SECTION_TITLE: React.CSSProperties = {
  fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-muted)', marginBottom: 14,
};

function fmtDate(iso?: string): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Personal MCP surface. An MCP token belongs to the signed-in user and grants
 * exactly that user's permissions, so this tab lives in the profile and needs no
 * permission of its own: the tool list is already filtered server-side.
 */
export function ProfileMcpTab() {
  const navigate = useNavigate();
  const [tokens, setTokens] = useState<McpTokenRow[]>([]);
  const [tools, setTools] = useState<McpToolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [tk, tl] = await Promise.all([getMyMcpTokens(), getMyMcpTools()]);
      setTokens(tk);
      setTools(tl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the MCP surface');
    } finally {
      setLoading(false);
    }
  }

  function handleRevoke(token: McpTokenRow) {
    setConfirmState({
      message: `Revoke MCP token "${token.name}"? Clients using it stop working immediately.`,
      onConfirm: async () => {
        setConfirmState(null);
        setError('');
        setBusy(true);
        try {
          await deleteMyMcpToken(token.id);
          setTokens(prev => prev.filter(t => t.id !== token.id));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to revoke the token');
        } finally {
          setBusy(false);
        }
      },
    });
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 900 }}>
      {error && <div className="form-error">{error}</div>}

      {/* ── Tokens ────────────────────────────────────────────────────────── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ ...SECTION_TITLE, marginBottom: 0 }}>MCP Tokens</h3>
          <button className="btn btn-primary" onClick={() => navigate('/dashboard/profile/mcp/new')} disabled={busy}>
            <Plus size={16} /> New Token
          </button>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 16 }}>
          Each token acts as you: it exposes exactly the tools your role permits. The full value is shown
          once, on the page that creates it.
        </p>

        {tokens.length === 0 ? (
          <div className="empty-state">
            <Key size={36} />
            <p>No MCP tokens yet. Create one to connect an MCP client.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tokens.map(token => (
              <div
                key={token.id}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <Key size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)' }}>{token.name}</div>
                    <span className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {token.tokenSnippet}<span style={{ opacity: 0.5 }}>••••••••</span>
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                  {([
                    ['Created', fmtDate(token.createdAt)],
                    ['Last used', token.lastUsedAt ? fmtDate(token.lastUsedAt) : 'Never'],
                    ['Expires', fmtDate(token.expiresAt)],
                  ] as const).map(([label, value]) => (
                    <div key={label} style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{value}</span>
                    </div>
                  ))}
                  <button className="btn-icon danger" onClick={() => handleRevoke(token)} disabled={busy} title="Revoke token">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Tools ─────────────────────────────────────────────────────────── */}
      <section>
        <h3 style={SECTION_TITLE}>Tools Your Tokens Expose</h3>
        {tools.length === 0 ? (
          <div className="empty-state">
            <Wrench size={36} />
            <p>Your role grants no MCP tool. Ask an administrator for the permissions you need.</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Scope</th>
                  <th>Description</th>
                  <th>Source module</th>
                  <th>Permission</th>
                </tr>
              </thead>
              <tbody>
                {tools.map(t => (
                  <tr key={t.name}>
                    <td><span className="mono" style={{ fontSize: '0.82rem' }}>{t.name}</span></td>
                    <td><span className={`badge badge-${t.scope === 'write' ? 'warning' : 'success'}`}>{t.scope}</span></td>
                    <td><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t.description}</span></td>
                    <td><span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.sourceModule}</span></td>
                    <td><span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.permission}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Connection instructions ───────────────────────────────────────── */}
      <section>
        <h3 style={SECTION_TITLE}>Connect an MCP Client</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 16 }}>
          Pick the client you are wiring up, then replace <span className="mono">{PLACEHOLDER_MCP_TOKEN}</span> with
          one of your tokens. Creating a token shows the same snippet with the value already in it.
        </p>

        <McpClientGuide token={PLACEHOLDER_MCP_TOKEN} />

        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 6 }}>Any other client</div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 10 }}>
            Over HTTP, point it at this endpoint and authenticate with{' '}
            <span className="mono">Authorization: Bearer &lt;your MCP token&gt;</span>. It is JSON-RPC 2.0
            over Streamable HTTP.
          </p>
          <CopyBlock text={HTTP_ENDPOINT} />
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 12, marginBottom: 10 }}>
            Over stdio, the CLI bridges it and passes your token through. Running the service directly
            instead? Set <span className="mono">ROUTERLY_MCP_STDIO=1</span> and{' '}
            <span className="mono">ROUTERLY_MCP_TOKEN=&lt;your MCP token&gt;</span> yourself.
          </p>
          <CopyBlock text="routerly mcp serve" />
        </div>
      </section>

      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}
