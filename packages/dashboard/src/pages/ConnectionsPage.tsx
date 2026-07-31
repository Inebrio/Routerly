import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Edit2, Boxes, Plug, ShieldOff } from 'lucide-react';
import {
  getConnections, createConnection, updateConnection, deleteConnection, getProviderDescriptors,
  type Connection, type ProviderDescriptor,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ConnectionForm, type ConnectionFormState, emptyForm, credentialsToRecord } from '../components/ConnectionForm';
import { useAuth } from '../AuthContext';

export function ConnectionsPage() {
  const { can } = useAuth();
  const canRead = can('connections:read');
  const canManage = can('connections:manage');

  const [connections, setConnections] = useState<Connection[]>([]);
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<ConnectionFormState>(emptyForm(''));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ConnectionFormState>(emptyForm(''));
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useEffect(() => { if (canRead) void load(); else setLoading(false); }, [canRead]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [conns, descriptors] = await Promise.all([getConnections(), getProviderDescriptors()]);
      setConnections(conns);
      setProviders(descriptors);
      setCreateForm(emptyForm(descriptors[0]?.id ?? ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load connections');
    } finally {
      setLoading(false);
    }
  }

  function startEdit(conn: Connection) {
    setEditingId(conn.id);
    setEditForm({ providerId: conn.providerId, label: conn.label, endpoint: conn.endpoint ?? '', enabled: conn.enabled, credentials: [] });
    setShowCreate(false);
  }

  async function submitCreate() {
    setSaving(true);
    setError('');
    try {
      const created = await createConnection({
        providerId: createForm.providerId,
        label: createForm.label,
        ...(createForm.endpoint ? { endpoint: createForm.endpoint } : {}),
        enabled: createForm.enabled,
        credentials: credentialsToRecord(createForm.credentials),
      });
      setConnections(cs => [...cs, created]);
      setShowCreate(false);
      setCreateForm(emptyForm(providers[0]?.id ?? ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create connection');
    } finally {
      setSaving(false);
    }
  }

  async function submitEdit() {
    /* v8 ignore next */
    if (!editingId) return;
    setSaving(true);
    setError('');
    try {
      const patch: Parameters<typeof updateConnection>[1] = {
        providerId: editForm.providerId,
        label: editForm.label,
        ...(editForm.endpoint ? { endpoint: editForm.endpoint } : {}),
        enabled: editForm.enabled,
      };
      const credentials = credentialsToRecord(editForm.credentials);
      if (Object.keys(credentials).length > 0) patch.credentials = credentials;
      const updated = await updateConnection(editingId, patch);
      setConnections(cs => cs.map(c => c.id === updated.id ? updated : c));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update connection');
    } finally {
      setSaving(false);
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
              {canManage && !showCreate && (
                <button className="btn btn-primary" onClick={() => { setShowCreate(true); setEditingId(null); }}>
                  <Plus size={16} /> Add Connection
                </button>
              )}
            </div>

            {showCreate && (
              <ConnectionForm
                form={createForm}
                onChange={setCreateForm}
                onSave={submitCreate}
                onCancel={() => { setShowCreate(false); setCreateForm(emptyForm(providers[0]?.id ?? '')); }}
                saving={saving}
                providers={providers}
                isNew
              />
            )}

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
                      <React.Fragment key={conn.id}>
                        <tr>
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
                                <button className="btn-icon" onClick={() => startEdit(conn)} title="Edit">
                                  <Edit2 size={15} />
                                </button>
                                <button className="btn-icon danger" onClick={() => handleDelete(conn)} title="Remove">
                                  <Trash2 size={15} />
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                        {editingId === conn.id && (
                          <tr>
                            <td colSpan={5} style={{ padding: 0 }}>
                              <ConnectionForm
                                form={editForm}
                                onChange={setEditForm}
                                onSave={submitEdit}
                                onCancel={() => setEditingId(null)}
                                saving={saving}
                                providers={providers}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
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
