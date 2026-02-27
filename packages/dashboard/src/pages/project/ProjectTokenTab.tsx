import React, { useState } from 'react';
import { Copy, Check, RefreshCw } from 'lucide-react';
import { rotateToken } from '../../api';
import { useProject } from './ProjectLayout';

export function ProjectTokenTab() {
  const { project, setProject } = useProject();
  if (!project) return null; // should never happen as tab is disabled for new projects

  const [rotating, setRotating] = useState(false);
  const [err, setErr] = useState('');

  // For the new token reveal modal
  const [revealedToken, setRevealedToken] = useState<{ name: string; token: string; isNew: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleRotateToken() {
    if (!confirm('This will immediately revoke the current token. Any application using it will stop working until updated. Continue?')) return;
    setErr('');
    setRotating(true);
    try {
      const result = await rotateToken(project!.id);
      setProject(p => p ? { ...p, tokenSnippet: result.tokenSnippet ?? '' } : p);
      setRevealedToken({ name: result.name, token: result.token, isNew: true });
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Error rotating token');
    } finally {
      setRotating(false);
    }
  }

  async function copyToken(token: string) {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <div style={{ maxWidth: 480 }}>
        {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

        <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem', color: 'var(--text-primary)' }}>API Token</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 16px' }}>
          This token is used to authenticate requests to the LocalRouter API. Rotating the token immediately revokes the current one.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="mono" style={{ fontSize: '1.1rem', color: 'var(--text-primary)', letterSpacing: '0.04em', background: 'var(--surface-active)', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
            {project.tokenSnippet ? `${project.tokenSnippet}••••••••••••••••••••••` : '••••••••••••••••••••••••••••••••'}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRotateToken}
            disabled={rotating}
            style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
          >
            {rotating ? <span className="spinner" /> : <RefreshCw size={14} />}
            Rotate Token
          </button>
        </div>
      </div>

      {/* Token reveal modal */}
      {revealedToken && (
        <div className="modal-overlay">
          <div className="modal">
            <h2 className="modal-title">
              🔑 New Token Generated
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 12 }}>
              Copy this token now — it won't be shown again.
            </p>
            <div className="token-box" style={{ marginBottom: 12 }}>{revealedToken.token}</div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => copyToken(revealedToken.token)}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? 'Copied!' : 'Copy Token'}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setRevealedToken(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
