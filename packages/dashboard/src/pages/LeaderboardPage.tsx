import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { getLeaderboard, getProjects, type LeaderboardEntry, type Project } from '../api';

const PERIODS: { value: string; label: string }[] = [
  { value: 'daily',   label: 'Today' },
  { value: 'weekly',  label: 'This week' },
  { value: 'monthly', label: 'This month' },
];

/** Inline SVG sparkline of daily cost over the last 7 days. */
function Sparkline({ trend }: { trend: LeaderboardEntry['trend'] }) {
  const w = 80, h = 22, pad = 2;
  const max = Math.max(...trend.map(t => t.cost), 0);
  if (max <= 0) {
    return <svg width={w} height={h} aria-label="No cost in range"><line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="var(--border)" strokeWidth={1} /></svg>;
  }
  const n = trend.length;
  const points = trend.map((t, i) => {
    const x = pad + (n === 1 ? 0 : (i * (w - pad * 2)) / (n - 1));
    const y = h - pad - (t.cost / max) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} aria-label="Daily cost, last 7 days">
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function fmtCost(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}

export function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [period, setPeriod] = useState('monthly');
  const [projectId, setProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProjects().then(setProjects).catch(() => { /* non-critical */ });
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getLeaderboard(period, projectId || undefined)
      .then(data => { if (active) { setRows(data); setError(null); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Failed to load leaderboard'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period, projectId]);

  // Best model = top of the cost-performance ranking that actually served traffic successfully.
  const bestModelId = rows.find(r => r.successRate > 0)?.modelId ?? null;

  return (
    <>
      <div className="page-header">
        <h1>Leaderboard</h1>
        <p>Models ranked by cost-performance from your real traffic. Data is local — no external telemetry.</p>
      </div>
      <div className="page-body">
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
            {PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                style={{
                  padding: '6px 14px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', border: 'none',
                  background: period === p.value ? 'var(--accent)' : 'var(--bg-elevated)',
                  color: period === p.value ? 'var(--accent-contrast, #fff)' : 'var(--text-secondary)',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            style={{
              padding: '6px 12px', fontSize: '0.82rem', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            }}
          >
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : error ? (
          <div className="empty-state" style={{ color: 'var(--danger)' }}>{error}</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">No usage in the selected range.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'right' }}>Rank</th>
                  <th>Model</th>
                  <th>Provider</th>
                  <th style={{ textAlign: 'right' }}>Requests</th>
                  <th style={{ textAlign: 'right' }}>Success rate</th>
                  <th style={{ textAlign: 'right' }}>Avg latency</th>
                  <th style={{ textAlign: 'right' }}>P95 latency</th>
                  <th style={{ textAlign: 'right' }}>Cost / 1K tokens</th>
                  <th style={{ textAlign: 'right' }}>Total cost</th>
                  <th style={{ textAlign: 'right' }}>Trend (7d)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isBest = r.modelId === bestModelId;
                  return (
                    <tr key={r.modelId}>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{i + 1}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {isBest && <Star size={13} fill="var(--warning)" color="var(--warning)" aria-label="Best cost-performance" />}
                          {r.modelId}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{r.provider}</td>
                      <td style={{ textAlign: 'right' }}>{r.totalRequests}</td>
                      <td style={{ textAlign: 'right' }}>{(r.successRate * 100).toFixed(1)}%</td>
                      <td style={{ textAlign: 'right' }}>{Math.round(r.avgLatencyMs)} ms</td>
                      <td style={{ textAlign: 'right' }}>{Math.round(r.p95LatencyMs)} ms</td>
                      <td style={{ textAlign: 'right' }}>{fmtCost(r.avgCostPer1kTokens)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtCost(r.totalCost)}</td>
                      <td style={{ textAlign: 'right' }}><Sparkline trend={r.trend} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
