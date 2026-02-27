import { useEffect, useState } from 'react';
import { getUsage, getProjects, type UsageStats, type Project } from '../api';

export function UsagePage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [period, setPeriod] = useState('monthly');
  const [projectId, setProjectId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProjects().then(setProjects).catch(console.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    getUsage(period, projectId || undefined)
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [period, projectId]);

  return (
    <>
      <div className="page-header">
        <h1>Usage</h1>
        <p>Detailed call logs and per-model breakdown</p>
      </div>
      <div className="page-body">
        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['daily', 'weekly', 'monthly', 'all'] as const).map(p => (
              <button key={p} className={`btn btn-sm ${period === p ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPeriod(p)}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <select className="form-input" style={{ maxWidth: 200 }} value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : !stats ? null : (
          <>
            {/* Summary */}
            <div className="stats-grid" style={{ marginBottom: 24 }}>
              <div className="stat-card">
                <div className="stat-label">Total Cost</div>
                <div className="stat-value">${stats.summary.totalCost.toFixed(4)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Calls</div>
                <div className="stat-value">{stats.summary.totalCalls}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Errors</div>
                <div className="stat-value" style={{ color: stats.summary.errorCalls > 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {stats.summary.errorCalls}
                </div>
              </div>
            </div>

            {/* Per-model table */}
            {Object.keys(stats.byModel).length > 0 && (
              <div className="table-wrap" style={{ marginBottom: 24 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Model</th><th>Calls</th><th>Errors</th>
                      <th>Input Tokens</th><th>Output Tokens</th><th>Cost (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(stats.byModel).map(([model, v]) => (
                      <tr key={model}>
                        <td><span className="mono">{model}</span></td>
                        <td>{v.calls}</td>
                        <td style={{ color: v.errors > 0 ? 'var(--danger)' : 'inherit' }}>{v.errors}</td>
                        <td>{v.inputTokens.toLocaleString()}</td>
                        <td>{v.outputTokens.toLocaleString()}</td>
                        <td className="mono">${v.cost.toFixed(6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Recent calls */}
            {stats.records.length > 0 && (
              <>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                  Recent Calls
                </h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th><th>Model</th><th>In</th><th>Out</th>
                        <th>Cost</th><th>Latency</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.records.map((r, i) => (
                        <tr key={i}>
                          <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            {new Date(r.timestamp).toLocaleString()}
                          </td>
                          <td><span className="mono" style={{ fontSize: '0.78rem' }}>{r.modelId}</span></td>
                          <td>{r.inputTokens}</td>
                          <td>{r.outputTokens}</td>
                          <td className="mono" style={{ fontSize: '0.78rem' }}>${r.cost.toFixed(6)}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{r.latencyMs}ms</td>
                          <td>
                            <span className={`badge ${r.outcome === 'success' ? 'badge-success' : 'badge-error'}`}>
                              {r.outcome}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {stats.records.length === 0 && (
              <div className="empty-state">
                <p>No usage records for this period.</p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
