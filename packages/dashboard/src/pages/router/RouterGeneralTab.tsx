import React, { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Route, Shuffle, Plug, ChevronDown } from 'lucide-react';
import { updateRouter, getSettings, type RouterKind } from '../../api';
import { useRouter } from './RouterLayout';
import { useUnsavedChanges, UnsavedChangesModal } from '../../hooks/useUnsavedChanges';
import { SearchableSelect } from '../../components/SearchableSelect';
import { CopyBlock } from '../../components/CopyBlock';
import { AUTO_MODEL, PLACEHOLDER_TOKEN } from '../connectShared';
import { DEFAULT_ROUTER_TIMEOUT_MS } from '@routerly/shared';

// Kind is fixed at creation time; the General tab only ever displays it.
const KIND_ICON: Record<RouterKind, typeof Route> = {
  router: Route,
  orchestrator: Shuffle,
  passthrough: Plug,
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-muted)', marginBottom: 6,
};

const SECTION_TEXT: React.CSSProperties = {
  fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.55,
};

// Editing an existing router only — creation lives in RouterFormRouter /
// RouterFormOrchestrator / RouterFormPassthrough, one dedicated form per kind.
export function RouterGeneralTab() {
  const { t } = useTranslation();
  const { router, setRouter } = useRouter();

  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [err, setErr] = useState('');
  const [endpointOptions, setEndpointOptions] = useState<string[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('');

  // Fetch publicUrl + local addresses from settings on mount.
  useEffect(() => {
    getSettings().then(s => {
      if (s.publicUrl) {
        const url = s.publicUrl.replace(/\/$/, '');
        setEndpointOptions([url]);
        setSelectedEndpoint(url);
      } else {
        const proto = window.location.protocol;
        const port = s.port;
        const fallback = `${proto}//${window.location.hostname}:${port}`;
        const options = [fallback];
        (s.localAddresses ?? []).forEach(ip => {
          const url = `${proto}//${ip}:${port}`;
          if (!options.includes(url)) options.push(url);
        });
        setEndpointOptions(options);
        setSelectedEndpoint(options[0] ?? fallback);
      }
    }).catch(() => {});
  }, []);

  const [form, setForm] = useState({
    name: '',
    timeoutMs: String(DEFAULT_ROUTER_TIMEOUT_MS),
    traceContent: false,
  });

  useEffect(() => {
    if (router) {
      setForm({
        name: router.name,
        timeoutMs: String(router.timeoutMs ?? DEFAULT_ROUTER_TIMEOUT_MS),
        traceContent: router.traceContent === true,
      });
    }
  }, [router]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDirty =
    form.name !== (/* v8 ignore next */ router?.name ?? '') ||
    form.timeoutMs !== String(/* v8 ignore next */ router?.timeoutMs ?? DEFAULT_ROUTER_TIMEOUT_MS) ||
    form.traceContent !== (/* v8 ignore next */ router?.traceContent === true);

  const { isBlocked, proceed, reset } = useUnsavedChanges(isDirty);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!router) return;
    setErr('');
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        ...(router.routingModelId ? { routingModelId: router.routingModelId } : {}),
        models: router.models.map(m => ({ modelId: m.modelId })),
        timeoutMs: parseInt(form.timeoutMs),
        traceContent: form.traceContent,
      };
      await updateRouter(router.id, payload);
      // Update context and reset form so isDirty becomes false — no navigation needed
      const updated = { ...router, name: form.name, timeoutMs: parseInt(form.timeoutMs), traceContent: form.traceContent };
      setRouter(updated);
      setForm(f => ({ ...f, name: updated.name, timeoutMs: String(updated.timeoutMs), traceContent: updated.traceContent }));
    } catch (err) {
      setErr(err instanceof Error ? err.message : t('routers.general.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (!router) return null;
  const KindIcon = KIND_ICON[router.kind ?? 'router'];

  return (
    <>
      {/* ── Connection info (only when editing an existing router) ────────────── */}
      {router.kind === 'passthrough' && (() => {
        const root = (selectedEndpoint || window.location.origin).replace(/\/$/, '');
        const passthroughBase = `${root}/passthrough/${router.slug ?? ''}`;
        return (
          <section style={{ marginBottom: 32, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 900 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                <Plug size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>How to connect</h2>
              </div>
              <p style={SECTION_TEXT}>
                Passthrough forwards every request unmodified — use <strong>your own</strong>{' '}
                upstream provider key as the API key, never a Routerly token. Routerly does
                not store or issue a credential for this router; whatever the client sends
                goes straight to the provider.
              </p>
              <p style={SECTION_TEXT}>
                Budgets and limits do not apply to this router: cost is unknown for
                Passthrough traffic, so it is never checked against or counted toward any
                spend limit.
              </p>
              {endpointOptions.length > 1 && (
                <SearchableSelect
                  value={selectedEndpoint}
                  onChange={setSelectedEndpoint}
                  options={endpointOptions.map(opt => ({ value: opt, label: opt }))}
                  style={{ marginBottom: 10, fontSize: '0.82rem', fontFamily: 'monospace', maxWidth: 420 }}
                />
              )}
            </div>

            <div>
              <div style={SECTION_TITLE}>OpenAI SDK</div>
              <p style={SECTION_TEXT}>
                Base URL <code>{passthroughBase}</code> — no <code>/v1</code> suffix, the SDK
                still appends its own path exactly as it would against the real OpenAI API.
              </p>
              <CopyBlock text={`from openai import OpenAI

client = OpenAI(
    base_url="${passthroughBase}",
    api_key="<your OpenAI API key>",
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}],
)`} />
            </div>

            <div>
              <div style={SECTION_TITLE}>Anthropic SDK</div>
              <p style={SECTION_TEXT}>
                Base URL <code>{passthroughBase}</code> — the SDK still appends{' '}
                <code>/v1/messages</code> itself, exactly as it would against the real
                Anthropic API.
              </p>
              <CopyBlock text={`from anthropic import Anthropic

client = Anthropic(
    base_url="${passthroughBase}",
    api_key="<your Anthropic API key>",
)

message = client.messages.create(
    model="claude-opus-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)`} />
            </div>
          </section>
        );
      })()}

      {/* ── Connection info (only when editing an existing non-passthrough router) ────────────── */}
      {router.kind !== 'passthrough' && (() => {
        const root = (selectedEndpoint || window.location.origin).replace(/\/$/, '');
        // The two SDKs disagree on where the version prefix lives: the OpenAI
        // client appends the path to whatever base URL it is given, the
        // Anthropic client appends `/v1/messages` itself.
        const openaiBase = `${root}/v1`;
        return (
          <section style={{ marginBottom: 32, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 900 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                <Plug size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>{t('routers.general.connect.heading')}</h2>
              </div>
              <p style={SECTION_TEXT}>
                <Trans
                  i18nKey="routers.general.connect.intro"
                  values={{ token: PLACEHOLDER_TOKEN, model: AUTO_MODEL }}
                  components={{
                    tokenLink: <Link to={`/dashboard/routers/${router.id}/token`} />,
                    code: <code />,
                    modelsLink: <Link to="/dashboard/models" />,
                  }}
                />
              </p>
              {endpointOptions.length > 1 && (
                <SearchableSelect
                  value={selectedEndpoint}
                  onChange={setSelectedEndpoint}
                  options={endpointOptions.map(opt => ({ value: opt, label: opt }))}
                  style={{ marginBottom: 10, fontSize: '0.82rem', fontFamily: 'monospace', maxWidth: 420 }}
                />
              )}
            </div>

            <div>
              <div style={SECTION_TITLE}>{t('routers.general.connect.openaiSdk')}</div>
              <p style={SECTION_TEXT}>
                <Trans
                  i18nKey="routers.general.connect.openaiBaseUrlHint"
                  components={{ code: <code /> }}
                  values={{ baseUrl: openaiBase }}
                />
              </p>
              <CopyBlock text={`from openai import OpenAI

client = OpenAI(
    base_url="${openaiBase}",
    api_key="${PLACEHOLDER_TOKEN}",
)

response = client.chat.completions.create(
    model="${AUTO_MODEL}",
    messages=[{"role": "user", "content": "Hello!"}],
)`} />
            </div>

            <div>
              <div style={SECTION_TITLE}>{t('routers.general.connect.anthropicSdk')}</div>
              <p style={SECTION_TEXT}>
                <Trans
                  i18nKey="routers.general.connect.anthropicBaseUrlHint"
                  components={{ code: <code /> }}
                  values={{ baseUrl: root }}
                />
              </p>
              <CopyBlock text={`from anthropic import Anthropic

client = Anthropic(
    base_url="${root}",
    api_key="${PLACEHOLDER_TOKEN}",
)

message = client.messages.create(
    model="${AUTO_MODEL}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)`} />
            </div>

            <div>
              <div style={SECTION_TITLE}>{t('routers.general.connect.curl')}</div>
              <p style={SECTION_TEXT}>
                <Trans
                  i18nKey="routers.general.connect.curlHint"
                  components={{ usageLink: <Link to="/dashboard/usage" /> }}
                />
              </p>
              <CopyBlock text={`curl ${openaiBase}/chat/completions \\
  -H "Authorization: Bearer ${PLACEHOLDER_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${AUTO_MODEL}","messages":[{"role":"user","content":"Hello!"}]}'`} />
            </div>
          </section>
        );
      })()}

      <form onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
        {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

        <div className="form-group">
          <label className="form-label">{t('routers.general.form.kind')}</label>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
            {t('routers.general.form.kindFixedHint')}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
            <KindIcon size={16} style={{ color: 'var(--accent)' }} />
            {t(`routers.general.kind.${router.kind ?? 'router'}.label`)}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">{t('routers.general.form.routerName')}</label>
          <input
            className="form-input"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder={t('routers.general.form.routerNamePlaceholder')}
            required
          />
        </div>

        {router.kind === 'passthrough' && (
          <div className="form-group">
            <label className="form-label">{t('routers.general.form.passthroughPath')}</label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
              <Trans
                i18nKey="routers.general.form.passthroughPathHint"
                values={{ path: router.slug || '<path>' }}
                components={{ code: <code /> }}
              />
            </p>
            <CopyBlock text={`${(selectedEndpoint || window.location.origin).replace(/\/$/, '')}/passthrough/${router.slug ?? ''}`} />
          </div>
        )}

        {/* ── Advanced Settings ─────────────────────────── */}
        <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <button type="button" onClick={() => setShowAdvanced(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.82rem', fontWeight: 500, padding: '2px 0', userSelect: 'none' }}>
            <ChevronDown size={15} style={{ transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }} />
            {t('routers.general.form.advancedSettings')}
          </button>

          {showAdvanced && (
            <div style={{ marginTop: 16 }}>
              <div className="form-group">
                <label className="form-label">{t('routers.general.form.ttftTimeout')}</label>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
                  {t('routers.general.form.ttftTimeoutHint')}
                </p>
                <input
                  className="form-input"
                  type="number"
                  value={form.timeoutMs}
                  onChange={e => setForm(f => ({ ...f, timeoutMs: e.target.value }))}
                  min={0}
                  step={100}
                />
              </div>

              <div className="form-group">
                <label className="form-label">{t('routers.general.form.traceContent')}</label>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
                  {t('routers.general.form.traceContentHint')}
                </p>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.traceContent}
                    onChange={e => setForm(f => ({ ...f, traceContent: e.target.checked }))}
                    style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }}
                  />
                  {t('routers.general.form.capturePromptsAndAnswers')}
                </label>
              </div>

            </div>
          )}
        </div>

        <div style={{ marginTop: 24 }}>
          <button type="submit" className="btn btn-primary" disabled={saving || !isDirty}>
            {saving ? <span className="spinner" /> : t('routers.general.form.saveChanges')}
          </button>
        </div>
      </form>

      {isBlocked && <UnsavedChangesModal onConfirm={proceed} onCancel={reset} />}
    </>
  );
}
