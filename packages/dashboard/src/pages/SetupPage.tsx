import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setupFirstAdmin, checkSetupStatus } from '../api';
import { useAuth } from '../AuthContext';
import { Logo } from '../components/Logo';

export function SetupPage() {
  const navigate = useNavigate();
  const { loginDirect, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect away if already logged in or setup already completed
  useEffect(() => {
    if (user) {
      navigate('/dashboard/overview', { replace: true });
      return;
    }
    checkSetupStatus().then(({ needsSetup }) => {
      if (!needsSetup) navigate('/dashboard/login', { replace: true });
    }).catch(() => {});
  }, [user, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      const { token, user } = await setupFirstAdmin(email, password);
      loginDirect(token, user);
      navigate('/dashboard/overview', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 420 }}>
        <div className="login-logo">
          <Logo size={52} />
          <h1>Routerly.ai</h1>
          <p>One gateway. Any AI model. Total control.</p>
        </div>

        <div style={{
          background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.1))',
          border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: 10,
          padding: '12px 16px',
          marginBottom: 24,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>🚀</div>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
            Welcome! Let's get you set up.
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginTop: 4 }}>
            Create the first admin account to start managing Routerly.
          </div>
        </div>

        <div style={{
          background: 'rgba(234,179,8,0.08)',
          border: '1px solid rgba(234,179,8,0.25)',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 20,
          fontSize: '0.78rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}>
          <span style={{ fontWeight: 600, color: 'rgba(234,179,8,0.9)' }}>🚧 Beta</span>
          {' '}— Routerly is actively evolving. Bugs may occur.{' '}
          Your feedback helps shape what it becomes —{' '}
          <a
            href="https://github.com/Inebrio/Routerly/issues"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'rgba(234,179,8,0.8)', textDecoration: 'underline' }}
          >
            report issues or share ideas
          </a>.
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}
          <div className="form-group">
            <label className="form-label" htmlFor="setup-email">Admin Email</label>
            <input
              id="setup-email"
              type="email"
              className="form-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="setup-password">Password</label>
            <input
              id="setup-password"
              type="password"
              className="form-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="setup-confirm">Confirm Password</label>
            <input
              id="setup-confirm"
              type="password"
              className="form-input"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Re-enter password"
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
          >
            {loading ? <span className="spinner" /> : 'Create Admin Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
