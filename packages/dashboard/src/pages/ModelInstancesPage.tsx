import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Boxes, Download, Save, X, ShieldOff } from 'lucide-react';
import {
  getConnections, getInstances, createInstance, deleteInstance, getModelCatalog,
  type Connection, type Instance, type CatalogEntry,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../AuthContext';

interface InstanceFormState {
  upstreamModelId: string;
  inputPerMillion: string;
  outputPerMillion: string;
  cachePerMillion: string;
  contextWindow: string;
}

const EMPTY_FORM: InstanceFormState = { upstreamModelId: '', inputPerMillion: '', outputPerMillion: '', cachePerMillion: '', contextWindow: '' };

export function ModelInstancesPage() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canRead = can('connections:read');
  const canManage = can('connections:manage');

  const [connection, setConnection] = useState<Connection | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<InstanceFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const [showCatalog, setShowCatalog] = useState(false);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  useEffect(() => { if (canRead) void load(); else setLoading(false); }, [canRead, connectionId]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [connections, allInstances] = await Promise.all([getConnections(), getInstances()]);
      const found = connections.find(c => c.id === connectionId) ?? null;
      setConnection(found);
      setInstances(allInstances.filter(i => i.connectionId === connectionId));
      if (!found) setError('Connection not found');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load instances');
    } finally {
      setLoading(false);
    }
  }

  async function submitAdd() {
    /* v8 ignore next */
    if (!connectionId) return;
    setSaving(true);
    setError('');
    try {
      const created = await createInstance({
        connectionId,
        upstreamModelId: addForm.upstreamModelId,
        cost: {
          inputPerMillion: Number(addForm.inputPerMillion) || 0,
          outputPerMillion: Number(addForm.outputPerMillion) || 0,
          ...(addForm.cachePerMillion ? { cachePerMillion: Number(addForm.cachePerMillion) } : {}),
        },
        contextWindow: Number(addForm.contextWindow) || 0,
      });
      setInstances(list => [...list, created]);
      setShowAdd(false);
      setAddForm(EMPTY_FORM);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create instance');
    } finally {
      setSaving(false);
    }
  }

  async function openCatalog() {
    setShowCatalog(true);
    if (catalog.length === 0) {
      setCatalogLoading(true);
      try {
        setCatalog(await getModelCatalog());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load catalog');
      } finally {
        setCatalogLoading(false);
      }
    }
  }

  async function importEntry(entry: CatalogEntry) {
    /* v8 ignore next */
    if (!connectionId) return;
    setImportingId(entry.id);
    setError('');
    try {
      const created = await createInstance({
        connectionId,
        upstreamModelId: entry.id,
        cost: {
          inputPerMillion: entry.pricing.inputPer1kTokens * 1000,
          outputPerMillion: entry.pricing.outputPer1kTokens * 1000,
        },
        contextWindow: entry.contextWindow,
      });
      setInstances(list => [...list, created]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to import catalog entry');
    } finally {
      setImportingId(null);
    }
  }

  function handleDelete(instance: Instance) {
    setConfirmState({
      message: `Remove instance "${instance.upstreamModelId}"?`,
      onConfirm: async () => {
        setConfirmState(null);
        setError('');
        try {
          await deleteInstance(instance.id);
          setInstances(list => list.filter(i => i.id !== instance.id));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to delete instance');
        }
      },
    });
  }

  const importedIds = useMemo(() => new Set(instances.map(i => i.upstreamModelId)), [instances]);
  const catalogForProvider = useMemo(
    () => catalog.filter(entry => entry.provider === connection?.providerId),
    [catalog, connection],
  );

  if (!canRead) {
    return (
      <>
        <div className="page-header">
          <h1>Instances</h1>
        </div>
        <div className="page-body">
          <div className="empty-state"><ShieldOff size={40} /><p>You don't have permission to view instances.</p></div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header" style={{ paddingBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-icon" onClick={() => navigate('/dashboard/connections')} title="Back to connections">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 style={{ margin: 0 }}>{connection ? connection.label : 'Instances'}</h1>
            {connection && (
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <span className={`badge badge-${connection.providerId}`}>{connection.providerId}</span>
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="page-body">
        {error && <div className="form-error" style={{ marginBottom: 20 }}>{error}</div>}

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : !connection ? null : (
          <>
            <div className="toolbar">
              <span className="toolbar-title">
                {instances.length} instance{instances.length !== 1 ? 's' : ''}
              </span>
              {canManage && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary" onClick={openCatalog}>
                    <Download size={15} /> Import from catalog
                  </button>
                  <button className="btn btn-primary" onClick={() => { setShowAdd(true); setShowCatalog(false); }}>
                    <Plus size={15} /> Add Instance
                  </button>
                </div>
              )}
            </div>

            {showCatalog && (
              <div className="card" style={{ padding: 20, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Catalog entries for {connection.providerId}</span>
                  <button className="btn-icon" onClick={() => setShowCatalog(false)} title="Close">
                    <X size={14} />
                  </button>
                </div>
                {catalogLoading ? (
                  <div className="loading-center"><div className="spinner" /></div>
                ) : catalogForProvider.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No catalog entries for this provider.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {catalogForProvider.map(entry => (
                      <div key={entry.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                        <div>
                          <span className="mono">{entry.id}</span>
                          <span style={{ marginLeft: 10, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            ${entry.pricing.inputPer1kTokens * 1000}/1M in · ${entry.pricing.outputPer1kTokens * 1000}/1M out · {(entry.contextWindow / 1000).toFixed(0)}k ctx
                          </span>
                        </div>
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={importedIds.has(entry.id) || importingId === entry.id}
                          onClick={() => importEntry(entry)}
                        >
                          {importedIds.has(entry.id) ? 'Imported' : importingId === entry.id ? <span className="spinner" /> : 'Import'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {showAdd && (
              <InstanceForm
                form={addForm}
                onChange={setAddForm}
                onSave={submitAdd}
                onCancel={() => { setShowAdd(false); setAddForm(EMPTY_FORM); }}
                saving={saving}
              />
            )}

            {instances.length === 0 ? (
              <div className="empty-state"><Boxes size={40} /><p>No instances yet. Add one or import from the catalog.</p></div>
            ) : (
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 600 }}>
                  <thead>
                    <tr>
                      <th>Upstream Model ID</th>
                      <th>Input $/1M</th>
                      <th>Output $/1M</th>
                      <th>Cache $/1M</th>
                      <th>Context Size</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {instances.map(instance => (
                      <tr key={instance.id}>
                        <td><span className="mono">{instance.upstreamModelId}</span></td>
                        <td>${instance.cost.inputPerMillion}</td>
                        <td>${instance.cost.outputPerMillion}</td>
                        <td>{instance.cost.cachePerMillion != null ? `$${instance.cost.cachePerMillion}` : <span className="text-muted">—</span>}</td>
                        <td>{instance.contextWindow ? `${(instance.contextWindow / 1000).toFixed(0)}k` : <span className="text-muted">—</span>}</td>
                        <td style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          {canManage && (
                            <button className="btn-icon danger" onClick={() => handleDelete(instance)} title="Remove">
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

interface InstanceFormProps {
  form: InstanceFormState;
  onChange: React.Dispatch<React.SetStateAction<InstanceFormState>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

function InstanceForm({ form, onChange, onSave, onCancel, saving }: InstanceFormProps) {
  return (
    <div className="card" style={{ padding: 20, marginBottom: 12, border: '1px solid var(--primary)', borderRadius: 8 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="form-group" style={{ flex: '1 1 220px', marginBottom: 0 }}>
          <label className="form-label" htmlFor="inst-model-id">Upstream Model ID</label>
          <input id="inst-model-id" className="form-input" placeholder="e.g. gpt-4o" value={form.upstreamModelId}
            onChange={e => onChange(f => ({ ...f, upstreamModelId: e.target.value }))} />
        </div>
        <div className="form-group" style={{ flex: '0 0 130px', marginBottom: 0 }}>
          <label className="form-label" htmlFor="inst-input">Input $/1M</label>
          <input id="inst-input" className="form-input" type="number" step="any" value={form.inputPerMillion}
            onChange={e => onChange(f => ({ ...f, inputPerMillion: e.target.value }))} />
        </div>
        <div className="form-group" style={{ flex: '0 0 130px', marginBottom: 0 }}>
          <label className="form-label" htmlFor="inst-output">Output $/1M</label>
          <input id="inst-output" className="form-input" type="number" step="any" value={form.outputPerMillion}
            onChange={e => onChange(f => ({ ...f, outputPerMillion: e.target.value }))} />
        </div>
        <div className="form-group" style={{ flex: '0 0 130px', marginBottom: 0 }}>
          <label className="form-label" htmlFor="inst-cache">Cache $/1M</label>
          <input id="inst-cache" className="form-input" type="number" step="any" value={form.cachePerMillion}
            onChange={e => onChange(f => ({ ...f, cachePerMillion: e.target.value }))} />
        </div>
        <div className="form-group" style={{ flex: '0 0 150px', marginBottom: 0 }}>
          <label className="form-label" htmlFor="inst-context">Context Size</label>
          <input id="inst-context" className="form-input" type="number" value={form.contextWindow}
            onChange={e => onChange(f => ({ ...f, contextWindow: e.target.value }))} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={saving || !form.upstreamModelId.trim()} onClick={onSave}>
          {saving ? <span className="spinner" /> : <><Save size={14} /> Create</>}
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>
          <X size={14} /> Cancel
        </button>
      </div>
    </div>
  );
}
