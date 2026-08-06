import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, FolderOpen, Pencil } from 'lucide-react';
import { getRouters, deleteRouter, type Router } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../AuthContext';

export function RoutersPage() {
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
      message: 'Delete this router?',
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await deleteRouter(id);
          setRouters(p => p.filter(x => x.id !== id));
        } catch (error) {
          setErr(error instanceof Error ? error.message : 'Error deleting router');
        }
      },
    });
  }

  return (
    <>
      <div className="page-header">
        <h1>Routers</h1>
        <p>Client applications that access Routerly</p>
      </div>
      {err && <div className="form-error" style={{ margin: '0 20px' }}>{err}</div>}
      <div className="page-body">
        <div className="toolbar">
          <span className="toolbar-title">{routers.length} router{routers.length !== 1 ? 's' : ''}</span>
          {canWrite && (
            <button className="btn btn-primary" onClick={() => navigate('/dashboard/routers/new')}>
              <Plus size={16} /> New Router
            </button>
          )}
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : routers.length === 0 ? (
          <div className="empty-state"><FolderOpen size={40} /><p>No routers yet.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Tokens</th><th>Policies</th><th>Models</th><th></th></tr>
              </thead>
              <tbody>
                {routers.map(p => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/dashboard/routers/${p.id}`)}>
                    <td><strong style={{ color: 'var(--text-primary)' }}>{p.name}</strong></td>
                    <td>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {p.tokens?.length || 0} token{p.tokens?.length !== 1 ? 's' : ''}
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
                      <button className="btn-icon" onClick={() => navigate(`/dashboard/routers/${p.id}/general`)} title="Edit router">
                        <Pencil size={15} />
                      </button>
                      {canWrite && (
                        <button className="btn-icon danger" onClick={() => handleDelete(p.id)} title="Delete router">
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
