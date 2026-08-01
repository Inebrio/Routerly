import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Trash2, Play, ShieldOff, Split } from 'lucide-react';
import {
  getExperiments, getProjects, deleteExperiment, startExperiment,
  type ApiError, type ExperimentStatus, type MaskedExperiment, type Project,
} from '../api';
import { rotationLabel, type ExperimentRotation } from '@routerly/shared';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SearchableSelect } from '../components/SearchableSelect';
import { useAuth } from '../AuthContext';

export const STATUS_LABELS: Record<ExperimentStatus, string> = {
  draft: 'Draft',
  running: 'Running',
  closed: 'Closed',
};

/** Draft still needs a start, running takes live traffic, closed is history. */
export const STATUS_BADGE: Record<ExperimentStatus, string> = {
  draft: 'badge-warning',
  running: 'badge-success',
  closed: 'badge-custom',
};

/**
 * Whether the nav should offer Experiments at all: the permission decides, and a
 * 403 on the list route means the module itself is off. Same shape as
 * useClientsEnabled, which solves the identical problem for the clients module.
 */
export function useExperimentsEnabled(): boolean | null {
  const { can } = useAuth();
  const allowed = can('experiments:read');
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!allowed) { setEnabled(false); return; }
    let cancelled = false;
    getExperiments()
      .then(() => { if (!cancelled) setEnabled(true); })
      .catch((err: ApiError) => {
        // Only a confirmed 403 (module disabled, the permission already passed)
        // hides the link; any other error leaves it unresolved rather than
        // looking identical to "genuinely disabled".
        if (!cancelled && err.status === 403) setEnabled(false);
      });
    return () => { cancelled = true; };
  }, [allowed]);

  return enabled;
}

export function ExperimentsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const canRead = can('experiments:read');
  const canManage = can('experiments:manage');

  const [experiments, setExperiments] = useState<MaskedExperiment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [statusFilter, setStatusFilter] = useState<'' | ExperimentStatus>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useEffect(() => {
    if (!canRead) { setLoading(false); return; }
    setLoading(true);
    getExperiments()
      .then(setExperiments)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load experiments'))
      .finally(() => setLoading(false));
    // Variants name their project, not its id: a failed lookup only costs the
    // fallback label, so it never blocks the list.
    getProjects().then(setProjects).catch(() => {});
  }, [canRead]);

  /** What each variant is called on screen: its own label, else the project it routes to. */
  function variantLabels(e: MaskedExperiment): string {
    return e.variants
      .map(v => v.name ?? projects.find(p => p.id === v.projectId)?.name ?? v.projectId.slice(0, 8))
      .join(' vs ');
  }

  async function handleStart(e: MaskedExperiment) {
    setError('');
    try {
      const started = await startExperiment(e.id);
      setExperiments(list => list.map(x => (x.id === e.id ? started : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the experiment');
    }
  }

  function handleDelete(e: MaskedExperiment) {
    setConfirmState({
      message: `Delete experiment "${e.name}"? Its tokens stop working immediately. This cannot be undone.`,
      onConfirm: async () => {
        setConfirmState(null);
        setError('');
        try {
          await deleteExperiment(e.id);
          setExperiments(list => list.filter(x => x.id !== e.id));
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to delete the experiment');
        }
      },
    });
  }

  if (!canRead) {
    return (
      <>
        <div className="page-header">
          <h1>Experiments</h1>
          <p>A/B tests that split traffic across whole projects</p>
        </div>
        <div className="page-body">
          <div className="empty-state"><ShieldOff size={40} /><p>You don't have permission to view experiments.</p></div>
        </div>
      </>
    );
  }

  const visible = statusFilter === '' ? experiments : experiments.filter(e => e.status === statusFilter);

  return (
    <>
      <div className="page-header">
        <h1>Experiments</h1>
        <p>A/B tests that split traffic across whole projects</p>
      </div>
      <div className="page-body">
        {error && <div className="form-error" style={{ marginBottom: 20 }}>{error}</div>}

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : (
          <>
            <div className="toolbar">
              <span className="toolbar-title">
                {visible.length} experiment{visible.length !== 1 ? 's' : ''}
              </span>
              <div style={{ width: 200 }}>
                <SearchableSelect
                  ariaLabel="Status"
                  placeholder="All statuses"
                  value={statusFilter}
                  onChange={v => setStatusFilter(v as '' | ExperimentStatus)}
                  options={[
                    { value: '', label: 'All statuses' },
                    ...(Object.keys(STATUS_LABELS) as ExperimentStatus[]).map(s => ({ value: s, label: STATUS_LABELS[s] })),
                  ]}
                />
              </div>
              {canManage && (
                <button className="btn btn-primary" onClick={() => navigate('/dashboard/experiments/new')}>
                  <Plus size={16} /> New Experiment
                </button>
              )}
            </div>

            {visible.length === 0 ? (
              <div className="empty-state">
                <Split size={40} />
                <p>No experiments yet. Create one to compare two projects on live traffic.</p>
              </div>
            ) : (
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 820 }}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Variants</th>
                      <th>Rotation</th>
                      <th>Created</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(e => (
                      <tr key={e.id}>
                        <td style={{ maxWidth: 360 }}>
                          <Link to={`/dashboard/experiments/${e.id}`} style={{ fontWeight: 500 }}>{e.name}</Link>
                          {e.description && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>
                              {e.description}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span className={`badge ${STATUS_BADGE[e.status]}`}>{STATUS_LABELS[e.status]}</span>
                            {e.tokens.length === 0 && (
                              <span className="badge badge-warning" title="Without a token no client can reach this experiment">
                                No token
                              </span>
                            )}
                          </div>
                        </td>
                        <td><span style={{ fontSize: '0.82rem' }}>{variantLabels(e) || '—'}</span></td>
                        <td><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{rotationLabel(e.rotation as ExperimentRotation)}</span></td>
                        <td><span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{new Date(e.createdAt).toLocaleDateString()}</span></td>
                        <td>
                          {/* A flex td collapses the row's own height: keep the layout on an inner box. */}
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {canManage && e.status === 'draft' && (
                              <button className="btn-icon" onClick={() => handleStart(e)} title="Start">
                                <Play size={15} />
                              </button>
                            )}
                            {canManage && e.status !== 'running' && (
                              <button className="btn-icon danger" onClick={() => handleDelete(e)} title="Delete">
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
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
