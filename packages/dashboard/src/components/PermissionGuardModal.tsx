import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fixPermissions } from '../api';

export interface PermissionBlockedDetail {
  error: string;
  message: string;
  files: string[];
}

interface Props {
  detail: PermissionBlockedDetail;
  onFixed: () => void;
  onCancel: () => void;
}

/**
 * Blocking modal shown when the service returns 423 (unsafe secrets-file
 * permissions). Reuses the ConfirmDialog overlay/card styling. "Fix now"
 * chmods the offending files server-side; "Cancel" leaves the block in
 * place — the action that triggered it is not retried automatically.
 */
export function PermissionGuardModal({ detail, onFixed, onCancel }: Props) {
  const { t } = useTranslation();
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFix() {
    setFixing(true);
    setError(null);
    try {
      await fixPermissions();
      onFixed();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.permissionGuard.fixFailed'));
    } finally {
      setFixing(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div className="card" style={{ maxWidth: 480, width: '90%', padding: 24 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>{t('common.permissionGuard.title')}</h3>
        <p style={{ marginBottom: 12 }}>
          {detail.message || t('common.permissionGuard.defaultMessage')}
        </p>
        {detail.files?.length > 0 && (
          <ul style={{ marginBottom: 16, paddingLeft: 20 }}>
            {detail.files.map(file => (
              <li key={file} style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{file}</li>
            ))}
          </ul>
        )}
        {error && (
          <p style={{ color: 'var(--error, #e53e3e)', marginBottom: 12 }}>{error}</p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onCancel} disabled={fixing}>{t('common.cancel')}</button>
          <button className="btn btn-danger" onClick={handleFix} disabled={fixing}>
            {fixing ? t('common.permissionGuard.fixing') : t('common.permissionGuard.fixNow')}
          </button>
        </div>
      </div>
    </div>
  );
}
