import { useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { RouterCreateForm } from './RouterFormShared';

export function RouterFormPassthrough() {
  const { t } = useTranslation();
  const [slug, setSlug] = useState('');

  return (
    <RouterCreateForm
      kind="passthrough"
      buildExtraPayload={() => ({ slug })}
      afterCreatePath={id => `/dashboard/routers/${id}/general`}
      submitLabel={t('routers.general.form.createPassthrough')}
    >
      <div className="form-group">
        <label className="form-label">{t('routers.general.form.passthroughPath')}</label>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
          <Trans
            i18nKey="routers.general.form.passthroughPathHint"
            values={{ path: slug || '<path>' }}
            components={{ code: <code /> }}
          />
        </p>
        <input
          className="form-input"
          value={slug}
          onChange={e => setSlug(e.target.value)}
          placeholder="my-provider"
          required
        />
      </div>
    </RouterCreateForm>
  );
}
