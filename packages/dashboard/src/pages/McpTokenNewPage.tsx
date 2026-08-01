import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Copy } from 'lucide-react';
import { createMyMcpToken } from '../api';
import { CopyBlock } from '../components/CopyBlock';
import { McpClientGuide } from '../components/McpClientGuide';
import { writeToClipboard } from '../utils/clipboard';

const SECTION_TITLE: React.CSSProperties = {
  fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-muted)', marginBottom: 10,
};

const HINT: React.CSSProperties = {
  fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '6px 0 0',
};

/**
 * Creating an MCP token, on its own page rather than in a form inside the
 * profile tab: the value is shown exactly once, and the client wiring that
 * follows only makes sense while it is on screen.
 */
export function McpTokenNewPage() {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState('');
  const [copied, setCopied] = useState(false);

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
      setRevealed(created.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create the token');
    } finally {
      setBusy(false);
    }
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

  const back = (
    <button
      className="btn-icon"
      onClick={() => navigate('/dashboard/profile/mcp')}
      style={{ marginBottom: 16, display: 'inline-flex', padding: 4, width: 'fit-content' }}
    >
      <ArrowLeft size={16} />
      <span style={{ marginLeft: 6, fontSize: '0.8rem', fontWeight: 500 }}>Back to MCP</span>
    </button>
  );

  return (
    <>
      <div className="page-header">
        {back}
        <h1>New MCP Token</h1>
        <p>The token acts as you: it exposes exactly the tools your role permits.</p>
      </div>

      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 760 }}>
        {error && <div className="form-error">{error}</div>}

        {revealed === '' ? (
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
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
                autoFocus
              />
              <p style={HINT}>Where this token is used, for example "laptop" or "claude-desktop".</p>
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="mcp-token-expiry">Expires on</label>
              <input
                id="mcp-token-expiry"
                type="date"
                className="form-input"
                value={expiry}
                onChange={e => setExpiry(e.target.value)}
              />
              <p style={HINT}>Optional. Leave it empty and the token never expires, until you revoke it.</p>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
                {busy ? 'Creating…' : 'Create token'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/dashboard/profile/mcp')} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <section>
              <div style={SECTION_TITLE}>Your token</div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                Copy it now. It is not shown again, and a lost token can only be replaced.
              </p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div className="token-box" style={{ flex: 1, margin: 0, wordBreak: 'break-all', fontSize: '0.82rem' }}>
                  {revealed}
                </div>
                <button className="btn btn-secondary" onClick={handleCopy} title="Copy token" style={{ flexShrink: 0 }}>
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </section>

            <section>
              <div style={SECTION_TITLE}>Connect a client</div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                Pick the client you are wiring up. The snippet already carries this token.
              </p>
              <McpClientGuide token={revealed} />
            </section>

            <section>
              <div style={SECTION_TITLE}>Or use the local bridge</div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                For a client that only speaks stdio, the CLI bridges it and passes your token through.
              </p>
              <CopyBlock text="routerly mcp serve" />
            </section>

            <div>
              <button className="btn btn-primary" onClick={() => navigate('/dashboard/profile/mcp')}>Done</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
