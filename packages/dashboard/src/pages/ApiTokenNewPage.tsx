import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Copy } from 'lucide-react';
import { createMyApiToken, getMe } from '../api';
import { CopyBlock } from '../components/CopyBlock';
import { writeToClipboard } from '../utils/clipboard';

const SECTION_TITLE: React.CSSProperties = {
  fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-muted)', marginBottom: 10,
};
const HINT: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '6px 0 0' };
const MAX_DAYS = 365;

const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

/**
 * Creating a management API token, on its own page: the value is shown exactly
 * once. Scope is limited to the permissions the signed-in user holds.
 */
export function ApiTokenNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState(isoDay(90));
  const [available, setAvailable] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getMe().then(me => setAvailable(me.permissions ?? [])).catch(e => setError(e instanceof Error ? e.message : t('profile.apiTokens.newToken.errors.createFailed')));
  }, [t]);

  function toggle(p: string) {
    setSelected(prev => (prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // The date input yields a plain day; the token stays valid through its end.
      const created = await createMyApiToken({
        name: name.trim(),
        expiresAt: new Date(`${expiry}T23:59:59Z`).toISOString(),
        permissions: selected,
      });
      setRevealed(created.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('profile.apiTokens.newToken.errors.createFailed'));
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
      setError(t('profile.apiTokens.newToken.errors.copyFailed'));
    }
  }

  const back = () => navigate('/dashboard/profile/api-tokens');

  return (
    <>
      <div className="page-header">
        <button className="btn-icon" onClick={back} style={{ marginBottom: 16, display: 'inline-flex', padding: 4, width: 'fit-content' }}>
          <ArrowLeft size={16} />
          <span style={{ marginLeft: 6, fontSize: '0.8rem', fontWeight: 500 }}>{t('profile.apiTokens.newToken.back')}</span>
        </button>
        <h1>{t('profile.apiTokens.newToken.title')}</h1>
        <p>{t('profile.apiTokens.newToken.subtitle')}</p>
      </div>

      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 760 }}>
        {error && <div className="form-error">{error}</div>}

        {revealed === '' ? (
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="api-token-name">{t('profile.apiTokens.newToken.nameLabel')}</label>
              <input id="api-token-name" type="text" className="form-input" value={name} onChange={e => setName(e.target.value)}
                placeholder={t('profile.apiTokens.newToken.namePlaceholder')} maxLength={60} required autoFocus />
              <p style={HINT}>{t('profile.apiTokens.newToken.nameHint')}</p>
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="api-token-expiry">{t('profile.apiTokens.newToken.expiryLabel')}</label>
              <input id="api-token-expiry" type="date" className="form-input" value={expiry} min={isoDay(1)} max={isoDay(MAX_DAYS - 1)}
                onChange={e => setExpiry(e.target.value)} required />
              <p style={HINT}>{t('profile.apiTokens.newToken.expiryHint', { days: MAX_DAYS })}</p>
            </div>

            <fieldset className="form-group" style={{ margin: 0, border: 'none', padding: 0 }}>
              <legend className="form-label">{t('profile.apiTokens.newToken.permissionsLabel')}</legend>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                {available.map(p => (
                  <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={selected.includes(p)} onChange={() => toggle(p)} />
                    <span className="mono">{p}</span>
                  </label>
                ))}
              </div>
              <p style={HINT}>{t('profile.apiTokens.newToken.permissionsHint')}</p>
            </fieldset>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || selected.length === 0 || !expiry}>
                {busy ? t('profile.apiTokens.newToken.creatingButton') : t('profile.apiTokens.newToken.createButton')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={back} disabled={busy}>
                {t('profile.apiTokens.newToken.cancelButton')}
              </button>
            </div>
          </form>
        ) : (
          <>
            <section>
              <div style={SECTION_TITLE}>{t('profile.apiTokens.newToken.tokenSection.title')}</div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                {t('profile.apiTokens.newToken.tokenSection.hint')}
              </p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div className="token-box" style={{ flex: 1, margin: 0, wordBreak: 'break-all', fontSize: '0.82rem' }}>{revealed}</div>
                <button className="btn btn-secondary" onClick={handleCopy} style={{ flexShrink: 0 }}>
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? t('profile.apiTokens.newToken.tokenSection.copiedButton') : t('profile.apiTokens.newToken.tokenSection.copyButton')}
                </button>
              </div>
            </section>

            <section>
              <div style={SECTION_TITLE}>{t('profile.apiTokens.newToken.usageSection.title')}</div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                {t('profile.apiTokens.newToken.usageSection.hint')}
              </p>
              <CopyBlock text={`routerly auth login --url ${window.location.origin} --token ${revealed}`} />
            </section>

            <div>
              <button className="btn btn-primary" onClick={back}>{t('profile.apiTokens.newToken.doneButton')}</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
