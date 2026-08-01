import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Edit2, Copy, Eye, Layers, ShieldOff } from 'lucide-react';
import {
  getProfiles, deleteProfile,
  type Profile, type ProfileKind,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SearchableSelect } from '../components/SearchableSelect';
import { useAuth } from '../AuthContext';

export const KIND_LABELS: Record<ProfileKind, string> = {
  routing: 'Routing',
  optimizer: 'Optimizer',
  security: 'Security',
};

/** One-line description of what a profile actually configures, shown in the list. */
export function profileSummary(p: Profile): string {
  if (p.kind === 'routing') {
    const enabled = p.policies.filter(x => x.enabled).length;
    return `${enabled} polic${enabled === 1 ? 'y' : 'ies'}, ${p.selector}`;
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
  const [kindFilter, setKindFilter] = useState<'' | ProfileKind>('');
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

  const visible = kindFilter === '' ? profiles : profiles.filter(p => p.kind === kindFilter);

  return (
    <>
      <div className="page-header">
        <h1>Profiles</h1>
        <p>Reusable routing, optimizer and security configurations</p>
      </div>
      <div className="page-body">
        {error && <div className="form-error" style={{ marginBottom: 20 }}>{error}</div>}

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : (
          <>
            <div className="toolbar">
              <span className="toolbar-title">
                {visible.length} profile{visible.length !== 1 ? 's' : ''}
              </span>
              <div style={{ width: 200 }}>
                <SearchableSelect
                  ariaLabel="Kind"
                  placeholder="All kinds"
                  value={kindFilter}
                  onChange={v => setKindFilter(v as '' | ProfileKind)}
                  options={[
                    { value: '', label: 'All kinds' },
                    ...(Object.keys(KIND_LABELS) as ProfileKind[]).map(k => ({ value: k, label: KIND_LABELS[k] })),
                  ]}
                />
              </div>
              {canManage && (
                <button className="btn btn-primary" onClick={() => navigate('/dashboard/profiles/new')}>
                  <Plus size={16} /> New Profile
                </button>
              )}
            </div>

            {visible.length === 0 ? (
              <div className="empty-state"><Layers size={40} /><p>No profiles yet.</p></div>
            ) : (
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Kind</th>
                      <th>Type</th>
                      <th>Configuration</th>
                      <th>Version</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(p => (
                      <tr key={p.id}>
                        <td>{p.label}</td>
                        <td><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{KIND_LABELS[p.kind]}</span></td>
                        <td><span className={`badge badge-${p.builtin ? 'success' : 'custom'}`}>{p.builtin ? 'Built-in' : 'Custom'}</span></td>
                        <td><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{profileSummary(p)}</span></td>
                        <td><span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.version}</span></td>
                        <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
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
