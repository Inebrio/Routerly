import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Edit2, Save, X, Plug, Boxes, ShieldOff } from 'lucide-react';
import {
  getConnections, createConnection, updateConnection, deleteConnection, getProviderDescriptors,
  type Connection, type ProviderDescriptor,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../AuthContext';

interface CredentialRow { key: string; value: string }

interface ConnectionFormState {
  providerId: string;
  label: string;
  endpoint: string;
  enabled: boolean;
  credentials: CredentialRow[];
}

function emptyForm(defaultProviderId: string): ConnectionFormState {
  return { providerId: defaultProviderId, label: '', endpoint: '', enabled: true, credentials: [] };
}

function credentialsToRecord(rows: CredentialRow[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim()) record[row.key.trim()] = row.value;
  }
  return record;
}

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

interface ConnectionFormProps {
  form: ConnectionFormState;
  onChange: React.Dispatch<React.SetStateAction<ConnectionFormState>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  providers: ProviderDescriptor[];
  isNew?: boolean;
}

function ConnectionForm({ form, onChange, onSave, onCancel, saving, providers, isNew }: ConnectionFormProps) {
  function addCredentialRow() {
    onChange(f => ({ ...f, credentials: [...f.credentials, { key: '', value: '' }] }));
  }
  function updateCredentialRow(index: number, patch: Partial<CredentialRow>) {
    onChange(f => ({ ...f, credentials: f.credentials.map((row, i) => i === index ? { ...row, ...patch } : row) }));
  }
  function removeCredentialRow(index: number) {
    onChange(f => ({ ...f, credentials: f.credentials.filter((_, i) => i !== index) }));
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 12, border: '1px solid var(--primary)', borderRadius: 8 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="form-group" style={{ flex: '0 0 200px', marginBottom: 0 }}>
          <label className="form-label" htmlFor="conn-provider">Provider</label>
          <select
            id="conn-provider"
            className="form-input"
            value={form.providerId}
            onChange={e => onChange(f => ({ ...f, providerId: e.target.value }))}
          >
            {providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ flex: '1 1 180px', marginBottom: 0 }}>
          <label className="form-label" htmlFor="conn-label">Label</label>
          <input id="conn-label" className="form-input" placeholder="e.g. Primary OpenAI account" value={form.label}
            onChange={e => onChange(f => ({ ...f, label: e.target.value }))} />
        </div>
        <div className="form-group" style={{ flex: '1 1 200px', marginBottom: 0 }}>
          <label className="form-label" htmlFor="conn-endpoint">Endpoint (optional)</label>
          <input id="conn-endpoint" className="form-input" placeholder="https://api.example.com/v1" value={form.endpoint}
            onChange={e => onChange(f => ({ ...f, endpoint: e.target.value }))} />
        </div>
        <div className="form-group" style={{ flex: '0 0 auto', marginBottom: 0, display: 'flex', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem', height: 36 }}>
            <input type="checkbox" checked={form.enabled} onChange={e => onChange(f => ({ ...f, enabled: e.target.checked }))} />
            Enabled
          </label>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="form-label" style={{ marginBottom: 8, display: 'block' }}>
          Credentials{!isNew && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> (leave empty to keep existing)</span>}
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {form.credentials.map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <input className="form-input" placeholder="e.g. apiKey" value={row.key}
                onChange={e => updateCredentialRow(i, { key: e.target.value })} style={{ flex: '0 0 180px' }} />
              <input className="form-input" placeholder="value" type="password" autoComplete="new-password" value={row.value}
                onChange={e => updateCredentialRow(i, { value: e.target.value })} style={{ flex: 1 }} />
              <button type="button" className="btn-icon danger" onClick={() => removeCredentialRow(i)} title="Remove field">
                <X size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={addCredentialRow}>
            <Plus size={13} /> Add credential field
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={saving || !form.label.trim()} onClick={onSave}>
          {saving ? <span className="spinner" /> : <><Save size={14} /> {isNew ? 'Create' : 'Save'}</>}
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>
          <X size={14} /> Cancel
        </button>
      </div>
    </div>
  );
}
