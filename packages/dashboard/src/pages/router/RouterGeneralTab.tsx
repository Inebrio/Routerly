import React, { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { Copy, Check, ChevronDown, ArrowRight, Plug } from 'lucide-react';
import { createRouter, updateRouter, getSettings, type RouterKind } from '../../api';
import { useRouter } from './RouterLayout';
import { useUnsavedChanges, UnsavedChangesModal } from '../../hooks/useUnsavedChanges';
import { SearchableSelect } from '../../components/SearchableSelect';
import { CopyBlock } from '../../components/CopyBlock';
import { AUTO_MODEL, PLACEHOLDER_TOKEN } from '../connectShared';
import { writeToClipboard } from '../../utils/clipboard';
import { DEFAULT_ROUTER_TIMEOUT_MS } from '@routerly/shared';

function useKindOptions(t: (k: string) => string): { value: RouterKind; label: string; description: string }[] {
  return [
    { value: 'router', label: t('routers.general.kind.router.label'), description: t('routers.general.kind.router.description') },
    { value: 'orchestrator', label: t('routers.general.kind.orchestrator.label'), description: t('routers.general.kind.orchestrator.description') },
    { value: 'passthrough', label: t('routers.general.kind.passthrough.label'), description: t('routers.general.kind.passthrough.description') },
  ];
}

const SECTION_TITLE: React.CSSProperties = {
  fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-muted)', marginBottom: 6,
};

const SECTION_TEXT: React.CSSProperties = {
  fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 10px', lineHeight: 1.55,
};

export function RouterGeneralTab() {
  const { t } = useTranslation();
  const KIND_OPTIONS = useKindOptions(t);
  const navigate = useNavigate();
  const { router, setRouter } = useRouter();
  const isEdit = Boolean(router);

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

  // For the new token reveal modal
  const [revealedToken, setRevealedToken] = useState<{ name: string; token: string; isNew: boolean; routerId: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    name: '',
    kind: 'router' as RouterKind,
    timeoutMs: String(DEFAULT_ROUTER_TIMEOUT_MS),
    traceContent: false,
  });

  useEffect(() => {
    if (router) {
      setForm({
        name: router.name,
        kind: router.kind ?? 'router',
        timeoutMs: String(router.timeoutMs ?? DEFAULT_ROUTER_TIMEOUT_MS),
        traceContent: router.traceContent === true,
      });
    }
  }, [router]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDirty = isEdit
    ? form.name !== (/* v8 ignore next */ router?.name ?? '') ||
      form.timeoutMs !== String(/* v8 ignore next */ router?.timeoutMs ?? DEFAULT_ROUTER_TIMEOUT_MS) ||
      form.traceContent !== (/* v8 ignore next */ router?.traceContent === true)
    : form.name !== '';

  // Once the token is revealed the form is "done" — don't block navigation anymore.
  const { isBlocked, proceed, reset } = useUnsavedChanges(isDirty && !revealedToken);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      const payload = isEdit
        ? {
            name: form.name,
            ...(router!.routingModelId ? { routingModelId: router!.routingModelId } : {}),
            models: router!.models.map(m => ({ modelId: m.modelId })),
            timeoutMs: parseInt(form.timeoutMs),
            traceContent: form.traceContent,
          }
        : {
            name: form.name,
            ...(form.kind !== 'router' ? { kind: form.kind } : {}),
            models: [],
            timeoutMs: parseInt(form.timeoutMs),
          };

      if (isEdit && router) {
        await updateRouter(router.id, payload);
        // Update context and reset form so isDirty becomes false — no navigation needed
        const updated = { ...router, name: form.name, timeoutMs: parseInt(form.timeoutMs), traceContent: form.traceContent };
        setRouter(updated);
        setForm(f => ({ ...f, name: updated.name, timeoutMs: String(updated.timeoutMs), traceContent: updated.traceContent }));
      } else {
        const proj = await createRouter(payload);
        if (proj.token) {
          setRevealedToken({ name: proj.name, token: proj.token, isNew: false, routerId: proj.id });
        } else {
          navigate(`/dashboard/routers/${proj.id}/general`);
        }
      }
    } catch (err) {
      setErr(err instanceof Error ? err.message : t('routers.general.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }


  async function copyToken(token: string) {
    try {
      await writeToClipboard(token);
      setCopied(true);
      setTimeout(/* v8 ignore next */ () => setCopied(false), 2000);
    } catch { setErr(t('routers.general.errors.copyFailed')); }
  }

  // ── Token reveal view (after router creation) ───────────────────────────────
  if (revealedToken) {
    return (
      <div style={{ maxWidth: 480 }}>
        {/* Warning */}
        <div style={{ display: 'flex', gap: 10, padding: '10px 14px', marginBottom: 16, background: 'color-mix(in srgb, var(--color-warning, #f59e0b) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 40%, transparent)', borderRadius: 8 }}>
          <span style={{ fontSize: '1rem', flexShrink: 0 }}>⚠️</span>
          <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.55, color: 'var(--text-primary)' }}>
            <strong>{t('routers.general.tokenReveal.saveNow')}</strong> {t('routers.general.tokenReveal.saveNowHint')}
          </p>
        </div>

        {/* Token box */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="token-box" style={{ flex: 1, margin: 0, wordBreak: 'break-all', fontSize: '0.8rem', minWidth: 0 }}>
            {revealedToken.token}
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => copyToken(revealedToken.token)} style={{ flexShrink: 0 }}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? t('routers.general.tokenReveal.copied') : t('routers.general.tokenReveal.copy')}
          </button>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => navigate(`/dashboard/routers/${revealedToken.routerId}/general`)}
        >
          {t('routers.general.tokenReveal.goToRouter')} <ArrowRight size={15} />
        </button>
      </div>
    );
  }

  return (
    <>
      {/* ── Connection info (only when editing an existing router) ────────────── */}
      {isEdit && router && (() => {
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

        {!isEdit && (
          <div className="form-group">
            <label className="form-label">{t('routers.general.form.kind')}</label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
              {t('routers.general.form.kindFixedHint')}
            </p>
            <SearchableSelect
              ariaLabel={t('routers.general.form.kindAriaLabel')}
              value={form.kind}
              onChange={v => setForm(f => ({ ...f, kind: v as RouterKind }))}
              options={KIND_OPTIONS.map(k => ({ value: k.value, label: k.label, description: k.description }))}
              style={{ maxWidth: 420 }}
            />
          </div>
        )}

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
          <button type="submit" className="btn btn-primary" disabled={saving || (isEdit && !isDirty)}>
            {saving ? <span className="spinner" /> : isEdit ? t('routers.general.form.saveChanges') : t('routers.general.form.createRouter')}
          </button>
        </div>
      </form>

      {isBlocked && <UnsavedChangesModal onConfirm={proceed} onCancel={reset} />}
    </>
  );
}
