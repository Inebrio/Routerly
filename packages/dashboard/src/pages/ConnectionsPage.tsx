import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Trash2, Edit2, Boxes, Plug, ShieldOff } from 'lucide-react';
import {
  getConnections, deleteConnection,
  type Connection,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../AuthContext';

export function ConnectionsPage() {
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
      setError(e instanceof Error ? e.message : 'Failed to load connections');
    } finally {
      setLoading(false);
    }
  }

  function handleDelete(conn: Connection) {
    setConfirmState({
      message: `Remove connection "${conn.label}"? Instances bound to it will stop working.`,
      onConfirm: async () => {
        setConfirmState(null);
        setError('');
        try {
          await deleteConnection(conn.id);
          setConnections(cs => cs.filter(c => c.id !== conn.id));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to delete connection');
        }
      },
    });
  }

  if (!canRead) {
    return (
      <>
        <div className="page-header">
          <h1>Connections</h1>
          <p>Provider accounts used to run model instances</p>
        </div>
        <div className="page-body">
          <div className="empty-state"><ShieldOff size={40} /><p>You don't have permission to view connections.</p></div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>Connections</h1>
        <p>Provider accounts used to run model instances</p>
      </div>
      <div className="page-body">
        {error && <div className="form-error" style={{ marginBottom: 20 }}>{error}</div>}

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : (
          <>
            <div className="toolbar">
              <span className="toolbar-title">
                {connections.length} connection{connections.length !== 1 ? 's' : ''}
              </span>
              {canManage && (
                <button className="btn btn-primary" onClick={() => navigate('/dashboard/connections/new')}>
                  <Plus size={16} /> Add Connection
                </button>
              )}
            </div>

            {connections.length === 0 ? (
              <div className="empty-state"><Plug size={40} /><p>No connections yet. Add one to get started.</p></div>
            ) : (
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 700 }}>
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Provider</th>
                      <th>Endpoint</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {connections.map(conn => (
                      <tr key={conn.id}>
                        <td>{conn.label}</td>
                        <td><span className={`badge badge-${conn.providerId}`}>{conn.providerId}</span></td>
                        <td><span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{conn.endpoint || '—'}</span></td>
                        <td>
                          <span style={{ fontSize: '0.8rem', color: conn.enabled ? 'var(--success)' : 'var(--text-muted)' }}>
                            {conn.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </td>
                        <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <Link to={`/dashboard/connections/${encodeURIComponent(conn.id)}/instances`} className="btn-icon" title="Instances">
                            <Boxes size={15} />
                          </Link>
                          {canManage && (
                            <>
                              <button className="btn-icon" onClick={() => navigate(`/dashboard/connections/${encodeURIComponent(conn.id)}/edit`)} title="Edit">
                                <Edit2 size={15} />
                              </button>
                              <button className="btn-icon danger" onClick={() => handleDelete(conn)} title="Remove">
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
