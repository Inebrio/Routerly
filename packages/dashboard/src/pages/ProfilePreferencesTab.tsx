import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../LanguageContext';
import { SUPPORTED_LANGUAGES } from '../locales/languages';
import { SearchableSelect } from '../components/SearchableSelect';

const SECTION_TITLE: React.CSSProperties = {
  fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-muted)', marginBottom: 14,
};

const LANGUAGE_OPTIONS = SUPPORTED_LANGUAGES.map(l => ({ value: l.code, label: l.name }));

export function ProfilePreferencesTab() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleChange(code: string) {
    setSaving(true);
    setSaved(false);
    try {
      await setLanguage(code);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 520 }}>
      <section>
        <h3 style={SECTION_TITLE}>{t('profile.preferences.heading')}</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 16 }}>
          {t('profile.preferences.description')}
        </p>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" htmlFor="preferences-language">{t('profile.preferences.languageLabel')}</label>
          <SearchableSelect
            ariaLabel={t('profile.preferences.languageLabel')}
            options={LANGUAGE_OPTIONS}
            value={language}
            onChange={code => void handleChange(code)}
            disabled={saving}
            style={{ maxWidth: 280 }}
          />
        </div>
        {saved && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, fontSize: '0.83rem', color: '#22c55e' }}>
            {t('profile.preferences.saved')}
          </div>
        )}
      </section>
    </div>
  );
}
