import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Trash2, Pencil, ShieldOff, Split } from 'lucide-react';
import {
  getExperiments, getRouters, deleteExperiment,
  type ApiError, type MaskedExperiment, type Router,
} from '../api';
import { rotationLabel, type ExperimentRotation } from '@routerly/shared';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../AuthContext';

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
  const { t } = useTranslation();
  const { can } = useAuth();
  const navigate = useNavigate();
  const canRead = can('experiments:read');
  const canManage = can('experiments:manage');

  const [experiments, setExperiments] = useState<MaskedExperiment[]>([]);
  const [routers, setRouters] = useState<Router[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useEffect(() => {
    if (!canRead) { setLoading(false); return; }
    setLoading(true);
    getExperiments()
      .then(setExperiments)
      .catch(e => setError(e instanceof Error ? e.message : t('experiments.list.errors.loadFailed')))
      .finally(() => setLoading(false));
    // Variants name their router, not its id: a failed lookup only costs the
    // fallback label, so it never blocks the list.
    getRouters().then(setRouters).catch(() => {});
  }, [canRead]);

  /** What each variant is called on screen: its own label, else the router it routes to. */
  function variantLabels(e: MaskedExperiment): string {
    return e.variants
      .map(v => v.name ?? routers.find(p => p.id === v.routerId)?.name ?? v.routerId.slice(0, 8))
      .join(' vs ');
  }

  function handleDelete(e: MaskedExperiment) {
    setConfirmState({
      message: t('experiments.list.deleteConfirm', { name: e.name }),
      onConfirm: async () => {
        setConfirmState(null);
        setError('');
        try {
          await deleteExperiment(e.id);
          setExperiments(list => list.filter(x => x.id !== e.id));
        } catch (err) {
          setError(err instanceof Error ? err.message : t('experiments.list.errors.deleteFailed'));
        }
      },
    });
  }

  if (!canRead) {
    return (
      <>
        <div className="page-header">
          <h1>{t('experiments.list.title')}</h1>
          <p>{t('experiments.list.subtitle')}</p>
        </div>
        <div className="page-body">
          <div className="empty-state"><ShieldOff size={40} /><p>{t('experiments.list.noPermission')}</p></div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>{t('experiments.list.title')}</h1>
        <p>{t('experiments.list.subtitle')}</p>
      </div>
      <div className="page-body">
        {error && <div className="form-error" style={{ marginBottom: 20 }}>{error}</div>}

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : (
          <>
            <div className="toolbar">
              <span className="toolbar-title">
                {t('experiments.list.count', { count: experiments.length })}
              </span>
              {canManage && (
                <button className="btn btn-primary" onClick={() => navigate('/dashboard/experiments/new')}>
                  <Plus size={16} /> {t('experiments.list.newExperiment')}
                </button>
              )}
            </div>

            {experiments.length === 0 ? (
              <div className="empty-state">
                <Split size={40} />
                <p>{t('experiments.list.empty')}</p>
              </div>
            ) : (
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th>{t('experiments.list.columns.name')}</th>
                      <th>{t('experiments.list.columns.variants')}</th>
                      <th>{t('experiments.list.columns.rotation')}</th>
                      <th>{t('experiments.list.columns.created')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {experiments.map(e => (
                      <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/dashboard/experiments/${e.id}`)}>
                        <td style={{ maxWidth: 360 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <Link to={`/dashboard/experiments/${e.id}`} style={{ fontWeight: 500 }}>{e.name}</Link>
                            {e.tokens.length === 0 && (
                              <span className="badge badge-warning" title={t('experiments.list.noTokenTitle')}>
                                {t('experiments.list.noToken')}
                              </span>
                            )}
                          </div>
                          {e.description && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>
                              {e.description}
                            </div>
                          )}
                        </td>
                        <td><span style={{ fontSize: '0.82rem' }}>{variantLabels(e) || '—'}</span></td>
                        <td><span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{rotationLabel(e.rotation as ExperimentRotation)}</span></td>
                        <td><span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{new Date(e.createdAt).toLocaleDateString()}</span></td>
                        <td onClick={ev => ev.stopPropagation()}>
                          {/* A flex td collapses the row's own height: keep the layout on an inner box. */}
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {canManage && (
                              <>
                                <button className="btn-icon" onClick={() => navigate(`/dashboard/experiments/${e.id}/config`)} title={t('experiments.list.actions.edit')}>
                                  <Pencil size={15} />
                                </button>
                                <button className="btn-icon danger" onClick={() => handleDelete(e)} title={t('experiments.list.actions.remove')}>
                                  <Trash2 size={15} />
                                </button>
                              </>
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
