import { useEffect, useCallback } from 'react';
import { useBlocker } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function useUnsavedChanges(isDirty: boolean) {
  const blocker = useBlocker(isDirty);

  // Warn on browser close / page refresh
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const proceed = useCallback(() => blocker.proceed?.(), [blocker]);
  const reset = useCallback(() => blocker.reset?.(), [blocker]);

  return {
    isBlocked: blocker.state === 'blocked',
    proceed,
    reset,
  };
}

export function UnsavedChangesModal({ onConfirm, onCancel }: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 420 }}>
        <h2 className="modal-title">{t('common.unsavedChanges.title')}</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 24 }}>
          {t('common.unsavedChanges.message')}
        </p>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>{t('common.unsavedChanges.stay')}</button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--danger, #e53e3e)', borderColor: 'var(--danger, #e53e3e)' }}
            onClick={onConfirm}
          >
            {t('common.unsavedChanges.leaveAnyway')}
          </button>
        </div>
      </div>
    </div>
  );
}
