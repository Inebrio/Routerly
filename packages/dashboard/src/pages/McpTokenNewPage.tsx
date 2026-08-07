import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      setError(e instanceof Error ? e.message : t('profile.mcp.newToken.errors.createFailed'));
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
      setError(t('profile.mcp.newToken.errors.copyFailed'));
    }
  }

  const back = (
    <button
      className="btn-icon"
      onClick={() => navigate('/dashboard/profile/mcp')}
      style={{ marginBottom: 16, display: 'inline-flex', padding: 4, width: 'fit-content' }}
    >
      <ArrowLeft size={16} />
      <span style={{ marginLeft: 6, fontSize: '0.8rem', fontWeight: 500 }}>{t('profile.mcp.newToken.backToMcp')}</span>
    </button>
  );

  return (
    <>
      <div className="page-header">
        {back}
        <h1>{t('profile.mcp.newToken.title')}</h1>
        <p>{t('profile.mcp.newToken.subtitle')}</p>
      </div>

      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 760 }}>
        {error && <div className="form-error">{error}</div>}

        {revealed === '' ? (
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="mcp-token-name">{t('profile.mcp.newToken.nameLabel')}</label>
              <input
                id="mcp-token-name"
                type="text"
                className="form-input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('profile.mcp.newToken.namePlaceholder')}
                maxLength={60}
                required
                autoFocus
              />
              <p style={HINT}>{t('profile.mcp.newToken.nameHint')}</p>
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="mcp-token-expiry">{t('profile.mcp.newToken.expiryLabel')}</label>
              <input
                id="mcp-token-expiry"
                type="date"
                className="form-input"
                value={expiry}
                onChange={e => setExpiry(e.target.value)}
              />
              <p style={HINT}>{t('profile.mcp.newToken.expiryHint')}</p>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
                {busy ? t('profile.mcp.newToken.creatingButton') : t('profile.mcp.newToken.createButton')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/dashboard/profile/mcp')} disabled={busy}>
                {t('profile.mcp.newToken.cancelButton')}
              </button>
            </div>
          </form>
        ) : (
          <>
            <section>
              <div style={SECTION_TITLE}>{t('profile.mcp.newToken.tokenSection.title')}</div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                {t('profile.mcp.newToken.tokenSection.hint')}
              </p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div className="token-box" style={{ flex: 1, margin: 0, wordBreak: 'break-all', fontSize: '0.82rem' }}>
                  {revealed}
                </div>
                <button className="btn btn-secondary" onClick={handleCopy} title={copied ? t('profile.mcp.newToken.tokenSection.copiedTitle') : t('profile.mcp.newToken.tokenSection.copyTitle')} style={{ flexShrink: 0 }}>
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? t('profile.mcp.newToken.tokenSection.copiedButton') : t('profile.mcp.newToken.tokenSection.copyButton')}
                </button>
              </div>
            </section>

            <section>
              <div style={SECTION_TITLE}>{t('profile.mcp.newToken.connectSection.title')}</div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                {t('profile.mcp.newToken.connectSection.hint')}
              </p>
              <McpClientGuide token={revealed} />
            </section>

            <section>
              <div style={SECTION_TITLE}>{t('profile.mcp.newToken.bridgeSection.title')}</div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                {t('profile.mcp.newToken.bridgeSection.hint')}
              </p>
              <CopyBlock text="routerly mcp serve" />
            </section>

            <div>
              <button className="btn btn-primary" onClick={() => navigate('/dashboard/profile/mcp')}>{t('profile.mcp.newToken.doneButton')}</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
