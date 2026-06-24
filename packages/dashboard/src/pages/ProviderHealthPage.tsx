import { useEffect, useRef, useState } from 'react';
import { getProviderHealth, type ProviderHealth } from '../api';

const REFRESH_MS = 30_000;

const STATUS_META: Record<ProviderHealth['status'], { label: string; color: string }> = {
  healthy:     { label: 'Healthy',     color: 'var(--success)' },
  degraded:    { label: 'Degraded',    color: 'var(--warning)' },
  unavailable: { label: 'Unavailable', color: 'var(--danger)' },
  cooldown:    { label: 'Cooldown',    color: 'var(--text-muted)' },
};

function StatusBadge({ status }: { status: ProviderHealth['status'] }) {
  const meta = STATUS_META[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: '0.8rem', fontWeight: 600, color: meta.color,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color }} />
      {meta.label}
    </span>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function cooldownTimer(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const s = Math.ceil(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.ceil(s / 60)}m`;
}

export function ProviderHealthPage() {
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const didInit = useRef(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { providers } = await getProviderHealth();
        if (!active) return;
        setProviders(providers);
        setUpdatedAt(new Date());
        setError(null);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load health');
      } finally {
        if (active && !didInit.current) { setLoading(false); didInit.current = true; }
      }
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { active = false; clearInterval(id); };
  }, []);

  return (
    <>
      <div className="page-header">
        <h1>Provider Health</h1>
        <p>
          Real-time operational status per model{' '}
          {updatedAt && <span style={{ color: 'var(--text-muted)' }}>· updated {relativeTime(updatedAt.toISOString())}</span>}
        </p>
      </div>
      <div className="page-body">
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : error ? (
          <div className="empty-state" style={{ color: 'var(--danger)' }}>{error}</div>
        ) : providers.length === 0 ? (
          <div className="empty-state">No models configured.</div>
        ) : (
          <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Provider</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Error rate (5m)</th>
                <th style={{ textAlign: 'right' }}>P95 latency (5m)</th>
                <th style={{ textAlign: 'right' }}>Requests (1h)</th>
                <th style={{ textAlign: 'right' }}>Last success</th>
                <th style={{ textAlign: 'right' }}>Cooldown</th>
              </tr>
            </thead>
            <tbody>
              {providers.map(p => {
                const cd = cooldownTimer(p.cooldownUntil);
                return (
                  <tr key={p.modelId}>
                    <td>{p.name || p.modelId}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{p.provider}</td>
                    <td><StatusBadge status={cd ? 'cooldown' : p.status} /></td>
                    <td style={{ textAlign: 'right' }}>{(p.errorRate * 100).toFixed(1)}%</td>
                    <td style={{ textAlign: 'right' }}>{p.p95LatencyMs == null ? '—' : `${Math.round(p.p95LatencyMs)} ms`}</td>
                    <td style={{ textAlign: 'right' }}>{p.requestsLastHour}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{relativeTime(p.lastSuccessAt)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{cd ?? '—'}</td>
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
