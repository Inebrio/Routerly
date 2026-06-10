import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Copy, Check, ArrowLeft } from 'lucide-react';
import { createProjectToken } from '../../api';
import { useProject } from './ProjectLayout';
import { LabelInput } from './ProjectTokenTab'; // Will be exported next

export function ProjectTokenCreatePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { project, setProject } = useProject();
  if (!project) return null;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  // Create state
  const [createLabels, setCreateLabels] = useState<string[]>([]);
  const [createLabelInput, setCreateLabelInput] = useState('');
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  const allLabels = Array.from(new Set((project.tokens || []).flatMap(t => t.labels || []))).sort();

  async function copyToClipboard(token: string) {
    const success = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };
    try {
      await navigator.clipboard.writeText(token);
      success();
    } catch {
      // Fallback for non-secure contexts (HTTP, docker self-hosted via IP)
      try {
        const el = document.createElement('textarea');
        el.value = token;
        el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
        document.body.appendChild(el);
        el.focus();
        el.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(el);
        if (ok) { success(); } else { setErr('Copy failed — please select and copy the token manually.'); }
      } catch {
        setErr('Copy failed — please select and copy the token manually.');
      }
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true);
    if (!projectId) return;
    try {
      const result = await createProjectToken(projectId, createLabels);
      setProject(p => p ? { ...p, tokens: [...(p.tokens || []), result.tokenInfo] } : p);
      setRevealedToken(result.token);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error creating token'); }
    finally { setLoading(false); }
  }

  function goBack() {
    navigate(`/dashboard/projects/${projectId}/token`);
  }

  return (
    <div className="page-body">
      <div style={{ maxWidth: 560 }}>


        <button type="button" onClick={goBack}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', padding: 0, marginBottom: 24 }}>
          <ArrowLeft size={16} /> Back to tokens
        </button>

        <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 600 }}>New API Token</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 28 }}>
          The full token is shown only once after creation — store it securely.
        </p>

        {revealedToken ? (
          <>
            <div style={{
              padding: 16, background: 'rgba(34,197,94,0.07)',
              border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, marginBottom: 24,
            }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 10 }}>
                Token created successfully. Copy it now — it won't be shown again.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="token-box" style={{ flex: 1, margin: 0, wordBreak: 'break-all', fontSize: '0.82rem' }}>
                  {revealedToken}
                </div>
                <button className="btn btn-secondary" onClick={() => copyToClipboard(revealedToken)} style={{ flexShrink: 0 }}>
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <button className="btn btn-primary" onClick={goBack}>Done</button>
          </>
        ) : (
          <form onSubmit={handleCreate}>
            {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

            <div className="form-group">
              <label className="form-label">
                Labels <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
              </label>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                Tag this token to identify where it's used (e.g. "production", "ci").
              </p>
              <LabelInput labels={createLabels} setLabels={setCreateLabels} input={createLabelInput} setInput={setCreateLabelInput} allLabels={allLabels} />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <span className="spinner" /> : 'Create Token'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={goBack} disabled={loading}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
