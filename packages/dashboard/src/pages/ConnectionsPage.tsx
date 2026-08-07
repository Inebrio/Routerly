import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Trash2, Edit2, Boxes, Plug, ShieldOff } from 'lucide-react';
import {
  getConnections, deleteConnection,
  type Connection,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../AuthContext';

export function ConnectionsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canRead = can('connections:read');
  const canManage = can('connections:manage');
  const navigate = useNavigate();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useEffect(() => { if (canRead) void load(); else setLoading(false); }, [canRead]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const conns = await getConnections();
      setConnections(conns);
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
        {error && <div className="form-error" style={{ marginBottom: 20 }}>{error}</div>}

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
