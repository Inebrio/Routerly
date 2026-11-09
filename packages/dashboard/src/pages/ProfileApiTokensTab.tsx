import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Key, AlertTriangle } from 'lucide-react';
import { getMyApiTokens, deleteMyApiToken, type ApiTokenRow } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';

const WARN_MS = 7 * 86_400_000;

function fmtDate(iso: string | undefined, emptyLabel: string): string {
  if (!iso) return emptyLabel;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Long-lived management API tokens of the signed-in user. A token acts as the
 * user limited to the permissions picked at creation, so the tab needs no
 * permission of its own. Tokens expiring within a week (or already expired)
 * carry a warning badge.
 */
export function ProfileApiTokensTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tokens, setTokens] = useState<ApiTokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setTokens(await getMyApiTokens());
    } catch (e) {
      setError(e instanceof Error ? e.message : t('profile.apiTokens.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  function handleRevoke(token: ApiTokenRow) {
    setConfirmState({
      message: t('profile.apiTokens.revokeConfirm', { name: token.name }),
      onConfirm: async () => {
        setConfirmState(null);
        setError('');
        setBusy(true);
        try {
          await deleteMyApiToken(token.id);
          setTokens(prev => prev.filter(x => x.id !== token.id));
        } catch (e) {
          setError(e instanceof Error ? e.message : t('profile.apiTokens.errors.revokeFailed'));
        } finally {
          setBusy(false);
        }
      },
    });
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  const now = Date.now();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
      {error && <div className="form-error">{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', margin: 0 }}>
          {t('profile.apiTokens.heading')}
        </h3>
        <button className="btn btn-primary" onClick={() => navigate('/dashboard/profile/api-tokens/new')} disabled={busy}>
          <Plus size={16} /> {t('profile.apiTokens.newTokenButton')}
        </button>
      </div>

      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
        {t('profile.apiTokens.description')}
      </p>

      {tokens.length === 0 ? (
        <div className="empty-state">
          <Key size={36} />
          <p>{t('profile.apiTokens.empty')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tokens.map(token => {
            const left = new Date(token.expiresAt).getTime() - now;
            const expired = left <= 0;
            const expiring = !expired && left <= WARN_MS;
            return (
              <div
                key={token.id}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Key size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)' }}>{token.name}</span>
                    {expired && <span className="badge badge-error">{t('profile.apiTokens.expired')}</span>}
                    {expiring && (
                      <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <AlertTriangle size={12} /> {t('profile.apiTokens.expiringSoon')}
                      </span>
                    )}
                  </div>
                  <span className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {token.tokenSnippet}<span style={{ opacity: 0.5 }}>••••••••</span>
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {token.permissions.map(p => <span key={p} className="badge mono" style={{ fontSize: '0.7rem' }}>{p}</span>)}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                  {([
                    [t('profile.apiTokens.created'), fmtDate(token.createdAt, '')],
                    [t('profile.apiTokens.lastUsed'), fmtDate(token.lastUsedAt, t('profile.apiTokens.never'))],
                    [t('profile.apiTokens.expires'), fmtDate(token.expiresAt, '')],
                  ] as const).map(([label, value]) => (
                    <div key={label} style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{value}</span>
                    </div>
                  ))}
                  <button className="btn-icon danger" onClick={() => handleRevoke(token)} disabled={busy} title={t('profile.apiTokens.revokeTitle')}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
