import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

function fmtDate(iso: string | undefined, neverLabel: string): string {
  if (!iso) return neverLabel;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Personal MCP surface. An MCP token belongs to the signed-in user and grants
 * exactly that user's permissions, so this tab lives in the profile and needs no
 * permission of its own: the tool list is already filtered server-side.
 */
export function ProfileMcpTab() {
  const { t } = useTranslation();
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
      setError(e instanceof Error ? e.message : t('profile.mcp.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  function handleRevoke(token: McpTokenRow) {
    setConfirmState({
      message: t('profile.mcp.revokeConfirm', { name: token.name }),
      onConfirm: async () => {
        setConfirmState(null);
        setError('');
        setBusy(true);
        try {
          await deleteMyMcpToken(token.id);
          setTokens(prev => prev.filter(t => t.id !== token.id));
        } catch (e) {
          setError(e instanceof Error ? e.message : t('profile.mcp.errors.revokeFailed'));
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
          <h3 style={{ ...SECTION_TITLE, marginBottom: 0 }}>{t('profile.mcp.tokens.heading')}</h3>
          <button className="btn btn-primary" onClick={() => navigate('/dashboard/profile/mcp/new')} disabled={busy}>
            <Plus size={16} /> {t('profile.mcp.tokens.newToken')}
          </button>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 16 }}>
          {t('profile.mcp.tokens.description')}
        </p>

        {tokens.length === 0 ? (
          <div className="empty-state">
            <Key size={36} />
            <p>{t('profile.mcp.tokens.empty')}</p>
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
                    [t('profile.mcp.tokens.created'), fmtDate(token.createdAt, t('profile.mcp.tokens.never'))],
                    [t('profile.mcp.tokens.lastUsed'), token.lastUsedAt ? fmtDate(token.lastUsedAt, t('profile.mcp.tokens.never')) : t('profile.mcp.tokens.never')],
                    [t('profile.mcp.tokens.expires'), fmtDate(token.expiresAt, t('profile.mcp.tokens.never'))],
                  ] as const).map(([label, value]) => (
                    <div key={label} style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{value}</span>
                    </div>
                  ))}
                  <button className="btn-icon danger" onClick={() => handleRevoke(token)} disabled={busy} title={t('profile.mcp.tokens.revokeTitle')}>
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
        <h3 style={SECTION_TITLE}>{t('profile.mcp.tools.heading')}</h3>
        {tools.length === 0 ? (
          <div className="empty-state">
            <Wrench size={36} />
            <p>{t('profile.mcp.tools.empty')}</p>
          </div>
        ) : (
          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>{t('profile.mcp.tools.table.name')}</th>
                  <th>{t('profile.mcp.tools.table.scope')}</th>
                  <th>{t('profile.mcp.tools.table.description')}</th>
                  <th>{t('profile.mcp.tools.table.sourceModule')}</th>
                  <th>{t('profile.mcp.tools.table.permission')}</th>
                </tr>
              </thead>
              <tbody>
                {tools.map(tool => (
                  <tr key={tool.name}>
                    <td><span className="mono" style={{ fontSize: '0.82rem' }}>{tool.name}</span></td>
                    <td><span className={`badge badge-${tool.scope === 'write' ? 'warning' : 'success'}`}>{tool.scope}</span></td>
                    <td><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{tool.description}</span></td>
                    <td><span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{tool.sourceModule}</span></td>
                    <td><span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{tool.permission}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Connection instructions ───────────────────────────────────────── */}
      <section>
        <h3 style={SECTION_TITLE}>{t('profile.mcp.connect.heading')}</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 16 }}>
          {t('profile.mcp.connect.descriptionPre')} <span className="mono">{PLACEHOLDER_MCP_TOKEN}</span> {t('profile.mcp.connect.descriptionPost')}
        </p>

        <McpClientGuide token={PLACEHOLDER_MCP_TOKEN} />

        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 6 }}>{t('profile.mcp.connect.otherClient')}</div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 10 }}>
            {t('profile.mcp.connect.httpInstructionsPre')}{' '}
            <span className="mono">Authorization: Bearer &lt;your MCP token&gt;</span>
            {t('profile.mcp.connect.httpInstructionsPost')}
          </p>
          <CopyBlock text={HTTP_ENDPOINT} />
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 12, marginBottom: 10 }}>
            {t('profile.mcp.connect.stdioInstructionsPre')}{' '}
            <span className="mono">ROUTERLY_MCP_STDIO=1</span> {t('profile.mcp.connect.stdioInstructionsAnd')}{' '}
            <span className="mono">ROUTERLY_MCP_TOKEN=&lt;your MCP token&gt;</span> {t('profile.mcp.connect.stdioInstructionsPost')}
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
