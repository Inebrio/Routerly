import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Edit2, Copy, Eye, Layers, ShieldOff } from 'lucide-react';
import {
  getProfiles, deleteProfile,
  type Profile, type ProfileKind,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../AuthContext';

export const KIND_LABELS: Record<ProfileKind, string> = {
  routing: 'Routing',
  optimizer: 'Optimizer',
  security: 'Security',
};

const KIND_DESCRIPTIONS: Record<ProfileKind, string> = {
  routing: 'Which model answers a request, and what happens when it cannot',
  optimizer: 'What is stripped from a prompt before it is sent',
  security: 'Guardrails and PII policies applied to traffic',
};

const KINDS = Object.keys(KIND_LABELS) as ProfileKind[];

/** One-line description of what a profile actually configures, shown in the list. */
export function profileSummary(p: Profile): string {
  if (p.kind === 'routing') {
    const enabled = p.policies.filter(x => x.enabled).length;
    return `${enabled} polic${enabled === 1 ? 'y' : 'ies'} enabled`;
  }
  if (p.kind === 'optimizer') {
    const enabled = p.optimizers.steps.filter(s => s.enabled).length;
    return `${enabled} step${enabled === 1 ? '' : 's'} enabled`;
  }
  const rules = p.guardrails.rules?.length ?? 0;
  const pii = p.pii.policies?.length ?? 0;
  return `${rules} guardrail${rules === 1 ? '' : 's'}, ${pii} PII polic${pii === 1 ? 'y' : 'ies'}`;
}

export function ProfilesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const canRead = can('profiles:read');
  const canManage = can('profiles:manage');

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [kind, setKind] = useState<ProfileKind>('routing');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useEffect(() => {
    if (!canRead) { setLoading(false); return; }
    setLoading(true);
    getProfiles()
      .then(setProfiles)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load profiles'))
      .finally(() => setLoading(false));
  }, [canRead]);

  function handleDelete(p: Profile) {
    setConfirmState({
      message: `Delete profile "${p.label}"? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmState(null);
        setError('');
        try {
          await deleteProfile(p.id);
          setProfiles(ps => ps.filter(x => x.id !== p.id));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to delete profile');
        }
      },
    });
  }

  if (!canRead) {
    return (
      <>
        <div className="page-header">
          <h1>Profiles</h1>
          <p>Reusable routing, optimizer and security configurations</p>
        </div>
        <div className="page-body">
          <div className="empty-state"><ShieldOff size={40} /><p>You don't have permission to view profiles.</p></div>
        </div>
      </>
    );
  }

  const visible = profiles.filter(p => p.kind === kind);

  // The three kinds share nothing but the word "profile": a tab per kind beats a
  // filter that hides two thirds of the page behind a dropdown (T110).
  const tabStyle = (k: ProfileKind): CSSProperties => ({
    padding: '0 4px 12px',
    fontSize: '0.9rem', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer',
    color: kind === k ? 'var(--primary)' : 'var(--text-secondary)',
    borderBottom: kind === k ? '2px solid var(--primary)' : '2px solid transparent',
    transition: 'color 0.15s',
    marginBottom: -1,
  });

  return (
    <>
      <div className="page-header" style={{ paddingBottom: 0 }}>
        <h1>Profiles</h1>
        <p>Reusable routing, optimizer and security configurations</p>
        <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginTop: 12 }}>
          {KINDS.map(k => (
            <button key={k} style={tabStyle(k)} onClick={() => setKind(k)} aria-pressed={kind === k}>
              {KIND_LABELS[k]}
              {!loading && (
                <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  {profiles.filter(p => p.kind === k).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="page-body" style={{ paddingTop: 24 }}>
        {error && <div className="form-error" style={{ marginBottom: 20 }}>{error}</div>}

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : (
          <>
            <div className="toolbar">
              <span className="toolbar-title" style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>
                {KIND_DESCRIPTIONS[kind]}
              </span>
              {canManage && (
                <button className="btn btn-primary" onClick={() => navigate(`/dashboard/profiles/new?kind=${kind}`)}>
                  <Plus size={16} /> New {KIND_LABELS[kind]} Profile
                </button>
              )}
            </div>

            {visible.length === 0 ? (
              <div className="empty-state">
                <Layers size={40} />
                <p>No {KIND_LABELS[kind].toLowerCase()} profiles yet.</p>
              </div>
            ) : (
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 640 }}>
                  {/* Five columns over a wide screen drift apart and stop reading as
                      one row, so everything but the actions is sized to its content. */}
                  <colgroup>
                    <col style={{ width: 280 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 240 }} />
                    <col style={{ width: 100 }} />
                    <col />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Type</th>
                      <th>Configuration</th>
                      <th>Version</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(p => (
                      <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/dashboard/profiles/${p.id}`)}>
                        <td>{p.label}</td>
                        <td><span className={`badge badge-${p.builtin ? 'success' : 'custom'}`}>{p.builtin ? 'Built-in' : 'Custom'}</span></td>
                        <td><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{profileSummary(p)}</span></td>
                        <td><span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.version}</span></td>
                        <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                          <button
                            className="btn-icon"
                            onClick={() => navigate(`/dashboard/profiles/${p.id}`)}
                            title={p.builtin || !canManage ? 'View' : 'Edit'}
                          >
                            {p.builtin || !canManage ? <Eye size={15} /> : <Edit2 size={15} />}
                          </button>
                          {canManage && (
                            <button
                              className="btn-icon"
                              onClick={() => navigate(`/dashboard/profiles/new?base=${encodeURIComponent(p.id)}`)}
                              title="Clone"
                            >
                              <Copy size={15} />
                            </button>
                          )}
                          {canManage && !p.builtin && (
                            <button className="btn-icon danger" onClick={() => handleDelete(p)} title="Delete">
                              <Trash2 size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </>
  );
}
