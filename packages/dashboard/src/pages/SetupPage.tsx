import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { setupFirstAdmin, checkSetupStatus } from '../api';
import { useAuth } from '../AuthContext';
import { Logo } from '../components/Logo';

export function SetupPage() {
  const { t } = useTranslation();
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
    if (password !== confirm) { setError(t('setup.errors.mismatch')); return; }
    if (password.length < 8) { setError(t('setup.errors.tooShort')); return; }
    setLoading(true);
    try {
      const { token, user } = await setupFirstAdmin(email, password);
      loginDirect(token, user);
      navigate('/dashboard/overview', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('setup.errors.setupFailed'));
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
          <p>{t('app.tagline')}</p>
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
            {t('setup.welcome')}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginTop: 4 }}>
            {t('setup.welcomeSubtitle')}
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
          <span style={{ fontWeight: 600, color: 'rgba(234,179,8,0.9)' }}>{t('setup.betaBadge')}</span>
          {' '}— {t('setup.betaNotice')}{' '}
          {t('setup.betaFeedback')}{' '}
          <a
            href="https://github.com/Inebrio/Routerly/issues"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'rgba(234,179,8,0.8)', textDecoration: 'underline' }}
          >
            {t('setup.betaLink')}
          </a>.
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}
          <div className="form-group">
            <label className="form-label" htmlFor="setup-email">{t('setup.emailLabel')}</label>
            <input
              id="setup-email"
              type="email"
              className="form-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('setup.emailPlaceholder')}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="setup-password">{t('setup.passwordLabel')}</label>
            <input
              id="setup-password"
              type="password"
              className="form-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={t('setup.passwordPlaceholder')}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="setup-confirm">{t('setup.confirmLabel')}</label>
            <input
              id="setup-confirm"
              type="password"
              className="form-input"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder={t('setup.confirmPlaceholder')}
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
          >
            {loading ? <span className="spinner" /> : t('setup.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
