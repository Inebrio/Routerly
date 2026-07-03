import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { checkSetupStatus, verify2fa } from '../api';
import { Logo } from '../components/Logo';

export function LoginPage() {
  const { login, loginDirect, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (() => {
    const to = new URLSearchParams(location.search).get('to');
    return to && to.startsWith('/dashboard/') ? to : '/dashboard/overview';
  })();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);

  // 2FA step state
  const [totpUserId, setTotpUserId] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);

  useEffect(() => {
    if (user) { navigate(redirectTo, { replace: true }); return; }
    checkSetupStatus()
      .then(({ needsSetup }) => {
        if (needsSetup) navigate('/dashboard/setup', { replace: true });
      })
      .catch(() => { /* service unreachable, show login as fallback */ })
      .finally(() => setCheckingSetup(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result?.requiresTotp) {
        setTotpUserId(result.userId);
      } else {
        navigate(redirectTo, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleTotpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await verify2fa(
        totpUserId!,
        useBackupCode ? undefined : totpCode,
        useBackupCode ? totpCode : undefined,
      );
      loginDirect(result.token, result.user);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '2FA verification failed');
    } finally {
      setLoading(false);
    }
  }

  if (checkingSetup) return <div className="loading-center"><div className="spinner" /></div>;

  if (totpUserId) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">
            <Logo size={52} />
            <h1>Two-Factor Authentication</h1>
            <p>{useBackupCode ? 'Enter a backup code.' : 'Enter the 6-digit code from your authenticator app.'}</p>
          </div>
          <form onSubmit={handleTotpSubmit}>
            {error && <div className="form-error">{error}</div>}
            <div className="form-group">
              <label className="form-label" htmlFor="totp-code">
                {useBackupCode ? 'Backup Code' : 'Authenticator Code'}
              </label>
              <input
                id="totp-code"
                type="text"
                className="form-input"
                value={totpCode}
                onChange={e => setTotpCode(e.target.value.trim())}
                placeholder={useBackupCode ? 'XXXXXXXX' : '000000'}
                maxLength={useBackupCode ? 8 : 6}
                autoComplete="one-time-code"
                required
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
            >
              {loading ? <span className="spinner" /> : 'Verify'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
              onClick={() => { setUseBackupCode(b => !b); setTotpCode(''); setError(''); }}
            >
              {useBackupCode ? 'Use authenticator app instead' : 'Use a backup code instead'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <Logo size={52} />
          <h1>Routerly.ai</h1>
          <p>One gateway. Any AI model. Total control.</p>
        </div>
        <form onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}
          <div className="form-group">
            <label className="form-label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="form-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="form-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
          >
            {loading ? <span className="spinner" /> : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
