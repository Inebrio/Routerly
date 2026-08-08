import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Check, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { getRouters, updateRouter, type Router } from '../../api';
import { useRouter } from './RouterLayout';
import { SearchableSelect } from '../../components/SearchableSelect';
import { useUnsavedChanges, UnsavedChangesModal } from '../../hooks/useUnsavedChanges';
import { LimitRowsEditor, limitsToRows, limitRowsToLimits, type LimitRow } from '../../components/LimitRowsEditor';
import { RoutingPoliciesEditor, mkPolicyId, type PolicyItem } from '../../components/RoutingPoliciesEditor';

// An Orchestrator scores a candidate Router as a whole (weight/health/rate-limit/
// fairness/performance/budget-remaining) — it has no models of its own, so the
// remaining model-attribute policy types (cheapest, capability, context, llm,
// semantic-intent, model-preference) are not offered here. Kept in sync with
// ORCHESTRATOR_POLICY_TYPES in packages/service/src/modules/routing/validate-orchestrator-policies.ts.
export const ORCHESTRATOR_POLICY_TYPES = ['health', 'rate-limit', 'fairness', 'performance', 'budget-remaining'] as const;

type CandidateRow = {
  internalId: string; // for React keys
  routerId: string;
  limitRows: LimitRow[];
};

function mkId() {
  return Math.random().toString(36).substring(7);
}

/**
 * Candidate list for an Orchestrator router. Each row shows only name/id/weight
 * of the candidate (AC7 — no policy/budget/model detail of the candidate router
 * is ever fetched or rendered here).
 */
export function RouterOrchestratorTab() {
  const { t } = useTranslation();
  const { router, setRouter } = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [candidateRouters, setCandidateRouters] = useState<Router[]>([]);
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [policies, setPolicies] = useState<PolicyItem[]>([]);

  useEffect(() => {
    getRouters()
      .then(all => setCandidateRouters(all.filter(r => (r.kind ?? 'router') === 'router' && r.id !== router?.id)))
      .catch(e => setErr(e instanceof Error ? e.message : t('routers.orchestrator.errors.loadFailed')))
      .finally(() => setLoading(false));
  }, [router?.id]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draggedRowIdx, setDraggedRowIdx] = useState<number | null>(null);

  useEffect(() => {
    /* v8 ignore next */
    if (!router) return;
    setRows((router.candidates ?? []).map(c => ({
      internalId: mkId(), routerId: c.routerId, limitRows: limitsToRows(c.limits),
    })));
    setPolicies((router.policies ?? []).map(p => ({ ...p, internalId: mkPolicyId() })));
  }, [router]);

  const isDirty = (() => {
    /* v8 ignore next */
    if (!router) return false;
    const savedCandidates = router.candidates ?? [];
    if (rows.length !== savedCandidates.length) return true;
    if (rows.some((r, i) =>
      r.routerId !== savedCandidates[i]!.routerId ||
      JSON.stringify(limitRowsToLimits(r.limitRows)) !== JSON.stringify(savedCandidates[i]!.limits ?? [])
    )) return true;

    const savedPolicies = router.policies ?? [];
    if (policies.length !== savedPolicies.length) return true;
    return policies.some((p, i) =>
      p.type !== savedPolicies[i]!.type ||
      p.enabled !== savedPolicies[i]!.enabled ||
      JSON.stringify(p.config || {}) !== JSON.stringify(savedPolicies[i]!.config || {})
    );
  })();

  const { isBlocked, proceed, reset } = useUnsavedChanges(isDirty);

  function usedRouterIds(excludeIdx: number): Set<string> {
    const used = new Set<string>();
    rows.forEach((r, i) => { if (i !== excludeIdx) used.add(r.routerId); });
    return used;
  }

  function addRow() {
    const used = usedRouterIds(-1);
    const first = candidateRouters.find(r => !used.has(r.id));
    /* v8 ignore next */
    setRows(prev => [...prev, { internalId: mkId(), routerId: first?.id ?? '', limitRows: [] }]);
  }

  // Candidate row drag/drop reordering — same mechanics as RoutingPoliciesEditor's policy DnD.
  function onDragStartRow(e: React.DragEvent, idx: number) {
    setDraggedRowIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    /* v8 ignore next 3 */
    setTimeout(() => {
      const el = document.getElementById(`candidate-row-${idx}`);
      if (el) el.style.opacity = '0.4';
    }, 0);
  }
  function onDragEnterRow(e: React.DragEvent, targetIdx: number) {
    e.preventDefault();
    if (draggedRowIdx === null || draggedRowIdx === targetIdx) return;
    setRows(prev => {
      const copy = [...prev];
      const draggedItem = copy[draggedRowIdx]!;
      copy.splice(draggedRowIdx, 1);
      copy.splice(targetIdx, 0, draggedItem);
      return copy;
    });
    setDraggedRowIdx(targetIdx);
  }
  function onDragEndRow(_e: React.DragEvent, idx: number) {
    setDraggedRowIdx(null);
    const el = document.getElementById(`candidate-row-${idx}`);
    /* v8 ignore next */
    if (el) el.style.opacity = '1';
  }

  function toggleExpanded(internalId: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(internalId)) next.delete(internalId); else next.add(internalId);
      return next;
    });
  }

  function updateRow(idx: number, patch: Partial<CandidateRow>) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function removeRow(idx: number) {
    setRows(prev => prev.filter((_, i) => i !== idx));
  }

  async function doSave() {
    /* v8 ignore next */
    if (!router) return;
    setErr('');
    setSaving(true);
    try {
      const payload: Parameters<typeof updateRouter>[1] = {
        name: router.name,
        models: router.models.map(m => ({ modelId: m.modelId })),
        candidates: rows.map(r => {
          const limits = limitRowsToLimits(r.limitRows);
          return { routerId: r.routerId, ...(limits.length > 0 ? { limits } : {}) };
        }),
        policies: policies.map(p => {
          const { internalId, ...rest } = p;
          return { ...rest, enabled: true };
        }),
      };
      const updated = await updateRouter(router.id, payload);
      setRouter(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('routers.orchestrator.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void doSave();
  }

  if (loading) return (
    <div style={{ maxWidth: 768, animation: 'fade-in 0.2s ease' }} className="loading-center">
      <div className="spinner" />
    </div>
  );

  /* v8 ignore next 3 */
  if (router && (router.kind ?? 'router') !== 'orchestrator') {
    return <div className="form-error">{t('routers.orchestrator.notOrchestrator')}</div>;
  }

  return (
    <>
      <form onSubmit={handleSubmit} style={{ maxWidth: 800 }}>
        {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

        <div className="form-group">
          <label className="form-label">{t('routers.orchestrator.routingPolicies')}</label>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
            {t('routers.orchestrator.routingPoliciesHint')}
          </p>
          <RoutingPoliciesEditor
            policies={policies}
            setPolicies={setPolicies}
            availableModels={[]}
            allowedTypes={ORCHESTRATOR_POLICY_TYPES}
          />
        </div>

        <div style={{ margin: '32px 0 24px', borderTop: '1px solid var(--border)' }} />

        <div className="form-group">
          <label className="form-label">{t('routers.orchestrator.candidateRouters')}</label>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
            {t('routers.orchestrator.candidateRoutersHint')}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rows.map((row, idx) => {
              const isExpanded = expanded.has(row.internalId);
              const limitCount = row.limitRows.filter(r => r.value !== '').length;
              return (
                <div
                  key={row.internalId}
                  id={`candidate-row-${idx}`}
                  draggable
                  onDragStart={e => onDragStartRow(e, idx)}
                  onDragEnter={e => onDragEnterRow(e, idx)}
                  onDragEnd={e => onDragEndRow(e, idx)}
                  /* v8 ignore next */
                  onDragOver={e => e.preventDefault()}
                  style={{
                    background: 'var(--surface-active)',
                    padding: 12,
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    cursor: 'grab',
                    transition: 'opacity 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ color: 'var(--text-muted)', paddingTop: 24, flexShrink: 0 }}><GripVertical size={16} /></div>

                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>{t('routers.orchestrator.router')}</label>
                      <SearchableSelect
                        value={row.routerId}
                        onChange={v => updateRow(idx, { routerId: v })}
                        placeholder={t('routers.orchestrator.selectRouter')}
                        options={candidateRouters
                          .filter(r => r.id === row.routerId || !usedRouterIds(idx).has(r.id))
                          .map(r => ({ value: r.id, label: r.name }))}
                      />
                    </div>

                    <div style={{ paddingTop: 20 }}>
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        className="btn-icon danger"
                        title={t('routers.orchestrator.removeCandidate')}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(row.internalId)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
                        cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.8rem', padding: 0,
                      }}
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {t('routers.orchestrator.usageLimits')}
                      {limitCount > 0 && (
                        <span style={{ fontSize: '0.72rem', background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '1px 7px' }}>
                          {t('routers.orchestrator.limitCount', { count: limitCount })}
                        </span>
                      )}
                    </button>
                    {isExpanded && (
                      <div style={{ marginTop: 10 }}>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                          {t('routers.orchestrator.usageLimitsHint')}
                        </p>
                        <LimitRowsEditor
                          rows={row.limitRows}
                          onChange={limitRows => updateRow(idx, { limitRows })}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {rows.length === 0 && (
              <div className="empty-state" style={{ padding: 24, fontSize: '0.9rem' }}>
                {t('routers.orchestrator.empty')}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={addRow}
            disabled={candidateRouters.filter(r => !rows.some(row => row.routerId === r.id)).length === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
              width: '100%', padding: '10px', marginTop: 12,
              background: 'none', border: '1.5px dashed var(--border)', borderRadius: 8,
              color: 'var(--text-secondary)', fontSize: '0.9rem', cursor: 'pointer',
              transition: 'all 0.2s',
              opacity: candidateRouters.filter(r => !rows.some(row => row.routerId === r.id)).length === 0 ? 0.4 : 1,
            }}
          >
            <Plus size={16} /> {t('routers.orchestrator.addCandidate')}
          </button>
        </div>

        <div style={{ marginTop: 32 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={() => void doSave()}
            style={saved ? { background: '#16a34a', borderColor: '#16a34a', transition: 'background 0.2s, border-color 0.2s' } : { transition: 'background 0.2s, border-color 0.2s' }}
          >
            {saving ? (
              <span className="spinner" />
            ) : saved ? (
              <><Check size={15} style={{ marginRight: 6 }} />{t('routers.orchestrator.saved')}</>
            ) : (
              t('routers.orchestrator.saveCandidates')
            )}
          </button>
        </div>
      </form>

      {isBlocked && <UnsavedChangesModal onConfirm={proceed} onCancel={reset} />}
    </>
  );
}
