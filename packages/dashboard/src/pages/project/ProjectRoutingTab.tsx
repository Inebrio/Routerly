import React, { useEffect, useState } from 'react';
import { Plus, Trash2, GripVertical, Info } from 'lucide-react';
import { updateProject, getModels, type Model, type Project } from '../../api';
import { useProject } from './ProjectLayout';
import { useUnsavedChanges, UnsavedChangesModal } from '../../hooks/useUnsavedChanges';

type TargetModel = {
  internalId: string; // for React keys
  modelId: string;
  prompt: string;
};

type FallbackModel = {
  internalId: string;
  modelId: string;
};

export function ProjectRoutingTab() {
  const { project, setProject } = useProject();
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const [routingModelId, setRoutingModelId] = useState('');
  const [autoRouting, setAutoRouting] = useState(true);
  const [fallbackModels, setFallbackModels] = useState<FallbackModel[]>([]);
  const [targetModels, setTargetModels] = useState<TargetModel[]>([]);

  // Drag state
  const [draggedTargetIdx, setDraggedTargetIdx] = useState<number | null>(null);
  const [draggedFallbackIdx, setDraggedFallbackIdx] = useState<number | null>(null);

  useEffect(() => {
    getModels()
      .then(m => setAvailableModels(m))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (project) {
      setRoutingModelId(project.routingModelId);
      setAutoRouting(project.autoRouting ?? true);

      const fallbacks = project.fallbackRoutingModelIds || [];
      setFallbackModels(fallbacks.map(id => ({
        internalId: Math.random().toString(36).substring(7),
        modelId: id
      })));

      setTargetModels(project.models.map(m => ({
        internalId: Math.random().toString(36).substring(7),
        modelId: m.modelId,
        prompt: m.prompt || '',
      })));
    }
  }, [project]);

  const isDirty = (() => {
    if (!project) return false;
    if (routingModelId !== project.routingModelId) return true;
    if (autoRouting !== (project.autoRouting ?? true)) return true;
    const savedFallbacks = project.fallbackRoutingModelIds || [];
    if (fallbackModels.length !== savedFallbacks.length) return true;
    if (fallbackModels.some((f, i) => f.modelId !== savedFallbacks[i])) return true;
    const savedTargets = project.models || [];
    if (targetModels.length !== savedTargets.length) return true;
    if (targetModels.some((t, i) => t.modelId !== savedTargets[i].modelId || t.prompt !== (savedTargets[i].prompt || ''))) return true;
    return false;
  })();

  const { isBlocked, proceed, reset } = useUnsavedChanges(isDirty);

  // --- Helpers for used model IDs ---
  function getUsedFallbackModelIds(excludeIdx: number): Set<string> {
    const used = new Set<string>();
    used.add(routingModelId);
    fallbackModels.forEach((m, i) => { if (i !== excludeIdx) used.add(m.modelId); });
    return used;
  }

  function getUsedTargetModelIds(excludeIdx: number): Set<string> {
    const used = new Set<string>();
    targetModels.forEach((m, i) => { if (i !== excludeIdx) used.add(m.modelId); });
    return used;
  }

  // --- Fallback Models Handlers ---
  function addFallbackModel() {
    const usedIds = new Set([routingModelId, ...fallbackModels.map(f => f.modelId)]);
    const firstAvailable = availableModels.find(m => !usedIds.has(m.id));
    setFallbackModels(prev => [
      ...prev,
      {
        internalId: Math.random().toString(36).substring(7),
        modelId: firstAvailable?.id || availableModels[0]?.id || ''
      }
    ]);
  }

  function updateFallbackModel(idx: number, modelId: string) {
    setFallbackModels(prev => prev.map((m, i) => i === idx ? { ...m, modelId } : m));
  }

  function removeFallbackModel(idx: number) {
    setFallbackModels(prev => prev.filter((_, i) => i !== idx));
  }

  // Fallback Drag Drop
  function onDragStartFallback(e: React.DragEvent, idx: number) {
    setDraggedFallbackIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
      const el = document.getElementById(`fallback-row-${idx}`);
      if (el) el.style.opacity = '0.4';
    }, 0);
  }
  function onDragEnterFallback(e: React.DragEvent, targetIdx: number) {
    e.preventDefault();
    if (draggedFallbackIdx === null || draggedFallbackIdx === targetIdx) return;
    setFallbackModels(prev => {
      const copy = [...prev];
      const draggedItem = copy[draggedFallbackIdx]!;
      copy.splice(draggedFallbackIdx, 1);
      copy.splice(targetIdx, 0, draggedItem);
      return copy;
    });
    setDraggedFallbackIdx(targetIdx);
  }
  function onDragEndFallback(e: React.DragEvent, idx: number) {
    setDraggedFallbackIdx(null);
    const el = document.getElementById(`fallback-row-${idx}`);
    if (el) el.style.opacity = '1';
  }

  // --- Target Models Handlers ---
  function addTargetModel() {
    const usedIds = new Set(targetModels.map(t => t.modelId));
    const firstAvailable = availableModels.find(m => !usedIds.has(m.id));
    setTargetModels(prev => [
      ...prev,
      {
        internalId: Math.random().toString(36).substring(7),
        modelId: firstAvailable?.id || availableModels[0]?.id || '',
        prompt: '',
      }
    ]);
  }

  function updateTargetModel(idx: number, field: keyof TargetModel, value: string) {
    setTargetModels(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  }

  function removeTargetModel(idx: number) {
    setTargetModels(prev => prev.filter((_, i) => i !== idx));
  }

  // Target Drag Drop
  function onDragStartTarget(e: React.DragEvent, idx: number) {
    setDraggedTargetIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
      const el = document.getElementById(`target-row-${idx}`);
      if (el) el.style.opacity = '0.4';
    }, 0);
  }
  function onDragEnterTarget(e: React.DragEvent, targetIdx: number) {
    e.preventDefault();
    if (draggedTargetIdx === null || draggedTargetIdx === targetIdx) return;
    setTargetModels(prev => {
      const copy = [...prev];
      const draggedItem = copy[draggedTargetIdx]!;
      copy.splice(draggedTargetIdx, 1);
      copy.splice(targetIdx, 0, draggedItem);
      return copy;
    });
    setDraggedTargetIdx(targetIdx);
  }
  function onDragEndTarget(e: React.DragEvent, idx: number) {
    setDraggedTargetIdx(null);
    const el = document.getElementById(`target-row-${idx}`);
    if (el) el.style.opacity = '1';
  }

  // --------------------------------

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;
    setErr('');

    // Validate: fallback models cannot repeat or equal base routing model
    const fallbackIds = fallbackModels.map(f => f.modelId);
    if (fallbackIds.includes(routingModelId)) {
      setErr('A fallback model cannot be the same as the base routing model.');
      return;
    }
    if (new Set(fallbackIds).size !== fallbackIds.length) {
      setErr('Fallback models cannot contain duplicates.');
      return;
    }

    // Validate: target models cannot repeat
    const targetIds = targetModels.map(t => t.modelId);
    if (new Set(targetIds).size !== targetIds.length) {
      setErr('Target models cannot contain duplicates.');
      return;
    }

    setSaving(true);
    try {
      const payload: Parameters<typeof updateProject>[1] = {
        name: project.name,
        routingModelId,
        autoRouting,
        ...(fallbackModels.length > 0 && { fallbackRoutingModelIds: fallbackModels.map(f => f.modelId) }),
        models: targetModels.map(m => ({
          modelId: m.modelId,
          ...(!autoRouting && m.prompt.trim() ? { prompt: m.prompt.trim() } : {}),
        })),
        ...(project.timeoutMs !== undefined && { timeoutMs: project.timeoutMs }),
      };
      const updated = await updateProject(project.id, payload);
      setProject(updated);
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Error saving project routing');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <>
    <form onSubmit={handleSubmit} style={{ maxWidth: 800 }}>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 24 }}>
        {/* Base Routing Model */}
        <div className="form-group">
          <label className="form-label">Base Routing Model</label>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
            The primary logic model used to determine the correct destination.
          </p>
          <select
            className="form-input"
            value={routingModelId}
            onChange={e => {
              setRoutingModelId(e.target.value);
            }}
            required
          >
            {availableModels.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
          </select>
        </div>

        {/* Fallback Routing Models */}
        <div className="form-group">
          <label className="form-label">Fallback Routing Models <span style={{ color: 'var(--text-muted)' }}>(opt.)</span></label>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
            Ordered list of models to try if the primary router fails.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {fallbackModels.map((item, idx) => (
              <div
                key={item.internalId}
                id={`fallback-row-${idx}`}
                draggable
                onDragStart={(e) => onDragStartFallback(e, idx)}
                onDragEnter={(e) => onDragEnterFallback(e, idx)}
                onDragEnd={(e) => onDragEndFallback(e, idx)}
                onDragOver={(e) => e.preventDefault()}
                style={{
                  display: 'flex', gap: 8, alignItems: 'center',
                  background: 'var(--surface-active)', padding: '6px 6px',
                  borderRadius: 6, border: '1px solid var(--border)',
                  cursor: 'grab', transition: 'opacity 0.2s'
                }}
              >
                <div style={{ color: 'var(--text-muted)' }}>
                  <GripVertical size={14} />
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>#{idx + 1}</div>
                <select
                  className="form-input"
                  style={{ flex: 1, padding: '4px 8px', fontSize: '0.8rem', minHeight: 0 }}
                  value={item.modelId}
                  onChange={e => updateFallbackModel(idx, e.target.value)}
                  required
                >
                  <option value="" disabled>Select model</option>
                  {availableModels
                    .filter(m => m.id === item.modelId || !getUsedFallbackModelIds(idx).has(m.id))
                    .map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => removeFallbackModel(idx)}
                  className="btn-icon danger" style={{ padding: 4 }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addFallbackModel}
            disabled={availableModels.filter(m => m.id !== routingModelId && !fallbackModels.some(f => f.modelId === m.id)).length === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '6px', marginTop: fallbackModels.length > 0 ? 8 : 0,
              background: 'none', border: '1px dashed var(--border)', borderRadius: 6,
              color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer',
              opacity: availableModels.filter(m => m.id !== routingModelId && !fallbackModels.some(f => f.modelId === m.id)).length === 0 ? 0.4 : 1,
            }}
          >
            <Plus size={14} /> Add Fallback
          </button>
        </div>
      </div>

      <div style={{ margin: '32px 0 24px', borderTop: '1px solid var(--border)' }} />

      {/* Target Models Section */}
      <div className="form-group">
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Target Models</span>

          <label
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}
          >
            <input
              type="checkbox"
              checked={autoRouting}
              onChange={(e) => setAutoRouting(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--primary)', cursor: 'pointer' }}
            />
            Auto Routing
          </label>
        </label>

        {autoRouting && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px', background: 'var(--surface-active)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 16 }}>
            <Info size={16} style={{ color: 'var(--info)', marginTop: 2, flexShrink: 0 }} />
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
              Auto Routing is enabled. The router will automatically distribute traffic among these targets according to traditional load-balancing strategies (or random choice). Prompts are not needed.
            </p>
          </div>
        )}
        {!autoRouting && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
            Define the models that the router can choose from. Describe in the prompt exactly when the router should pick each model. Drag to reorder.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {targetModels.map((item, idx) => (
            <div
              key={item.internalId}
              id={`target-row-${idx}`}
              draggable
              onDragStart={(e) => onDragStartTarget(e, idx)}
              onDragEnter={(e) => onDragEnterTarget(e, idx)}
              onDragEnd={(e) => onDragEndTarget(e, idx)}
              onDragOver={(e) => e.preventDefault()}
              style={{
                display: 'flex',
                gap: 12,
                background: 'var(--surface-active)',
                padding: '12px 12px 12px 6px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                cursor: 'grab',
                transition: 'opacity 0.2s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 6, color: 'var(--text-muted)' }}>
                <GripVertical size={18} />
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Endpoint Model</label>
                  <select
                    className="form-input"
                    value={item.modelId}
                    onChange={e => updateTargetModel(idx, 'modelId', e.target.value)}
                    required
                    style={{ padding: '6px 10px', fontSize: '0.9rem' }}
                  >
                    <option value="" disabled>Select model</option>
                    {availableModels
                      .filter(m => m.id === item.modelId || !getUsedTargetModelIds(idx).has(m.id))
                      .map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                  </select>
                </div>

                {!autoRouting && (
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Prompt Definition</label>
                    <textarea
                      className="form-input"
                      value={item.prompt}
                      onChange={e => updateTargetModel(idx, 'prompt', e.target.value)}
                      placeholder="Describe exactly when and why the router should pick this model..."
                      rows={2}
                      style={{ fontSize: '0.9rem', resize: 'vertical', minHeight: '60px' }}
                      required={!autoRouting}
                    />
                  </div>
                )}
              </div>

              <div style={{ paddingTop: 20 }}>
                <button
                  type="button"
                  onClick={() => removeTargetModel(idx)}
                  className="btn-icon danger"
                  title="Remove target model"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}

          {targetModels.length === 0 && (
            <div className="empty-state" style={{ padding: 24, fontSize: '0.9rem' }}>
              No target models configured.
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={addTargetModel}
          disabled={availableModels.filter(m => !targetModels.some(t => t.modelId === m.id)).length === 0}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
            width: '100%', padding: '10px', marginTop: 12,
            background: 'none', border: '1.5px dashed var(--border)', borderRadius: 8,
            color: 'var(--text-secondary)', fontSize: '0.9rem', cursor: 'pointer',
            transition: 'all 0.2s',
            opacity: availableModels.filter(m => !targetModels.some(t => t.modelId === m.id)).length === 0 ? 0.4 : 1,
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--primary)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--primary)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)';
          }}
        >
          <Plus size={16} /> Add Target Model
        </button>
      </div>

      <div style={{ marginTop: 32 }}>
        <button type="submit" className="btn btn-primary" disabled={saving || !isDirty}>
          {saving ? <span className="spinner" /> : 'Save Routing Configuration'}
        </button>
      </div>
    </form>

    {isBlocked && <UnsavedChangesModal onConfirm={proceed} onCancel={reset} />}
    </>
  );
}
