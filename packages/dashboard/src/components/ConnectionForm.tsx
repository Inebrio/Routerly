import React from 'react';
import { Plus, Save, X } from 'lucide-react';
import { type ProviderDescriptor } from '../api';
import { SearchableSelect } from './SearchableSelect';

export interface CredentialRow { key: string; value: string }

export interface ConnectionFormState {
  providerId: string;
  label: string;
  endpoint: string;
  enabled: boolean;
  credentials: CredentialRow[];
}

export function emptyForm(defaultProviderId: string): ConnectionFormState {
  return { providerId: defaultProviderId, label: '', endpoint: '', enabled: true, credentials: [] };
}

export function credentialsToRecord(rows: CredentialRow[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim()) record[row.key.trim()] = row.value;
  }
  return record;
}

interface ConnectionFormProps {
  form: ConnectionFormState;
  onChange: React.Dispatch<React.SetStateAction<ConnectionFormState>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  providers: ProviderDescriptor[];
  isNew?: boolean;
}

export function ConnectionForm({ form, onChange, onSave, onCancel, saving, providers, isNew }: ConnectionFormProps) {
  function addCredentialRow() {
    onChange(f => ({ ...f, credentials: [...f.credentials, { key: '', value: '' }] }));
  }
  function updateCredentialRow(index: number, patch: Partial<CredentialRow>) {
    onChange(f => ({ ...f, credentials: f.credentials.map((row, i) => i === index ? { ...row, ...patch } : row) }));
  }
  function removeCredentialRow(index: number) {
    onChange(f => ({ ...f, credentials: f.credentials.filter((_, i) => i !== index) }));
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 12, border: '1px solid var(--primary)', borderRadius: 8 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="form-group" style={{ flex: '0 0 200px', marginBottom: 0 }}>
          <label className="form-label">Provider</label>
          <SearchableSelect
            options={providers.map(p => ({ value: p.id, label: p.label }))}
            value={form.providerId}
            onChange={v => onChange(f => ({ ...f, providerId: v }))}
          />
        </div>
        <div className="form-group" style={{ flex: '1 1 180px', marginBottom: 0 }}>
          <label className="form-label" htmlFor="conn-label">Label</label>
          <input id="conn-label" className="form-input" placeholder="e.g. Primary OpenAI account" value={form.label}
            onChange={e => onChange(f => ({ ...f, label: e.target.value }))} />
        </div>
        <div className="form-group" style={{ flex: '1 1 200px', marginBottom: 0 }}>
          <label className="form-label" htmlFor="conn-endpoint">Endpoint (optional)</label>
          <input id="conn-endpoint" className="form-input" placeholder="https://api.example.com/v1" value={form.endpoint}
            onChange={e => onChange(f => ({ ...f, endpoint: e.target.value }))} />
        </div>
        <div className="form-group" style={{ flex: '0 0 auto', marginBottom: 0, display: 'flex', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem', height: 36 }}>
            <input type="checkbox" checked={form.enabled} onChange={e => onChange(f => ({ ...f, enabled: e.target.checked }))} />
            Enabled
          </label>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="form-label" style={{ marginBottom: 8, display: 'block' }}>
          Credentials{!isNew && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> (leave empty to keep existing)</span>}
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {form.credentials.map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <input className="form-input" placeholder="e.g. apiKey" value={row.key}
                onChange={e => updateCredentialRow(i, { key: e.target.value })} style={{ flex: '0 0 180px' }} />
              <input className="form-input" placeholder="value" type="password" autoComplete="new-password" value={row.value}
                onChange={e => updateCredentialRow(i, { value: e.target.value })} style={{ flex: 1 }} />
              <button type="button" className="btn-icon danger" onClick={() => removeCredentialRow(i)} title="Remove field">
                <X size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={addCredentialRow}>
            <Plus size={13} /> Add credential field
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={saving || !form.label.trim()} onClick={onSave}>
          {saving ? <span className="spinner" /> : <><Save size={14} /> {isNew ? 'Create' : 'Save'}</>}
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>
          <X size={14} /> Cancel
        </button>
      </div>
    </div>
  );
}
