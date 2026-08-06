import React from 'react';
import { X, Plus } from 'lucide-react';
import type { Limit, LimitMetric, LimitPeriod, RollingUnit } from '../api';
import { SearchableSelect } from './SearchableSelect';

/**
 * Shared editable-row representation of a `Limit`, and the grid UI to edit a
 * list of them. Extracted from `RouterTokenEditPage`'s per-model limit
 * override editor so any surface that needs to edit a `Limit[]` (per-model
 * token overrides, per-candidate orchestrator overrides, ...) reuses the same
 * pattern instead of re-implementing it.
 */
export type LimitRow = {
  metric: LimitMetric;
  windowType: 'period' | 'rolling';
  period: LimitPeriod;
  rollingAmount: string;
  rollingUnit: RollingUnit;
  value: string;
};

export const LIMIT_METRIC_OPTIONS: { value: LimitMetric; label: string }[] = [
  { value: 'cost',          label: 'Cost (USD)'      },
  { value: 'calls',         label: 'Requests'        },
  { value: 'input_tokens',  label: 'Input tokens'    },
  { value: 'output_tokens', label: 'Output tokens'   },
  { value: 'total_tokens',  label: 'Total tokens'    },
];

export const PERIOD_OPTIONS: { value: LimitPeriod; label: string }[] = [
  { value: 'hourly',  label: 'Hourly'  },
  { value: 'daily',   label: 'Daily'   },
  { value: 'weekly',  label: 'Weekly'  },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly',  label: 'Yearly'  },
];

export const ROLLING_UNIT_OPTIONS: { value: RollingUnit; label: string }[] = [
  { value: 'second', label: 'seconds' },
  { value: 'minute', label: 'minutes' },
  { value: 'hour',   label: 'hours'   },
  { value: 'day',    label: 'days'    },
  { value: 'week',   label: 'weeks'   },
  { value: 'month',  label: 'months'  },
];

export const EMPTY_LIMIT_ROW: LimitRow = {
  metric: 'cost', windowType: 'period', period: 'monthly',
  rollingAmount: '24', rollingUnit: 'hour', value: '',
};

export function rowKey(r: LimitRow): string {
  if (r.windowType === 'rolling') return `${r.metric}|rolling|${r.rollingAmount}|${r.rollingUnit}`;
  return `${r.metric}|period|${r.period}`;
}

export function findFreeCombo(rows: LimitRow[]): LimitRow | null {
  const used = new Set(rows.map(rowKey));
  for (const m of LIMIT_METRIC_OPTIONS.map(o => o.value as LimitMetric)) {
    for (const p of PERIOD_OPTIONS.map(o => o.value as LimitPeriod)) {
      const candidate: LimitRow = { ...EMPTY_LIMIT_ROW, metric: m, windowType: 'period', period: p };
      if (!used.has(rowKey(candidate))) return candidate;
    }
  }
  return null;
}

export function rowToLimit(r: LimitRow): Limit {
  if (r.windowType === 'rolling') {
    return { metric: r.metric, windowType: 'rolling', rollingAmount: parseInt(r.rollingAmount) || 1, rollingUnit: r.rollingUnit, value: parseFloat(r.value) };
  }
  return { metric: r.metric, windowType: 'period', period: r.period, value: parseFloat(r.value) };
}

export function limitToRow(l: Limit): LimitRow {
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

export function limitRowsToLimits(rows: LimitRow[]): Limit[] {
  return rows
    .filter(r => r.value !== '' && !isNaN(parseFloat(r.value)))
    .map(rowToLimit);
}

export function limitsToRows(limits: Limit[] | undefined): LimitRow[] {
  if (!limits?.length) return [];
  return limits.map(limitToRow);
}

export function fmtLimit(l: Limit): string {
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

/** Editable grid of `LimitRow`s plus an "Add limit" affordance. */
export function LimitRowsEditor({ rows, onChange }: { rows: LimitRow[]; onChange: (rows: LimitRow[]) => void }) {
  const freeCombo = findFreeCombo(rows);

  function updateRow(idx: number, patch: Partial<LimitRow>) {
    onChange(rows.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function removeRow(idx: number) {
    onChange(rows.filter((_, i) => i !== idx));
  }

  function addRow() {
    if (freeCombo) onChange([...rows, freeCombo]);
  }

  return (
    <div>
      {rows.length === 0 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 8px', fontStyle: 'italic' }}>
          No limits set.
        </p>
      )}
      {rows.map((lim, idx) => {
        const upd = (patch: Partial<LimitRow>) => updateRow(idx, patch);
        const otherKeys = new Set(rows.filter((_, i) => i !== idx).map(rowKey));
        return (
          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '120px 100px 1fr 90px auto', gap: 6, alignItems: 'flex-end', marginBottom: 8 }}>
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
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: '0.72rem' }}>Type</label>
              <SearchableSelect
                value={lim.windowType}
                onChange={v => upd({ windowType: v as 'period' | 'rolling' })}
                options={[{ value: 'period', label: 'Period' }, { value: 'rolling', label: 'Rolling' }]}
              />
            </div>
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
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: '0.72rem' }}>
                {lim.metric === 'cost' ? 'Max ($)' : lim.metric === 'calls' ? 'Max (n.)' : 'Max (tokens)'}
              </label>
              <input className="form-input" type="number" step="any" min="0" value={lim.value}
                onChange={e => upd({ value: e.target.value })}
                placeholder={lim.metric === 'cost' ? '10.00' : lim.metric === 'calls' ? '100' : '100000'} />
            </div>
            <button type="button" onClick={() => removeRow(idx)}
              style={{ padding: 7, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', alignSelf: 'flex-end', display: 'flex', alignItems: 'center', borderRadius: 6 }}>
              <X size={14} />
            </button>
          </div>
        );
      })}
      <button type="button" onClick={addRow}
        disabled={!freeCombo}
        title={!freeCombo ? 'All metric/period combinations are already set' : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, background: 'none', border: '1px dashed var(--border)', borderRadius: 6, cursor: freeCombo ? 'pointer' : 'not-allowed', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '6px 12px', transition: 'all 0.15s', opacity: freeCombo ? 1 : 0.4 }}>
        <Plus size={12} /> Add limit
      </button>
    </div>
  );
}
