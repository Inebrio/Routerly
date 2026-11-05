import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Trash2, Edit2, Boxes, Plug, ShieldOff, RefreshCw } from 'lucide-react';
import {
  getConnections, deleteConnection, getModels, syncConnection,
  type Connection, type Model,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../AuthContext';

export function ConnectionsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canRead = can('connections:read');
  const canManage = can('connections:manage');
  const canReadModels = can('model:read');
  const navigate = useNavigate();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useEffect(() => { if (canRead) void load(); else setLoading(false); }, [canRead]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const conns = await getConnections();
      setConnections(conns);
      // Model counts are best-effort: the list still works without them.
      if (canReadModels) setModels(await getModels().catch(() => []));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('connections.list.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  function handleDelete(conn: Connection) {
    setConfirmState({
      message: t('connections.list.deleteConfirm', { label: conn.label }),
      onConfirm: async () => {
        setConfirmState(null);
        setError('');
        try {
          await deleteConnection(conn.id);
          setConnections(cs => cs.filter(c => c.id !== conn.id));
        } catch (e) {
          setError(e instanceof Error ? e.message : t('connections.list.errors.deleteFailed'));
        }
      },
    });
  }

  async function handleSync(conn: Connection) {
    setSyncing(conn.id);
    setError('');
    setNotice('');
    try {
      const sum = await syncConnection(conn.id);
      setNotice(sum.catalogAvailable
        ? t('connections.list.sync.done', { label: conn.label, added: sum.added.length, unavailable: sum.unavailable.length, restored: sum.restored.length, skipped: sum.skipped.length })
        : t('connections.list.sync.catalogUnavailable', { label: conn.label }));
      if (canReadModels) setModels(await getModels().catch(() => models));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('connections.list.sync.failed'));
    } finally {
      setSyncing(null);
    }
  }

  function modelCounts(connId: string) {
    const own = models.filter(m => m.connectionId === connId);
    return {
      total: own.length,
      fresh: own.filter(m => m.isNew).length,
      unavailable: own.filter(m => m.unavailable).length,
    };
  }

  if (!canRead) {
    return (
      <>
        <div className="page-header">
          <h1>{t('connections.list.title')}</h1>
          <p>{t('connections.list.subtitle')}</p>
        </div>
        <div className="page-body">
          <div className="empty-state"><ShieldOff size={40} /><p>{t('connections.list.noPermission')}</p></div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>{t('connections.list.title')}</h1>
        <p>{t('connections.list.subtitle')}</p>
      </div>
      <div className="page-body">
        {error && (
          // Scrolled into view: with a long list the banner sits above the fold and the failed removal looked silent.
          <div className="form-error" role="alert" style={{ marginBottom: 20 }} ref={el => el?.scrollIntoView?.({ block: 'center' })}>{error}</div>
        )}

        {notice && <div role="status" className="form-error" style={{ marginBottom: 20, background: 'rgba(16,185,129,0.08)', color: 'var(--success)', borderColor: 'rgba(16,185,129,0.2)' }}>{notice}</div>}

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : (
          <>
            <div className="toolbar">
              <span className="toolbar-title">
                {t('connections.list.count', { count: connections.length })}
              </span>
              {canManage && (
                <button className="btn btn-primary" onClick={() => navigate('/dashboard/connections/new')}>
                  <Plus size={16} /> {t('connections.list.addConnection')}
                </button>
              )}
            </div>

            {connections.length === 0 ? (
              <div className="empty-state"><Plug size={40} /><p>{t('connections.list.empty')}</p></div>
            ) : (
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 700 }}>
                  <thead>
                    <tr>
                      <th>{t('connections.list.columns.label')}</th>
                      <th>{t('connections.list.columns.provider')}</th>
                      <th>{t('connections.list.columns.endpoint')}</th>
                      {canReadModels && <th>{t('connections.list.columns.models')}</th>}
                      <th>{t('connections.list.columns.status')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {connections.map(conn => (
                      <tr
                        key={conn.id}
                        {...(canManage ? {
                          style: { cursor: 'pointer' },
                          onClick: () => navigate(`/dashboard/connections/${encodeURIComponent(conn.id)}/edit`),
                        } : {})}
                      >
                        <td>{conn.label}</td>
                        <td>
                          <span className={`badge badge-${conn.providerId}`}>{conn.providerId}</span>
                          {/* A custom connection is only telling once it says what it points at (T205) */}
                          {conn.providerName && (
                            <span style={{ marginLeft: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{conn.providerName}</span>
                          )}
                        </td>
                        <td><span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{conn.endpoint || '—'}</span></td>
                        {canReadModels && (() => {
                          const c = modelCounts(conn.id);
                          return (
                            <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                              <Link to={`/dashboard/models?connection=${encodeURIComponent(conn.id)}`} style={{ color: 'inherit' }}>
                                {c.total}
                                {c.fresh > 0 && <span style={{ color: 'var(--primary)' }}> · {t('connections.list.counts.new', { count: c.fresh })}</span>}
                                {c.unavailable > 0 && <span style={{ color: 'var(--danger)' }}> · {t('connections.list.counts.unavailable', { count: c.unavailable })}</span>}
                              </Link>
                            </td>
                          );
                        })()}
                        <td>
                          <span style={{ fontSize: '0.8rem', color: conn.enabled ? 'var(--success)' : 'var(--text-muted)' }}>
                            {conn.enabled ? t('connections.list.status.enabled') : t('connections.list.status.disabled')}
                          </span>
                        </td>
                        <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                          <Link to={`/dashboard/models?connection=${encodeURIComponent(conn.id)}`} className="btn-icon" title={t('connections.list.actions.models')}>
                            <Boxes size={15} />
                          </Link>
                          {canManage && (
                            <>
                              <button
                                className="btn-icon" disabled={!conn.catalogSync || syncing !== null}
                                onClick={() => void handleSync(conn)}
                                title={conn.catalogSync ? t('connections.list.actions.sync') : t('connections.list.actions.syncOff')}
                              >
                                {syncing === conn.id ? <span className="spinner" /> : <RefreshCw size={15} />}
                              </button>
                              <button className="btn-icon" onClick={() => navigate(`/dashboard/connections/${encodeURIComponent(conn.id)}/edit`)} title={t('connections.list.actions.edit')}>
                                <Edit2 size={15} />
                              </button>
                              <button className="btn-icon danger" onClick={() => handleDelete(conn)} title={t('connections.list.actions.remove')}>
                                <Trash2 size={15} />
                              </button>
                            </>
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
