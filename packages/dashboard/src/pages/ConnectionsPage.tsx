import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Trash2, Edit2, Boxes, Plug, ShieldOff, ChevronRight, ChevronDown, FlaskConical, Telescope } from 'lucide-react';
import {
  getConnections, deleteConnection, getModels, deleteModel, testModel, getProviderHealth,
  type Connection, type Model, type ProviderHealth,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../AuthContext';

const ORPHAN = '__none__';
const HEALTH_COLOR: Record<ProviderHealth['status'], string> = {
  healthy: 'var(--success)', degraded: 'var(--warning)', unavailable: 'var(--danger)', cooldown: 'var(--text-muted)',
};

export function ConnectionsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canRead = can('connections:read');
  const canManage = can('connections:manage');
  const canReadModels = can('model:read');
  const canWriteModels = can('model:write');
  const canReadHealth = can('report:read');
  const navigate = useNavigate();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [health, setHealth] = useState<Map<string, ProviderHealth>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tests, setTests] = useState<Record<string, 'loading' | { ok: boolean; latencyMs: number; error?: string }>>({});
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useEffect(() => { if (canRead) void load(); else setLoading(false); }, [canRead]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const conns = await getConnections();
      setConnections(conns);
      // Models and health only enrich the tree: a failure here must not hide the connections.
      if (canReadModels) getModels().then(setModels).catch(() => {});
      if (canReadModels && canReadHealth) {
        getProviderHealth().then(({ providers }) => setHealth(new Map(providers.map(p => [p.modelId, p])))).catch(() => {});
      }
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

  function toggle(id: string) {
    setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function handleTest(id: string) {
    setTests(r => ({ ...r, [id]: 'loading' }));
    const result = await testModel(id);
    setTests(r => ({ ...r, [id]: result }));
  }

  function handleDeleteModel(m: Model) {
    setConfirmState({
      message: t('models.page.deleteConfirm', { id: m.id }),
      onConfirm: async () => {
        setConfirmState(null);
        setError('');
        try {
          await deleteModel(m.id);
          setModels(ms => ms.filter(x => x.id !== m.id));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
    });
  }

  const knownIds = new Set(connections.map(c => c.id));
  const modelsOf = (connId: string) => models.filter(m => (connId === ORPHAN ? !m.connectionId || !knownIds.has(m.connectionId) : m.connectionId === connId));

  function renderModels(connId: string, connEnabled = true) {
    const list = modelsOf(connId);
    const addHref = connId === ORPHAN ? '/dashboard/models/new' : `/dashboard/models/new?connection=${encodeURIComponent(connId)}`;
    return (
      <div className="tree-models" style={{ padding: '4px 0 8px 28px' }}>
        {list.length === 0 && <p style={{ margin: '6px 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('connections.tree.noModels')}</p>}
        {list.map(m => {
          const h = health.get(m.id);
          const tr = tests[m.id];
          return (
            <div key={m.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '5px 0', borderTop: '1px solid var(--border)' }}>
              {h && <span title={h.status} style={{ width: 8, height: 8, borderRadius: '50%', background: HEALTH_COLOR[h.status], flexShrink: 0 }} />}
              <span className="mono" style={{ flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>{m.id}</span>
              {!connEnabled && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t('connections.list.status.disabled')}</span>}
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {t('connections.tree.price', { input: m.cost.inputPerMillion, output: m.cost.outputPerMillion })}
                {m.contextWindow ? ` · ${Math.round(m.contextWindow / 1000)}k` : ''}
              </span>
              {tr === 'loading' && <span style={{ fontSize: '0.7rem' }}>…</span>}
              {tr && tr !== 'loading' && (
                <span style={{ fontSize: '0.7rem', color: tr.ok ? 'var(--success)' : 'var(--danger)' }} title={tr.error}>
                  {tr.ok ? `✓ ${tr.latencyMs}ms` : `✗ ${tr.error?.slice(0, 30)}`}
                </span>
              )}
              <button className="btn-icon" onClick={() => void handleTest(m.id)} title={t('models.page.actions.test')} aria-label={`${t('models.page.actions.test')} ${m.id}`}><FlaskConical size={15} /></button>
              {canWriteModels && (
                <>
                  <Link to={`/dashboard/models/${encodeURIComponent(m.id)}`} className="btn-icon" title={t('models.page.actions.edit')} aria-label={`${t('models.page.actions.edit')} ${m.id}`}><Edit2 size={15} /></Link>
                  <button className="btn-icon danger" onClick={() => handleDeleteModel(m)} title={t('models.page.actions.remove')} aria-label={`${t('models.page.actions.remove')} ${m.id}`}><Trash2 size={15} /></button>
                </>
              )}
            </div>
          );
        })}
        {canWriteModels && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <Link to={addHref} className="btn btn-sm"><Plus size={14} /> {t('connections.tree.addModel')}</Link>
            <Link to="/dashboard/models/discover" className="btn btn-sm btn-secondary"><Telescope size={14} /> {t('connections.tree.discover')}</Link>
          </div>
        )}
      </div>
    );
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
                <table>
                  <thead>
                    <tr>
                      <th>{t('connections.list.columns.label')}</th>
                      <th>{t('connections.list.columns.provider')}</th>
                      <th className="hide-narrow">{t('connections.list.columns.endpoint')}</th>
                      <th>{t('connections.list.columns.status')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {connections.map(conn => (
                      <Fragment key={conn.id}>
                      <tr
                        {...(canManage ? {
                          style: { cursor: 'pointer' },
                          onClick: () => navigate(`/dashboard/connections/${encodeURIComponent(conn.id)}/edit`),
                        } : {})}
                      >
                        <td>
                          {canReadModels ? (
                            <button
                              className="btn-icon"
                              aria-expanded={expanded.has(conn.id)}
                              aria-label={t('connections.tree.toggle', { label: conn.label })}
                              onClick={e => { e.stopPropagation(); toggle(conn.id); }}
                              style={{ marginRight: 6 }}
                            >
                              {expanded.has(conn.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                            </button>
                          ) : null}
                          {conn.label}
                          {canReadModels && (
                            <span style={{ marginLeft: 8, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {t('connections.tree.modelCount', { count: modelsOf(conn.id).length })}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`badge badge-${conn.providerId}`}>{conn.providerId}</span>
                          {/* A custom connection is only telling once it says what it points at (T205) */}
                          {conn.providerName && (
                            <span style={{ marginLeft: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{conn.providerName}</span>
                          )}
                        </td>
                        <td className="hide-narrow"><span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{conn.endpoint || '—'}</span></td>
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
                      {canReadModels && expanded.has(conn.id) && (
                        <tr><td colSpan={5} style={{ padding: 0 }}>{renderModels(conn.id, conn.enabled)}</td></tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {canReadModels && modelsOf(ORPHAN).length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h3 style={{ fontSize: '0.9rem' }}>{t('connections.tree.orphans', { count: modelsOf(ORPHAN).length })}</h3>
                {renderModels(ORPHAN)}
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
