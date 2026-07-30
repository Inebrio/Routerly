import { useCallback, useEffect, useState } from 'react';
import { ShieldOff, ShieldCheck, RotateCcw } from 'lucide-react';
import { getResilience, resetResilience } from '../api';
import type { ResilienceEntry, ResilienceLevel, ResilienceState } from '../api';
import { useAuth } from '../AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';

const LEVELS: { level: ResilienceLevel; title: string }[] = [
  { level: 'provider', title: 'Providers' },
  { level: 'connection', title: 'Connections' },
  { level: 'model', title: 'Models' },
];

const STATE_BADGE: Record<ResilienceState, string> = {
  closed: 'badge-success',
  'half-open': 'badge-warning',
  open: 'badge-error',
};

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatCountdown(targetMs: number, now: number): string {
  const remaining = targetMs - now;
  if (remaining <= 0) return 'now';
  const totalSec = Math.ceil(remaining / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function keyOf(entry: ResilienceEntry): string {
  return `${entry.key.level}:${entry.key.id}`;
}

export function ResiliencePage() {
  const { can } = useAuth();
  const canRead = can('resilience:read');
  const canManage = can('resilience:manage');

  const [entries, setEntries] = useState<ResilienceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const now = useNow();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const snapshot = await getResilience();
      setEntries(snapshot.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load resilience state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (canRead) void load(); else setLoading(false); }, [canRead, load]);

  async function handleReset(entry?: ResilienceEntry) {
    const busyId = entry ? keyOf(entry) : 'all';
    setBusyKey(busyId);
    setError('');
    try {
      await resetResilience(entry ? { level: entry.key.level, id: entry.key.id } : undefined);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset resilience state');
    } finally {
      setBusyKey(null);
    }
  }

  function confirmReset(entry?: ResilienceEntry) {
    setConfirmState({
      message: entry
        ? `Reset the circuit breaker for ${entry.key.level} "${entry.key.id}"?`
        : 'Reset all resilience state? This clears every circuit breaker, cooldown, and lockout.',
      onConfirm: () => { setConfirmState(null); void handleReset(entry); },
    });
  }

  if (!canRead) {
    return (
      <>
        <div className="page-header">
          <h1>Resilience</h1>
          <p>Circuit breakers, cooldowns, and lockouts across providers, connections, and models</p>
        </div>
        <div className="page-body">
          <div className="empty-state"><ShieldOff size={40} /><p>You don't have permission to view resilience state.</p></div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>Resilience</h1>
        <p>Circuit breakers, cooldowns, and lockouts across providers, connections, and models</p>
      </div>
      <div className="page-body">
        {error && <div className="form-error" style={{ marginBottom: 20 }}>{error}</div>}

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : entries.length === 0 ? (
          <div className="empty-state"><ShieldCheck size={40} /><p>All providers healthy — no resilience entries recorded.</p></div>
        ) : (
          <>
            <div className="toolbar">
              <span className="toolbar-title">
                {entries.length} entr{entries.length !== 1 ? 'ies' : 'y'}
              </span>
              {canManage && (
                <button className="btn btn-secondary" disabled={busyKey !== null} onClick={() => confirmReset()}>
                  {busyKey === 'all' ? <span className="spinner" /> : <><RotateCcw size={14} /> Reset all</>}
                </button>
              )}
            </div>

            {LEVELS.map(({ level, title }) => {
              const levelEntries = entries.filter(e => e.key.level === level);
              if (levelEntries.length === 0) return null;
              return (
                <div key={level} style={{ marginBottom: 24 }}>
                  <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                    {title}
                  </h3>
                  <div className="table-wrap" style={{ overflowX: 'auto' }}>
                    <table style={{ minWidth: 700 }}>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>State</th>
                          <th>Last fault</th>
                          <th>Failures</th>
                          {/* ponytail: open-state next-probe eligibility is an internal store constant
                              (PROVIDER_OPEN_MS), not exposed on ResilienceEntry — showing "opened"
                              relative time instead of guessing a probe ETA. Add a probeAt field to
                              the shared type if a precise probe countdown is wanted later. */}
                          <th>Cooldown / lockout</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {levelEntries.map(entry => {
                          const rowKey = keyOf(entry);
                          const until = entry.lockoutUntil ?? entry.cooldownUntil;
                          return (
                            <tr key={rowKey}>
                              <td><span className="mono" style={{ fontSize: '0.8rem' }}>{entry.key.id}</span></td>
                              <td><span className={`badge ${STATE_BADGE[entry.state]}`}>{entry.state}</span></td>
                              <td>{entry.lastFault ?? '—'}</td>
                              <td>{entry.failureCount}</td>
                              <td>
                                {until !== undefined
                                  ? formatCountdown(until, now)
                                  : entry.state === 'open' && entry.openedAt !== undefined
                                    ? `opened ${formatCountdown(now, entry.openedAt)} ago`
                                    : '—'}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {canManage && (
                                  <button
                                    className="btn-icon"
                                    disabled={busyKey !== null}
                                    onClick={() => confirmReset(entry)}
                                    title="Reset"
                                  >
                                    {busyKey === rowKey ? <span className="spinner" /> : <RotateCcw size={15} />}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
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
