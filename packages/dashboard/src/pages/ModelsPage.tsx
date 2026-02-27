import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Server, Eye, EyeOff } from 'lucide-react';
import { getModels, createModel, deleteModel, type Model } from '../api';
import providersConf from '../conf/providers.json';

type Provider = keyof typeof providersConf;

const PROVIDERS = Object.keys(providersConf) as Provider[];

const ENDPOINT_DEFAULTS = Object.fromEntries(
  PROVIDERS.map(p => [p, providersConf[p].endpoint])
) as Record<Provider, string>;

const PROVIDER_MODELS = Object.fromEntries(
  PROVIDERS.map(p => [p, providersConf[p].models as { id: string; input: number; output: number }[]])
) as Record<Provider, { id: string; input: number; output: number }[]>;

const DEFAULT_FORM = {
  id: '', provider: 'openai' as Provider,
  endpoint: ENDPOINT_DEFAULTS.openai,
  apiKey: '', inputPerMillion: '', outputPerMillion: '',
  dailyBudget: '', monthlyBudget: '',
};

export function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isCustomModel, setIsCustomModel] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setModels(await getModels()); } finally { setLoading(false); }
  }

  function handleProviderChange(provider: Provider) {
    const providerModels = PROVIDER_MODELS[provider];
    const firstModel = providerModels[0];
    setIsCustomModel(false);
    setForm(f => ({
      ...f,
      provider,
      endpoint: ENDPOINT_DEFAULTS[provider],
      id: firstModel ? firstModel.id : '',
      inputPerMillion: firstModel ? String(firstModel.input) : '',
      outputPerMillion: firstModel ? String(firstModel.output) : '',
    }));
  }

  function handleModelChange(id: string) {
    if (id === '__custom__') {
      setIsCustomModel(true);
      setForm(f => ({ ...f, id: '', inputPerMillion: '', outputPerMillion: '' }));
      return;
    }
    setIsCustomModel(false);
    const providerModels = PROVIDER_MODELS[form.provider];
    const preset = providerModels.find(m => m.id === id);
    setForm(f => ({
      ...f, id,
      ...(preset ? { inputPerMillion: String(preset.input), outputPerMillion: String(preset.output) } : {}),
    }));
  }

  function openModal() {
    const firstModel = PROVIDER_MODELS.openai[0];
    setForm({
      ...DEFAULT_FORM,
      id: firstModel ? firstModel.id : '',
      inputPerMillion: firstModel ? String(firstModel.input) : '',
      outputPerMillion: firstModel ? String(firstModel.output) : '',
    });
    setErr('');
    setShowToken(false);
    setIsCustomModel(false);
    setShowModal(true);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      await createModel({
        id: form.id,
        provider: form.provider,
        endpoint: form.endpoint,
        ...(form.apiKey ? { apiKey: form.apiKey } : {}),
        inputPerMillion: parseFloat(form.inputPerMillion) || 0,
        outputPerMillion: parseFloat(form.outputPerMillion) || 0,
        ...(form.dailyBudget ? { dailyBudget: parseFloat(form.dailyBudget) } : {}),
        ...(form.monthlyBudget ? { monthlyBudget: parseFloat(form.monthlyBudget) } : {}),
      });
      setShowModal(false);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm(`Remove model "${id}"?`)) return;
    await deleteModel(id);
    setModels(m => m.filter(x => x.id !== id));
  }

  const providerModels = PROVIDER_MODELS[form.provider];

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
                  <th>Input $/1M</th><th>Output $/1M</th><th>Monthly Budget</th><th></th>
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
                    <td>{m.globalThresholds?.monthly ? `$${m.globalThresholds.monthly}` : <span className="text-muted">—</span>}</td>
                    <td>
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
          <div className="modal">
            <h2 className="modal-title">Add Model</h2>
            <form onSubmit={handleAdd}>
              {err && <div className="form-error">{err}</div>}

              {/* Provider selector */}
              <div className="form-group">
                <label className="form-label">Provider</label>
                <select
                  className="form-input"
                  value={form.provider}
                  onChange={e => handleProviderChange(e.target.value as Provider)}
                >
                  {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              {/* Model selector — dropdown if known models exist, free-text otherwise */}
              <div className="form-group">
                <label className="form-label">Model</label>
                {providerModels.length > 0 ? (
                  <select
                    className="form-input"
                    value={isCustomModel ? '__custom__' : form.id}
                    onChange={e => handleModelChange(e.target.value)}
                  >
                    {providerModels.map(m => (
                      <option key={m.id} value={m.id}>{m.id}</option>
                    ))}
                    <option value="__custom__">— custom model ID —</option>
                  </select>
                ) : null}
                {/* Free-text input: always shown for "custom" provider, or when user picks custom */}
                {(isCustomModel || providerModels.length === 0) && (
                  <input
                    className="form-input"
                    style={{ marginTop: providerModels.length > 0 ? 6 : 0 }}
                    value={form.id}
                    onChange={e => setForm(f => ({ ...f, id: e.target.value }))}
                    placeholder="e.g. my-fine-tuned-model"
                    required
                    autoFocus
                  />
                )}
              </div>

              {/* Token / API Key with show/hide */}
              <div className="form-group">
                <label className="form-label">Token (API Key)</label>
                <div style={{ position: 'relative' }}>
                  <input
                    className="form-input"
                    type={showToken ? 'text' : 'password'}
                    value={form.apiKey}
                    onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                    placeholder={form.provider === 'ollama' ? 'not required for local models' : 'sk-...'}
                    style={{ paddingRight: 40 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(v => !v)}
                    title={showToken ? 'Hide token' : 'Show token'}
                    style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', padding: 0, display: 'flex', alignItems: 'center',
                    }}
                  >
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

              {/* Pricing */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Input $/1M tokens</label>
                  <input className="form-input" type="number" step="any" value={form.inputPerMillion}
                    onChange={e => setForm(f => ({ ...f, inputPerMillion: e.target.value }))} placeholder="5.00" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Output $/1M tokens</label>
                  <input className="form-input" type="number" step="any" value={form.outputPerMillion}
                    onChange={e => setForm(f => ({ ...f, outputPerMillion: e.target.value }))} placeholder="15.00" required />
                </div>
              </div>

              {/* Budgets */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Daily budget (USD, optional)</label>
                  <input className="form-input" type="number" step="any" value={form.dailyBudget}
                    onChange={e => setForm(f => ({ ...f, dailyBudget: e.target.value }))} placeholder="—" />
                </div>
                <div className="form-group">
                  <label className="form-label">Monthly budget (USD, optional)</label>
                  <input className="form-input" type="number" step="any" value={form.monthlyBudget}
                    onChange={e => setForm(f => ({ ...f, monthlyBudget: e.target.value }))} placeholder="—" />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" /> : 'Add Model'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
