import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Server, Edit2, Copy, ChevronUp, ChevronDown, ChevronsUpDown, Search, X } from 'lucide-react';
import { getModels, deleteModel, type Model } from '../api';

type SortKey = 'id' | 'provider' | 'input' | 'output' | 'cache' | 'context';
type SortDir = 'asc' | 'desc';

function numOrInfinity(v: number | null | undefined) { return v ?? Infinity; }

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={13} style={{ opacity: 0.35, marginLeft: 4, flexShrink: 0 }} />;
  return sortDir === 'asc'
    ? <ChevronUp size={13} style={{ marginLeft: 4, flexShrink: 0, color: 'var(--accent)' }} />
    : <ChevronDown size={13} style={{ marginLeft: 4, flexShrink: 0, color: 'var(--accent)' }} />;
}

export function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

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

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter(m =>
      !q ||
      m.id.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q) ||
      m.endpoint.toLowerCase().includes(q)
    );
  }, [models, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'id':       cmp = a.id.localeCompare(b.id); break;
        case 'provider': cmp = a.provider.localeCompare(b.provider); break;
        case 'input':    cmp = a.cost.inputPerMillion - b.cost.inputPerMillion; break;
        case 'output':   cmp = a.cost.outputPerMillion - b.cost.outputPerMillion; break;
        case 'cache':    cmp = numOrInfinity(a.cost.cachePerMillion) - numOrInfinity(b.cost.cachePerMillion); break;
        case 'context':  cmp = numOrInfinity(a.contextWindow) - numOrInfinity(b.contextWindow); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const thStyle: React.CSSProperties = {
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };
  const thInner = (label: string, key: SortKey) => (
    <span style={{ display: 'inline-flex', alignItems: 'center' }} onClick={() => handleSort(key)}>
      {label}<SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
    </span>
  );

  return (
    <>
      <div className="page-header">
        <h1>Models</h1>
        <p>LLM providers registered with LocalRouter</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <span className="toolbar-title">
            {filtered.length !== models.length
              ? `${filtered.length} of ${models.length} model${models.length !== 1 ? 's' : ''}`
              : `${models.length} model${models.length !== 1 ? 's' : ''}`}
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter models…"
                style={{ paddingLeft: 28, paddingRight: search ? 28 : 10, height: 32, fontSize: '0.85rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', outline: 'none', width: 200 }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex', alignItems: 'center' }}>
                  <X size={13} />
                </button>
              )}
            </div>
            <Link to="/dashboard/models/new" className="btn btn-primary">
              <Plus size={16} /> Add Model
            </Link>
          </div>
        </div>
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : models.length === 0 ? (
          <div className="empty-state"><Server size={40} /><p>No models yet. Add one to get started.</p></div>
        ) : sorted.length === 0 ? (
          <div className="empty-state"><Search size={40} /><p>No models match "<strong>{search}</strong>".</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={thStyle}>{thInner('ID', 'id')}</th>
                  <th style={thStyle}>{thInner('Provider', 'provider')}</th>
                  <th>Endpoint</th>
                  <th style={thStyle}>{thInner('Input $/1M', 'input')}</th>
                  <th style={thStyle}>{thInner('Output $/1M', 'output')}</th>
                  <th style={thStyle}>{thInner('Cache $/1M', 'cache')}</th>
                  <th style={thStyle}>{thInner('Context Size', 'context')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(m => (
                  <tr key={m.id}>
                    <td><span className="mono">{m.id}</span></td>
                    <td><span className={`badge badge-${m.provider}`}>{m.provider}</span></td>
                    <td><span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.endpoint}</span></td>
                    <td>${m.cost.inputPerMillion}</td>
                    <td>${m.cost.outputPerMillion}</td>
                    <td>{m.cost.cachePerMillion != null ? `$${m.cost.cachePerMillion}` : <span className="text-muted">—</span>}</td>
                    <td>{m.contextWindow != null ? `${(m.contextWindow / 1000).toFixed(0)}k` : <span className="text-muted">—</span>}</td>
                    <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Link to={`/dashboard/models/new?clone=${encodeURIComponent(m.id)}`} className="btn-icon" title="Clone">
                        <Copy size={15} />
                      </Link>
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
