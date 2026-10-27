import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchableSelect } from './SearchableSelect';
import { ConfirmDialog } from './ConfirmDialog';

/** Shown while the profile/custom choice differs from what is stored. */
export function PendingProfileNotice({ profileLabel, onDiscard }: { profileLabel: string | null; onDiscard: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16,
        padding: '10px 14px', borderRadius: 8, fontSize: '0.82rem',
        border: '1px solid var(--warning, #f59e0b)', background: 'var(--surface-active)',
      }}
    >
      <span style={{ flex: 1, minWidth: 200 }}>
        {profileLabel === null
          ? t('routers.profileDraft.pendingCustom')
          : t('routers.profileDraft.pendingProfile', { label: profileLabel })}
      </span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onDiscard}>
        {t('routers.profileDraft.discard')}
      </button>
    </div>
  );
}

/**
 * Explicit "start Custom from a copy of a profile". The copy only fills the
 * editor; it is stored on save. Asks first when custom settings already exist.
 */
export function StartFromProfile({ options, hasCustom, onCopy }: {
  options: { value: string; label: string }[];
  hasCustom: boolean;
  onCopy: (profileId: string) => void;
}) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState('');
  const [confirming, setConfirming] = useState(false);
  if (options.length === 0) return null;

  function apply() {
    onCopy(choice);
    setChoice('');
    setConfirming(false);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      <SearchableSelect
        style={{ minWidth: 260 }}
        ariaLabel={t('routers.profileDraft.startFromAria')}
        value={choice}
        onChange={setChoice}
        placeholder={t('routers.profileDraft.startFromPlaceholder')}
        options={options}
      />
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={choice === ''}
        onClick={() => (hasCustom ? setConfirming(true) : apply())}
      >
        {t('routers.profileDraft.startFromButton')}
      </button>
      {confirming && (
        <ConfirmDialog
          message={t('routers.profileDraft.replaceConfirm')}
          confirmLabel={t('routers.profileDraft.replaceConfirmButton')}
          onConfirm={apply}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
