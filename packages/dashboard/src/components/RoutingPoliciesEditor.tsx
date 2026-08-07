import React, { useState } from 'react';
import { Plus, Trash2, GripVertical, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Model, RoutingPolicy } from '../api';
import { SearchableSelect } from './SearchableSelect';

export type PolicyItem = RoutingPolicy & {
  internalId: string;
};

export const ALL_POLICY_TYPES = ['health', 'context', 'capability', 'budget-remaining', 'rate-limit', 'semantic-intent', 'llm', 'performance', 'fairness', 'cheapest', 'model-preference'] as const;

export function policyLabel(t: TFunction, type: string): string {
  return t(`common.routingPolicies.labels.${type}`, { defaultValue: `${type} Policy` });
}

export function policyDescription(t: TFunction, type: string): string {
  return t(`common.routingPolicies.descriptions.${type}`, { defaultValue: '' });
}

export function mkPolicyId(): string {
  return Math.random().toString(36).substring(7);
}

interface RoutingPoliciesEditorProps {
  policies: PolicyItem[];
  setPolicies: React.Dispatch<React.SetStateAction<PolicyItem[]>>;
  /** Model pool the policy configs pick their routing and embedding models from. */
  availableModels: Model[];
  /** Seeds a freshly added AI Routing policy. Routers pass their own routing model. */
  llmDefaults?: { routingModelId?: string; fallbackModelIds?: string[] };
}

/**
 * Ordered list of routing policies with their per-type config forms. Shared by
 * the router routing tab (inline router policies) and the profile form page
 * (profile policies), so both edit routing the exact same way.
 */
export function RoutingPoliciesEditor({ policies, setPolicies, availableModels, llmDefaults }: RoutingPoliciesEditorProps) {
  const { t } = useTranslation();
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
  const [draggedPolicyIdx, setDraggedPolicyIdx] = useState<number | null>(null);
  const [draggedLlmModelIdx, setDraggedLlmModelIdx] = useState<number | null>(null);
  const [draggedSemModelIdx, setDraggedSemModelIdx] = useState<number | null>(null);

  function updatePolicyConfig(idx: number, configUpdates: any) {
    setPolicies(prev => prev.map((p, i) => {
      /* v8 ignore next */
      if (i !== idx) return p;
      /* v8 ignore next */
      const base = p.config || {};
      return { ...p, config: { ...base, ...configUpdates } };
    }));
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
      /* v8 ignore next */
      embedding_model: newIds[0] ?? '',
      embedding_fallback_models: newIds.slice(1),
    });
  }

  function onDragStartSemModel(e: React.DragEvent, mIdx: number) {
    setDraggedSemModelIdx(mIdx);
    e.dataTransfer.effectAllowed = 'move';
    /* v8 ignore next 3 */
    setTimeout(() => {
      const el = document.getElementById(`sem-model-row-${mIdx}`);
      if (el) el.style.opacity = '0.4';
    }, 0);
  }

  function onDragEnterSemModel(e: React.DragEvent, policyIdx: number, targetIdx: number) {
    e.preventDefault();
    /* v8 ignore next */
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
    /* v8 ignore next */
    if (el) el.style.opacity = '1';
  }

  // --- LLM Routing Model Helpers ---
  function getLlmModelIds(policy: PolicyItem): string[] {
    const primary = policy.config?.routingModelId;
    /* v8 ignore next */
    const fallbacks: string[] = policy.config?.fallbackModelIds ?? [];
    return primary ? [primary, ...fallbacks] : fallbacks;
  }

  function setLlmModelIds(policyIdx: number, newIds: string[]) {
    updatePolicyConfig(policyIdx, {
      /* v8 ignore next */
      routingModelId: newIds[0] ?? '',
      fallbackModelIds: newIds.slice(1),
    });
  }

  function onDragStartLlmModel(e: React.DragEvent, mIdx: number) {
    setDraggedLlmModelIdx(mIdx);
    e.dataTransfer.effectAllowed = 'move';
    /* v8 ignore next 3 */
    setTimeout(() => {
      const el = document.getElementById(`llm-model-row-${mIdx}`);
      if (el) el.style.opacity = '0.4';
    }, 0);
  }

  function onDragEnterLlmModel(e: React.DragEvent, policyIdx: number, targetIdx: number) {
    e.preventDefault();
    /* v8 ignore next */
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
    /* v8 ignore next */
    if (el) el.style.opacity = '1';
  }

  // Policy Drag Drop
  function onDragStartPolicy(e: React.DragEvent, idx: number) {
    setDraggedPolicyIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    /* v8 ignore next 3 */
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
    /* v8 ignore next */
    if (el) el.style.opacity = '1';
  }

  // --- Policy Add/Remove ---
  function addPolicy(type: string) {
    let config: Record<string, unknown> | undefined;
    if (type === 'semantic-intent') config = { embedding_provider: 'openai', embedding_model: '', intents: {} };
    else if (type === 'llm') config = { routingModelId: llmDefaults?.routingModelId || '', fallbackModelIds: llmDefaults?.fallbackModelIds || [], autoRouting: true };
    setPolicies(prev => [...prev, { internalId: mkPolicyId(), type: type as PolicyItem['type'], enabled: true, ...(config ? { config } : {}) }]);
  }

  function removePolicy(idx: number) {
    setPolicies(prev => prev.filter((_, i) => i !== idx));
  }

  return (
          <div className="form-group">
            <label className="form-label">{t('common.routingPolicies.title')}</label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
              {t('common.routingPolicies.subtitle')}
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
                  /* v8 ignore next */
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
                        {policyLabel(t, policy.type)}
                      </div>
                      {policyDescription(t, policy.type) && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>
                          {policyDescription(t, policy.type)}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removePolicy(idx)}
                      title={t('common.routingPolicies.removePolicy')}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Policy Specific Configs */}
                  {policy.type === 'llm' && policy.enabled && (
                    <div style={{ paddingLeft: 30, paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>{t('common.routingPolicies.routingModels')}</label>
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
                                /* v8 ignore next */
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
                                  placeholder={t('common.routingPolicies.selectModel')}
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
                            /* v8 ignore next */
                          if (firstAvail) setLlmModelIds(idx, [...getLlmModelIds(policy), firstAvail.id]);
                          }}
                          disabled={availableModels.filter(m => !new Set(getLlmModelIds(policy)).has(m.id)).length === 0}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'none', border: '1px dashed var(--border)', borderRadius: 4, color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer', marginTop: 6, width: 'fit-content', opacity: availableModels.filter(m => !new Set(getLlmModelIds(policy)).has(m.id)).length === 0 ? 0.4 : 1 }}
                        >
                          <Plus size={12} /> {t('common.routingPolicies.addFallbackModel')}
                        </button>
                      </div>

                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}>
                          <input
                            type="checkbox"
                            checked={policy.config?.autoRouting /* v8 ignore next */ ?? true}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              updatePolicyConfig(idx, { autoRouting: checked, ...(checked ? { additionalPromptInfo: undefined } : {}) });
                            }}
                            style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }}
                          />
                          Auto Routing
                        </label>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4, marginLeft: 22, lineHeight: 1.4, marginBottom: !(policy.config?.autoRouting /* v8 ignore next */ ?? true) ? 8 : 12 }}>
                          If enabled, traffic is distributed without custom prompts. If disabled, you can write specific prompts instructing the AI when to select each target model.
                        </p>
                        {!(policy.config?.autoRouting /* v8 ignore next */ ?? true) && (
                          <div style={{ marginLeft: 22, marginBottom: 12 }}>
                            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Additional Prompt Info <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                            <textarea
                              className="form-input"
                              rows={3}
                              placeholder="Extra instructions to include in the routing prompt..."
                              value={policy.config?.additionalPromptInfo ?? ''}
                              onChange={e => updatePolicyConfig(idx, { additionalPromptInfo: e.target.value })}
                              /* v8 ignore next 2 */
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
                                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{t('common.routingPolicies.previousMessages')}</label>
                                  <input
                                    type="number"
                                    min={1}
                                    max={50}
                                    className="form-input"
                                    style={{ width: 70, padding: '4px 8px', fontSize: '0.8rem' }}
                                    value={policy.config?.memoryCount ?? 5}
                                    onChange={e => updatePolicyConfig(idx, { memoryCount: Math.max(1, Number(e.target.value)) })}
                                    /* v8 ignore next */
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
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', minWidth: 160 }}>{t('common.routingPolicies.maxCompletionTokens')}</label>
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
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', minWidth: 160 }}>{t('common.routingPolicies.maxPromptChars')}</label>
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

                      {/* --- Caching --- */}
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}>
                          <input
                            type="checkbox"
                            checked={policy.config?.cache?.enabled ?? false}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              updatePolicyConfig(idx, {
                                cache: {
                                  ...(policy.config?.cache ?? { embedding_provider: 'openai', embedding_model: '', ttl_seconds: 3600, similarity_threshold: 0.85 }),
                                  enabled: checked,
                                },
                              });
                            }}
                            onMouseDown={e => e.stopPropagation()}
                            style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }}
                          />
                          Caching
                        </label>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4, marginLeft: 22, lineHeight: 1.4 }}>
                          If enabled, responses are cached using semantic similarity. Requests with a similar meaning return the cached response directly, skipping the provider call.
                        </p>
                        {(policy.config?.cache?.enabled ?? false) && (() => {
                          const cacheModelIds = (() => {
                            const primary = policy.config?.cache?.embedding_model;
                            const fallbacks: string[] = policy.config?.cache?.embedding_fallback_models ?? [];
                            const ids = primary ? [primary, ...fallbacks] : fallbacks;
                            return ids.length === 0 ? [''] : ids;
                          })();
                          const setCacheModelIds = (newIds: string[]) => {
                            /* v8 ignore next */
                            const existingCache = policy.config?.cache ?? {};
                            /* v8 ignore next */
                            const newPrimary = newIds[0] ?? '';
                            updatePolicyConfig(idx, {
                              cache: {
                                ...existingCache,
                                embedding_model: newPrimary,
                                embedding_fallback_models: newIds.slice(1),
                              },
                            });
                          };
                          return (
                            <div style={{ marginLeft: 22, marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {/* Embedding Models */}
                              <div>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>{t('common.routingPolicies.embeddingModels')}</label>
                                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6, marginTop: -2 }}>The first model is the primary. The others are tried in order if the primary fails.</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {cacheModelIds.map((modelId, mIdx) => {
                                    const embeddingModels = availableModels.filter(m => m.capabilities?.embedding === true);
                                    const usedIds = new Set(cacheModelIds.filter((_, i) => i !== mIdx));
                                    const opts = embeddingModels
                                      .filter(m => !usedIds.has(m.id))
                                      .sort((a, b) => a.id.localeCompare(b.id))
                                      .map(m => ({ value: m.id, label: m.id }));
                                    return (
                                      <div key={mIdx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <SearchableSelect
                                          options={opts}
                                          value={modelId}
                                          onChange={val => {
                                            const copy = [...cacheModelIds];
                                            copy[mIdx] = val;
                                            setCacheModelIds(copy);
                                          }}
                                          placeholder={t('common.routingPolicies.selectModel')}
                                          style={{ flex: 1 }}
                                        />
                                        {mIdx === 0 && (
                                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0, minWidth: 48, textAlign: 'right' }}>primary</span>
                                        )}
                                        <button
                                          type="button"
                                          className="btn-icon danger"
                                          disabled={cacheModelIds.length === 1}
                                          onClick={() => setCacheModelIds(cacheModelIds.filter((_, i) => i !== mIdx))}
                                          onMouseDown={e => e.stopPropagation()}
                                          style={{ padding: 4, flexShrink: 0, opacity: cacheModelIds.length === 1 ? 0.3 : 1 }}
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
                                    const usedIds = new Set(cacheModelIds);
                                    const firstAvail = embeddingModels.find(m => !usedIds.has(m.id));
                                    /* v8 ignore next */
                                    if (firstAvail) setCacheModelIds([...cacheModelIds, firstAvail.id]);
                                  }}
                                  disabled={availableModels.filter(m => m.capabilities?.embedding === true && !new Set(cacheModelIds).has(m.id)).length === 0}
                                  onMouseDown={e => e.stopPropagation()}
                                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'none', border: '1px dashed var(--border)', borderRadius: 4, color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer', marginTop: 6, width: 'fit-content' }}
                                >
                                  <Plus size={12} /> {t('common.routingPolicies.addFallbackModel')}
                                </button>
                              </div>
                              {/* TTL + Threshold */}
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>TTL (seconds)</label>
                                  <input
                                    type="number"
                                    min={1}
                                    className="form-input"
                                    style={{ width: 72, padding: '4px 8px', fontSize: '0.8rem' }}
                                    value={policy.config?.cache?.ttl_seconds ?? 3600}
                                    onChange={e => {
                                      /* v8 ignore next */
                                      const c = policy.config?.cache ?? {};
                                      updatePolicyConfig(idx, { cache: { ...c, ttl_seconds: Number(e.target.value) } });
                                    }}
                                    onMouseDown={e => e.stopPropagation()}
                                  />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{t('common.routingPolicies.similarityThreshold')}</label>
                                  <input
                                    type="number"
                                    min={0} max={1} step={0.01}
                                    className="form-input"
                                    style={{ width: 72, padding: '4px 8px', fontSize: '0.8rem' }}
                                    value={policy.config?.cache?.similarity_threshold ?? 0.85}
                                    onChange={e => {
                                      /* v8 ignore next */
                                      const c = policy.config?.cache ?? {};
                                      updatePolicyConfig(idx, { cache: { ...c, similarity_threshold: Number(e.target.value) } });
                                    }}
                                    onMouseDown={e => e.stopPropagation()}
                                  />
                                </div>
                              </div>
                              {/* Extend on hit */}
                              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                <input
                                  type="checkbox"
                                  checked={policy.config?.cache?.extend_on_hit ?? false}
                                  onChange={e => {
                                    /* v8 ignore next */
                                    const c = policy.config?.cache ?? {};
                                    updatePolicyConfig(idx, { cache: { ...c, extend_on_hit: e.target.checked } });
                                  }}
                                  onMouseDown={e => e.stopPropagation()}
                                  style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }}
                                />
                                Extend TTL on hit
                              </label>
                              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: -6, marginLeft: 22, lineHeight: 1.4 }}>
                                When a cached response is returned, its expiry is reset to the full TTL (sliding expiration).
                              </p>
                            </div>
                          );
                        })()}
                      </div>

                    </div>
                  )}

                  {policy.type === 'semantic-intent' && policy.enabled && (
                    <div style={{ paddingLeft: 30, paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>

                      {/* --- Embedding Model --- */}
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>{t('common.routingPolicies.embeddingModels')}</label>
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
                                /* v8 ignore next */
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
                                  placeholder={t('common.routingPolicies.selectModel')}
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
                            /* v8 ignore next */
                            if (firstAvail) setSemModelIds(idx, [...getSemModelIds(policy), firstAvail.id]);
                          }}
                          disabled={availableModels.filter(m => m.capabilities?.embedding === true && !new Set(getSemModelIds(policy)).has(m.id)).length === 0}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'none', border: '1px dashed var(--border)', borderRadius: 4, color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer', marginTop: 6, width: 'fit-content', opacity: availableModels.filter(m => m.capabilities?.embedding === true && !new Set(getSemModelIds(policy)).has(m.id)).length === 0 ? 0.4 : 1 }}
                        >
                          <Plus size={12} /> {t('common.routingPolicies.addFallbackModel')}
                        </button>
                      </div>

                      {/* --- Intents --- */}
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>{t('common.routingPolicies.intents')}</label>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
                          Each intent groups example utterances that represent a category of requests. The closer a user message is to an intent's examples, the higher its score.
                        </p>
                        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                          {(() => {
                            /* v8 ignore next */
                            const intentMap = (policy.config?.intents ?? {}) as Record<string, { examples: string[]; candidate_models: string[] }>;
                            return Object.entries(intentMap).map(([intentName, intentDef], iIdx, arr) => {
                            const isExpanded = expandedIntents.has(intentName);
                            const exampleKey = `${idx}::${intentName}`;
                            /* v8 ignore next */
                            const exampleCount = intentDef.examples?.length ?? 0;
                            /* v8 ignore next */
                            const addExampleVal = addExampleInputs[exampleKey] ?? '';
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
                                    {exampleCount} example{exampleCount !== 1 ? 's' : ''}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      /* v8 ignore next */
                                      const intents = { ...((policy.config?.intents ?? {}) as Record<string, unknown>) };
                                      delete intents[intentName];
                                      updatePolicyConfig(idx, { intents });
                                    }}
                                    style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', borderRadius: 4, flexShrink: 0 }}
                                    title={t('common.routingPolicies.removeIntent')}
                                  >
                                    <X size={14} />
                                  </button>
                                </div>

                                {/* Expanded: examples list */}
                                {isExpanded && (
                                  <div style={{ padding: '0 12px 10px 36px' }}>
                                    {exampleCount === 0 && (
                                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: '4px 0 8px' }}>
                                        No examples yet. Add representative phrases below.
                                      </p>
                                    )}
                                    {(() => {
                                      /* v8 ignore next */
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
                                                  /* v8 ignore next */
                                                  const intents = { ...((policy.config?.intents ?? {}) as Record<string, { examples: string[]; candidate_models: string[] }>) };
                                                  const def = intents[intentName];
                                                  /* v8 ignore next */
                                                  if (!def) return;
                                                  const newExamples = [...def.examples];
                                                  newExamples[exIdx] = e.target.value;
                                                  intents[intentName] = { ...def, examples: newExamples };
                                                  updatePolicyConfig(idx, { intents });
                                                }}
                                                onMouseDown={e => e.stopPropagation()}
                                                /* v8 ignore next */
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
                                                  /* v8 ignore next */
                                                  const intents = { ...((policy.config?.intents ?? {}) as Record<string, { examples: string[]; candidate_models: string[] }>) };
                                                  const def = intents[intentName];
                                                  /* v8 ignore next */
                                                  if (!def) return;
                                                  intents[intentName] = { ...def, examples: def.examples.filter((_, i) => i !== exIdx) };
                                                  updatePolicyConfig(idx, { intents });
                                                }}
                                                style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', flexShrink: 0, opacity: 0.5 }}
                                                title={t('common.routingPolicies.removeExample')}
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
                                              {t('common.showLess')}
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
                                        placeholder={t('common.routingPolicies.addExamplePlaceholder')}
                                        value={addExampleVal}
                                        onChange={e => setAddExampleInputs(prev => ({ ...prev, [exampleKey]: e.target.value }))}
                                        onMouseDown={e => e.stopPropagation()}
                                        onKeyDown={e => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault();
                                            const text = addExampleInputs[exampleKey]?.trim();
                                            if (!text) return;
                                            /* v8 ignore next */
                                            const intents = { ...((policy.config?.intents ?? {}) as Record<string, { examples: string[]; candidate_models: string[] }>) };
                                            const def = intents[intentName];
                                            /* v8 ignore next */
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
                          });
                          })()}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--surface-2, rgba(255,255,255,0.03))' }}>
                            <Plus size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                            <input
                              type="text"
                              placeholder={t('common.routingPolicies.addIntentPlaceholder')}
                              value={addIntentInputs[idx] ?? ''}
                              onChange={e => setAddIntentInputs(prev => ({ ...prev, [idx]: e.target.value }))}
                              onMouseDown={e => e.stopPropagation()}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  const raw = addIntentInputs[idx];
                                  /* v8 ignore next */
                                  if (!raw?.trim()) return;
                                  const key = raw.trim().toLowerCase().replace(/\s+/g, '_');
                                  /* v8 ignore next */
                                  const intents = { ...((policy.config?.intents ?? {}) as Record<string, unknown>) };
                                  /* v8 ignore next */
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
                                /* v8 ignore next */
                                if (raw?.trim()) {
                                  const key = raw.trim().toLowerCase().replace(/\s+/g, '_');
                                  /* v8 ignore next */
                                  const intents = { ...((policy.config?.intents ?? {}) as Record<string, unknown>) };
                                  /* v8 ignore next */
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
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', minWidth: 160 }}>{t('common.routingPolicies.confidenceThreshold')}</label>
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
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', minWidth: 160 }}>{t('common.routingPolicies.ambiguityMargin')}</label>
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
                  {policy.type === 'model-preference' && policy.enabled && (
                    <div style={{ paddingLeft: 30, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Bonus (0.0 – 1.0)</label>
                        <input
                          type="number" min={0} max={1} step={0.1}
                          className="form-input"
                          style={{ width: 80, padding: '4px 8px', fontSize: '0.8rem' }}
                          value={policy.config?.bonus ?? 1.0}
                          onChange={e => updatePolicyConfig(idx, { bonus: Number(e.target.value) })}
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
                          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{t('common.routingPolicies.maxCallsPerWindow')}</label>
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
                  .filter(pt => !policies.some(p => p.type === pt))
                  .map(pt => {
                    const label = policyLabel(t, pt);
                    const description = policyDescription(t, pt);
                    return {
                      value: pt,
                      label,
                      /* v8 ignore next */
                      ...(description ? { description } : {}),
                    };
                  })}
                value=""
                onChange={addPolicy}
                placeholder={t('common.routingPolicies.addPolicyPlaceholder')}
                disabled={ALL_POLICY_TYPES.every(pt => policies.some(p => p.type === pt))}
              />
            </div>
          </div>
  );
}
