import React, { useEffect, useState } from 'react';
import { Plus, Trash2, GripVertical, X, Check } from 'lucide-react';
import { updateProject, getModels, type Model, type Project, type RoutingPolicy } from '../../api';
import { useProject } from './ProjectLayout';
import { SearchableSelect } from '../../components/SearchableSelect';
import { useUnsavedChanges, UnsavedChangesModal } from '../../hooks/useUnsavedChanges';

type TargetModel = {
  internalId: string; // for React keys
  modelId: string;
  prompt: string;
};

type PolicyItem = RoutingPolicy & {
  internalId: string;
};

const ALL_POLICY_TYPES = ['health', 'context', 'capability', 'budget-remaining', 'rate-limit', 'semantic-intent', 'llm', 'performance', 'fairness', 'cheapest'] as const;

const POLICY_LABELS: Record<string, string> = {
  llm:               'AI Routing Policy',
  'rate-limit':      'Rate Limit Policy',
  'budget-remaining':'Budget Remaining Policy',
  'semantic-intent': 'Semantic Intent Policy',
  health:            'Health Policy',
  context:           'Context Policy',
  capability:        'Capability Policy',
  performance:       'Performance Policy',
  fairness:          'Fairness Policy',
  cheapest:          'Cheapest Policy',
};

const POLICY_DESCRIPTIONS: Record<string, string> = {
  context:          'Scores models based on available context window. Assigns 0 to models whose context window is smaller than the estimated request length, preventing truncation errors.',
  cheapest:         'Scores models inversely proportional to their token cost. The cheapest model gets 1.0, the most expensive gets 0.0, helping reduce API spend across requests.',
  health:           'Scores models based on their recent error rate using exponential decay (recent errors weigh more). Applies a circuit breaker that sets the score to 0 when the weighted error rate exceeds a critical threshold.',
  performance:      'Scores models based on their recent average latency using exponential decay. The fastest model gets 1.0, the slowest gets 0.0. Models without recent data default to 1.0.',
  llm:              'Uses an AI model to score candidates based on the semantic content of the request. Supports routing guidance prompts per model and considers budget headroom when limits are configured.',
  capability:       'Hard filter: assigns 0 to models that explicitly lack a feature required by the request (vision, function calling, JSON mode). Models without explicit capability declarations are not penalized.',
  'rate-limit':     'Penalizes models with a high recent call frequency to reduce the risk of hitting provider rate limits (HTTP 429). Supports a configurable hard threshold that forces the score to 0.',
  fairness:         'Distributes traffic evenly by penalizing models that received more successful calls recently. Acts as a soft round-robin to prevent load from concentrating on a single model.',
  'budget-remaining': 'Scores models based on remaining budget headroom across all configured limits. Prefers models with more room before their thresholds are hit, spreading consumption proactively.',
  'semantic-intent':  'Classifies the request by semantic intent using embeddings, then restricts the candidate pool to the models mapped to that intent. Confident matches hard-filter the pool; ambiguous matches merge top-2 pools; unknown requests pass all candidates through.',
};

export function ProjectRoutingTab() {
  const { project, setProject } = useProject();
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const [policies, setPolicies] = useState<PolicyItem[]>([]);
  const [targetModels, setTargetModels] = useState<TargetModel[]>([]);

  // Advanced section open state per policy index
  const [advancedOpen, setAdvancedOpen] = useState<Set<number>>(new Set());

  // Add-intent inline input state per policy index
  const [addIntentInputs, setAddIntentInputs] = useState<Record<number, string>>({});

  // Expanded intent state: which intents are open (keyed by intentName)
  const [expandedIntents, setExpandedIntents] = useState<Set<string>>(new Set());

  // Show-all-examples toggle: keyed by `${policyIdx}::${intentName}`
  const [showAllExamples, setShowAllExamples] = useState<Set<string>>(new Set());

  // Add-example inline input state: keyed by `${policyIdx}::${intentName}`
  const [addExampleInputs, setAddExampleInputs] = useState<Record<string, string>>({});

  // Drag state
  const [draggedTargetIdx, setDraggedTargetIdx] = useState<number | null>(null);
  const [draggedPolicyIdx, setDraggedPolicyIdx] = useState<number | null>(null);
  const [draggedLlmModelIdx, setDraggedLlmModelIdx] = useState<number | null>(null);
  const [draggedSemModelIdx, setDraggedSemModelIdx] = useState<number | null>(null);
  const [promptHoverIdx, setPromptHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    getModels()
      .then(m => setAvailableModels(m))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (project) {
      const mkId = () => Math.random().toString(36).substring(7);

      if (project.policies && project.policies.length > 0) {
        setPolicies(project.policies.map(p => ({ ...p, internalId: mkId() })));
      } else {
        setPolicies([]);
      }

      setTargetModels(project.models.map(m => ({
        internalId: Math.random().toString(36).substring(7),
        modelId: m.modelId,
        prompt: m.prompt || '',
      })));
    }
  }, [project]);

  const isDirty = (() => {
    if (!project) return false;

    const savedPolicies = project.policies || [];
    if (policies.length !== savedPolicies.length) return true;
    for (let i = 0; i < policies.length; i++) {
      const p1 = policies[i]!;
      const p2 = savedPolicies[i]!;
      if (p1.type !== p2.type || p1.enabled !== p2.enabled) return true;
      if (JSON.stringify(p1.config || {}) !== JSON.stringify(p2.config || {})) return true;
    }

    const savedTargets = project.models || [];
    if (targetModels.length !== savedTargets.length) return true;
    if (targetModels.some((t, i) => t.modelId !== savedTargets[i]!.modelId || t.prompt !== (savedTargets[i]!.prompt || ''))) return true;
    return false;
  })();

  const { isBlocked, proceed, reset } = useUnsavedChanges(isDirty);

  // --- Helpers for used model IDs ---
  function getUsedTargetModelIds(excludeIdx: number): Set<string> {
    const used = new Set<string>();
    targetModels.forEach((m, i) => { if (i !== excludeIdx) used.add(m.modelId); });
    return used;
  }

  // --- Semantic Intent / Model association helpers ---
  function getIntentsForModel(modelId: string): Set<string> {
    const result = new Set<string>();
    const semPolicy = policies.find(p => p.type === 'semantic-intent' && p.enabled);
    if (!semPolicy) return result;
    const intents = (semPolicy.config?.intents ?? {}) as Record<string, { candidate_models: string[] }>;
    for (const [key, def] of Object.entries(intents)) {
      if (def.candidate_models?.includes(modelId)) result.add(key);
    }
    return result;
  }

  function toggleIntentForModel(modelId: string, intentKey: string) {
    const semPolicyIdx = policies.findIndex(p => p.type === 'semantic-intent' && p.enabled);
    if (semPolicyIdx === -1) return;
    const semPolicy = policies[semPolicyIdx]!;
    const intents = { ...((semPolicy.config?.intents ?? {}) as Record<string, { examples: string[]; candidate_models: string[] }>) };
    const def = intents[intentKey];
    if (!def) return;
    const current = def.candidate_models ?? [];
    const next = current.includes(modelId)
      ? current.filter(id => id !== modelId)
      : [...current, modelId];
    intents[intentKey] = { ...def, candidate_models: next };
    updatePolicyConfig(semPolicyIdx, { intents });
  }

  // --- Semantic Intent Embedding Model Helpers ---
  function getSemModelIds(policy: PolicyItem): string[] {
    const primary = policy.config?.embedding_model;
    const fallbacks: string[] = policy.config?.embedding_fallback_models ?? [];
    const ids = primary ? [primary, ...fallbacks] : fallbacks;
    return ids.length === 0 ? [''] : ids;
  }

  function setSemModelIds(policyIdx: number, newIds: string[]) {
    updatePolicyConfig(policyIdx, {
      embedding_model: newIds[0] ?? '',
      embedding_fallback_models: newIds.slice(1),
    });
  }

  function onDragStartSemModel(e: React.DragEvent, mIdx: number) {
    setDraggedSemModelIdx(mIdx);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
      const el = document.getElementById(`sem-model-row-${mIdx}`);
      if (el) el.style.opacity = '0.4';
    }, 0);
  }

  function onDragEnterSemModel(e: React.DragEvent, policyIdx: number, targetIdx: number) {
    e.preventDefault();
    if (draggedSemModelIdx === null || draggedSemModelIdx === targetIdx) return;
    const pol = policies[policyIdx]!;
    const ids = getSemModelIds(pol);
    const copy = [...ids];
    const dragged = copy[draggedSemModelIdx]!;
    copy.splice(draggedSemModelIdx, 1);
    copy.splice(targetIdx, 0, dragged);
    setSemModelIds(policyIdx, copy);
    setDraggedSemModelIdx(targetIdx);
  }

  function onDragEndSemModel(_e: React.DragEvent, mIdx: number) {
    setDraggedSemModelIdx(null);
    const el = document.getElementById(`sem-model-row-${mIdx}`);
    if (el) el.style.opacity = '1';
  }

  // --- LLM Routing Model Helpers ---
  function getLlmModelIds(policy: PolicyItem): string[] {
    const primary = policy.config?.routingModelId;
    const fallbacks: string[] = policy.config?.fallbackModelIds ?? [];
    return primary ? [primary, ...fallbacks] : fallbacks;
  }

  function setLlmModelIds(policyIdx: number, newIds: string[]) {
    updatePolicyConfig(policyIdx, {
      routingModelId: newIds[0] ?? '',
      fallbackModelIds: newIds.slice(1),
    });
  }

  function onDragStartLlmModel(e: React.DragEvent, mIdx: number) {
    setDraggedLlmModelIdx(mIdx);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
      const el = document.getElementById(`llm-model-row-${mIdx}`);
      if (el) el.style.opacity = '0.4';
    }, 0);
  }

  function onDragEnterLlmModel(e: React.DragEvent, policyIdx: number, targetIdx: number) {
    e.preventDefault();
    if (draggedLlmModelIdx === null || draggedLlmModelIdx === targetIdx) return;
    const policy = policies[policyIdx]!;
    const ids = getLlmModelIds(policy);
    const copy = [...ids];
    const dragged = copy[draggedLlmModelIdx]!;
    copy.splice(draggedLlmModelIdx, 1);
    copy.splice(targetIdx, 0, dragged);
    setLlmModelIds(policyIdx, copy);
    setDraggedLlmModelIdx(targetIdx);
  }

  function onDragEndLlmModel(_e: React.DragEvent, mIdx: number) {
    setDraggedLlmModelIdx(null);
    const el = document.getElementById(`llm-model-row-${mIdx}`);
    if (el) el.style.opacity = '1';
  }

  // --- Policy Handlers ---
  function updatePolicy(idx: number, field: keyof PolicyItem, value: any) {
    setPolicies(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }

  function updatePolicyConfig(idx: number, configUpdates: any) {
    setPolicies(prev => prev.map((p, i) => i === idx ? { ...p, config: { ...(p.config || {}), ...configUpdates } } : p));
  }

  // Policy Drag Drop
  function onDragStartPolicy(e: React.DragEvent, idx: number) {
    setDraggedPolicyIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
      const el = document.getElementById(`policy-row-${idx}`);
      if (el) el.style.opacity = '0.4';
    }, 0);
  }
  function onDragEnterPolicy(e: React.DragEvent, targetIdx: number) {
    e.preventDefault();
    if (draggedPolicyIdx === null || draggedPolicyIdx === targetIdx) return;
    setPolicies(prev => {
      const copy = [...prev];
      const draggedItem = copy[draggedPolicyIdx]!;
      copy.splice(draggedPolicyIdx, 1);
      copy.splice(targetIdx, 0, draggedItem);
      return copy;
    });
    setDraggedPolicyIdx(targetIdx);
  }
  function onDragEndPolicy(e: React.DragEvent, idx: number) {
    setDraggedPolicyIdx(null);
    const el = document.getElementById(`policy-row-${idx}`);
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

  // --- Policy Add/Remove ---
  function addPolicy(type: string) {
    const mkId = () => Math.random().toString(36).substring(7);
    let config: Record<string, unknown> | undefined;
    if (type === 'semantic-intent') config = { embedding_provider: 'openai', embedding_model: '', intents: {} };
    else if (type === 'llm') config = { routingModelId: project?.routingModelId || '', fallbackModelIds: project?.fallbackRoutingModelIds || [], autoRouting: true };
    setPolicies(prev => [...prev, { internalId: mkId(), type: type as PolicyItem['type'], enabled: true, ...(config ? { config } : {}) }]);
  }

  function removePolicy(idx: number) {
    setPolicies(prev => prev.filter((_, i) => i !== idx));
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

  async function doSave() {
    if (!project) return;
    setErr('');

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
        policies: policies.map(p => {
          const { internalId, ...rest } = p;
          return { ...rest, enabled: true };
        }),
        models: targetModels.map(m => ({
          modelId: m.modelId,
          ...(m.prompt.trim() ? { prompt: m.prompt.trim() } : {}),
        })),
        ...(project.timeoutMs !== undefined && { timeoutMs: project.timeoutMs }),
      };
      const updated = await updateProject(project.id, payload);
      setProject(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Error saving project routing');
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void doSave();
  }

  const isAiRoutingEnabled = policies.some(p => p.type === 'llm' && p.enabled);
  const isAutoRoutingEnabled = policies.find(p => p.type === 'llm')?.config?.autoRouting ?? true;
  const showPromptInput = isAiRoutingEnabled && !isAutoRoutingEnabled;

  const semanticIntentPolicy = policies.find(p => p.type === 'semantic-intent' && p.enabled);
  const isSemanticIntentEnabled = !!semanticIntentPolicy;
  const semanticIntents = isSemanticIntentEnabled
    ? (semanticIntentPolicy!.config?.intents ?? {}) as Record<string, { examples: string[]; candidate_models: string[] }>
    : {};

  if (loading) return (
    <div style={{ maxWidth: 768, animation: 'fade-in 0.2s ease' }} className="loading-center">
      <div className="spinner" />
    </div>
  );

  return (
    <>
      <form onSubmit={handleSubmit} style={{ maxWidth: 800 }}>
        {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24 }}>
          <div className="form-group">
            <label className="form-label">Routing Policies</label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
              Policies determine how requests are routed. They are executed in order from top to bottom.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {policies.map((policy, idx) => (
                <div
                  key={policy.internalId}
                  id={`policy-row-${idx}`}
                  draggable
                  onDragStart={(e) => onDragStartPolicy(e, idx)}
                  onDragEnter={(e) => onDragEnterPolicy(e, idx)}
                  onDragEnd={(e) => onDragEndPolicy(e, idx)}
                  onDragOver={(e) => e.preventDefault()}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 10,
                    background: 'var(--surface-active)', padding: '12px',
                    borderRadius: 8, border: '1px solid var(--border)',
                    cursor: 'grab', transition: 'opacity 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ color: 'var(--text-muted)' }}><GripVertical size={16} /></div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, textTransform: 'capitalize' }}>
                        {policy.type === 'llm' ? 'AI Routing'
                          : policy.type === 'rate-limit' ? 'Rate Limit'
                          : policy.type === 'budget-remaining' ? 'Budget Remaining'
                          : policy.type === 'semantic-intent' ? 'Semantic Intent'
                          : policy.type} Policy
                      </div>
                      {POLICY_DESCRIPTIONS[policy.type] && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>
                          {POLICY_DESCRIPTIONS[policy.type]}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removePolicy(idx)}
                      title="Remove policy"
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Policy Specific Configs */}
                  {policy.type === 'llm' && policy.enabled && (
                    <div style={{ paddingLeft: 30, paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>Routing Models</label>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8, marginTop: -4 }}>The first model is the primary. The others are tried in order if the primary fails.</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {getLlmModelIds(policy).map((modelId, mIdx) => {
                            const usedIds = new Set(getLlmModelIds(policy).filter((_, i) => i !== mIdx));
                            const opts = availableModels
                              .filter(m => !usedIds.has(m.id))
                              .sort((a, b) => a.id.localeCompare(b.id))
                              .map(m => ({ value: m.id, label: m.id }));
                            return (
                              <div
                                key={mIdx}
                                id={`llm-model-row-${mIdx}`}
                                draggable
                                onDragStart={e => onDragStartLlmModel(e, mIdx)}
                                onDragEnter={e => onDragEnterLlmModel(e, idx, mIdx)}
                                onDragEnd={e => onDragEndLlmModel(e, mIdx)}
                                onDragOver={e => e.preventDefault()}
                                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'grab', transition: 'opacity 0.2s' }}
                              >
                                <div style={{ color: 'var(--text-muted)', flexShrink: 0 }}><GripVertical size={14} /></div>
                                <SearchableSelect
                                  options={opts}
                                  value={modelId}
                                  onChange={val => {
                                    const ids = getLlmModelIds(policy);
                                    const copy = [...ids];
                                    copy[mIdx] = val;
                                    setLlmModelIds(idx, copy);
                                  }}
                                  placeholder="Select model"
                                  style={{ flex: 1 }}
                                />
                                {mIdx === 0 && (
                                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0, minWidth: 48, textAlign: 'right' }}>primary</span>
                                )}
                                <button
                                  type="button"
                                  className="btn-icon danger"
                                  disabled={getLlmModelIds(policy).length === 1}
                                  onClick={() => {
                                    const ids = getLlmModelIds(policy).filter((_, i) => i !== mIdx);
                                    setLlmModelIds(idx, ids);
                                  }}
                                  style={{ padding: 4, flexShrink: 0, opacity: getLlmModelIds(policy).length === 1 ? 0.3 : 1 }}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const usedIds = new Set(getLlmModelIds(policy));
                            const firstAvail = availableModels.find(m => !usedIds.has(m.id));
                            if (firstAvail) setLlmModelIds(idx, [...getLlmModelIds(policy), firstAvail.id]);
                          }}
                          disabled={availableModels.filter(m => !new Set(getLlmModelIds(policy)).has(m.id)).length === 0}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'none', border: '1px dashed var(--border)', borderRadius: 4, color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer', marginTop: 6, width: 'fit-content', opacity: availableModels.filter(m => !new Set(getLlmModelIds(policy)).has(m.id)).length === 0 ? 0.4 : 1 }}
                        >
                          <Plus size={12} /> Add Fallback Model
                        </button>
                      </div>

                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}>
                          <input
                            type="checkbox"
                            checked={policy.config?.autoRouting ?? true}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              updatePolicyConfig(idx, { autoRouting: checked, ...(checked ? { additionalPromptInfo: undefined } : {}) });
                            }}
                            style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }}
                          />
                          Auto Routing
                        </label>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4, marginLeft: 22, lineHeight: 1.4, marginBottom: !(policy.config?.autoRouting ?? true) ? 8 : 12 }}>
                          If enabled, traffic is distributed without custom prompts. If disabled, you can write specific prompts instructing the AI when to select each target model.
                        </p>
                        {!(policy.config?.autoRouting ?? true) && (
                          <div style={{ marginLeft: 22, marginBottom: 12 }}>
                            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Additional Prompt Info <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                            <textarea
                              className="form-input"
                              rows={3}
                              placeholder="Extra instructions to include in the routing prompt..."
                              value={policy.config?.additionalPromptInfo ?? ''}
                              onChange={e => updatePolicyConfig(idx, { additionalPromptInfo: e.target.value })}
                              onMouseDown={e => e.stopPropagation()}
                              onDragStart={e => e.preventDefault()}
                              style={{ width: '100%', resize: 'vertical', fontSize: '0.8rem', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box', cursor: 'text' }}
                            />
                          </div>
                        )}
                      </div>

                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        <details
                          open={advancedOpen.has(idx)}
                          onToggle={(e) => {
                            const open = (e.currentTarget as HTMLDetailsElement).open;
                            setAdvancedOpen(prev => {
                              const next = new Set(prev);
                              open ? next.add(idx) : next.delete(idx);
                              return next;
                            });
                          }}
                        >
                          <summary style={{ fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer', userSelect: 'none', color: 'var(--text-secondary)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: '0.7rem', display: 'inline-block', transform: advancedOpen.has(idx) ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>▶</span> Advanced
                          </summary>
                          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 0 }}>

                            <div style={{ paddingBottom: 10 }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}>
                                <input
                                  type="checkbox"
                                  checked={policy.config?.memory ?? false}
                                  onChange={(e) => updatePolicyConfig(idx, { memory: e.target.checked })}
                                  style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }}
                                />
                                Memory
                              </label>
                              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4, marginLeft: 22, lineHeight: 1.4, marginBottom: (policy.config?.memory ?? false) ? 8 : 0 }}>
                                If enabled, the last N messages from the conversation history are included in the routing prompt to give the AI router additional context.
                              </p>
                              {(policy.config?.memory ?? false) && (
                                <div style={{ marginLeft: 22, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Previous messages</label>
                                  <input
                                    type="number"
                                    min={1}
                                    max={50}
                                    className="form-input"
                                    style={{ width: 70, padding: '4px 8px', fontSize: '0.8rem' }}
                                    value={policy.config?.memoryCount ?? 5}
                                    onChange={e => updatePolicyConfig(idx, { memoryCount: Math.max(1, Number(e.target.value)) })}
                                    onMouseDown={e => e.stopPropagation()}
                                  />
                                </div>
                              )}
                            </div>

                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, paddingBottom: 10 }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}>
                                <input
                                  type="checkbox"
                                  checked={policy.config?.thinking ?? false}
                                  onChange={(e) => updatePolicyConfig(idx, { thinking: e.target.checked })}
                                  style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }}
                                />
                                Thinking
                              </label>
                              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4, marginLeft: 22, lineHeight: 1.4, marginBottom: 0 }}>
                                If enabled and the routing model supports it, extended thinking is used for more accurate routing decisions. This increases latency significantly.
                              </p>
                            </div>

                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, paddingBottom: 10 }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}>
                                <input
                                  type="checkbox"
                                  checked={policy.config?.includeReason ?? false}
                                  onChange={(e) => updatePolicyConfig(idx, { includeReason: e.target.checked })}
                                  style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }}
                                />
                                Include Reason
                              </label>
                              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4, marginLeft: 22, lineHeight: 1.4, marginBottom: 0 }}>
                                If enabled, the routing model adds a brief explanation for each score. Useful for debugging but increases output tokens.
                              </p>
                            </div>

                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, paddingBottom: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', minWidth: 160 }}>Max completion tokens</label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  className="form-input"
                                  style={{ width: 80, padding: '4px 8px', fontSize: '0.8rem' }}
                                  placeholder="auto"
                                  value={policy.config?.maxCompletionTokens ?? ''}
                                  onChange={e => {
                                    const v = e.target.value.replace(/[^0-9]/g, '');
                                    updatePolicyConfig(idx, { maxCompletionTokens: v === '' ? undefined : Number(v) });
                                  }}
                                  onBlur={e => {
                                    const v = e.target.value.replace(/[^0-9]/g, '');
                                    if (v !== '' && Number(v) < 50) updatePolicyConfig(idx, { maxCompletionTokens: 50 });
                                  }}
                                  onMouseDown={e => e.stopPropagation()}
                                />
                              </div>
                              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4, marginBottom: 0, lineHeight: 1.4 }}>
                                Limits the routing model output tokens. Leave empty to use the provider default.
                              </p>
                            </div>

                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', minWidth: 160 }}>Max prompt chars</label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  className="form-input"
                                  style={{ width: 80, padding: '4px 8px', fontSize: '0.8rem' }}
                                  placeholder="auto"
                                  value={policy.config?.maxUserMessageChars ?? ''}
                                  onChange={e => {
                                    const v = e.target.value.replace(/[^0-9]/g, '');
                                    updatePolicyConfig(idx, { maxUserMessageChars: v === '' ? undefined : Number(v) });
                                  }}
                                  onMouseDown={e => e.stopPropagation()}
                                />
                              </div>
                              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4, marginBottom: 0, lineHeight: 1.4 }}>
                                Truncates the routing prompt after this many characters. Leave empty for no limit.
                              </p>
                            </div>

                          </div>
                        </details>
                      </div>

                    </div>
                  )}

                  {policy.type === 'semantic-intent' && policy.enabled && (
                    <div style={{ paddingLeft: 30, paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>

                      {/* --- Embedding Model --- */}
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>Embedding Models</label>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8, marginTop: -4 }}>The first model is the primary. The others are tried in order if the primary fails.</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {getSemModelIds(policy).map((modelId, mIdx) => {
                            const embeddingModels = availableModels.filter(m => m.capabilities?.embedding === true);
                            const usedIds = new Set(getSemModelIds(policy).filter((_, i) => i !== mIdx));
                            const opts = embeddingModels
                              .filter(m => !usedIds.has(m.id))
                              .sort((a, b) => a.id.localeCompare(b.id))
                              .map(m => ({ value: m.id, label: m.id }));
                            return (
                              <div
                                key={mIdx}
                                id={`sem-model-row-${mIdx}`}
                                draggable
                                onDragStart={e => onDragStartSemModel(e, mIdx)}
                                onDragEnter={e => onDragEnterSemModel(e, idx, mIdx)}
                                onDragEnd={e => onDragEndSemModel(e, mIdx)}
                                onDragOver={e => e.preventDefault()}
                                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'grab', transition: 'opacity 0.2s' }}
                              >
                                <div style={{ color: 'var(--text-muted)', flexShrink: 0 }}><GripVertical size={14} /></div>
                                <SearchableSelect
                                  options={opts}
                                  value={modelId}
                                  onChange={val => {
                                    const ids = getSemModelIds(policy);
                                    const copy = [...ids];
                                    copy[mIdx] = val;
                                    setSemModelIds(idx, copy);
                                  }}
                                  placeholder="Select model"
                                  style={{ flex: 1 }}
                                />
                                {mIdx === 0 && (
                                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0, minWidth: 48, textAlign: 'right' }}>primary</span>
                                )}
                                <button
                                  type="button"
                                  className="btn-icon danger"
                                  disabled={getSemModelIds(policy).length === 1}
                                  onClick={() => {
                                    const ids = getSemModelIds(policy).filter((_, i) => i !== mIdx);
                                    setSemModelIds(idx, ids);
                                  }}
                                  style={{ padding: 4, flexShrink: 0, opacity: getSemModelIds(policy).length === 1 ? 0.3 : 1 }}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const embeddingModels = availableModels.filter(m => m.capabilities?.embedding === true);
                            const usedIds = new Set(getSemModelIds(policy));
                            const firstAvail = embeddingModels.find(m => !usedIds.has(m.id));
                            if (firstAvail) setSemModelIds(idx, [...getSemModelIds(policy), firstAvail.id]);
                          }}
                          disabled={availableModels.filter(m => m.capabilities?.embedding === true && !new Set(getSemModelIds(policy)).has(m.id)).length === 0}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'none', border: '1px dashed var(--border)', borderRadius: 4, color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer', marginTop: 6, width: 'fit-content', opacity: availableModels.filter(m => m.capabilities?.embedding === true && !new Set(getSemModelIds(policy)).has(m.id)).length === 0 ? 0.4 : 1 }}
                        >
                          <Plus size={12} /> Add Fallback Model
                        </button>
                      </div>

                      {/* --- Intents --- */}
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Intents</label>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
                          Each intent groups example utterances that represent a category of requests. The closer a user message is to an intent's examples, the higher its score.
                        </p>
                        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                          {Object.entries((policy.config?.intents ?? {}) as Record<string, { examples: string[]; candidate_models: string[] }>).map(([intentName, intentDef], iIdx, arr) => {
                            const isExpanded = expandedIntents.has(intentName);
                            const exampleKey = `${idx}::${intentName}`;
                            return (
                              <div
                                key={intentName}
                                style={{
                                  borderBottom: iIdx < arr.length - 1 ? '1px solid var(--border)' : undefined,
                                  background: 'var(--surface)',
                                }}
                              >
                                {/* Intent header row */}
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                    userSelect: 'none',
                                  }}
                                  onClick={() => setExpandedIntents(prev => {
                                    const next = new Set(prev);
                                    next.has(intentName) ? next.delete(intentName) : next.add(intentName);
                                    return next;
                                  })}
                                >
                                  <span style={{ fontSize: '0.65rem', display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease', color: 'var(--text-muted)', flexShrink: 0 }}>▶</span>
                                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                                  <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                                    {intentName.replace(/_/g, ' ')}
                                  </span>
                                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginRight: 4 }}>
                                    {intentDef.examples?.length ?? 0} example{(intentDef.examples?.length ?? 0) !== 1 ? 's' : ''}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const intents = { ...((policy.config?.intents ?? {}) as Record<string, unknown>) };
                                      delete intents[intentName];
                                      updatePolicyConfig(idx, { intents });
                                    }}
                                    style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', borderRadius: 4, flexShrink: 0 }}
                                    title="Remove intent"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>

                                {/* Expanded: examples list */}
                                {isExpanded && (
                                  <div style={{ padding: '0 12px 10px 36px' }}>
                                    {(intentDef.examples ?? []).length === 0 && (
                                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: '4px 0 8px' }}>
                                        No examples yet. Add representative phrases below.
                                      </p>
                                    )}
                                    {(() => {
                                      const examples = intentDef.examples ?? [];
                                      const PAGE = 5;
                                      const showAll = showAllExamples.has(exampleKey);
                                      const visible = showAll ? examples : examples.slice(0, PAGE);
                                      const hidden = examples.length - PAGE;
                                      return (
                                        <>
                                          {visible.map((ex, exIdx) => (
                                            <div key={exIdx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border-light, rgba(128,128,128,0.1))', borderRadius: 4, transition: 'background 0.1s ease' }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(128,128,128,0.06)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', width: 22, textAlign: 'right', flexShrink: 0, fontFamily: 'monospace' }}>{exIdx + 1}.</span>
                                              <input
                                                type="text"
                                                value={ex}
                                                onChange={e => {
                                                  const intents = { ...((policy.config?.intents ?? {}) as Record<string, { examples: string[]; candidate_models: string[] }>) };
                                                  const def = intents[intentName];
                                                  if (!def) return;
                                                  const newExamples = [...def.examples];
                                                  newExamples[exIdx] = e.target.value;
                                                  intents[intentName] = { ...def, examples: newExamples };
                                                  updatePolicyConfig(idx, { intents });
                                                }}
                                                onMouseDown={e => e.stopPropagation()}
                                                onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
                                                style={{
                                                  flex: 1,
                                                  fontSize: '0.8rem',
                                                  color: 'var(--text-primary)',
                                                  lineHeight: 1.4,
                                                  background: 'none',
                                                  border: '1px solid transparent',
                                                  borderRadius: 4,
                                                  outline: 'none',
                                                  padding: '3px 6px',
                                                  transition: 'border-color 0.15s ease',
                                                }}
                                                onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                                                onBlur={e => { e.currentTarget.style.borderColor = 'transparent'; }}
                                              />
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const intents = { ...((policy.config?.intents ?? {}) as Record<string, { examples: string[]; candidate_models: string[] }>) };
                                                  const def = intents[intentName];
                                                  if (!def) return;
                                                  intents[intentName] = { ...def, examples: def.examples.filter((_, i) => i !== exIdx) };
                                                  updatePolicyConfig(idx, { intents });
                                                }}
                                                style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', flexShrink: 0, opacity: 0.5 }}
                                                title="Remove example"
                                              >
                                                <X size={12} />
                                              </button>
                                            </div>
                                          ))}
                                          {!showAll && hidden > 0 && (
                                            <button
                                              type="button"
                                              onClick={() => setShowAllExamples(prev => new Set(prev).add(exampleKey))}
                                              style={{ background: 'none', border: 'none', padding: '6px 0 2px', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--accent)', opacity: 0.8 }}
                                            >
                                              + {hidden} more example{hidden !== 1 ? 's' : ''}
                                            </button>
                                          )}
                                          {showAll && examples.length > PAGE && (
                                            <button
                                              type="button"
                                              onClick={() => setShowAllExamples(prev => { const n = new Set(prev); n.delete(exampleKey); return n; })}
                                              style={{ background: 'none', border: 'none', padding: '6px 0 2px', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-muted)' }}
                                            >
                                              Show less
                                            </button>
                                          )}
                                        </>
                                      );
                                    })()}
                                    {/* Add example input */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                                      <Plus size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                      <input
                                        type="text"
                                        placeholder="Add example and press Enter…"
                                        value={addExampleInputs[exampleKey] ?? ''}
                                        onChange={e => setAddExampleInputs(prev => ({ ...prev, [exampleKey]: e.target.value }))}
                                        onMouseDown={e => e.stopPropagation()}
                                        onKeyDown={e => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault();
                                            const text = addExampleInputs[exampleKey]?.trim();
                                            if (!text) return;
                                            const intents = { ...((policy.config?.intents ?? {}) as Record<string, { examples: string[]; candidate_models: string[] }>) };
                                            const def = intents[intentName];
                                            if (!def) return;
                                            intents[intentName] = { ...def, examples: [...def.examples, text] };
                                            updatePolicyConfig(idx, { intents });
                                            setAddExampleInputs(prev => ({ ...prev, [exampleKey]: '' }));
                                          } else if (e.key === 'Escape') {
                                            setAddExampleInputs(prev => ({ ...prev, [exampleKey]: '' }));
                                          }
                                        }}
                                        style={{ flex: 1, background: 'none', border: '1px solid var(--border)', borderRadius: 4, outline: 'none', fontSize: '0.8rem', color: 'var(--text-primary)', padding: '4px 8px' }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--surface-2, rgba(255,255,255,0.03))' }}>
                            <Plus size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                            <input
                              type="text"
                              placeholder="Add intent and press Enter…"
                              value={addIntentInputs[idx] ?? ''}
                              onChange={e => setAddIntentInputs(prev => ({ ...prev, [idx]: e.target.value }))}
                              onMouseDown={e => e.stopPropagation()}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  const raw = addIntentInputs[idx];
                                  if (!raw?.trim()) return;
                                  const key = raw.trim().toLowerCase().replace(/\s+/g, '_');
                                  const intents = { ...((policy.config?.intents ?? {}) as Record<string, unknown>) };
                                  if (!intents[key]) {
                                    intents[key] = { examples: [], candidate_models: [] };
                                    updatePolicyConfig(idx, { intents });
                                    setExpandedIntents(prev => new Set(prev).add(key));
                                  }
                                  setAddIntentInputs(prev => ({ ...prev, [idx]: '' }));
                                } else if (e.key === 'Escape') {
                                  setAddIntentInputs(prev => ({ ...prev, [idx]: '' }));
                                }
                              }}
                              onBlur={() => {
                                const raw = addIntentInputs[idx];
                                if (raw?.trim()) {
                                  const key = raw.trim().toLowerCase().replace(/\s+/g, '_');
                                  const intents = { ...((policy.config?.intents ?? {}) as Record<string, unknown>) };
                                  if (!intents[key]) {
                                    intents[key] = { examples: [], candidate_models: [] };
                                    updatePolicyConfig(idx, { intents });
                                    setExpandedIntents(prev => new Set(prev).add(key));
                                  }
                                }
                                setAddIntentInputs(prev => ({ ...prev, [idx]: '' }));
                              }}
                              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: '0.82rem', color: 'var(--text-primary)', padding: 0 }}
                            />
                          </div>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                          Names are normalized automatically (e.g. "Customer Support" → <code style={{ fontSize: '0.7rem' }}>customer_support</code>)
                        </div>
                      </div>

                      {/* --- Advanced (thresholds) --- */}
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        <details
                          open={advancedOpen.has(idx)}
                          onToggle={(e) => {
                            const open = (e.currentTarget as HTMLDetailsElement).open;
                            setAdvancedOpen(prev => {
                              const next = new Set(prev);
                              open ? next.add(idx) : next.delete(idx);
                              return next;
                            });
                          }}
                        >
                          <summary style={{ fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer', userSelect: 'none', color: 'var(--text-secondary)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: '0.7rem', display: 'inline-block', transform: advancedOpen.has(idx) ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>▶</span> Advanced
                          </summary>
                          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 0 }}>

                            <div style={{ paddingBottom: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', minWidth: 160 }}>Confidence threshold</label>
                                <input
                                  type="number"
                                  min={0} max={1} step={0.05}
                                  className="form-input"
                                  style={{ width: 80, padding: '4px 8px', fontSize: '0.8rem' }}
                                  value={policy.config?.absolute_threshold ?? 0.60}
                                  onChange={e => updatePolicyConfig(idx, { absolute_threshold: Number(e.target.value) })}
                                  onMouseDown={e => e.stopPropagation()}
                                />
                              </div>
                              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, marginBottom: 0, lineHeight: 1.4 }}>
                                Minimum cosine similarity score to consider a classification valid. Below this, the result is "unknown" and no filtering is applied.
                              </p>
                            </div>

                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, paddingBottom: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', minWidth: 160 }}>Ambiguity margin</label>
                                <input
                                  type="number"
                                  min={0} max={0.5} step={0.01}
                                  className="form-input"
                                  style={{ width: 80, padding: '4px 8px', fontSize: '0.8rem' }}
                                  value={policy.config?.ambiguity_threshold ?? 0.08}
                                  onChange={e => updatePolicyConfig(idx, { ambiguity_threshold: Number(e.target.value) })}
                                  onMouseDown={e => e.stopPropagation()}
                                />
                              </div>
                              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, marginBottom: 0, lineHeight: 1.4 }}>
                                Minimum gap between the top and second-best intent. If the margin is smaller, the classification is "ambiguous" and the candidate pools of both intents are merged.
                              </p>
                            </div>

                          </div>
                        </details>
                      </div>

                    </div>
                  )}

                  {policy.type === 'fairness' && policy.enabled && (
                    <div style={{ paddingLeft: 30, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Window (minutes)</label>
                        <input
                          type="number" min={1} max={1440}
                          className="form-input"
                          style={{ width: 80, padding: '4px 8px', fontSize: '0.8rem' }}
                          value={policy.config?.windowMinutes ?? 60}
                          onChange={e => updatePolicyConfig(idx, { windowMinutes: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                  )}
                  {policy.type === 'rate-limit' && policy.enabled && (
                    <div style={{ paddingLeft: 30, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Window (minutes)</label>
                          <input
                            type="number" min={1} max={60}
                            className="form-input"
                            style={{ width: 80, padding: '4px 8px', fontSize: '0.8rem' }}
                            value={policy.config?.windowMinutes ?? 1}
                            onChange={e => updatePolicyConfig(idx, { windowMinutes: Number(e.target.value) })}
                          />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Max calls per window</label>
                          <input
                            type="number" min={1}
                            className="form-input"
                            style={{ width: 80, padding: '4px 8px', fontSize: '0.8rem' }}
                            placeholder="none"
                            value={policy.config?.maxCallsPerWindow ?? ''}
                            onChange={e => {
                              const v = e.target.value;
                              updatePolicyConfig(idx, { maxCallsPerWindow: v === '' ? undefined : Number(v) });
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}


                </div>
              ))}

              {policies.length === 0 && (
                <div style={{ textAlign: 'center', padding: '20px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  No routing policies configured.
                </div>
              )}
            </div>

            {/* Add Policy */}
            <div style={{ marginTop: 10, border: '1.5px dashed var(--border)', borderRadius: 8, padding: '6px 10px' }}>
              <SearchableSelect
                options={ALL_POLICY_TYPES
                  .filter(t => !policies.some(p => p.type === t))
                  .map(t => ({ value: t, label: POLICY_LABELS[t] ?? t, description: POLICY_DESCRIPTIONS[t] }))}
                value=""
                onChange={addPolicy}
                placeholder="Add a policy..."
                disabled={ALL_POLICY_TYPES.every(t => policies.some(p => p.type === t))}
              />
            </div>
          </div>
        </div>

        <div style={{ margin: '32px 0 24px', borderTop: '1px solid var(--border)' }} />

        {/* Target Models Section */}
        <div className="form-group">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Target Models</span>
          </label>

          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
            Define the pool of models that the Policies will filter and select from. Optional prompts instruct the AI Router on when to pick each model.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {targetModels.map((item, idx) => (
              <div
                key={item.internalId}
                id={`target-row-${idx}`}
                draggable={promptHoverIdx !== idx}
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
                  cursor: promptHoverIdx === idx ? 'default' : 'grab',
                  transition: 'opacity 0.2s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 6, color: 'var(--text-muted)' }}>
                  <GripVertical size={18} />
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Endpoint Model</label>
                    <SearchableSelect
                      value={item.modelId}
                      onChange={v => updateTargetModel(idx, 'modelId', v)}
                      placeholder="Select model"
                      options={availableModels
                        .filter(m => m.id === item.modelId || !getUsedTargetModelIds(idx).has(m.id))
                        .sort((a, b) => a.id.localeCompare(b.id))
                        .map(m => ({ value: m.id, label: m.id }))}
                    />
                  </div>

                  {showPromptInput && (
                    <div
                      className="form-group"
                      style={{ margin: 0 }}
                      onMouseEnter={() => setPromptHoverIdx(idx)}
                      onMouseLeave={() => setPromptHoverIdx(null)}
                    >
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Prompt Definition</label>
                      <textarea
                        className="form-input"
                        value={item.prompt}
                        onChange={e => updateTargetModel(idx, 'prompt', e.target.value)}
                        placeholder="Describe exactly when and why the router should pick this model..."
                        rows={2}
                        style={{ fontSize: '0.9rem', resize: 'vertical', minHeight: '60px' }}
                      />
                    </div>
                  )}

                  {isSemanticIntentEnabled && Object.keys(semanticIntents).length > 0 && (
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>Intents</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {Object.keys(semanticIntents).map(intentKey => {
                          const active = getIntentsForModel(item.modelId).has(intentKey);
                          return (
                            <button
                              key={intentKey}
                              type="button"
                              onClick={() => toggleIntentForModel(item.modelId, intentKey)}
                              style={{
                                padding: '3px 10px',
                                borderRadius: 12,
                                border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                                background: active ? 'var(--primary)' : 'transparent',
                                color: active ? '#fff' : 'var(--text-secondary)',
                                fontSize: '0.72rem',
                                cursor: 'pointer',
                                fontFamily: 'monospace',
                                transition: 'all 0.15s',
                              }}
                            >
                              {intentKey}
                            </button>
                          );
                        })}
                      </div>
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
              'Save Routing Configuration'
            )}
          </button>
        </div>
      </form>

      {isBlocked && <UnsavedChangesModal onConfirm={proceed} onCancel={reset} />}
    </>
  );
}
