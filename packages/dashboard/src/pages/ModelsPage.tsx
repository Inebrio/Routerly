import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Server, Eye, EyeOff, ChevronDown, X, Edit2 } from 'lucide-react';
import { getModels, createModel, deleteModel, updateModel, type Model, type PricingTier } from '../api';
import providersConf from '../conf/providers.json';

type Provider = keyof typeof providersConf;
type ProviderModel = {
  id: string;
  input: number;
  output: number;
  cache?: number;
  notes?: string;
  pricingTiers?: Array<{
    metric: string;
    above: number;
    input: number;
    output: number;
    cache?: number;
  }>;
};

// ── Constants ──────────────────────────────────────────────────────────────────
const PROVIDERS = Object.keys(providersConf) as Provider[];
const ENDPOINT_DEFAULTS = Object.fromEntries(
  PROVIDERS.map(p => [p, providersConf[p].endpoint])
) as Record<Provider, string>;
const PROVIDER_MODELS = Object.fromEntries(
  PROVIDERS.map(p => [p, providersConf[p].models as ProviderModel[]])
) as Record<Provider, ProviderModel[]>;

const METRIC_OPTIONS = [
  { value: 'context_tokens', label: 'Context tokens' },
];

// ── Types ──────────────────────────────────────────────────────────────────────
type TierRow = {
  metric: string;
  above: string;
  input: string;
  output: string;
  cache: string;
};

const EMPTY_TIER: TierRow = {
  metric: 'context_tokens',
  above: '',
  input: '',
  output: '',
  cache: '',
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function generateId(provider: string, modelId: string, existingIds: string[]): string {
  if (!modelId || modelId === '__custom__') return '';
  const base = `${provider}/${modelId}`;
  if (!existingIds.includes(base)) return base;
  let n = 1;
  while (existingIds.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

const EMPTY_FORM = {
  customId: '',
  id: '',
  provider: 'openai' as Provider,
  endpoint: ENDPOINT_DEFAULTS.openai,
  apiKey: '',
  inputPerMillion: '',
  outputPerMillion: '',
  cachePerMillion: '',
  dailyBudget: '',
  monthlyBudget: '',
};

// ── Component ──────────────────────────────────────────────────────────────────
export function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [tierRows, setTierRows] = useState<TierRow[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setModels(await getModels()); } finally { setLoading(false); }
  }

  function applyPreset(provider: Provider, modelId: string) {
    const preset = PROVIDER_MODELS[provider]?.find(m => m.id === modelId);
    if (!preset) {
      setForm(f => ({ ...f, id: modelId, inputPerMillion: '', outputPerMillion: '', cachePerMillion: '' }));
      setTierRows([]); setShowAdvanced(false);
      return;
    }
    setForm(f => ({
      ...f,
      id: modelId,
      inputPerMillion: String(preset.input),
      outputPerMillion: String(preset.output),
      cachePerMillion: preset.cache != null ? String(preset.cache) : '',
    }));
    if (preset.pricingTiers?.length) {
      setTierRows(preset.pricingTiers.map(t => ({
        metric: t.metric,
        above: String(t.above),
        input: String(t.input),
        output: String(t.output),
        cache: t.cache != null ? String(t.cache) : '',
      })));
      setShowAdvanced(true);
    } else {
      setTierRows([]); setShowAdvanced(false);
    }
  }

  function handleProviderChange(provider: Provider) {
    const firstModel = PROVIDER_MODELS[provider]?.[0];
    setIsCustomModel(false);
    setForm({ ...EMPTY_FORM, provider, endpoint: ENDPOINT_DEFAULTS[provider], id: firstModel?.id ?? '' });
    setTierRows([]); setShowAdvanced(false);
    if (firstModel) applyPreset(provider, firstModel.id);
  }

  function handleModelChange(modelId: string) {
    if (modelId === '__custom__') {
      setIsCustomModel(true);
      setForm(f => ({ ...f, id: '', inputPerMillion: '', outputPerMillion: '', cachePerMillion: '', customId: '' }));
      setTierRows([]); setShowAdvanced(false);
      return;
    }
    setIsCustomModel(false);
    setForm(f => ({ ...f, customId: '' }));
    applyPreset(form.provider, modelId);
  }

  function openModal() {
    setEditingModelId(null);
    const firstModel = PROVIDER_MODELS.openai?.[0];
    setIsCustomModel(false); setShowAdvanced(false);
    setErr(''); setShowToken(false); setTierRows([]);
    setForm({ ...EMPTY_FORM, id: firstModel?.id ?? '' });
    if (firstModel) applyPreset('openai', firstModel.id);
    setShowModal(true);
  }

  function editModel(model: Model) {
    setEditingModelId(model.id);
    setIsCustomModel(true);
    setErr(''); setShowToken(false);

    setForm({
      id: model.id,
      customId: '',
      provider: model.provider as Provider,
      endpoint: model.endpoint,
      apiKey: '',
      inputPerMillion: String(model.cost.inputPerMillion),
      outputPerMillion: String(model.cost.outputPerMillion),
      cachePerMillion: model.cost.cachePerMillion != null ? String(model.cost.cachePerMillion) : '',
      dailyBudget: model.globalThresholds?.daily != null ? String(model.globalThresholds.daily) : '',
      monthlyBudget: model.globalThresholds?.monthly != null ? String(model.globalThresholds.monthly) : '',
    });

    if (model.cost.pricingTiers?.length) {
      setTierRows(model.cost.pricingTiers.map(t => ({
        metric: t.metric,
        above: String(t.above),
        input: String(t.inputPerMillion),
        output: String(t.outputPerMillion),
        cache: t.cachePerMillion != null ? String(t.cachePerMillion) : '',
      })));
      setShowAdvanced(true);
    } else {
      setTierRows([]); setShowAdvanced(false);
    }

    setShowModal(true);
  }

  function addTier() {
    setTierRows(rows => [...rows, { ...EMPTY_TIER }]);
    setShowAdvanced(true);
  }

  function removeTier(idx: number) {
    setTierRows(rows => rows.filter((_, i) => i !== idx));
  }

  function updateTier(idx: number, field: keyof TierRow, value: string) {
    setTierRows(rows => rows.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  function effectiveId(): string {
    if (form.customId.trim()) return form.customId.trim();
    return generateId(form.provider, form.id, models.map(m => m.id));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setSaving(true);
    const finalId = editingModelId || effectiveId();
    if (!finalId) { setErr('Model ID required'); setSaving(false); return; }

    const pricingTiersPayload: PricingTier[] = tierRows
      .filter(t => t.above && t.input && t.output)
      .map(t => ({
        metric: t.metric,
        above: parseFloat(t.above),
        inputPerMillion: parseFloat(t.input),
        outputPerMillion: parseFloat(t.output),
        ...(t.cache ? { cachePerMillion: parseFloat(t.cache) } : {}),
      }));

    try {
      const payload = {
        id: finalId,
        provider: form.provider,
        endpoint: form.endpoint,
        ...(form.apiKey ? { apiKey: form.apiKey } : {}),
        inputPerMillion: parseFloat(form.inputPerMillion) || 0,
        outputPerMillion: parseFloat(form.outputPerMillion) || 0,
        ...(form.cachePerMillion ? { cachePerMillion: parseFloat(form.cachePerMillion) } : {}),
        ...(pricingTiersPayload.length ? { pricingTiers: pricingTiersPayload } : {}),
        ...(form.dailyBudget ? { dailyBudget: parseFloat(form.dailyBudget) } : {}),
        ...(form.monthlyBudget ? { monthlyBudget: parseFloat(form.monthlyBudget) } : {}),
      };

      if (editingModelId) {
        await updateModel(editingModelId, payload);
      } else {
        await createModel(payload);
      }
      setShowModal(false); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm(`Remove model "${id}"?`)) return;
    await deleteModel(id);
    setModels(m => m.filter(x => x.id !== id));
  }

  const providerModels = PROVIDER_MODELS[form.provider] ?? [];
  const selectedPreset = providerModels.find(m => m.id === form.id);
  const autoId = form.id ? generateId(form.provider, form.id, models.map(m => m.id)) : '';

  return (
    <>
      <div className="page-header">
        <h1>Models</h1>
        <p>LLM providers registered with LocalRouter</p>
      </div>
      <div className="page-body">
        <div className="toolbar">
          <span className="toolbar-title">{models.length} model{models.length !== 1 ? 's' : ''}</span>
          <button className="btn btn-primary" onClick={openModal}>
            <Plus size={16} /> Add Model
          </button>
        </div>
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : models.length === 0 ? (
          <div className="empty-state"><Server size={40} /><p>No models yet. Add one to get started.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th><th>Provider</th><th>Endpoint</th>
                  <th>Input $/1M</th><th>Output $/1M</th><th>Cache $/1M</th><th>Monthly Budget</th><th></th>
                </tr>
              </thead>
              <tbody>
                {models.map(m => (
                  <tr key={m.id}>
                    <td><span className="mono">{m.id}</span></td>
                    <td><span className={`badge badge-${m.provider}`}>{m.provider}</span></td>
                    <td><span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.endpoint}</span></td>
                    <td>${m.cost.inputPerMillion}</td>
                    <td>${m.cost.outputPerMillion}</td>
                    <td>{m.cost.cachePerMillion != null ? `$${m.cost.cachePerMillion}` : <span className="text-muted">—</span>}</td>
                    <td>{m.globalThresholds?.monthly ? `$${m.globalThresholds.monthly}` : <span className="text-muted">—</span>}</td>
                    <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn-icon" onClick={() => editModel(m)} title="Edit">
                        <Edit2 size={15} />
                      </button>
                      <button className="btn-icon danger" onClick={() => handleDelete(m.id)} title="Remove">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 className="modal-title">{editingModelId ? 'Edit Model' : 'Add Model'}</h2>
            <form onSubmit={handleAdd} autoComplete="off">
              {err && <div className="form-error">{err}</div>}

              {/* ID */}
              <div className="form-group">
                <label className="form-label">
                  ID {editingModelId ? '' : <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional — default: <code style={{ fontSize: '0.78rem' }}>{autoId || `${form.provider}/model`}</code>)</span>}
                </label>
                {editingModelId ? (
                  <input className="form-input" value={editingModelId} disabled style={{ opacity: 0.7 }} />
                ) : (
                  <input className="form-input" value={form.customId} name="modelId" autoComplete="off"
                    onChange={e => setForm(f => ({ ...f, customId: e.target.value }))}
                    placeholder={autoId || `${form.provider}/model`} />
                )}
              </div>

              {/* Provider */}
              <div className="form-group">
                <label className="form-label">Provider</label>
                <select className="form-input" value={form.provider} disabled={!!editingModelId} style={{ opacity: editingModelId ? 0.7 : 1 }}
                  onChange={e => handleProviderChange(e.target.value as Provider)}>
                  {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              {/* Model */}
              {!editingModelId && (
                <div className="form-group">
                  <label className="form-label">Model</label>
                  {providerModels.length > 0 ? (
                    <select className="form-input" value={isCustomModel ? '__custom__' : form.id}
                      onChange={e => handleModelChange(e.target.value)}>
                      {providerModels.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                      <option value="__custom__">— custom model ID —</option>
                    </select>
                  ) : null}
                  {(isCustomModel || providerModels.length === 0) && (
                    <input className="form-input" style={{ marginTop: providerModels.length > 0 ? 6 : 0 }}
                      value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value }))}
                      placeholder="e.g. my-fine-tuned-model" required autoFocus />
                  )}
                  {!isCustomModel && selectedPreset?.notes && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>{selectedPreset.notes}</div>
                  )}
                </div>
              )}

              {/* API Key */}
              <div className="form-group">
                <label className="form-label">Token (API Key)</label>
                <div style={{ position: 'relative' }}>
                  <input className="form-input" type={showToken ? 'text' : 'password'}
                    name="apiKey" autoComplete="new-password"
                    value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                    placeholder={editingModelId ? 'Leave blank to keep existing key' : (form.provider === 'ollama' ? 'not required for local models' : 'sk-…')}
                    style={{ paddingRight: 40 }} />
                  <button type="button" onClick={() => setShowToken(v => !v)}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex', alignItems: 'center' }}>
                    {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Endpoint */}
              <div className="form-group">
                <label className="form-label">Endpoint</label>
                <input className="form-input" value={form.endpoint}
                  onChange={e => setForm(f => ({ ...f, endpoint: e.target.value }))} required />
              </div>

              {/* ── Base Pricing ───────────────────────────────────── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Input $/1M</label>
                  <input className="form-input" type="number" step="any" value={form.inputPerMillion}
                    onChange={e => setForm(f => ({ ...f, inputPerMillion: e.target.value }))} placeholder="5.00" required />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Output $/1M</label>
                  <input className="form-input" type="number" step="any" value={form.outputPerMillion}
                    onChange={e => setForm(f => ({ ...f, outputPerMillion: e.target.value }))} placeholder="15.00" required />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Cache $/1M <span style={{ color: 'var(--text-muted)' }}>(opt.)</span></label>
                  <input className="form-input" type="number" step="any" value={form.cachePerMillion}
                    onChange={e => setForm(f => ({ ...f, cachePerMillion: e.target.value }))} placeholder="—" />
                </div>
              </div>

              {/* ── Budget ─────────────────────────────────────────── */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Daily budget USD <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                  <input className="form-input" type="number" step="any" value={form.dailyBudget}
                    onChange={e => setForm(f => ({ ...f, dailyBudget: e.target.value }))} placeholder="—" />
                </div>
                <div className="form-group">
                  <label className="form-label">Monthly budget USD <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                  <input className="form-input" type="number" step="any" value={form.monthlyBudget}
                    onChange={e => setForm(f => ({ ...f, monthlyBudget: e.target.value }))} placeholder="—" />
                </div>
              </div>

              {/* ── Advanced: Pricing Tiers ─────────────────────────── */}
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <button type="button" onClick={() => setShowAdvanced(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.82rem', fontWeight: 500, padding: '2px 0', userSelect: 'none' }}>
                  <ChevronDown size={15} style={{ transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
                  Advanced — Pricing tiers
                  {tierRows.length > 0 && (
                    <span style={{ marginLeft: 4, background: 'var(--accent)', color: '#fff', fontSize: '0.68rem', borderRadius: 10, padding: '1px 7px' }}>{tierRows.length}</span>
                  )}
                </button>

                {showAdvanced && (
                  <div style={{ marginTop: 12 }}>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                      Override pricing when a metric exceeds a threshold. For example: "Above 200 000 context tokens, prices change."
                    </p>

                    {tierRows.map((tier, idx) => (
                      <div key={idx} style={{ background: 'var(--surface-2, rgba(255,255,255,0.04))', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginBottom: 10, position: 'relative' }}>
                        <button type="button" onClick={() => removeTier(idx)} title="Remove tier"
                          style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex', alignItems: 'center' }}>
                          <X size={14} />
                        </button>

                        {/* Condition: Above X [metric] */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontSize: '0.7rem' }}>Above</label>
                            <input className="form-input" type="number" step="1" value={tier.above}
                              onChange={e => updateTier(idx, 'above', e.target.value)}
                              placeholder="200000" />
                          </div>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontSize: '0.7rem' }}>Metric</label>
                            <select className="form-input" value={tier.metric}
                              onChange={e => updateTier(idx, 'metric', e.target.value)}>
                              {METRIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                        </div>

                        {/* Tier pricing */}
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Override pricing</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontSize: '0.7rem' }}>Input $/1M</label>
                            <input className="form-input" type="number" step="any" value={tier.input}
                              onChange={e => updateTier(idx, 'input', e.target.value)} placeholder="10.00" />
                          </div>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontSize: '0.7rem' }}>Output $/1M</label>
                            <input className="form-input" type="number" step="any" value={tier.output}
                              onChange={e => updateTier(idx, 'output', e.target.value)} placeholder="37.50" />
                          </div>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontSize: '0.7rem' }}>Cache $/1M <span style={{ color: 'var(--text-muted)' }}>(opt.)</span></label>
                            <input className="form-input" type="number" step="any" value={tier.cache}
                              onChange={e => updateTier(idx, 'cache', e.target.value)} placeholder="—" />
                          </div>
                        </div>
                      </div>
                    ))}

                    <button type="button" onClick={addTier}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1.5px dashed var(--border)', borderRadius: 7, cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '7px 14px', width: '100%', justifyContent: 'center', transition: 'border-color 0.15s, color 0.15s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; }}>
                      <Plus size={14} /> Add tier
                    </button>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" /> : (editingModelId ? 'Save Changes' : 'Add Model')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
