import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { updateRouterToken, getModels } from '../../api';
import type { Model, Limit, LimitMetric, LimitPeriod, RollingUnit } from '../../api';
import { useRouter } from './RouterLayout';
import { LabelInput } from './RouterTokenTab';
import { SearchableSelect } from '../../components/SearchableSelect';

// ── Limit helpers ─────────────────────────────────────────────────────────────
type LimitRow = {
  metric: LimitMetric;
  windowType: 'period' | 'rolling';
  period: LimitPeriod;
  rollingAmount: string;
  rollingUnit: RollingUnit;
  value: string;
};

const LIMIT_METRIC_OPTIONS: { value: LimitMetric; label: string }[] = [
  { value: 'cost',          label: 'Cost (USD)'      },
  { value: 'calls',         label: 'Requests'        },
  { value: 'input_tokens',  label: 'Input tokens'    },
  { value: 'output_tokens', label: 'Output tokens'   },
  { value: 'total_tokens',  label: 'Total tokens'    },
];

const PERIOD_OPTIONS: { value: LimitPeriod; label: string }[] = [
  { value: 'hourly',  label: 'Hourly'  },
  { value: 'daily',   label: 'Daily'   },
  { value: 'weekly',  label: 'Weekly'  },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly',  label: 'Yearly'  },
];

const ROLLING_UNIT_OPTIONS: { value: RollingUnit; label: string }[] = [
  { value: 'second', label: 'seconds' },
  { value: 'minute', label: 'minutes' },
  { value: 'hour',   label: 'hours'   },
  { value: 'day',    label: 'days'    },
  { value: 'week',   label: 'weeks'   },
  { value: 'month',  label: 'months'  },
];

const EMPTY_LIMIT_ROW: LimitRow = {
  metric: 'cost', windowType: 'period', period: 'monthly',
  rollingAmount: '24', rollingUnit: 'hour', value: '',
};

function rowKey(r: LimitRow): string {
  if (r.windowType === 'rolling') return `${r.metric}|rolling|${r.rollingAmount}|${r.rollingUnit}`;
  return `${r.metric}|period|${r.period}`;
}

function findFreeCombo(rows: LimitRow[]): LimitRow | null {
  const used = new Set(rows.map(rowKey));
  for (const m of LIMIT_METRIC_OPTIONS.map(o => o.value as LimitMetric)) {
    for (const p of PERIOD_OPTIONS.map(o => o.value as LimitPeriod)) {
      const candidate: LimitRow = { ...EMPTY_LIMIT_ROW, metric: m, windowType: 'period', period: p };
      if (!used.has(rowKey(candidate))) return candidate;
    }
  }
  return null;
}

function rowToLimit(r: LimitRow): Limit {
  if (r.windowType === 'rolling') {
    return { metric: r.metric, windowType: 'rolling', rollingAmount: parseInt(r.rollingAmount) || 1, rollingUnit: r.rollingUnit, value: parseFloat(r.value) };
  }
  return { metric: r.metric, windowType: 'period', period: r.period, value: parseFloat(r.value) };
}

function limitToRow(l: Limit): LimitRow {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacyWindow = (l as any).window as string | undefined;
  const legacyPeriodMap: Record<string, LimitPeriod> = {
    minute: 'hourly', hour: 'hourly', day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly',
  };
  if (l.windowType === 'rolling') {
    return { metric: l.metric, windowType: 'rolling', period: 'daily', rollingAmount: String(l.rollingAmount ?? 24), rollingUnit: l.rollingUnit ?? 'hour', value: String(l.value) };
  }
  return { metric: l.metric, windowType: 'period', period: l.period ?? (legacyWindow ? legacyPeriodMap[legacyWindow] : undefined) ?? 'monthly', rollingAmount: '24', rollingUnit: 'hour', value: String(l.value) };
}

function limitRowsToLimits(rows: LimitRow[]): Limit[] {
  return rows
    .filter(r => r.value !== '' && !isNaN(parseFloat(r.value)))
    .map(rowToLimit);
}

function limitsToRows(limits: Limit[] | undefined): LimitRow[] {
  if (!limits?.length) return [];
  return limits.map(limitToRow);
}

function fmtLimit(l: Limit): string {
  const metricLabel =
    l.metric === 'cost'         ? `$${l.value}` :
    l.metric === 'calls'        ? `${l.value} req` :
    l.metric === 'input_tokens' ? `${l.value} in-tok` :
    l.metric === 'output_tokens'? `${l.value} out-tok` :
    /* total_tokens */             `${l.value} tok`;
  if (l.windowType === 'rolling') {
    const unit = ROLLING_UNIT_OPTIONS.find(o => o.value === l.rollingUnit)?.label ?? l.rollingUnit ?? 'day';
    return `${metricLabel} / every ${l.rollingAmount ?? 1} ${unit}`;
  }
  const periodLabel = PERIOD_OPTIONS.find(o => o.value === l.period)?.label ?? l.period ?? 'monthly';
  return `${metricLabel} / ${periodLabel.toLowerCase()}`;
}

function inheritedLimitLabel(
  pm: { limits?: Limit[]; thresholds?: { daily?: number; weekly?: number; monthly?: number } },
  fullModel: Model | undefined,
): string {
  const routerLimits = pm.limits?.length ? pm.limits : (pm.thresholds
    ? [
      ...(pm.thresholds.daily   != null ? [{ metric: 'cost' as LimitMetric, windowType: 'period' as const, period: 'daily'   as LimitPeriod, value: pm.thresholds.daily   }] : []),
      ...(pm.thresholds.weekly  != null ? [{ metric: 'cost' as LimitMetric, windowType: 'period' as const, period: 'weekly'  as LimitPeriod, value: pm.thresholds.weekly  }] : []),
      ...(pm.thresholds.monthly != null ? [{ metric: 'cost' as LimitMetric, windowType: 'period' as const, period: 'monthly' as LimitPeriod, value: pm.thresholds.monthly }] : []),
    ]
    : undefined);

  const globalLimits = fullModel?.limits?.length ? fullModel.limits : (fullModel?.globalThresholds
    ? [
      ...(fullModel.globalThresholds.daily   != null ? [{ metric: 'cost' as LimitMetric, windowType: 'period' as const, period: 'daily'   as LimitPeriod, value: fullModel.globalThresholds.daily   }] : []),
      ...(fullModel.globalThresholds.weekly  != null ? [{ metric: 'cost' as LimitMetric, windowType: 'period' as const, period: 'weekly'  as LimitPeriod, value: fullModel.globalThresholds.weekly  }] : []),
      ...(fullModel.globalThresholds.monthly != null ? [{ metric: 'cost' as LimitMetric, windowType: 'period' as const, period: 'monthly' as LimitPeriod, value: fullModel.globalThresholds.monthly }] : []),
    ]
    : undefined);

  const effective = routerLimits ?? globalLimits;
  if (!effective?.length) return 'No limits';
  return effective.map(fmtLimit).join(' · ');
}

type EditModel = {
  modelId: string;
  limitRows: LimitRow[];
};

export function RouterTokenEditPage() {
  const { id: routerId, tokenId } = useParams<{ id: string; tokenId: string }>();
  const navigate = useNavigate();
  const { router, setRouter } = useRouter();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [allModels, setAllModels] = useState<Model[]>([]);

  useEffect(() => { getModels().then(setAllModels).catch(() => {}); }, []);

  // Form state: per-model limit overrides
  const [editModels, setEditModels] = useState<EditModel[]>([]);
  const [editLabels, setEditLabels] = useState<string[]>([]);
  const [editLabelInput, setEditLabelInput] = useState('');
  const [editScopes, setEditScopes] = useState<string[]>([]);
  const [editScopeInput, setEditScopeInput] = useState('');
  const [editTags, setEditTags] = useState<Record<string, string>>({});
  const [newTagKey, setNewTagKey] = useState('');
  const [newTagVal, setNewTagVal] = useState('');

  const tokens = router?.tokens || [];
  const editingToken = tokens.find(t => t.id === tokenId);
  const allLabels = Array.from(new Set(tokens.flatMap(t => t.labels || []))).sort();
  const allScopes = Array.from(new Set(tokens.flatMap(t => t.scopes || []))).sort();

  // Initialize form state from existing token data
  useEffect(() => {
    if (editingToken) {
      setEditModels(
        (editingToken.models || []).map(m => ({
          modelId: m.modelId,
          limitRows: limitsToRows(m.limits),
        }))
      );
      setEditLabels(editingToken.labels || []);
      setEditScopes(editingToken.scopes || []);
      setEditTags(editingToken.tags || {});
    }
  }, [editingToken]);

  if (!router || !editingToken) return null;

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true);
    if (!router || !routerId || !tokenId) return;
    try {
      const cleanedModels = editModels.map(m => ({
        modelId: m.modelId,
        limits: limitRowsToLimits(m.limitRows),
      }));
      const updated = await updateRouterToken(routerId, tokenId, cleanedModels, editLabels, editTags, editScopes);
      setRouter(p => p ? { ...p, tokens: p.tokens?.map(t => t.id === tokenId ? updated : t) || [] } : p);
      navigate(`/dashboard/routers/${routerId}/token`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error saving token'); }
    finally { setLoading(false); }
  }

  function goBack() {
    navigate(`/dashboard/routers/${routerId}/token`);
  }

  function toggleModelOverride(modelId: string, enabled: boolean) {
    if (enabled) {
      setEditModels(prev => [...prev, { modelId, limitRows: [] }]);
    } else {
      setEditModels(prev => prev.filter(m => m.modelId !== modelId));
    }
  }

  function addLimitRow(modelId: string) {
    setEditModels(prev => prev.map(m => {
      if (m.modelId !== modelId) return m;
      const free = findFreeCombo(m.limitRows);
      if (!free) return m;
      return { ...m, limitRows: [...m.limitRows, free] };
    }));
  }

  function updateLimitRow(modelId: string, idx: number, patch: Partial<LimitRow>) {
    setEditModels(prev => prev.map(m => {
      if (m.modelId !== modelId) return m;
      const updated = m.limitRows.map((r, i) => i === idx ? { ...r, ...patch } : r);
      const candidate = updated[idx];
      if (!candidate) return m;
      const isDup = updated.some((r, i) => i !== idx && rowKey(r) === rowKey(candidate));
      if (isDup) return m; // blocca aggiornamento che creerebbe un duplicato
      return { ...m, limitRows: updated };
    }));
  }

  function removeLimitRow(modelId: string, idx: number) {
    setEditModels(prev => prev.map(m =>
      m.modelId === modelId
        ? { ...m, limitRows: m.limitRows.filter((_, i) => i !== idx) }
        : m
    ));
  }

  return (
    <div className="page-body">
      <div style={{ maxWidth: 560 }}>


        <button type="button" onClick={goBack}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem', padding: 0, marginBottom: 24 }}>
          <ArrowLeft size={16} /> Back to tokens
        </button>

        <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 600 }}>Edit Token</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 28 }}>
          Update labels and per-model limit overrides for this token.
        </p>

        <form onSubmit={handleUpdate}>
          {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

          <div className="form-group">
            <label className="form-label">Token</label>
            <div className="form-input mono" style={{ opacity: 0.65, fontSize: '0.88rem', cursor: 'default', userSelect: 'text' }}>
              {editingToken.tokenSnippet}••••••••
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              Labels <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
            </label>
            <LabelInput labels={editLabels} setLabels={setEditLabels} input={editLabelInput} setInput={setEditLabelInput} allLabels={allLabels} />
          </div>

          <div className="form-group">
            <label className="form-label">
              Scopes <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
            </label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
              Free-form scopes attached to this token (e.g. "batch", "internal"), stored with the token for your own bookkeeping.
            </p>
            <LabelInput labels={editScopes} setLabels={setEditScopes} input={editScopeInput} setInput={setEditScopeInput} allLabels={allScopes} />
          </div>

          <div className="form-group">
            <label className="form-label">
              Tags <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
            </label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
              Key-value metadata forwarded to usage records (e.g. env=production).
            </p>
            {Object.entries(editTags).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span className="mono" style={{ fontSize: '0.82rem', flex: 1, color: 'var(--text-primary)' }}>{k}={v}</span>
                <button type="button" onClick={() => setEditTags(t => { const n = { ...t }; delete n[k]; return n; })}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 2 }}>
                  <X size={13} />
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="form-input" placeholder="key" value={newTagKey} onChange={e => setNewTagKey(e.target.value)} style={{ flex: 1 }} />
              <input className="form-input" placeholder="value" value={newTagVal} onChange={e => setNewTagVal(e.target.value)} style={{ flex: 1 }} />
              <button type="button" className="btn btn-secondary" style={{ padding: '0 10px' }}
                disabled={!newTagKey.trim()}
                onClick={() => { if (newTagKey.trim()) { setEditTags(t => ({ ...t, [newTagKey.trim()]: newTagVal })); setNewTagKey(''); setNewTagVal(''); } }}>
                <Plus size={14} />
              </button>
            </div>
          </div>

          <div style={{ marginTop: 28, borderTop: '1px solid var(--border)', paddingTop: 24 }}>
            <label className="form-label">Per-model limits</label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
              Override global and router-level limits for requests using this token.
            </p>

            {(!router.models || router.models.length === 0) ? (
              <div style={{
                padding: 20, border: '1px dashed var(--border)',
                borderRadius: 8, color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center',
              }}>
                Add target models in the Routing tab first.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {router.models.map(pm => {
                  const override = editModels.find(m => m.modelId === pm.modelId);
                  const isEnabled = !!override;
                  const fullModel = allModels.find(m => m.id === pm.modelId);
                  const inheritedLabel = inheritedLimitLabel(pm as any, fullModel);
                  const activeCount = override?.limitRows.filter(r => r.value !== '').length ?? 0;
                  const freeCombo = override ? findFreeCombo(override.limitRows) : null;

                  return (
                    <div key={pm.modelId} style={{
                      border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden',
                      background: isEnabled ? 'var(--surface-active)' : 'transparent', transition: 'background 0.2s',
                    }}>
                      <label style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: 0 }}>
                        <input
                          type="checkbox" checked={isEnabled}
                          onChange={e => toggleModelOverride(pm.modelId, e.target.checked)}
                          style={{ width: 15, height: 15, accentColor: 'var(--primary)', cursor: 'pointer' }}
                        />
                        <span className="mono" style={{ fontSize: '0.85rem', color: isEnabled ? 'var(--text-primary)' : 'var(--text-secondary)', flex: 1 }}>
                          {pm.modelId}
                        </span>
                        {isEnabled && activeCount > 0 ? (
                          <span style={{ fontSize: '0.72rem', background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '1px 7px' }}>
                            {activeCount} {activeCount === 1 ? 'limit' : 'limits'}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {isEnabled ? 'no override' : inheritedLabel}
                          </span>
                        )}
                      </label>

                      {isEnabled && (
                        <div style={{ padding: '0 14px 14px' }}>
                          {override!.limitRows.length === 0 && (
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 8px', fontStyle: 'italic' }}>
                              No limits set — inheriting from parent. Add a limit below to override.
                            </p>
                          )}
                          {override!.limitRows.map((lim, idx) => {
                            const upd = (patch: Partial<LimitRow>) =>
                              updateLimitRow(pm.modelId, idx, patch);
                            const otherKeys = new Set(
                              override!.limitRows.filter((_, i) => i !== idx).map(rowKey)
                            );
                            return (
                              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '120px 100px 1fr 90px auto', gap: 6, alignItems: 'flex-end', marginBottom: 8 }}>
                                {/* Metric */}
                                <div className="form-group" style={{ margin: 0 }}>
                                  <label className="form-label" style={{ fontSize: '0.72rem' }}>Metric</label>
                                  <SearchableSelect
                                    value={lim.metric}
                                    onChange={v => upd({ metric: v as LimitMetric })}
                                    options={LIMIT_METRIC_OPTIONS
                                      .filter(o => !otherKeys.has(rowKey({ ...lim, metric: o.value as LimitMetric })))
                                      .map(o => ({ value: o.value, label: o.label }))}
                                  />
                                </div>
                                {/* Window type */}
                                <div className="form-group" style={{ margin: 0 }}>
                                  <label className="form-label" style={{ fontSize: '0.72rem' }}>Type</label>
                                  <SearchableSelect
                                    value={lim.windowType}
                                    onChange={v => upd({ windowType: v as 'period' | 'rolling' })}
                                    options={[{ value: 'period', label: 'Period' }, { value: 'rolling', label: 'Rolling' }]}
                                  />
                                </div>
                                {/* Period or rolling */}
                                {lim.windowType === 'period' ? (
                                  <div className="form-group" style={{ margin: 0 }}>
                                    <label className="form-label" style={{ fontSize: '0.72rem' }}>Period</label>
                                    <SearchableSelect
                                      value={lim.period}
                                      onChange={v => upd({ period: v as LimitPeriod })}
                                      options={PERIOD_OPTIONS
                                        .filter(o => !otherKeys.has(rowKey({ ...lim, period: o.value as LimitPeriod })))
                                        .map(o => ({ value: o.value, label: o.label }))}
                                    />
                                  </div>
                                ) : (
                                  <div className="form-group" style={{ margin: 0 }}>
                                    <label className="form-label" style={{ fontSize: '0.72rem' }}>Every</label>
                                    <div style={{ display: 'flex', gap: 4 }}>
                                      <input className="form-input" type="number" min="1" step="1" value={lim.rollingAmount}
                                        onChange={e => upd({ rollingAmount: e.target.value })}
                                        style={{ width: 52 }} placeholder="24" />
                                      <SearchableSelect
                                        value={lim.rollingUnit}
                                        onChange={v => upd({ rollingUnit: v as RollingUnit })}
                                        options={ROLLING_UNIT_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                                        style={{ flex: 1 }}
                                      />
                                    </div>
                                  </div>
                                )}
                                {/* Max value */}
                                <div className="form-group" style={{ margin: 0 }}>
                                  <label className="form-label" style={{ fontSize: '0.72rem' }}>
                                  {lim.metric === 'cost' ? 'Max ($)' : lim.metric === 'calls' ? 'Max (n.)' : 'Max (tokens)'}
                                  </label>
                                  <input className="form-input" type="number" step="any" min="0" value={lim.value}
                                    onChange={e => upd({ value: e.target.value })}
                                    placeholder={lim.metric === 'cost' ? '10.00' : lim.metric === 'calls' ? '100' : '100000'} />
                                </div>
                                <button type="button" onClick={() => removeLimitRow(pm.modelId, idx)}
                                  style={{ padding: 7, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', alignSelf: 'flex-end', display: 'flex', alignItems: 'center', borderRadius: 6 }}>
                                  <X size={14} />
                                </button>
                              </div>
                            );
                          })}
                          <button type="button" onClick={() => addLimitRow(pm.modelId)}
                            disabled={!freeCombo}
                            title={!freeCombo ? 'All metric/period combinations are already set' : undefined}
                            style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, background: 'none', border: '1px dashed var(--border)', borderRadius: 6, cursor: freeCombo ? 'pointer' : 'not-allowed', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '6px 12px', transition: 'all 0.15s', opacity: freeCombo ? 1 : 0.4 }}
                            onMouseEnter={e => { if (freeCombo) { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)'; } }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; }}>
                            <Plus size={12} /> Add limit
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Save Changes'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={goBack} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
