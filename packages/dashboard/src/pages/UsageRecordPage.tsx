import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react'; // useState still used for record/routers/loading state
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { requestTypeLabel } from '@routerly/shared';
import { getRouters, getUsageRecord, type Router, type UsageRecord } from '../api';
import { tokenLabel } from '../utils/tokenLabel';
import { TraceLog } from '../components/TraceLog';
import { TraceSummary } from '../components/TraceSummary';

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

export function UsageRecordPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const stateRecord = (location.state as { record?: UsageRecord } | null)?.record;

  const [record, setRecord] = useState<UsageRecord | undefined>(stateRecord);
  const [routers, setRouters] = useState<Router[]>([]);
  const [loadingRecord, setLoadingRecord] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getRouters().then(setRouters).catch(console.error);
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoadingRecord(true);
    getUsageRecord(id)
      .then(setRecord)
      .catch(e => setLoadError(e instanceof Error ? e.message : t('usage.record.errors.loadFailed')))
      .finally(() => setLoadingRecord(false));
  }, [id]);

  const BackBtn = () => (
    <button
      className="btn btn-secondary btn-sm"
      onClick={() => navigate(-1)}
      style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
    >
      <ArrowLeft size={14} /> {t('usage.record.back')}
    </button>
  );

  if (loadingRecord) {
    return (
      <>
        <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <BackBtn />
          <h1 style={{ margin: 0 }}>{t('usage.record.title')}</h1>
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
          <h1 style={{ margin: 0 }}>{t('usage.record.notFoundTitle')}</h1>
        </div>
        <div className="page-body">
          <div className="empty-state">
            <p>{loadError ?? t('usage.record.notFoundBody', { id })}</p>
          </div>
        </div>
      </>
    );
  }

  const router = routers.find(p => p.id === record.routerId);
  const isRouting = (record.callType ?? 'completion') === 'routing';
  const totalTokens = record.inputTokens + record.outputTokens;

  return (
    <>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <BackBtn />
        <div>
          <h1 style={{ margin: 0 }}>{t('usage.record.title')}</h1>
          <p style={{ margin: 0 }}>{new Date(record.timestamp).toLocaleString()}</p>
        </div>
      </div>

      <div className="page-body">
        <div style={{ display: 'grid', gap: 16, maxWidth: 900 }}>

          {/* Summary: what the whole request did, in one card */}
          <TraceSummary trace={record.trace} />

          {/* Identity */}
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 20px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t('usage.record.sections.identity')}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 20 }}>
              <Field label={t('usage.record.fields.recordId')} value={record.id} mono />
              <Field label={t('usage.record.fields.router')} value={router ? router.name : <span className="mono" style={{ fontSize: '0.82rem' }}>{record.routerId}</span>} />
              {/* Which of the router's tokens the call came in on. Older records carry none. */}
              {record.tokenId && (
                <Field
                  label={t('usage.record.fields.token')}
                  value={(() => {
                    const tk = router?.tokens?.find(x => x.id === record.tokenId);
                    return tk ? tokenLabel(tk) : <span className="mono" style={{ fontSize: '0.82rem' }}>{record.tokenId}</span>;
                  })()}
                />
              )}
              <Field label={t('usage.record.fields.model')} value={record.modelId} mono />
              <Field
                label={t('usage.record.fields.callType')}
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
              {/* Records written before requestType existed were all chat calls. */}
              <Field label={t('usage.record.fields.requestType')} value={requestTypeLabel(record.requestType ?? 'chat')} />
            </div>
          </div>

          {/* Tokens & Cost */}
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 20px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t('usage.record.sections.tokensAndCost')}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 20 }}>
              <Field label={t('usage.record.fields.inputTokens')} value={record.inputTokens.toLocaleString()} />
              <Field label={t('usage.record.fields.outputTokens')} value={record.outputTokens.toLocaleString()} />
              <Field label={t('usage.record.fields.totalTokens')} value={totalTokens.toLocaleString()} />
              <Field label={t('usage.record.fields.costUsd')} value={<span className="mono">${record.cost.toFixed(8)}</span>} />
            </div>
          </div>

          {/* Performance & Outcome */}
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 20px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t('usage.record.sections.performanceAndOutcome')}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 20 }}>
              <Field label={t('usage.record.fields.latency')} value={`${record.latencyMs} ms`} />
              <Field label={t('usage.record.fields.ttft')} value={record.ttftMs != null ? `${record.ttftMs} ms` : '—'} />
              <Field label={t('usage.record.fields.tokensPerSec')} value={record.tokensPerSec != null ? `${record.tokensPerSec} tok/s` : '—'} />
              <Field
                label={t('usage.record.fields.outcome')}
                value={
                  <span className={`badge ${record.outcome === 'success' ? 'badge-success' : record.outcome === 'blocked' ? 'badge-warning' : 'badge-error'}`}>
                    {record.outcome}
                  </span>
                }
              />
              <Field label={t('usage.record.fields.timestamp')} value={new Date(record.timestamp).toISOString()} mono />
              {record.guardrailTriggered && (
                <Field label={t('usage.record.fields.guardrailTriggered')} value={record.guardrailTriggered} mono />
              )}
              {record.blockedBy && (
                <Field label={t('usage.record.fields.blockedBy')} value={record.blockedBy} mono />
              )}
              {record.piiRedacted && record.piiRedacted.length > 0 && (
                <Field label={t('usage.record.fields.piiRedacted')} value={record.piiRedacted.join(', ')} />
              )}
            </div>
            {record.errorMessage && (
              <div style={{ marginTop: 20, padding: '12px 16px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--danger)', marginBottom: 6 }}>
                  {t('usage.record.errorMessage')}
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
                {t('usage.record.sections.traceLog')}
              </h3>
              {record.trace && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {t('usage.record.eventCount', { count: record.trace.length })}
                </span>
              )}
            </div>

            {!record.trace || record.trace.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {t('usage.record.noTrace')}
              </p>
            ) : (
              <TraceLog entries={record.trace} />
            )}
          </div>

        </div>
      </div>
    </>
  );
}
