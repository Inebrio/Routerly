import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Globe, HardDrive } from 'lucide-react';
import { getModelCatalog, type CatalogEntry } from '../api';

const PROVIDERS = ['All', 'openai', 'anthropic', 'gemini', 'ollama'] as const;

function fmtPrice(p: number): string {
  if (p === 0) return 'free';
  return `$${p.toFixed(5).replace(/\.?0+$/, '')}`;
}

function fmtCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}

export function ModelDiscoveryPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState<string>('All');

  useEffect(() => {
    getModelCatalog()
      .then(setEntries)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e =>
      (provider === 'All' || e.provider === provider) &&
      (!q || e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
    );
  }, [entries, search, provider]);

  return (
    <>
      <div className="page-header">
        <h1>Model Discovery</h1>
        <p>Browse available models and their capabilities</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {PROVIDERS.map(p => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                className={`badge badge-${p === 'All' ? 'default' : p}`}
                style={{
                  cursor: 'pointer',
                  border: provider === p ? '2px solid var(--accent)' : '2px solid transparent',
                  padding: '3px 10px',
                  borderRadius: 12,
                  background: provider === p ? 'var(--accent-subtle, var(--surface-raised))' : 'var(--surface)',
                  fontWeight: provider === p ? 600 : 400,
                }}
              >
                {p === 'All' ? 'All' : p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search models…"
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
        ) : error ? (
          <div className="empty-state"><p style={{ color: 'var(--error)' }}>Failed to load catalog: {error}</p></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><Search size={40} /><p>No models match your filters.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Provider</th>
                  <th>Context</th>
                  <th>Modalities</th>
                  <th>Input /1K</th>
                  <th>Output /1K</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id}>
                    <td>
                      <span className="mono">{e.id}</span>
                      {e.local && (
                        <span title="Runs locally" style={{ marginLeft: 6, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}>
                          <HardDrive size={12} />
                        </span>
                      )}
                    </td>
                    <td><span className={`badge badge-${e.provider}`}>{e.provider}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtCtx(e.contextWindow)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {e.modalities.map(m => (
                          <span key={m} style={{ fontSize: '0.72rem', padding: '1px 6px', borderRadius: 8, background: 'var(--surface-raised, var(--border))', color: 'var(--text-muted)' }}>
                            {m}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {e.local ? <span style={{ color: 'var(--success, green)', fontWeight: 600 }}>local/free</span> : fmtPrice(e.pricing.inputPer1kTokens)}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {e.local ? <span style={{ color: 'var(--success, green)', fontWeight: 600 }}>local/free</span> : fmtPrice(e.pricing.outputPer1kTokens)}
                    </td>
                    <td>
                      {e.isConfigured ? (
                        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 10, background: 'var(--success-bg, #d1fae5)', color: 'var(--success-text, #065f46)', fontWeight: 600 }}>
                          Configured
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn btn-sm"
                        title="Add to routing"
                        onClick={() => navigate(`/dashboard/models/new?provider=${encodeURIComponent(e.provider)}&modelId=${encodeURIComponent(e.id)}`)}
                        style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      >
                        <Globe size={13} /> Add
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && (
          <p style={{ marginTop: 12, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {filtered.length} of {entries.length} models shown. Prices in USD per 1K tokens.
          </p>
        )}
      </div>
    </>
  );
}
