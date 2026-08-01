import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Key, Copy, Check, Wrench, X } from 'lucide-react';
import {
  getMyMcpTokens, getMyMcpTools, createMyMcpToken, deleteMyMcpToken,
  type McpTokenRow, type McpToolRow,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { writeToClipboard } from '../utils/clipboard';

const HTTP_ENDPOINT = `${window.location.origin}/mcp`;

const CODE_BLOCK: React.CSSProperties = {
  margin: 0, padding: 12, background: 'var(--surface-active)',
  border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.78rem',
  overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
};

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
  const [tokens, setTokens] = useState<McpTokenRow[]>([]);
  const [tools, setTools] = useState<McpToolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);

  const [revealed, setRevealed] = useState('');
  const [copied, setCopied] = useState(false);
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // The date input yields a plain day; the API wants an ISO instant, so the
      // token stays valid through the end of the chosen day.
      const created = await createMyMcpToken({
        name: name.trim(),
        ...(expiry ? { expiresAt: new Date(`${expiry}T23:59:59Z`).toISOString() } : {}),
      });
      const { token, ...row } = created;
      setTokens(prev => [...prev, row]);
      setRevealed(token);
      setCopied(false);
      setName('');
      setExpiry('');
      setFormOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create the token');
    } finally {
      setBusy(false);
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

  async function handleCopy() {
    try {
      await writeToClipboard(revealed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed, select and copy the token manually.');
    }
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 900 }}>
      {error && <div className="form-error">{error}</div>}

      {/* ── Tokens ────────────────────────────────────────────────────────── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ ...SECTION_TITLE, marginBottom: 0 }}>MCP Tokens</h3>
          {!formOpen && (
            <button className="btn btn-primary" onClick={() => setFormOpen(true)} disabled={busy}>
              <Plus size={16} /> New Token
            </button>
          )}
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 16 }}>
          Each token acts as you: it exposes exactly the tools your role permits. The full value is shown
          once, at creation.
        </p>

        {revealed && (
          <div className="card" style={{ padding: 16, marginBottom: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                Token created. Copy it now, it will not be shown again.
              </span>
              <button className="btn-icon" onClick={() => setRevealed('')} title="Dismiss"><X size={16} /></button>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div className="token-box" style={{ flex: 1, margin: 0, wordBreak: 'break-all', fontSize: '0.82rem' }}>
                {revealed}
              </div>
              <button className="btn btn-secondary" onClick={handleCopy} style={{ flexShrink: 0 }}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {formOpen && (
          <form
            onSubmit={handleCreate}
            className="card"
            style={{ padding: 16, marginBottom: 16, border: '1px solid var(--border)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="mcp-token-name">Name</label>
              <input
                id="mcp-token-name"
                type="text"
                className="form-input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="laptop"
                maxLength={60}
                required
              />
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '6px 0 0' }}>
                Where this token is used, for example "laptop" or "claude-desktop".
              </p>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="mcp-token-expiry">Expires on (optional)</label>
              <input
                id="mcp-token-expiry"
                type="date"
                className="form-input"
                value={expiry}
                onChange={e => setExpiry(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>Create token</button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { setFormOpen(false); setName(''); setExpiry(''); }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

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
          Two transports are available. Use stdio for local desktop clients, HTTP for remote ones. Both
          authenticate with one of your MCP tokens.
        </p>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 6 }}>stdio (local)</div>
          <pre className="mono" style={CODE_BLOCK}>routerly mcp serve</pre>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
            The CLI passes your token through. Running the service directly instead? Set{' '}
            <span className="mono">ROUTERLY_MCP_STDIO=1</span> and{' '}
            <span className="mono">ROUTERLY_MCP_TOKEN=&lt;your MCP token&gt;</span> yourself.
          </p>
        </div>

        <div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 6 }}>HTTP (remote)</div>
          <pre className="mono" style={CODE_BLOCK}>{HTTP_ENDPOINT}</pre>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
            JSON-RPC 2.0 over Streamable HTTP. Authenticate with{' '}
            <span className="mono">Authorization: Bearer &lt;your MCP token&gt;</span>.
          </p>
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
