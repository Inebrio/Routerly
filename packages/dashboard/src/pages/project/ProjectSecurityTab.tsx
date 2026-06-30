import { useEffect, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import {
  getModels,
  updateProject,
  type GuardrailConfig,
  type GuardrailRule,
  type GuardrailRuleType,
  type GuardrailTarget,
  type Model,
  type RegexGuardConfig,
  type SemanticGuardConfig,
  type TopicGuardConfig,
  type ModerationGuardConfig,
  type PiiConfig,
  type PiiEntity,
  type PiiPolicy,
} from '../../api';
import { SearchableSelect } from '../../components/SearchableSelect';
import { useProject } from './ProjectLayout';

const ALL_PII_ENTITIES: PiiEntity[] = ['EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN'];

const PII_LABELS: Record<PiiEntity, string> = {
  EMAIL: 'Email',
  PHONE: 'Phone',
  CREDIT_CARD: 'Credit Card',
  SSN: 'SSN',
  IBAN: 'IBAN',
};

// ── Guardrail rule helpers ────────────────────────────────────────────────────

type RuleWithId = GuardrailRule & { _id: string };

const RULE_TYPE_LABELS: Record<GuardrailRuleType, string> = {
  regex:      'Regex',
  semantic:   'Semantic',
  topic:      'Topic',
  moderation: 'Moderation',
};

const RULE_TYPE_DESCRIPTIONS: Record<GuardrailRuleType, string> = {
  regex:      'Block requests/responses matching regex patterns.',
  semantic:   'Block content semantically similar to provided examples.',
  topic:      'Restrict conversation to allowed topics using an LLM judge.',
  moderation: 'Block harmful content using an LLM moderation judge.',
};

function makeDefaultRule(type: GuardrailRuleType): RuleWithId {
  const _id = crypto.randomUUID();
  switch (type) {
    case 'regex':
      return { _id, type, target: 'request', config: { patterns: [] } };
    case 'semantic':
      return { _id, type, target: 'request', config: { embeddingModelId: '', examples: [], threshold: 0.82 } };
    case 'topic':
      return { _id, type, target: 'both', config: { modelId: '', allowedTopics: '', threshold: 0.5 } };
    case 'moderation':
      return { _id, type, target: 'both', config: { modelId: '', threshold: 0.5 } };
  }
}

function validateRegexLines(val: string): number[] {
  return val
    .split('\n')
    .map((line, i) => ({ line: line.trim(), i }))
    .filter(({ line }) => line.length > 0)
    .filter(({ line }) => { try { new RegExp(line); return false; } catch { return true; } })
    .map(({ i }) => i);
}

// ── PII Policy Card ──────────────────────────────────────────────────────────

function PiiPolicyCard({
  policy,
  onChange,
  onRemove,
}: {
  policy: PiiPolicy;
  onChange: (p: PiiPolicy) => void;
  onRemove: () => void;
}) {
  const entities: Set<PiiEntity> = new Set(policy.entities ?? ALL_PII_ENTITIES);

  function toggleEntity(e: PiiEntity) {
    const next = new Set(entities);
    next.has(e) ? next.delete(e) : next.add(e);
    onChange({ ...policy, entities: [...next] });
  }

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 12,
      background: 'var(--surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <input
          className="form-input"
          style={{ flex: 1, fontSize: '0.88rem' }}
          placeholder="Policy name"
          value={policy.name}
          onChange={e => onChange({ ...policy, name: e.target.value })}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', whiteSpace: 'nowrap', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={policy.enabled !== false}
            onChange={e => onChange({ ...policy, enabled: e.target.checked })}
            style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }}
          />
          Enabled
        </label>
        <button
          type="button"
          onClick={onRemove}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, display: 'flex' }}
          title="Remove policy"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={policy.scrubInput === true}
            onChange={e => onChange({ ...policy, scrubInput: e.target.checked })}
            style={{ width: 13, height: 13, accentColor: 'var(--primary)', cursor: 'pointer' }}
          />
          Scrub input
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={policy.scrubOutput === true}
            onChange={e => onChange({ ...policy, scrubOutput: e.target.checked })}
            style={{ width: 13, height: 13, accentColor: 'var(--primary)', cursor: 'pointer' }}
          />
          Scrub output
        </label>
      </div>

      <div style={{ marginBottom: 10 }}>
        <label className="form-label" style={{ fontSize: '0.72rem' }}>Entity types</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {ALL_PII_ENTITIES.map(entity => {
            const active = entities.has(entity);
            return (
              <label key={entity} style={{
                display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: '0.82rem',
                padding: '3px 8px', border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: 5, background: active ? 'color-mix(in srgb, var(--primary) 12%, transparent)' : 'transparent',
                transition: 'all 0.15s',
              }}>
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggleEntity(entity)}
                  style={{ width: 12, height: 12, accentColor: 'var(--primary)', cursor: 'pointer' }}
                />
                {PII_LABELS[entity]}
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <label className="form-label" style={{ fontSize: '0.72rem' }}>Custom patterns (regex, one per line)</label>
        <textarea
          className="form-input"
          rows={2}
          value={(policy.customPatterns ?? []).join('\n')}
          onChange={e => onChange({ ...policy, customPatterns: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
          placeholder={'\\b\\d{8}\\b'}
          style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '0.82rem' }}
        />
      </div>
    </div>
  );
}

// ── Target selector ───────────────────────────────────────────────────────────

function TargetSelector({ value, onChange }: { value: GuardrailTarget; onChange: (v: GuardrailTarget) => void }) {
  const reqChecked = value === 'request' || value === 'both';
  const resChecked = value === 'response' || value === 'both';

  function toggle(side: 'request' | 'response') {
    const newReq = side === 'request' ? !reqChecked : reqChecked;
    const newRes = side === 'response' ? !resChecked : resChecked;
    if (!newReq && !newRes) return;
    if (newReq && newRes) onChange('both');
    else if (newReq) onChange('request');
    else onChange('response');
  }

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      {(['request', 'response'] as const).map(side => (
        <label key={side} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem' }}>
          <input
            type="checkbox"
            checked={side === 'request' ? reqChecked : resChecked}
            onChange={() => toggle(side)}
            style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }}
          />
          {side}
        </label>
      ))}
    </div>
  );
}

// ── Per-rule config fields ────────────────────────────────────────────────────

function RegexFields({ rule, onChange, regexErrors }: {
  rule: RuleWithId;
  onChange: (r: RuleWithId) => void;
  regexErrors: number[];
}) {
  const cfg = rule.config as RegexGuardConfig;
  const text = cfg.patterns.join('\n');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10 }}>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Target</label>
        <TargetSelector value={rule.target} onChange={t => onChange({ ...rule, target: t })} />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Patterns (one per line)</label>
        <textarea
          className="form-input"
          rows={3}
          value={text}
          onChange={e => {
            const patterns = e.target.value.split('\n').map(s => s.trimEnd());
            onChange({ ...rule, config: { patterns } });
          }}
          placeholder={'offensive\nbad.*word'}
          style={{
            resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem',
            ...(regexErrors.length > 0 ? { borderColor: 'var(--error, #ef4444)' } : {}),
          }}
        />
        {regexErrors.length > 0 && (
          <p style={{ fontSize: '0.75rem', color: 'var(--error, #ef4444)', marginTop: 4 }}>
            Invalid regex on line(s): {regexErrors.map(i => i + 1).join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}

function SemanticFields({ rule, onChange, modelOptions }: {
  rule: RuleWithId;
  onChange: (r: RuleWithId) => void;
  modelOptions: { value: string; label: string }[];
}) {
  const cfg = rule.config as SemanticGuardConfig;
  const threshold = cfg.threshold ?? 0.82;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10 }}>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Target</label>
        <TargetSelector value={rule.target} onChange={t => onChange({ ...rule, target: t })} />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Embedding model</label>
        <SearchableSelect
          options={modelOptions}
          value={cfg.embeddingModelId}
          onChange={v => onChange({ ...rule, config: { ...cfg, embeddingModelId: v } })}
          placeholder="Select embedding model..."
        />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Example texts to block (one per line)</label>
        <textarea
          className="form-input"
          rows={3}
          value={cfg.examples.join('\n')}
          onChange={e => {
            const examples = e.target.value.split('\n').map(s => s.trimEnd());
            onChange({ ...rule, config: { ...cfg, examples } });
          }}
          placeholder={'How do I hack...\n...'}
          style={{ resize: 'vertical', fontSize: '0.85rem' }}
        />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Similarity threshold: <strong>{threshold.toFixed(2)}</strong></label>
        <input
          type="range" min="0" max="1" step="0.01"
          value={threshold}
          onChange={e => onChange({ ...rule, config: { ...cfg, threshold: parseFloat(e.target.value) } })}
          style={{ width: '100%', accentColor: 'var(--primary)' }}
        />
      </div>
    </div>
  );
}

function TopicFields({ rule, onChange, modelOptions }: {
  rule: RuleWithId;
  onChange: (r: RuleWithId) => void;
  modelOptions: { value: string; label: string }[];
}) {
  const cfg = rule.config as TopicGuardConfig;
  const threshold = cfg.threshold ?? 0.5;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10 }}>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Target</label>
        <TargetSelector value={rule.target} onChange={t => onChange({ ...rule, target: t })} />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Judge model</label>
        <SearchableSelect
          options={modelOptions}
          value={cfg.modelId}
          onChange={v => onChange({ ...rule, config: { ...cfg, modelId: v } })}
          placeholder="Select judge model..."
        />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Allowed topics (natural language)</label>
        <textarea
          className="form-input"
          rows={3}
          value={cfg.allowedTopics}
          onChange={e => onChange({ ...rule, config: { ...cfg, allowedTopics: e.target.value } })}
          placeholder="Customer support for software products. Technical troubleshooting. Billing questions."
          style={{ resize: 'vertical', fontSize: '0.85rem' }}
        />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Block if on-topic score below: <strong>{threshold.toFixed(2)}</strong></label>
        <input
          type="range" min="0" max="1" step="0.01"
          value={threshold}
          onChange={e => onChange({ ...rule, config: { ...cfg, threshold: parseFloat(e.target.value) } })}
          style={{ width: '100%', accentColor: 'var(--primary)' }}
        />
      </div>
    </div>
  );
}

function ModerationFields({ rule, onChange, modelOptions }: {
  rule: RuleWithId;
  onChange: (r: RuleWithId) => void;
  modelOptions: { value: string; label: string }[];
}) {
  const cfg = rule.config as ModerationGuardConfig;
  const threshold = cfg.threshold ?? 0.5;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10 }}>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Target</label>
        <TargetSelector value={rule.target} onChange={t => onChange({ ...rule, target: t })} />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Judge model</label>
        <SearchableSelect
          options={modelOptions}
          value={cfg.modelId}
          onChange={v => onChange({ ...rule, config: { ...cfg, modelId: v } })}
          placeholder="Select judge model..."
        />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Block if harm score above: <strong>{threshold.toFixed(2)}</strong></label>
        <input
          type="range" min="0" max="1" step="0.01"
          value={threshold}
          onChange={e => onChange({ ...rule, config: { ...cfg, threshold: parseFloat(e.target.value) } })}
          style={{ width: '100%', accentColor: 'var(--primary)' }}
        />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label" style={{ fontSize: '0.75rem' }}>
          Custom instructions <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional — JSON response format is always appended automatically)</span>
        </label>
        <textarea
          className="form-input"
          rows={4}
          value={cfg.systemPrompt ?? ''}
          onChange={e => {
            const val = e.target.value;
            const next: ModerationGuardConfig = { ...cfg };
            if (val) next.systemPrompt = val; else delete next.systemPrompt;
            onChange({ ...rule, config: next });
          }}
          placeholder={`You are a content safety classifier. Evaluate the following text for harmful content.\nCategories: hate speech, violence, sexual content, self-harm.\nRespond ONLY with a JSON object: {"score": <number between 0 and 1>}`}
          style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '0.82rem' }}
        />
      </div>
    </div>
  );
}

// ── Single rule card ──────────────────────────────────────────────────────────

function RuleCard({ rule, onChange, onDelete, regexErrors, modelOptions, embeddingModelOptions }: {
  rule: RuleWithId;
  onChange: (r: RuleWithId) => void;
  onDelete: () => void;
  regexErrors: number[];
  modelOptions: { value: string; label: string }[];
  embeddingModelOptions: { value: string; label: string }[];
}) {
  return (
    <div style={{
      background: 'var(--surface-active)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em',
          padding: '1px 7px', borderRadius: 4,
          border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
        }}>
          {RULE_TYPE_LABELS[rule.type]}
        </span>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', flex: 1 }}>{rule.target}</span>
        {/* ponytail: per-rule action override; undefined = use global */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Action:</span>
          {([undefined, 'block', 'log'] as const).map(opt => (
            <button
              key={opt ?? 'global'}
              type="button"
              className={`btn btn-sm${rule.action === opt ? ' btn-primary' : ' btn-secondary'}`}
              style={{ fontSize: '0.7rem', padding: '1px 7px' }}
              onClick={() => {
                const { action: _a, ...rest } = rule;
                onChange(opt === undefined ? rest as RuleWithId : { ...rest, action: opt });
              }}
            >
              {opt === undefined ? 'Global' : opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onDelete}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
          aria-label="Delete rule"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {rule.type === 'regex'      && <RegexFields      rule={rule} onChange={onChange} regexErrors={regexErrors} />}
      {rule.type === 'semantic'   && <SemanticFields   rule={rule} onChange={onChange} modelOptions={embeddingModelOptions} />}
      {rule.type === 'topic'      && <TopicFields      rule={rule} onChange={onChange} modelOptions={modelOptions} />}
      {rule.type === 'moderation' && <ModerationFields rule={rule} onChange={onChange} modelOptions={modelOptions} />}
    </div>
  );
}

// ── Add-rule picker ───────────────────────────────────────────────────────────

const ALL_RULE_TYPES: GuardrailRuleType[] = ['regex', 'semantic', 'topic', 'moderation'];

// ── Main component ────────────────────────────────────────────────────────────

export function ProjectSecurityTab() {
  const { project, setProject } = useProject();

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [allModels, setAllModels] = useState<Model[]>([]);

  useEffect(() => {
    void getModels().then(m => setAllModels(m));
  }, []);

  // Guardrails state
  const [action, setAction] = useState<'block' | 'log'>('block');
  const [fallbackMessage, setFallbackMessage] = useState('');
  const [rules, setRules] = useState<RuleWithId[]>([]);

  // PII state
  const [piiEntities, setPiiEntities] = useState<Set<PiiEntity>>(new Set(ALL_PII_ENTITIES));
  const [piiCustomPatterns, setPiiCustomPatterns] = useState('');
  const [piiPatternErrors, setPiiPatternErrors] = useState<number[]>([]);
  const [scrubInput, setScrubInput] = useState(true);
  const [scrubOutput, setScrubOutput] = useState(false);
  const [outputBufferSize, setOutputBufferSize] = useState(30);
  const [piiPolicies, setPiiPolicies] = useState<PiiPolicy[]>([]);

  useEffect(() => {
    if (!project) return;
    const g = project.guardrails;
    if (g) {
      setAction(g.action === 'flag' ? 'log' : (g.action ?? 'block'));
      setFallbackMessage(g.fallbackMessage ?? '');
      setRules((g.rules ?? []).map(r => ({ ...r, _id: crypto.randomUUID() })));
    }
    const p = project.pii;
    if (p) {
      setPiiEntities(new Set(p.entities ?? ALL_PII_ENTITIES));
      setPiiCustomPatterns((p.customPatterns ?? []).join('\n'));
      setScrubInput(p.scrubInput !== false);
      setScrubOutput(p.scrubOutput === true);
      setOutputBufferSize(p.outputBufferSize ?? 30);
      setPiiPolicies(p.policies ?? []);
    }
  }, [project]);

  function togglePiiEntity(entity: PiiEntity) {
    setPiiEntities(prev => {
      const next = new Set(prev);
      next.has(entity) ? next.delete(entity) : next.add(entity);
      return next;
    });
  }

  function validatePiiPatterns(val: string) {
    setPiiCustomPatterns(val);
    setPiiPatternErrors(validateRegexLines(val));
  }

  function updateRule(id: string, updated: RuleWithId) {
    setRules(prev => prev.map(r => r._id === id ? updated : r));
  }

  function deleteRule(id: string) {
    setRules(prev => prev.filter(r => r._id !== id));
  }

  function addRule(type: GuardrailRuleType) {
    setRules(prev => [...prev, makeDefaultRule(type)]);
  }

  const regexErrorsByRule: Record<string, number[]> = {};
  for (const r of rules) {
    if (r.type === 'regex') {
      const cfg = r.config as RegexGuardConfig;
      const errs = validateRegexLines(cfg.patterns.join('\n'));
      if (errs.length > 0) regexErrorsByRule[r._id] = errs;
    }
  }
  const hasRegexErrors = Object.keys(regexErrorsByRule).length > 0;
  const saveDisabled = saving || hasRegexErrors || piiPatternErrors.length > 0;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!project || saveDisabled) return;
    setErr('');
    setSaving(true);
    try {
      const strippedRules: GuardrailRule[] = rules.map(({ _id: _dropped, ...rest }) => rest);
      const guardrailsPayload: GuardrailConfig = {
        action,
        ...(action === 'block' && fallbackMessage.trim() ? { fallbackMessage: fallbackMessage.trim() } : {}),
        rules: strippedRules,
      };
      const validPolicies = piiPolicies.filter(p => p.name.trim());
      const piiPayload: PiiConfig = {
        entities: [...piiEntities],
        scrubInput,
        scrubOutput,
        outputBufferSize,
        ...(piiCustomPatterns.trim() ? {
          customPatterns: piiCustomPatterns.split('\n').map(s => s.trim()).filter(Boolean),
        } : {}),
        ...(validPolicies.length > 0 ? { policies: validPolicies } : {}),
      };
      const updated = await updateProject(project.id, {
        name: project.name,
        models: project.models.map(m => ({ modelId: m.modelId, ...(m.prompt ? { prompt: m.prompt } : {}) })),
        guardrails: guardrailsPayload,
        pii: piiPayload,
      });
      setProject(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error saving security settings');
    } finally {
      setSaving(false);
    }
  }

  if (!project) return null;

  // ponytail: embedding-only models can't act as chat judges — exclude them
  const modelOptions = allModels
    .filter(m => m.capabilities?.embedding !== true)
    .map(m => ({ value: m.id, label: m.name || m.id }));
  const embeddingModelOptions = allModels
    .filter(m => m.capabilities?.embedding === true)
    .map(m => ({ value: m.id, label: m.name || m.id }));

  return (
    <form onSubmit={(e) => { void handleSave(e); }} style={{ maxWidth: 800 }}>
      {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

      {/* ── Content Guardrails ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 36 }}>
        <label className="form-label">Content Guardrails</label>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
          Inspect requests and responses against configured rules. Active when at least one rule is configured.
        </p>

        {/* Action */}
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label" style={{ fontSize: '0.75rem' }}>Action when triggered</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['block', 'log'] as const).map(opt => (
              <button
                key={opt}
                type="button"
                className={`btn btn-sm${action === opt ? ' btn-primary' : ' btn-secondary'}`}
                onClick={() => setAction(opt)}
              >
                {opt.charAt(0).toUpperCase() + opt.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Fallback message — advanced, block only */}
        {action === 'block' && (
          <details style={{ marginBottom: 16 }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-muted)', userSelect: 'none', marginBottom: 8 }}>
              Advanced
            </summary>
            <div className="form-group" style={{ marginTop: 8 }}>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Fallback message</label>
              <input
                className="form-input"
                type="text"
                value={fallbackMessage}
                onChange={e => setFallbackMessage(e.target.value)}
                placeholder="Request blocked by content policy."
              />
            </div>
          </details>
        )}

        {/* Rules */}
        <div>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Security Policies
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rules.length === 0 && (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                No security policies configured.
              </p>
            )}
            {rules.map(r => (
              <RuleCard
                key={r._id}
                rule={r}
                onChange={updated => updateRule(r._id, updated)}
                onDelete={() => deleteRule(r._id)}
                regexErrors={regexErrorsByRule[r._id] ?? []}
                modelOptions={modelOptions}
                embeddingModelOptions={embeddingModelOptions}
              />
            ))}
            <div style={{ marginTop: 4, border: '1.5px dashed var(--border)', borderRadius: 8, padding: '6px 10px' }}>
              <SearchableSelect
                options={ALL_RULE_TYPES.map(t => ({
                  value: t,
                  label: RULE_TYPE_LABELS[t],
                  description: RULE_TYPE_DESCRIPTIONS[t],
                }))}
                value=""
                onChange={(type) => addRule(type as GuardrailRuleType)}
                placeholder="Add a security policy..."
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── PII Scrubbing ──────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <label className="form-label">PII Scrubbing</label>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
          Detect and redact personal data before it reaches the model. Active when entity types are selected.
        </p>

        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label" style={{ fontSize: '0.75rem' }}>Apply to</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.88rem' }}>
              <input
                type="checkbox"
                checked={scrubInput}
                onChange={e => setScrubInput(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
              Request — messages sent to the model
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.88rem' }}>
              <input
                type="checkbox"
                checked={scrubOutput}
                onChange={e => setScrubOutput(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
              Response — model output returned to the consumer
            </label>
            {scrubOutput && (
              <div className="form-group" style={{ marginBottom: 0, marginLeft: 22 }}>
                <label className="form-label" style={{ fontSize: '0.75rem' }}>Streaming buffer size (characters)</label>
                <input
                  className="form-input"
                  type="number"
                  min={10}
                  max={500}
                  value={outputBufferSize}
                  onChange={e => setOutputBufferSize(Math.max(10, Math.min(500, Number(e.target.value))))}
                  style={{ width: 100 }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label" style={{ fontSize: '0.75rem' }}>Entity types</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ALL_PII_ENTITIES.map(entity => {
              const active = piiEntities.has(entity);
              return (
                <label key={entity} style={{
                  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem',
                  padding: '4px 10px', border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                  borderRadius: 6, background: active ? 'color-mix(in srgb, var(--primary) 12%, transparent)' : 'transparent',
                  transition: 'all 0.15s',
                }}>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => togglePiiEntity(entity)}
                    style={{ width: 13, height: 13, accentColor: 'var(--primary)', cursor: 'pointer' }}
                  />
                  {PII_LABELS[entity]}
                </label>
              );
            })}
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: '0.75rem' }}>Custom patterns (regex, one per line)</label>
          <textarea
            className="form-input"
            rows={3}
            value={piiCustomPatterns}
            onChange={e => validatePiiPatterns(e.target.value)}
            placeholder={'\\b\\d{8}\\b'}
            style={{
              resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem',
              ...(piiPatternErrors.length > 0 ? { borderColor: 'var(--error, #ef4444)' } : {}),
            }}
          />
          {piiPatternErrors.length > 0 && (
            <p style={{ fontSize: '0.75rem', color: 'var(--error, #ef4444)', marginTop: 2 }}>
              Invalid regex on line(s): {piiPatternErrors.map(i => i + 1).join(', ')}
            </p>
          )}
        </div>

        <div style={{ marginTop: 24 }}>
          <label className="form-label" style={{ fontSize: '0.75rem' }}>Named Policies</label>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
            Additional policies merged at scrub time. Each policy controls its own entity set and direction.
          </p>
          {piiPolicies.map((policy, i) => (
            <PiiPolicyCard
              key={i}
              policy={policy}
              onChange={updated => setPiiPolicies(prev => prev.map((p, j) => j === i ? updated : p))}
              onRemove={() => setPiiPolicies(prev => prev.filter((_, j) => j !== i))}
            />
          ))}
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.85rem' }}
            onClick={() => setPiiPolicies(prev => [...prev, { name: '', enabled: true, scrubInput: true, entities: [] }])}
          >
            + Add Policy
          </button>
        </div>
      </div>

      <button
        type="submit"
        className="btn btn-primary"
        disabled={saveDisabled}
        style={saved ? { background: '#16a34a', borderColor: '#16a34a' } : {}}
      >
        {saving ? (
          <span className="spinner" />
        ) : saved ? (
          <><Check size={15} style={{ marginRight: 6 }} />Saved!</>
        ) : (
          'Save Security Settings'
        )}
      </button>
    </form>
  );
}
