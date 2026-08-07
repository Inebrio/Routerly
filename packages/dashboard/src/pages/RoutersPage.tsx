import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, FolderOpen, Pencil } from 'lucide-react';
import { getRouters, deleteRouter, type Router } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../AuthContext';

export function RoutersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canWrite = can('router:write');
  const [routers, setRouters] = useState<Router[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      setRouters(await getRouters());
    } finally { setLoading(false); }
  }

  function handleDelete(id: string) {
    setConfirmState({
      message: t('routers.list.deleteConfirm'),
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await deleteRouter(id);
          setRouters(p => p.filter(x => x.id !== id));
        } catch (error) {
          setErr(error instanceof Error ? error.message : t('routers.list.errors.deleteFailed'));
        }
      },
    });
  }

  return (
    <>
      <div className="page-header">
        <h1>{t('routers.list.title')}</h1>
        <p>{t('routers.list.subtitle')}</p>
      </div>
      {err && <div className="form-error" style={{ margin: '0 20px' }}>{err}</div>}
      <div className="page-body">
        <div className="toolbar">
          <span className="toolbar-title">{routers.length === 1 ? t('routers.list.count') : t('routers.list.count_other', { count: routers.length })}</span>
          {canWrite && (
            <button className="btn btn-primary" onClick={() => navigate('/dashboard/routers/new')}>
              <Plus size={16} /> {t('routers.list.newRouter')}
            </button>
          )}
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : routers.length === 0 ? (
          <div className="empty-state"><FolderOpen size={40} /><p>{t('routers.list.empty')}</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{t('routers.list.columns.name')}</th><th>{t('routers.list.columns.tokens')}</th><th>{t('routers.list.columns.policies')}</th><th>{t('routers.list.columns.models')}</th><th></th></tr>
              </thead>
              <tbody>
                {routers.map(p => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/dashboard/routers/${p.id}`)}>
                    <td><strong style={{ color: 'var(--text-primary)' }}>{p.name}</strong></td>
                    <td>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {(p.tokens?.length ?? 0) === 1 ? t('routers.list.tokenCount') : t('routers.list.tokenCount_other', { count: p.tokens?.length || 0 })}
                      </span>
                    </td>
                    <td>
                      {p.policies && p.policies.filter(pol => pol.enabled).length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {p.policies.filter(pol => pol.enabled).map(pol => (
                            <span key={pol.type} style={{ fontSize: '0.72rem', fontWeight: 500, padding: '2px 7px', borderRadius: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                              {pol.type}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {p.models.map(m => m.modelId).join(', ')}
                    </td>
                    <td style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                      {/* The row opens the router Dashboard; the pencil goes straight to the settings form. */}
                      <button className="btn-icon" onClick={() => navigate(`/dashboard/routers/${p.id}/general`)} title={t('routers.list.editRouter')}>
                        <Pencil size={15} />
                      </button>
                      {canWrite && (
                        <button className="btn-icon danger" onClick={() => handleDelete(p.id)} title={t('routers.list.deleteRouter')}>
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
