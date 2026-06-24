import React, { useState } from 'react';
import { User, Lock, ShieldCheck, ShieldOff } from 'lucide-react';
import { updateMe, setup2fa, confirm2fa, disable2fa, regenerateBackupCodes } from '../api';
import { useAuth } from '../AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type TwoFaStep = 'idle' | 'setup' | 'confirm' | 'enabled';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function qrImageUrl(otpauthUrl: string): string {
  return `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(otpauthUrl)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProfilePage() {
  const { user } = useAuth();

  // ── Change password ─────────────────────────────────────────────────────────
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

  // ── 2FA ─────────────────────────────────────────────────────────────────────
  const [tfaStep, setTfaStep] = useState<TwoFaStep>('idle');
  const [tfaSecret, setTfaSecret] = useState('');
  const [tfaQrUrl, setTfaQrUrl] = useState('');
  const [tfaBackupCodes, setTfaBackupCodes] = useState<string[]>([]);
  const [tfaCode, setTfaCode] = useState('');
  const [tfaError, setTfaError] = useState('');
  const [tfaBusy, setTfaBusy] = useState(false);
  // Track server-side 2FA status; we infer it from the flow (no me.totpEnabled field in API)
  const [tfaEnabled, setTfaEnabled] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [backupVisible, setBackupVisible] = useState(false);
  const [newBackupCodes, setNewBackupCodes] = useState<string[]>([]);
  const [regenCode, setRegenCode] = useState('');

  async function handleSetup2fa() {
    setTfaError('');
    setTfaBusy(true);
    try {
      const res = await setup2fa();
      setTfaSecret(res.secret);
      setTfaQrUrl(res.qrUrl);
      setTfaBackupCodes(res.backupCodes);
      setTfaStep('setup');
    } catch (e) {
      setTfaError(e instanceof Error ? e.message : 'Setup failed');
    } finally {
      setTfaBusy(false);
    }
  }

  async function handleConfirm2fa(e: React.FormEvent) {
    e.preventDefault();
    setTfaError('');
    setTfaBusy(true);
    try {
      await confirm2fa(tfaCode);
      setTfaCode('');
      setTfaStep('enabled');
      setTfaEnabled(true);
    } catch (e) {
      setTfaError(e instanceof Error ? e.message : 'Confirmation failed');
    } finally {
      setTfaBusy(false);
    }
  }

  async function handleDisable2fa(e: React.FormEvent) {
    e.preventDefault();
    setTfaError('');
    setTfaBusy(true);
    try {
      await disable2fa(disableCode);
      setDisableCode('');
      setTfaEnabled(false);
      setTfaStep('idle');
    } catch (e) {
      setTfaError(e instanceof Error ? e.message : 'Disable failed');
    } finally {
      setTfaBusy(false);
    }
  }

  async function handleRegenerateBackupCodes(e: React.FormEvent) {
    e.preventDefault();
    setTfaError('');
    setTfaBusy(true);
    try {
      const res = await regenerateBackupCodes(regenCode);
      setNewBackupCodes(res.backupCodes);
      setRegenCode('');
      setBackupVisible(false);
    } catch (e) {
      setTfaError(e instanceof Error ? e.message : 'Regeneration failed');
    } finally {
      setTfaBusy(false);
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
                  ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving...</>
                  : <><Lock size={14} /> Change Password</>}
              </button>
            </div>
          </form>
        </section>

        {/* ── Two-Factor Authentication ──────────────────────────────────────── */}
        <section>
          <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 14 }}>
            Two-Factor Authentication
          </h3>

          {tfaError && <div className="form-error" style={{ marginBottom: 12 }}>{tfaError}</div>}

          {/* Not enrolled and no setup in progress */}
          {tfaStep === 'idle' && !tfaEnabled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                2FA is not enabled. Protect your account with a time-based one-time password.
              </p>
              <div>
                <button className="btn btn-primary" onClick={handleSetup2fa} disabled={tfaBusy}>
                  <ShieldCheck size={14} /> Enable Two-Factor Authentication
                </button>
              </div>
            </div>
          )}

          {/* Setup step: show QR + backup codes */}
          {tfaStep === 'setup' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.), then enter the 6-digit code to confirm.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <img
                  src={qrImageUrl(tfaQrUrl)}
                  alt="TOTP QR code"
                  width={200}
                  height={200}
                  style={{ border: '4px solid #fff', borderRadius: 8 }}
                />
              </div>
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  Manual entry secret:
                </p>
                <code style={{ fontSize: '0.8rem', background: 'var(--surface-2)', padding: '4px 8px', borderRadius: 4, letterSpacing: '0.1em' }}>
                  {tfaSecret}
                </code>
              </div>
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                  Save these backup codes. Each can be used once if you lose access to your authenticator.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 }}>
                  {tfaBackupCodes.map(c => (
                    <code key={c} style={{ fontSize: '0.8rem', background: 'var(--surface-2)', padding: '4px 8px', borderRadius: 4 }}>{c}</code>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: '0.8rem' }}
                  onClick={() => navigator.clipboard.writeText(tfaBackupCodes.join('\n'))}
                >
                  Copy backup codes
                </button>
              </div>
              <form onSubmit={handleConfirm2fa} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="tfa-confirm-code">Enter code from your app to activate</label>
                  <input
                    id="tfa-confirm-code"
                    type="text"
                    className="form-input"
                    value={tfaCode}
                    onChange={e => setTfaCode(e.target.value.trim())}
                    placeholder="000000"
                    maxLength={6}
                    autoComplete="one-time-code"
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary" disabled={tfaBusy}>
                    {tfaBusy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Activate 2FA'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => { setTfaStep('idle'); setTfaError(''); }}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Enabled state: show status + management options */}
          {(tfaStep === 'enabled' || tfaEnabled) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', borderRadius: 8,
                background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
              }}>
                <ShieldCheck size={16} color="#22c55e" />
                <span style={{ fontSize: '0.85rem', color: '#22c55e', fontWeight: 600 }}>2FA is enabled</span>
              </div>

              {/* Regenerate backup codes */}
              {newBackupCodes.length > 0 ? (
                <div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>New backup codes (save these now):</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 }}>
                    {newBackupCodes.map(c => (
                      <code key={c} style={{ fontSize: '0.8rem', background: 'var(--surface-2)', padding: '4px 8px', borderRadius: 4 }}>{c}</code>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: '0.8rem' }}
                    onClick={() => navigator.clipboard.writeText(newBackupCodes.join('\n'))}
                  >
                    Copy
                  </button>
                </div>
              ) : backupVisible ? (
                <form onSubmit={handleRegenerateBackupCodes} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" htmlFor="regen-code">Enter authenticator code to regenerate backup codes</label>
                    <input
                      id="regen-code"
                      type="text"
                      className="form-input"
                      value={regenCode}
                      onChange={e => setRegenCode(e.target.value.trim())}
                      placeholder="000000"
                      maxLength={6}
                      autoComplete="one-time-code"
                      required
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="submit" className="btn btn-primary" disabled={tfaBusy}>
                      {tfaBusy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Regenerate'}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => { setBackupVisible(false); setTfaError(''); }}>Cancel</button>
                  </div>
                </form>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={() => setBackupVisible(true)}>
                  Regenerate backup codes
                </button>
              )}

              {/* Disable 2FA */}
              <form onSubmit={handleDisable2fa} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="disable-code">Disable 2FA (enter authenticator code)</label>
                  <input
                    id="disable-code"
                    type="text"
                    className="form-input"
                    value={disableCode}
                    onChange={e => setDisableCode(e.target.value.trim())}
                    placeholder="000000"
                    maxLength={6}
                    autoComplete="one-time-code"
                    required
                  />
                </div>
                <div>
                  <button type="submit" className="btn" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }} disabled={tfaBusy}>
                    <ShieldOff size={14} /> Disable 2FA
                  </button>
                </div>
              </form>
            </div>
          )}
        </section>

      </div>
    </>
  );
}
