import React, { useState } from 'react';
import { User, Lock } from 'lucide-react';
import { updateMe } from '../api';
import { useAuth } from '../AuthContext';

export function ProfilePage() {
  const { user } = useAuth();

  const [pwForm, setPwForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSaved, setPwSaved] = useState(false);
  const [pwError, setPwError] = useState('');

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    setPwSaved(false);
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('Passwords do not match.');
      return;
    }
    if (pwForm.newPassword.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    setPwSaving(true);
    try {
      await updateMe({
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPwSaved(true);
      setTimeout(() => setPwSaved(false), 3000);
    } catch (e) {
      setPwError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>My Profile</h1>
        <p>Manage your account settings</p>
      </div>

      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 520 }}>

        {/* ── Account info (read-only) ─────────────────────────────────────────── */}
        <div style={{
          background: 'var(--surface-2, rgba(255,255,255,0.04))',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '16px 20px',
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'linear-gradient(135deg, #3d75f5, #5a90f8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <User size={20} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
              {user?.email}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
              Role: <span style={{ color: 'var(--text-secondary)' }}>{user?.role}</span>
            </div>
          </div>
        </div>

        {/* ── Change password ────────────────────────────────────────────────── */}
        <section>
          <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 14 }}>
            Change Password
          </h3>
          <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="p-cur-pw">Current Password</label>
              <input
                id="p-cur-pw"
                type="password"
                className="form-input"
                value={pwForm.currentPassword}
                onChange={e => setPwForm(f => ({ ...f, currentPassword: e.target.value }))}
                required
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="p-new-pw">New Password</label>
              <input
                id="p-new-pw"
                type="password"
                className="form-input"
                value={pwForm.newPassword}
                onChange={e => setPwForm(f => ({ ...f, newPassword: e.target.value }))}
                placeholder="Minimum 8 characters"
                required
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="p-conf-pw">Confirm New Password</label>
              <input
                id="p-conf-pw"
                type="password"
                className="form-input"
                value={pwForm.confirmPassword}
                onChange={e => setPwForm(f => ({ ...f, confirmPassword: e.target.value }))}
                required
              />
            </div>
            {pwError && <div className="form-error">{pwError}</div>}
            {pwSaved && <div style={{ padding: '8px 12px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, fontSize: '0.83rem', color: '#22c55e' }}>Password changed successfully.</div>}
            <div>
              <button type="submit" className="btn btn-primary" disabled={pwSaving}>
                {pwSaving
                  ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</>
                  : <><Lock size={14} /> Change Password</>}
              </button>
            </div>
          </form>
        </section>

      </div>
    </>
  );
}

