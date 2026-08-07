import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, FolderOpen, Pencil } from 'lucide-react';
import { getRouters, deleteRouter, type Router, type RouterKind } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../AuthContext';

const KIND_TABS: RouterKind[] = ['router', 'orchestrator', 'passthrough'];

export function RoutersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canWrite = can('router:write');
  const [routers, setRouters] = useState<Router[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (KIND_TABS.includes(searchParams.get('tab') as RouterKind) ? searchParams.get('tab') : 'router') as RouterKind;
  const setTab = (next: RouterKind) => setSearchParams(next === 'router' ? {} : { tab: next }, { replace: true });
  const visibleRouters = routers.filter(r => (r.kind ?? 'router') === tab);

  const tabStyle = (target: RouterKind): CSSProperties => ({
    padding: '0 4px 12px',
    fontSize: '0.9rem', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer',
    color: tab === target ? 'var(--primary)' : 'var(--text-secondary)',
    borderBottom: tab === target ? '2px solid var(--primary)' : '2px solid transparent',
    transition: 'color 0.15s',
    marginBottom: -1,
  });

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

  const NEW_BUTTON: Record<RouterKind, { label: string; path: string }> = {
    router: { label: t('routers.list.newRouter'), path: '/dashboard/routers/new/router' },
    orchestrator: { label: t('routers.list.newOrchestrator'), path: '/dashboard/routers/new/orchestrator' },
    passthrough: { label: t('routers.list.newPassthrough'), path: '/dashboard/routers/new/passthrough' },
  };
  const newButton = NEW_BUTTON[tab];

  return (
    <>
      <div className="page-header" style={{ paddingBottom: 0 }}>
        <h1>{t('routers.list.title')}</h1>
        <p>{t('routers.list.subtitle')}</p>
        <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginTop: 12 }}>
          {KIND_TABS.map(k => (
            <button key={k} style={tabStyle(k)} onClick={() => setTab(k)}>
              {t(`routers.general.kind.${k}.label`)}
            </button>
          ))}
        </div>
      </div>
      {err && <div className="form-error" style={{ margin: '0 20px' }}>{err}</div>}
      <div className="page-body" style={{ paddingTop: 24 }}>
        <div className="toolbar">
          <span className="toolbar-title">{visibleRouters.length === 1 ? t('routers.list.count') : t('routers.list.count_other', { count: visibleRouters.length })}</span>
          {canWrite && newButton && (
            <button className="btn btn-primary" onClick={() => navigate(newButton.path)}>
              <Plus size={16} /> {newButton.label}
            </button>
          )}
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : routers.length === 0 ? (
          <div className="empty-state"><FolderOpen size={40} /><p>{t('routers.list.empty')}</p></div>
        ) : visibleRouters.length === 0 ? (
          <div className="empty-state"><FolderOpen size={40} /><p>{t('routers.list.emptyFiltered')}</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{t('routers.list.columns.name')}</th><th>{t('routers.list.columns.tokens')}</th><th>{t('routers.list.columns.policies')}</th><th>{t('routers.list.columns.models')}</th><th></th></tr>
              </thead>
              <tbody>
                {visibleRouters.map(p => (
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
