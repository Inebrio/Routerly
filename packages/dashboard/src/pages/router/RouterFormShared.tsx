import React, { useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Copy, Check, ChevronDown, ArrowRight } from 'lucide-react';
import { createRouter, type RouterKind } from '../../api';
import { useUnsavedChanges, UnsavedChangesModal } from '../../hooks/useUnsavedChanges';
import { writeToClipboard } from '../../utils/clipboard';
import { DEFAULT_ROUTER_TIMEOUT_MS } from '@routerly/shared';

/**
 * Fields shared by every router-creation form (name + advanced settings).
 * Kind-specific fields (e.g. Passthrough's path) are rendered by the caller
 * as `children`, between the name field and the advanced-settings block.
 */
export interface CommonFormState {
  name: string;
  timeoutMs: string;
  traceContent: boolean;
}

export function useCommonRouterForm() {
  return useState<CommonFormState>({
    name: '',
    timeoutMs: String(DEFAULT_ROUTER_TIMEOUT_MS),
    traceContent: false,
  });
}

interface RouterCreateFormProps {
  kind: RouterKind;
  /** Extra fields to merge into the creation payload (e.g. `{ slug }` for Passthrough). */
  buildExtraPayload: () => Record<string, unknown>;
  /** Where to send the user once the router exists (after any token reveal). */
  afterCreatePath: (routerId: string) => string;
  submitLabel: string;
  /** Kind-specific fields, rendered between the name field and advanced settings. */
  children?: React.ReactNode;
}

export function RouterCreateForm({ kind, buildExtraPayload, afterCreatePath, submitLabel, children }: RouterCreateFormProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [common, setCommon] = useCommonRouterForm();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [revealedToken, setRevealedToken] = useState<{ token: string; routerId: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const isDirty = common.name !== '';
  const { isBlocked, proceed, reset } = useUnsavedChanges(isDirty && !revealedToken);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      const payload = {
        name: common.name,
        ...(kind !== 'router' ? { kind } : {}),
        models: [],
        timeoutMs: parseInt(common.timeoutMs),
        traceContent: common.traceContent,
        ...buildExtraPayload(),
      };
      const proj = await createRouter(payload);
      if (proj.token) {
        setRevealedToken({ token: proj.token, routerId: proj.id });
      } else {
        // Reset so isDirty becomes false, and flush synchronously — the
        // blocker reads isDirty from a ref updated by an effect, and a plain
        // setState wouldn't flush before the navigate() call right below,
        // leaving the blocker armed and trapping the app's own redirect.
        flushSync(() => setCommon(f => ({ ...f, name: '' })));
        navigate(afterCreatePath(proj.id));
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

  if (revealedToken) {
    return (
      <div style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', gap: 10, padding: '10px 14px', marginBottom: 16, background: 'color-mix(in srgb, var(--color-warning, #f59e0b) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 40%, transparent)', borderRadius: 8 }}>
          <span style={{ fontSize: '1rem', flexShrink: 0 }}>⚠️</span>
          <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.55, color: 'var(--text-primary)' }}>
            <strong>{t('routers.general.tokenReveal.saveNow')}</strong> {t('routers.general.tokenReveal.saveNowHint')}
          </p>
        </div>

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
          onClick={() => navigate(afterCreatePath(revealedToken.routerId))}
        >
          {t('routers.general.tokenReveal.goToRouter')} <ArrowRight size={15} />
        </button>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
        {err && <div className="form-error" style={{ marginBottom: 16 }}>{err}</div>}

        <div className="form-group">
          <label className="form-label">{t('routers.general.form.routerName')}</label>
          <input
            className="form-input"
            value={common.name}
            onChange={e => setCommon(f => ({ ...f, name: e.target.value }))}
            placeholder={t('routers.general.form.routerNamePlaceholder')}
            required
          />
        </div>

        {children}

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
                  value={common.timeoutMs}
                  onChange={e => setCommon(f => ({ ...f, timeoutMs: e.target.value }))}
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
                    checked={common.traceContent}
                    onChange={e => setCommon(f => ({ ...f, traceContent: e.target.checked }))}
                    style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: 'pointer' }}
                  />
                  {t('routers.general.form.capturePromptsAndAnswers')}
                </label>
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 24 }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <span className="spinner" /> : submitLabel}
          </button>
        </div>
      </form>

      {isBlocked && <UnsavedChangesModal onConfirm={proceed} onCancel={reset} />}
    </>
  );
}
