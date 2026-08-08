import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, GripVertical, Check } from 'lucide-react';
import { updateRouter, getModels, getProfiles, assignRouterProfiles, type Model, type Router, type RoutingProfile } from '../../api';
import { PASSTHROUGH_MODEL_ID } from '@routerly/shared';
import { useRouter } from './RouterLayout';
import { SearchableSelect } from '../../components/SearchableSelect';
import { RoutingPoliciesEditor, mkPolicyId, type PolicyItem } from '../../components/RoutingPoliciesEditor';
import { useUnsavedChanges, UnsavedChangesModal } from '../../hooks/useUnsavedChanges';
import { ORCHESTRATOR_POLICY_TYPES } from './RouterOrchestratorTab';

type TargetModel = {
  internalId: string; // for React keys
  modelId: string;
  prompt: string;
};

export function RouterRoutingTab() {
  const { t } = useTranslation();
  const { router, setRouter } = useRouter();
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const [policies, setPolicies] = useState<PolicyItem[]>([]);
  const [targetModels, setTargetModels] = useState<TargetModel[]>([]);
  const [profiles, setProfiles] = useState<RoutingProfile[]>([]);

  // Drag state
  const [draggedTargetIdx, setDraggedTargetIdx] = useState<number | null>(null);
  const [promptHoverIdx, setPromptHoverIdx] = useState<number | null>(null);

  // Policies to install on the next router refresh, used when switching from a
  // profile to custom so the profile policies become the editable starting point.
  const pendingPolicies = useRef<PolicyItem[] | null>(null);

  useEffect(() => {
    getModels()
      .then(m => setAvailableModels(m))
      .finally(() => setLoading(false));
    getProfiles('routing')
      .then(list => setProfiles(list.filter((p): p is RoutingProfile => p.kind === 'routing')))
      .catch(() => setProfiles([]));
  }, []);

  async function onAssignProfile(profileId: string) {
    /* v8 ignore next */
    if (!router) return;
    setErr('');
    try {
      const updated = await assignRouterProfiles(router.id, { routing: profileId === '' ? null : profileId });
      setRouter(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('routers.routing.errors.assignProfileFailed'));
    }
  }

  useEffect(() => {
    /* v8 ignore next */
    if (router) {
      const mkId = () => Math.random().toString(36).substring(7);

      if (pendingPolicies.current) {
        setPolicies(pendingPolicies.current);
        pendingPolicies.current = null;
      } else if (router.policies && router.policies.length > 0) {
        setPolicies(router.policies.map(p => ({ ...p, internalId: mkId() })));
      } else {
        setPolicies([]);
      }

      setTargetModels(router.models.map(m => ({
        internalId: Math.random().toString(36).substring(7),
        modelId: m.modelId,
        prompt: m.prompt || '',
      })));
    }
  }, [router]);

  const isDirty = (() => {
    /* v8 ignore next */
    if (!router) return false;

    const savedPolicies = router.policies || [];
    if (policies.length !== savedPolicies.length) return true;
    for (let i = 0; i < policies.length; i++) {
      const p1 = policies[i]!;
      const p2 = savedPolicies[i]!;
      if (p1.type !== p2.type || p1.enabled !== p2.enabled) return true;
      if (JSON.stringify(p1.config || {}) !== JSON.stringify(p2.config || {})) return true;
    }

    /* v8 ignore next */
    const savedTargets = router.models || [];
    if (targetModels.length !== savedTargets.length) return true;
    if (targetModels.some((tm, i) => tm.modelId !== savedTargets[i]!.modelId || tm.prompt !== (savedTargets[i]!.prompt /* v8 ignore next */ || ''))) return true;
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
    /* v8 ignore next */
    if (!semPolicy) return result;
    /* v8 ignore next */
    const intents = (semPolicy.config?.intents ?? {}) as Record<string, { candidate_models: string[] }>;
    for (const [key, def] of Object.entries(intents)) {
      if (def.candidate_models?.includes(modelId)) result.add(key);
    }
    return result;
  }

  function toggleIntentForModel(modelId: string, intentKey: string) {
    const semPolicyIdx = policies.findIndex(p => p.type === 'semantic-intent' && p.enabled);
    /* v8 ignore next */
    if (semPolicyIdx === -1) return;
    const semPolicy = policies[semPolicyIdx]!;
    /* v8 ignore next */
    const intents = { ...((semPolicy.config?.intents ?? {}) as Record<string, { examples: string[]; candidate_models: string[] }>) };
    const def = intents[intentKey];
    /* v8 ignore next */
    if (!def) return;
    /* v8 ignore next */
    const current = def.candidate_models ?? [];
    const next = current.includes(modelId)
      ? current.filter(id => id !== modelId)
      : [...current, modelId];
    intents[intentKey] = { ...def, candidate_models: next };
    updatePolicyConfig(semPolicyIdx, { intents });
  }

  function updatePolicyConfig(idx: number, configUpdates: any) {
    setPolicies(prev => prev.map((p, i) => {
      /* v8 ignore next */
      if (i !== idx) return p;
      /* v8 ignore next */
      const base = p.config || {};
      return { ...p, config: { ...base, ...configUpdates } };
    }));
  }

  // --- Target Models Handlers ---
  function addTargetModel() {
    const usedIds = new Set(targetModels.map(tm => tm.modelId));
    const firstAvailable = availableModels.find(m => !m.capabilities?.embedding && !usedIds.has(m.id));
    /* v8 ignore next */
    const firstAvailableId = firstAvailable?.id || '';
    setTargetModels(prev => [
      ...prev,
      {
        internalId: Math.random().toString(36).substring(7),
        modelId: firstAvailableId,
        prompt: '',
      }
    ]);
  }

  function updateTargetModel(idx: number, field: keyof TargetModel, value: string) {
    /* v8 ignore next */
    setTargetModels(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  }

  function removeTargetModel(idx: number) {
    setTargetModels(prev => prev.filter((_, i) => i !== idx));
  }

  // Target Drag Drop
  function onDragStartTarget(e: React.DragEvent, idx: number) {
    setDraggedTargetIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    /* v8 ignore next 3 */
    setTimeout(() => {
      const el = document.getElementById(`target-row-${idx}`);
      if (el) el.style.opacity = '0.4';
    }, 0);
  }
  function onDragEnterTarget(e: React.DragEvent, targetIdx: number) {
    e.preventDefault();
    /* v8 ignore next */
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
    /* v8 ignore next */
    if (el) el.style.opacity = '1';
  }

  // --------------------------------

  async function doSave() {
    /* v8 ignore next */
    if (!router) return;
    setErr('');

    // Validate: target models cannot repeat
    const targetIds = targetModels.map(m => m.modelId);
    if (new Set(targetIds).size !== targetIds.length) {
      setErr(t('routers.routing.errors.duplicateTargets'));
      return;
    }

    setSaving(true);
    try {
      const payload: Parameters<typeof updateRouter>[1] = {
        name: router.name,
        policies: policies.map(p => {
          const { internalId, ...rest } = p;
          return { ...rest, enabled: true };
        }),
        models: targetModels.map(m => ({
          modelId: m.modelId,
          ...(m.prompt.trim() ? { prompt: m.prompt.trim() } : {}),
        })),
        ...(router.timeoutMs !== undefined && { timeoutMs: router.timeoutMs }),
      };
      const updated = await updateRouter(router.id, payload);
      setRouter(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setErr(err instanceof Error ? err.message : t('routers.routing.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void doSave();
  }

  const assignedProfileId = router?.routingProfileId ?? '';
  const profileAssigned = assignedProfileId !== '';

  // Policies actually in force: the assigned profile's, or this router's own.
  const effectivePolicies: { type: string; enabled: boolean; config?: Record<string, any> }[] =
    profileAssigned ? (profiles.find(p => p.id === assignedProfileId)?.policies ?? []) : policies;

  const isAiRoutingEnabled = effectivePolicies.some(p => p.type === 'llm' && p.enabled);
  const isAutoRoutingEnabled = effectivePolicies.find(p => p.type === 'llm')?.config?.autoRouting /* v8 ignore next */ ?? true;
  const showPromptInput = isAiRoutingEnabled && !isAutoRoutingEnabled;

  // Intent chips edit the policy config, so they only show for this router's own policies.
  const semanticIntentPolicy = profileAssigned ? undefined : policies.find(p => p.type === 'semantic-intent' && p.enabled);
  const isSemanticIntentEnabled = !!semanticIntentPolicy;
  const semanticIntents = isSemanticIntentEnabled
    ? (semanticIntentPolicy!.config?.intents ?? {}) as Record<string, { examples: string[]; candidate_models: string[] }>
    : {};
  // Auto is the intended default; fall back to any built-in, then to any profile.
  const defaultProfileId = profiles.find(p => p.id === 'auto')?.id ?? profiles.find(p => p.builtin)?.id ?? profiles[0]?.id ?? '';

  async function onSelectMode(next: 'profile' | 'custom') {
    if ((next === 'profile') === profileAssigned) return;
    if (next === 'profile') {
      if (!defaultProfileId) {
        setErr(t('routers.routing.errors.noProfileAvailable'));
        return;
      }
      await onAssignProfile(defaultProfileId);
      return;
    }
    // Leaving a profile: its policies become the editable starting point.
    const current = profiles.find(p => p.id === assignedProfileId);
    if (current) pendingPolicies.current = current.policies.map(p => ({ ...p, internalId: mkPolicyId() }));
    await onAssignProfile('');
  }

  if (loading) return (
    <div style={{ maxWidth: 768, animation: 'fade-in 0.2s ease' }} className="loading-center">
      <div className="spinner" />
    </div>
  );

  return (
    <>
      <form onSubmit={handleSubmit} style={{ maxWidth: 800 }}>
        {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

        <div className="form-group">
          <label className="form-label">{t('routers.routing.form.routing')}</label>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
            {t('routers.routing.form.routingHint')}
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: profileAssigned ? 16 : 0 }}>
            <button
              type="button"
              className={`btn btn-sm ${profileAssigned ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => void onSelectMode('profile')}
            >
              {t('routers.routing.form.profileMode')}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${profileAssigned ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => void onSelectMode('custom')}
            >
              {t('routers.routing.form.customMode')}
            </button>
          </div>
          {profileAssigned && (
            <>
              <SearchableSelect
                style={{ maxWidth: 420 }}
                ariaLabel={t('routers.routing.form.routingProfile')}
                value={assignedProfileId}
                onChange={v => void onAssignProfile(v)}
                options={[
                  ...profiles.filter(p => p.builtin).map(p => ({ value: p.id, label: `${p.label} ${t('routers.routing.form.builtinSuffix')}` })),
                  ...profiles.filter(p => !p.builtin).map(p => ({ value: p.id, label: p.label })),
                ]}
              />
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.45 }}>
                {t('routers.routing.form.profileHint')}
              </p>
            </>
          )}
        </div>

        {!profileAssigned && (
          <>
            <div style={{ margin: '24px 0', borderTop: '1px solid var(--border)' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24 }}>
              <RoutingPoliciesEditor
                policies={policies}
                setPolicies={setPolicies}
                availableModels={availableModels}
                {...((router?.kind ?? 'router') === 'orchestrator' ? { allowedTypes: ORCHESTRATOR_POLICY_TYPES } : {})}
                llmDefaults={{
                  ...(router?.routingModelId ? { routingModelId: router.routingModelId } : {}),
                  ...(router?.fallbackRoutingModelIds ? { fallbackModelIds: router.fallbackRoutingModelIds } : {}),
                }}
              />
            </div>
          </>
        )}

        <div style={{ margin: '32px 0 24px', borderTop: '1px solid var(--border)' }} />

        {/* Target Models Section */}
        <div className="form-group">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{t('routers.routing.targetModels.heading')}</span>
          </label>

          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
            {t('routers.routing.targetModels.hint')}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {targetModels.map((item, idx) => {
              const isPassthrough = item.modelId === PASSTHROUGH_MODEL_ID;
              return (
              <div
                key={item.internalId}
                id={`target-row-${idx}`}
                draggable={promptHoverIdx !== idx}
                onDragStart={(e) => onDragStartTarget(e, idx)}
                onDragEnter={(e) => onDragEnterTarget(e, idx)}
                onDragEnd={(e) => onDragEndTarget(e, idx)}
                /* v8 ignore next */
                onDragOver={(e) => e.preventDefault()}
                style={{
                  display: 'flex',
                  alignItems: isPassthrough ? 'center' : 'stretch',
                  gap: 12,
                  background: 'var(--surface-active)',
                  padding: '12px 12px 12px 6px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  cursor: promptHoverIdx === idx ? 'default' : 'grab',
                  transition: 'opacity 0.2s'
                }}
              >
                <div style={{ display: 'flex', alignItems: isPassthrough ? 'center' : 'flex-start', paddingTop: isPassthrough ? 0 : 6, color: 'var(--text-muted)' }}>
                  <GripVertical size={18} />
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {isPassthrough ? (
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <span className="badge badge-neutral">{t('routers.routing.targetModels.passthroughLabel')}</span>
                    </div>
                  ) : (
                    <>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>{t('routers.routing.targetModels.endpointModel')}</label>
                        <SearchableSelect
                          value={item.modelId}
                          onChange={v => updateTargetModel(idx, 'modelId', v)}
                          placeholder={t('routers.routing.targetModels.selectModel')}
                          options={availableModels
                            .filter(m => !m.capabilities?.embedding && (m.id === item.modelId || !getUsedTargetModelIds(idx).has(m.id)))
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
                          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>{t('routers.routing.targetModels.promptDefinition')}</label>
                          <textarea
                            className="form-input"
                            value={item.prompt}
                            onChange={e => updateTargetModel(idx, 'prompt', e.target.value)}
                            placeholder={t('routers.routing.targetModels.promptPlaceholder')}
                            rows={2}
                            style={{ fontSize: '0.9rem', resize: 'vertical', minHeight: '60px' }}
                          />
                        </div>
                      )}

                      {isSemanticIntentEnabled && Object.keys(semanticIntents).length > 0 && (
                        <div className="form-group" style={{ margin: 0 }}>
                          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>{t('routers.routing.targetModels.intents')}</label>
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
                    </>
                  )}
                </div>

                <div style={{ paddingTop: isPassthrough ? 0 : 20 }}>
                  <button
                    type="button"
                    onClick={() => removeTargetModel(idx)}
                    className="btn-icon danger"
                    disabled={isPassthrough}
                    title={isPassthrough ? t('routers.routing.targetModels.passthroughNotRemovable') : t('routers.routing.targetModels.removeTarget')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              );
            })}

            {targetModels.length === 0 && (
              <div className="empty-state" style={{ padding: 24, fontSize: '0.9rem' }}>
                {t('routers.routing.targetModels.empty')}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={addTargetModel}
            disabled={availableModels.filter(m => !m.capabilities?.embedding && !targetModels.some(tm => tm.modelId === m.id)).length === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
              width: '100%', padding: '10px', marginTop: 12,
              background: 'none', border: '1.5px dashed var(--border)', borderRadius: 8,
              color: 'var(--text-secondary)', fontSize: '0.9rem', cursor: 'pointer',
              transition: 'all 0.2s',
              opacity: availableModels.filter(m => !targetModels.some(tm => tm.modelId === m.id)).length === 0 ? 0.4 : 1,
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
            <Plus size={16} /> {t('routers.routing.targetModels.addTarget')}
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
              <><Check size={15} style={{ marginRight: 6 }} />{t('routers.routing.form.saved')}</>
            ) : (
              t('routers.routing.form.saveRoutingConfiguration')
            )}
          </button>
        </div>
      </form>

      {isBlocked && <UnsavedChangesModal onConfirm={proceed} onCancel={reset} />}
    </>
  );
}
