import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Server, Edit2 } from 'lucide-react';
import { getModels, deleteModel, type Model } from '../api';

export function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setModels(await getModels()); } finally { setLoading(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm(`Remove model "${id}"?`)) return;
    await deleteModel(id);
    setModels(m => m.filter(x => x.id !== id));
  }

  return (
    <>
      <div className="page-header">
        <h1>Models</h1>
        <p>LLM providers registered with LocalRouter</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <span className="toolbar-title">{models.length} model{models.length !== 1 ? 's' : ''}</span>
          <Link to="/dashboard/models/new" className="btn btn-primary">
            <Plus size={16} /> Add Model
          </Link>
        </div>
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : models.length === 0 ? (
          <div className="empty-state"><Server size={40} /><p>No models yet. Add one to get started.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th><th>Provider</th><th>Endpoint</th>
                  <th>Input $/1M</th><th>Output $/1M</th><th>Cache $/1M</th><th>Context Size</th><th>Monthly Budget</th><th></th>
                </tr>
              </thead>
              <tbody>
                {models.map(m => (
                  <tr key={m.id}>
                    <td><span className="mono">{m.id}</span></td>
                    <td><span className={`badge badge-${m.provider}`}>{m.provider}</span></td>
                    <td><span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.endpoint}</span></td>
                    <td>${m.cost.inputPerMillion}</td>
                    <td>${m.cost.outputPerMillion}</td>
                    <td>{m.cost.cachePerMillion != null ? `$${m.cost.cachePerMillion}` : <span className="text-muted">—</span>}</td>
                    <td>{m.contextWindow != null ? `${(m.contextWindow / 1000).toFixed(0)}k` : <span className="text-muted">—</span>}</td>
                    <td>{m.globalThresholds?.monthly ? `$${m.globalThresholds.monthly}` : <span className="text-muted">—</span>}</td>
                    <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Link to={`/dashboard/models/${encodeURIComponent(m.id)}`} className="btn-icon" title="Edit">
                        <Edit2 size={15} />
                      </Link>
                      <button className="btn-icon danger" onClick={() => handleDelete(m.id)} title="Remove">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
