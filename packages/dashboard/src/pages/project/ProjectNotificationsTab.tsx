import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getSettings, updateProject } from '../../api';
import type { NotificationChannel } from '@routerly/shared';
import { useProject } from './ProjectLayout';
import { useAuth } from '../../AuthContext';

function channelLabel(ch: NotificationChannel): string {
  return ch.name ?? ch.provider;
}

export function ProjectNotificationsTab() {
  const { project, setProject } = useProject();
  const { can } = useAuth();
  const canWrite = can('notification:write');

  const [globalChannels, setGlobalChannels] = useState<NotificationChannel[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>(
    project?.notifications?.channels ?? []
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSettings()
      .then(s => setGlobalChannels(s.notifications?.channels ?? []))
      .catch(() => {});
  }, []);

  // Sync selectedChannels if project context changes
  useEffect(() => {
    setSelectedChannels(project?.notifications?.channels ?? []);
  }, [project]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!project || !canWrite) return;
    setError('');
    setSaving(true);
    try {
      const updated = await updateProject(project.id, {
        name: project.name,
        models: project.models.map(m => ({ modelId: m.modelId })),
        notifications: selectedChannels.length > 0 ? { channels: selectedChannels } : null,
      });
      setProject(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error saving notification settings');
    } finally {
      setSaving(false);
    }
  }

  if (!project) return null;

  return (
    <form onSubmit={(e) => { void handleSave(e); }} style={{ maxWidth: 480 }}>
      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div style={{ marginBottom: 8 }}>
        <label className="form-label">Notification Channels</label>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
          Select which channels receive events from this project. If none selected, events go to all global channels.
        </p>
      </div>

      {globalChannels.length === 0 ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
          No notification channels configured.{' '}
          <Link to="/dashboard/settings/notifications" style={{ color: 'var(--color-primary, #6366f1)' }}>
            Go to Settings → Notifications to add channels.
          </Link>
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {globalChannels.map(ch => (
            <label key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: canWrite ? 'pointer' : 'default', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                disabled={!canWrite}
                checked={selectedChannels.includes(ch.id)}
                onChange={e => setSelectedChannels(prev =>
                  e.target.checked ? [...prev, ch.id] : prev.filter(id => id !== ch.id)
                )}
                style={{ width: 14, height: 14, accentColor: 'var(--primary)', cursor: canWrite ? 'pointer' : 'default' }}
              />
              <span style={{ fontWeight: 500 }}>{channelLabel(ch)}</span>
              {ch.name && (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>({ch.provider})</span>
              )}
            </label>
          ))}
        </div>
      )}

      {!canWrite && globalChannels.length > 0 && (
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 16 }}>
          Requires notification:write permission to edit.
        </p>
      )}

      {canWrite && globalChannels.length > 0 && (
        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving}
          style={saved ? { background: '#16a34a', borderColor: '#16a34a' } : {}}
        >
          {saving ? (
            <span className="spinner" />
          ) : saved ? (
            <><Check size={15} style={{ marginRight: 6 }} />Saved!</>
          ) : (
            'Save Changes'
          )}
        </button>
      )}
    </form>
  );
}
