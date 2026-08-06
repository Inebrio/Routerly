import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Check } from 'lucide-react';
import { getRouters, updateRouter, type Router } from '../../api';
import { useRouter } from './RouterLayout';
import { SearchableSelect } from '../../components/SearchableSelect';
import { useUnsavedChanges, UnsavedChangesModal } from '../../hooks/useUnsavedChanges';

type CandidateRow = {
  internalId: string; // for React keys
  routerId: string;
  weight: number;
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
  const { router, setRouter } = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [candidateRouters, setCandidateRouters] = useState<Router[]>([]);
  const [rows, setRows] = useState<CandidateRow[]>([]);

  useEffect(() => {
    getRouters()
      .then(all => setCandidateRouters(all.filter(r => (r.kind ?? 'router') === 'router' && r.id !== router?.id)))
      .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load routers'))
      .finally(() => setLoading(false));
  }, [router?.id]);

  useEffect(() => {
    /* v8 ignore next */
    if (!router) return;
    setRows((router.candidates ?? []).map(c => ({ internalId: mkId(), routerId: c.routerId, weight: c.weight })));
  }, [router]);

  const isDirty = (() => {
    /* v8 ignore next */
    if (!router) return false;
    const savedCandidates = router.candidates ?? [];
    if (rows.length !== savedCandidates.length) return true;
    return rows.some((r, i) => r.routerId !== savedCandidates[i]!.routerId || r.weight !== savedCandidates[i]!.weight);
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
    setRows(prev => [...prev, { internalId: mkId(), routerId: first?.id ?? '', weight: 1 }]);
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
        candidates: rows.map(r => ({ routerId: r.routerId, weight: r.weight })),
      };
      const updated = await updateRouter(router.id, payload);
      setRouter(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error saving orchestrator candidates');
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
    return <div className="form-error">This router is not an Orchestrator.</div>;
  }

  return (
    <>
      <form onSubmit={handleSubmit} style={{ maxWidth: 800 }}>
        {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

        <div className="form-group">
          <label className="form-label">Candidate Routers</label>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
            The routers this Orchestrator forwards requests to. Weight influences how often each
            candidate is picked; only its name, id and weight are shown here.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rows.map((row, idx) => {
              const resolved = candidateRouters.find(r => r.id === row.routerId);
              return (
                <div
                  key={row.internalId}
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                    background: 'var(--surface-active)',
                    padding: 12,
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Router</label>
                    <SearchableSelect
                      value={row.routerId}
                      onChange={v => updateRow(idx, { routerId: v })}
                      placeholder="Select router"
                      options={candidateRouters
                        .filter(r => r.id === row.routerId || !usedRouterIds(idx).has(r.id))
                        .map(r => ({ value: r.id, label: r.name, description: r.id }))}
                    />
                    {resolved && (
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>
                        {resolved.id}
                      </p>
                    )}
                  </div>

                  <div style={{ width: 120 }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Weight</label>
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      step={1}
                      value={row.weight}
                      onChange={e => updateRow(idx, { weight: Number(e.target.value) })}
                    />
                  </div>

                  <div style={{ paddingTop: 20 }}>
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      className="btn-icon danger"
                      title="Remove candidate"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}

            {rows.length === 0 && (
              <div className="empty-state" style={{ padding: 24, fontSize: '0.9rem' }}>
                No candidate routers yet. An Orchestrator needs at least one before it can forward requests.
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
            <Plus size={16} /> Add Candidate
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
              <><Check size={15} style={{ marginRight: 6 }} />Saved!</>
            ) : (
              'Save Candidates'
            )}
          </button>
        </div>
      </form>

      {isBlocked && <UnsavedChangesModal onConfirm={proceed} onCancel={reset} />}
    </>
  );
}
