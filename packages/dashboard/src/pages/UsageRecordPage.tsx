import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { getProjects, getUsageRecord, type Project, type UsageRecord, type TraceEntry } from '../api';

function Field({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  );
}

const PANEL_LABELS: Record<string, string> = {
  'router-request':  'Router Request',
  'router-response': 'Router Response',
  'request':         'Model Request',
  'response':        'Model Response',
};

const PANEL_COLORS: Record<string, string> = {
  'router-request':  '#3d75f5',
  'router-response': '#8b5cf6',
  'request':         '#3b82f6',
  'response':        '#0ea5e9',
};

function TracePanel({ entries }: { entries: TraceEntry[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (entries.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map((e, i) => {
        const color = PANEL_COLORS[e.panel] ?? '#6b7280';
        const label = PANEL_LABELS[e.panel] ?? e.panel;
        const isExpanded = expandedIdx === i;
        const hasDetails = Object.keys(e.details).length > 0;

        return (
          <div
            key={i}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              overflow: 'hidden',
              background: 'var(--bg-surface)',
            }}
          >
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px',
                cursor: hasDetails ? 'pointer' : 'default',
                userSelect: 'none',
              }}
              onClick={() => hasDetails && setExpandedIdx(isExpanded ? null : i)}
            >
              <span style={{
                fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.06em', padding: '2px 7px', borderRadius: 4,
                background: `${color}1a`, color,
                flexShrink: 0,
              }}>
                {label}
              </span>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)', fontFamily: 'monospace', flex: 1 }}>
                {e.message}
              </span>
              {hasDetails && (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                  {isExpanded ? '▲' : '▼'}
                </span>
              )}
            </div>

            {isExpanded && hasDetails && (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                <pre style={{
                  margin: 0, padding: '12px 14px',
                  fontSize: '0.75rem', lineHeight: 1.55,
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-base)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  overflowX: 'auto',
                }}>
                  {JSON.stringify(e.details, null, 2)}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function UsageRecordPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const stateRecord = (location.state as { record?: UsageRecord } | null)?.record;

  const [record, setRecord] = useState<UsageRecord | undefined>(stateRecord);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingRecord, setLoadingRecord] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getProjects().then(setProjects).catch(console.error);
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoadingRecord(true);
    getUsageRecord(id)
      .then(setRecord)
      .catch(e => setLoadError(e instanceof Error ? e.message : 'Failed to load record'))
      .finally(() => setLoadingRecord(false));
  }, [id]);

  const BackBtn = () => (
    <button
      className="btn btn-secondary btn-sm"
      onClick={() => navigate(-1)}
      style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
    >
      <ArrowLeft size={14} /> Back
    </button>
  );

  if (loadingRecord) {
    return (
      <>
        <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <BackBtn />
          <h1 style={{ margin: 0 }}>Call Detail</h1>
        </div>
        <div className="page-body"><div className="loading-center"><div className="spinner" /></div></div>
      </>
    );
  }

  if (loadError || !record) {
    return (
      <>
        <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <BackBtn />
          <h1 style={{ margin: 0 }}>Record Not Found</h1>
        </div>
        <div className="page-body">
          <div className="empty-state">
            <p>{loadError ?? `Usage record ${id} could not be loaded.`}</p>
          </div>
        </div>
      </>
    );
  }

  const project = projects.find(p => p.id === record.projectId);
  const isRouting = (record.callType ?? 'completion') === 'routing';
  const totalTokens = record.inputTokens + record.outputTokens;

  return (
    <>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <BackBtn />
        <div>
          <h1 style={{ margin: 0 }}>Call Detail</h1>
          <p style={{ margin: 0 }}>{new Date(record.timestamp).toLocaleString()}</p>
        </div>
      </div>

      <div className="page-body">
        <div style={{ display: 'grid', gap: 16, maxWidth: 900 }}>

          {/* Identity */}
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 20px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Identity
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 20 }}>
              <Field label="Record ID" value={record.id} mono />
              <Field label="Project" value={project ? project.name : <span className="mono" style={{ fontSize: '0.82rem' }}>{record.projectId}</span>} />
              <Field label="Model" value={record.modelId} mono />
              <Field
                label="Call Type"
                value={
                  <span style={{
                    display: 'inline-block', fontSize: '0.78rem', fontWeight: 600,
                    padding: '2px 10px', borderRadius: 99,
                    background: isRouting ? 'rgba(99,102,241,0.12)' : 'rgba(59,130,246,0.12)',
                    color: isRouting ? 'var(--accent)' : 'var(--primary)',
                  }}>
                    {isRouting ? 'router' : 'completion'}
                  </span>
                }
              />
            </div>
          </div>

          {/* Tokens & Cost */}
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 20px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Tokens & Cost
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 20 }}>
              <Field label="Input Tokens" value={record.inputTokens.toLocaleString()} />
              <Field label="Output Tokens" value={record.outputTokens.toLocaleString()} />
              <Field label="Total Tokens" value={totalTokens.toLocaleString()} />
              <Field label="Cost (USD)" value={<span className="mono">${record.cost.toFixed(8)}</span>} />
            </div>
          </div>

          {/* Performance & Outcome */}
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 20px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Performance & Outcome
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 20 }}>
              <Field label="Latency" value={`${record.latencyMs} ms`} />
              <Field label="TTFT" value={record.ttftMs != null ? `${record.ttftMs} ms` : '—'} />
              <Field label="Tok/s" value={record.tokensPerSec != null ? `${record.tokensPerSec} tok/s` : '—'} />
              <Field
                label="Outcome"
                value={
                  <span className={`badge ${record.outcome === 'success' ? 'badge-success' : 'badge-error'}`}>
                    {record.outcome}
                  </span>
                }
              />
              <Field label="Timestamp" value={new Date(record.timestamp).toISOString()} mono />
            </div>
            {record.errorMessage && (
              <div style={{ marginTop: 20, padding: '12px 16px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--danger)', marginBottom: 6 }}>
                  Error Message
                </div>
                <pre style={{ margin: 0, fontSize: '0.82rem', color: 'var(--danger)', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                  {record.errorMessage}
                </pre>
              </div>
            )}
          </div>

          {/* Trace Log */}
          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Trace Log
              </h3>
              {record.trace && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {record.trace.length} event{record.trace.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {!record.trace || record.trace.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                No trace available. Trace data is captured for new calls only.
              </p>
            ) : (
              <TracePanel entries={record.trace} />
            )}
          </div>

        </div>
      </div>
    </>
  );
}
