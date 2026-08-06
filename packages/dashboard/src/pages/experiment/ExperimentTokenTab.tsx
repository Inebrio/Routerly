import { useState } from 'react';
import { Plus, Trash2, Key, Copy, Check } from 'lucide-react';
import { createExperimentToken, deleteExperimentToken } from '../../api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CopyBlock } from '../../components/CopyBlock';
import { writeToClipboard } from '../../utils/clipboard';
import { useAuth } from '../../AuthContext';
import { useExperiment } from './ExperimentLayout';

export function ExperimentTokenTab() {
  const { experiment, setExperiment } = useExperiment();
  const { can } = useAuth();
  const canManage = can('experiments:manage');

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  if (!experiment) return null;
  const tokens = experiment.tokens;

  async function handleCreate() {
    setErr(''); setLoading(true);
    try {
      const result = await createExperimentToken(experiment!.id);
      setExperiment(e => (e ? { ...e, tokens: [...e.tokens, result.tokenInfo] } : e));
      setRevealed(result.token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create the token');
    } finally {
      setLoading(false);
    }
  }

  function handleDelete(tokenId: string, snippet: string) {
    setConfirmState({
      message: `Revoke token "${snippet}..."? Clients using it stop working immediately.`,
      onConfirm: async () => {
        setConfirmState(null);
        setErr(''); setLoading(true);
        try {
          await deleteExperimentToken(experiment!.id, tokenId);
          setExperiment(e => (e ? { ...e, tokens: e.tokens.filter(t => t.id !== tokenId) } : e));
        } catch (e) {
          setErr(e instanceof Error ? e.message : 'Failed to revoke the token');
        } finally {
          setLoading(false);
        }
      },
    });
  }

  async function copyToken(token: string) {
    try {
      await writeToClipboard(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr('Copy failed: select and copy the token manually.');
    }
  }

  return (
    <>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

      <p className="section-desc" style={{ marginTop: 0 }}>
        A client calls the experiment exactly like a router: same base URL, this token instead of a router token.
        Each request lands on one variant and is billed to that variant's router.
      </p>

      <div style={{ maxWidth: 620, marginBottom: 24 }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
          Base URL for the OpenAI or Anthropic SDK, with an experiment token as the API key:
        </div>
        <CopyBlock text={`${window.location.origin}/v1`} />
      </div>

      {revealed && (
        <div style={{ padding: 16, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, marginBottom: 24 }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 10 }}>
            Token created. Copy it now, it won't be shown again.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="token-box" style={{ flex: 1, margin: 0, wordBreak: 'break-all', fontSize: '0.82rem' }}>{revealed}</div>
            <button className="btn btn-secondary" onClick={() => copyToken(revealed)} style={{ flexShrink: 0 }}>
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {canManage && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
          <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>
            <Plus size={16} /> New Token
          </button>
        </div>
      )}

      {tokens.length === 0 ? (
        <div className="empty-state">
          <Key size={36} />
          <p>No tokens on this experiment. Create one so clients can call it.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tokens.map(token => (
            <div key={token.id} style={{
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Key size={16} style={{ color: 'var(--text-muted)' }} />
                <span className="mono" style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                  {token.tokenSnippet}<span style={{ opacity: 0.5 }}>••••••••</span>
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Created</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {new Date(token.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Last used</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                  </span>
                </div>
                {canManage && (
                  <button className="btn-icon danger" disabled={loading} title="Revoke Token"
                    onClick={() => handleDelete(token.id, token.tokenSnippet || '')}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmState && (
        <ConfirmDialog message={confirmState.message} onConfirm={confirmState.onConfirm} onCancel={() => setConfirmState(null)} />
      )}
    </>
  );
}
