import { useEffect, useState } from 'react';
import { Check, Trash2, AlertTriangle } from 'lucide-react';
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
import { MultiSelect } from '../../components/MultiSelect';
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
      return { _id, type, target: 'request', block: true, config: { patterns: [] } };
    case 'semantic':
      return { _id, type, target: 'request', block: true, config: { embeddingModelId: '', examples: [], threshold: 0.82 } };
    case 'topic':
      return { _id, type, target: 'both', block: true, config: { modelId: '', allowedTopics: '', threshold: 0.5 } };
    case 'moderation':
      return { _id, type, target: 'both', block: true, config: { modelId: '', threshold: 0.5 } };
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
  const showsResponse = policy.target === 'response' || policy.target === 'both';

  function toggleEntity(e: PiiEntity) {
    const next = new Set(entities);
    next.has(e) ? next.delete(e) : next.add(e);
    onChange({ ...policy, entities: [...next] });
  }

  // TargetSelector inline (same logic as the guardrail one below)
  function handleTargetToggle(side: 'request' | 'response') {
    const reqChecked = policy.target === 'request' || policy.target === 'both';
    const resChecked = policy.target === 'response' || policy.target === 'both';
    const newReq = side === 'request' ? !reqChecked : reqChecked;
    const newRes = side === 'response' ? !resChecked : resChecked;
    if (!newReq && !newRes) return;
    let next: GuardrailTarget;
    if (newReq && newRes) next = 'both';
    else if (newReq) next = 'request';
    else next = 'response';
    onChange({ ...policy, target: next });
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

      {/* Target selector (reuses the same checkbox pattern as TargetSelector) */}
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label className="form-label" style={{ fontSize: '0.72rem' }}>Apply to</label>
        <div style={{ display: 'flex', gap: 16 }}>
          {(['request', 'response'] as const).map(side => (
            <label key={side} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={side === 'request' ? (policy.target === 'request' || policy.target === 'both') : (policy.target === 'response' || policy.target === 'both')}
                onChange={() => handleTargetToggle(side)}
                style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
              {side}
            </label>
          ))}
        </div>
      </div>

      {/* Streaming buffer — only when response is targeted */}
      {showsResponse && (
        <div className="form-group" style={{ marginBottom: 10, marginLeft: 0 }}>
          <label className="form-label" style={{ fontSize: '0.72rem' }}>Streaming buffer size (characters)</label>
          <input
            className="form-input"
            type="number"
            min={10}
            max={500}
            value={policy.outputBufferSize ?? 30}
            onChange={e => onChange({ ...policy, outputBufferSize: Math.max(10, Math.min(500, Number(e.target.value))) })}
            style={{ width: 100 }}
          />
        </div>
      )}

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
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Fallback models (optional, tried in order)</label>
        <MultiSelect
          options={modelOptions.filter(o => o.value !== cfg.embeddingModelId)}
          value={cfg.fallbackModelIds ?? []}
          onChange={v => onChange({ ...rule, config: { ...cfg, fallbackModelIds: v } })}
          placeholder="No fallback models..."
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
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Fallback models (optional, tried in order)</label>
        <MultiSelect
          options={modelOptions.filter(o => o.value !== cfg.modelId)}
          value={cfg.fallbackModelIds ?? []}
          onChange={v => onChange({ ...rule, config: { ...cfg, fallbackModelIds: v } })}
          placeholder="No fallback models..."
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
        <label className="form-label" style={{ fontSize: '0.75rem' }}>Fallback models (optional, tried in order)</label>
        <MultiSelect
          options={modelOptions.filter(o => o.value !== cfg.modelId)}
          value={cfg.fallbackModelIds ?? []}
          onChange={v => onChange({ ...rule, config: { ...cfg, fallbackModelIds: v } })}
          placeholder="No fallback models..."
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
  const supportsJudge = rule.type === 'topic' || rule.type === 'moderation';
  const blockMessageLabel = supportsJudge && rule.useJudgeResponse
    ? 'Fallback message (used if the judge fails)'
    : 'Block message';

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

        {/* Block and Log independent checkboxes */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            data-testid="rule-block"
            checked={rule.block === true}
            onChange={e => onChange({ ...rule, block: e.target.checked })}
            style={{ width: 13, height: 13, accentColor: 'var(--primary)', cursor: 'pointer' }}
          />
          Block
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            data-testid="rule-log"
            checked={rule.log === true}
            onChange={e => onChange({ ...rule, log: e.target.checked })}
            style={{ width: 13, height: 13, accentColor: 'var(--primary)', cursor: 'pointer' }}
          />
          Log
        </label>

        <button
          type="button"
          onClick={onDelete}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
          aria-label="Delete rule"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Block message — shown when block is checked */}
      {rule.block && (
        <div className="form-group" style={{ marginTop: 10, marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: '0.72rem' }}>{blockMessageLabel}</label>
          <input
            className="form-input"
            data-testid="rule-block-message"
            type="text"
            value={rule.blockMessage ?? ''}
            onChange={e => {
              const val = e.target.value;
              const next: RuleWithId = { ...rule };
              if (val) next.blockMessage = val; else delete next.blockMessage;
              onChange(next);
            }}
            placeholder="Request blocked by content policy."
            style={{ fontSize: '0.85rem' }}
          />
        </div>
      )}

      {/* Use judge response — topic/moderation only */}
      {supportsJudge && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', cursor: 'pointer', marginTop: 10 }}>
          <input
            type="checkbox"
            data-testid="rule-use-judge"
            checked={rule.useJudgeResponse === true}
            onChange={e => {
              const next: RuleWithId = { ...rule };
              if (e.target.checked) next.useJudgeResponse = true; else delete next.useJudgeResponse;
              onChange(next);
            }}
            style={{ width: 13, height: 13, accentColor: 'var(--primary)', cursor: 'pointer' }}
          />
          Use judge response
        </label>
      )}

      {rule.type === 'regex'      && <RegexFields      rule={rule} onChange={onChange} regexErrors={regexErrors} />}
      {rule.type === 'semantic'   && <SemanticFields   rule={rule} onChange={onChange} modelOptions={embeddingModelOptions} />}
      {rule.type === 'topic'      && <TopicFields      rule={rule} onChange={onChange} modelOptions={modelOptions} />}
      {rule.type === 'moderation' && <ModerationFields rule={rule} onChange={onChange} modelOptions={modelOptions} />}
    </div>
  );
}

// ── Add-rule picker ───────────────────────────────────────────────────────────

const ALL_RULE_TYPES: GuardrailRuleType[] = ['regex', 'semantic', 'topic', 'moderation'];

// ── Streaming-disabled warning ────────────────────────────────────────────────

function StreamingDisabledWarning() {
  return (
    <div
      data-testid="streaming-disabled-warning"
      style={{
        display: 'flex', gap: 10, alignItems: 'flex-start',
        padding: '12px 16px',
        marginBottom: 16,
        borderRadius: 8,
        background: 'color-mix(in srgb, #f59e0b 10%, transparent)',
        border: '1px solid color-mix(in srgb, #f59e0b 40%, transparent)',
      }}
    >
      <AlertTriangle size={16} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
      <div>
        <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, color: '#b45309' }}>
          Streaming disabled for this project
        </p>
        <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          One or more rules are configured to block responses (target: response or both). Because the entire response must be
          inspected before a blocking decision can be made, Routerly holds the response in full before returning it
          to the client. Streaming is not available while a response-blocking rule is active; clients will receive the
          complete response at once instead of in incremental chunks.
        </p>
      </div>
    </div>
  );
}

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
  const [detectInjection, setDetectInjection] = useState(false);
  const [rules, setRules] = useState<RuleWithId[]>([]);

  // PII state
  const [piiPolicies, setPiiPolicies] = useState<PiiPolicy[]>([]);

  useEffect(() => {
    if (!project) return;
    const g = project.guardrails;
    if (g) {
      setDetectInjection(g.detectInjection === true);
      setRules((g.rules ?? []).map(r => ({ ...r, _id: crypto.randomUUID() })));
    }
    const p = project.pii;
    if (p) {
      setPiiPolicies(p.policies ?? []);
    }
  }, [project]);

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
  const saveDisabled = saving || hasRegexErrors;

  // Show streaming-disabled warning when any rule blocks a response
  const hasResponseBlockingRule = rules.some(
    r => r.block === true && (r.target === 'response' || r.target === 'both'),
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!project || saveDisabled) return;
    setErr('');
    setSaving(true);
    try {
      const strippedRules: GuardrailRule[] = rules.map(({ _id: _dropped, ...rest }) => rest);
      const guardrailsPayload: GuardrailConfig = {
        ...(detectInjection ? { detectInjection } : {}),
        rules: strippedRules,
      };
      const validPolicies = piiPolicies.filter(p => p.name.trim());
      const piiPayload: PiiConfig = {
        policies: validPolicies,
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

        {/* Detect injection toggle */}
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.88rem' }}>
            <input
              type="checkbox"
              checked={detectInjection}
              onChange={e => setDetectInjection(e.target.checked)}
              style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }}
            />
            Detect prompt injection
          </label>
          <p style={{ margin: '4px 0 0 22px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Runs built-in injection detection on every request; a hit blocks and is logged.
          </p>
        </div>

        {/* Streaming-disabled warning */}
        {hasResponseBlockingRule && <StreamingDisabledWarning />}

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

      {/* ── PII Policies ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <label className="form-label">PII Policies</label>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
          Detect and redact personal data. Each policy targets request input, model response, or both, and controls its own entity set.
        </p>

        {piiPolicies.map((policy, i) => (
          <PiiPolicyCard
            key={i}
            policy={policy}
            onChange={updated => setPiiPolicies(prev => prev.map((p, j) => j === i ? updated : p))}
            onRemove={() => setPiiPolicies(prev => prev.filter((_, j) => j !== i))}
          />
        ))}
        {piiPolicies.length === 0 && (
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 12 }}>
            No PII policies configured.
          </p>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: '0.85rem' }}
          onClick={() => setPiiPolicies(prev => [...prev, { name: '', enabled: true, target: 'request', entities: [] }])}
        >
          + Add Policy
        </button>
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
