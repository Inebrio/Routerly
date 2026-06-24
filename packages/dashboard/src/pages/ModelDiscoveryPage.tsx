import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, X } from 'lucide-react';
import { getModelCatalog, type CatalogEntry } from '../api.js';

function fmtContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const PROVIDERS = ['All', 'openai', 'anthropic', 'google', 'ollama'] as const;
type ProviderFilter = typeof PROVIDERS[number];

export function ModelDiscoveryPage() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<ProviderFilter>('All');
  const [search, setSearch] = useState('');

  useEffect(() => {
    getModelCatalog()
      .then(setCatalog)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter(m => {
      if (provider !== 'All' && m.provider !== provider) return false;
      if (q && !m.name.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [catalog, provider, search]);

  return (
    <>
      <div className="page-header">
        <h1>Discover Models</h1>
        <p>Browse the catalog of supported LLM models and add them to Routerly</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PROVIDERS.map(p => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                className={`btn${provider === p ? ' btn-primary' : ''}`}
                style={{ textTransform: p === 'All' ? undefined : 'capitalize', fontSize: '0.82rem', padding: '4px 12px' }}
              >
                {p === 'All' ? 'All' : p}
              </button>
            ))}
          </div>
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
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Model Name</th>
                  <th>Provider</th>
                  <th>Context</th>
                  <th>Modalities</th>
                  <th>Input $/1K</th>
                  <th>Output $/1K</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <tr key={m.id}>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="mono">{m.name}</span>
                        {m.isConfigured && (
                          <span title="Configured" style={{ color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 600 }}>Configured</span>
                        )}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.id}</span>
                    </td>
                    <td><span className={`badge badge-${m.provider}`}>{m.provider}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtContext(m.contextWindow)}</td>
                    <td>
                      {m.modalities.map(mod => (
                        <span key={mod} className="badge" style={{ marginRight: 4, fontSize: '0.72rem' }}>{mod}</span>
                      ))}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {m.local ? <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>free/local</span> : `$${m.pricing.inputPer1kTokens}`}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {m.local ? <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>free/local</span> : `$${m.pricing.outputPer1kTokens}`}
                    </td>
                    <td>
                      {!m.isConfigured && (
                        <Link
                          to={`/dashboard/models/new?id=${encodeURIComponent(m.id)}&provider=${encodeURIComponent(m.provider)}`}
                          className="btn btn-primary"
                          style={{ fontSize: '0.78rem', padding: '3px 10px', whiteSpace: 'nowrap' }}
                        >
                          <Plus size={13} /> Add
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>No models match the current filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
