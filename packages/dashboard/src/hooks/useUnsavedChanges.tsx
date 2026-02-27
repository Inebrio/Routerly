import { useEffect, useCallback } from 'react';
import { useBlocker } from 'react-router-dom';

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
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 420 }}>
        <h2 className="modal-title">Unsaved Changes</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 24 }}>
          You have unsaved changes. If you leave now, your changes will be lost.
        </p>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Stay</button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--danger, #e53e3e)', borderColor: 'var(--danger, #e53e3e)' }}
            onClick={onConfirm}
          >
            Leave anyway
          </button>
        </div>
      </div>
    </div>
  );
}
