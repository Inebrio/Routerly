import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  getConnections, createConnection, updateConnection, getProviderDescriptors,
  type ProviderDescriptor,
} from '../api';
import { ConnectionForm, type ConnectionFormState, emptyForm, credentialsToRecord } from '../components/ConnectionForm';

export function ConnectionFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEditing = Boolean(id);

  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [form, setForm] = useState<ConnectionFormState>(emptyForm(''));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    async function init() {
      setLoading(true);
      setErr('');
      try {
        const descriptors = await getProviderDescriptors();
        setProviders(descriptors);
        if (isEditing && id) {
          const connections = await getConnections();
          const conn = connections.find(c => c.id === id);
          if (conn) {
            setForm({ providerId: conn.providerId, label: conn.label, endpoint: conn.endpoint ?? '', enabled: conn.enabled, credentials: [] });
          } else {
            setErr('Connection not found');
          }
        } else {
          setForm(emptyForm(descriptors[0]?.id ?? ''));
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load connection');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [id, isEditing]);

  async function handleSave() {
    setSaving(true);
    setErr('');
    try {
      if (isEditing && id) {
        const patch: Parameters<typeof updateConnection>[1] = {
          providerId: form.providerId,
          label: form.label,
          ...(form.endpoint ? { endpoint: form.endpoint } : {}),
          enabled: form.enabled,
        };
        const credentials = credentialsToRecord(form.credentials);
        if (Object.keys(credentials).length > 0) patch.credentials = credentials;
        await updateConnection(id, patch);
      } else {
        await createConnection({
          providerId: form.providerId,
          label: form.label,
          ...(form.endpoint ? { endpoint: form.endpoint } : {}),
          enabled: form.enabled,
          credentials: credentialsToRecord(form.credentials),
        });
      }
      navigate('/dashboard/connections');
    } catch (e) {
      setErr(e instanceof Error ? e.message : `Failed to ${isEditing ? 'update' : 'create'} connection`);
      setSaving(false);
    }
  }

  const goBack = () => navigate('/dashboard/connections');

  if (loading) {
    return (
      <div className="page-body">
        <div className="loading-center"><div className="spinner" /></div>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <button className="btn-icon" onClick={goBack} style={{ marginBottom: 16, display: 'inline-flex', padding: 4, width: 'fit-content' }}>
          <ArrowLeft size={16} /><span style={{ marginLeft: 6, fontSize: '0.8rem', fontWeight: 500 }}>Back to Connections</span>
        </button>
        <h1>{isEditing ? 'Edit Connection' : 'Add Connection'}</h1>
        <p>{isEditing ? 'Update the provider account settings' : 'Register a new provider account'}</p>
      </div>

      <div className="page-body">
        {err && <div className="form-error" style={{ marginBottom: 20 }}>{err}</div>}
        <div style={{ maxWidth: 800 }}>
          <ConnectionForm
            form={form}
            onChange={setForm}
            onSave={handleSave}
            onCancel={goBack}
            saving={saving}
            providers={providers}
            isNew={!isEditing}
          />
        </div>
      </div>
    </>
  );
}
