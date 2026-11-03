import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, Outlet, NavLink, useLocation, useOutletContext } from 'react-router-dom';
import { ArrowLeft, Settings, Key, BarChart3 } from 'lucide-react';
import { getExperiment, type MaskedExperiment } from '../../api';

export function ExperimentLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const isNew = !id;

  const [experiment, setExperiment] = useState<MaskedExperiment | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (isNew || !id) return;
    setLoading(true);
    getExperiment(id)
      .then(setExperiment)
      .catch(e => setErr(e instanceof Error ? e.message : t('experiments.layout.errors.notFound')))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const tabs = [
    { id: 'config', label: t('experiments.layout.tabs.config'), icon: <Settings size={16} /> },
    { id: 'metrics', label: t('experiments.layout.tabs.metrics'), icon: <BarChart3 size={16} />, disabled: isNew },
    { id: 'token', label: t('experiments.layout.tabs.token'), icon: <Key size={16} />, disabled: isNew },
  ];

  if (err && !isNew) {
    return (
      <div className="page-body">
        <div className="form-error">{err}</div>
        <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => navigate('/dashboard/experiments')}>
          {t('experiments.layout.backToExperiments')}
        </button>
      </div>
    );
  }

  // On the bare `/experiments/:id` the index route renders Configuration, so the
  // last path segment is the experiment id itself.
  /* v8 ignore next */
  const currentTab = location.pathname.split('/').pop() || 'config';

  return (
    <>
      <div className="page-header" style={{ paddingBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 24 }}>
          <button className="btn-icon" onClick={() => navigate('/dashboard/experiments')} title={t('experiments.layout.backToExperiments')}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 style={{ margin: 0 }}>{isNew ? t('experiments.layout.newExperiment') : experiment?.name || t('experiments.layout.loading')}</h1>
            {!isNew && experiment && (
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {t('experiments.layout.experimentId')} <span className="mono">{experiment.id}</span>
              </p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)' }}>
          {tabs.map(tab => {
            /* v8 ignore next */
            const isActive = currentTab === tab.id || (currentTab === id && tab.id === 'config');
            if (tab.disabled) {
              return (
                <div
                  key={tab.id}
                  style={{
                    padding: '0 4px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: '0.9rem',
                    fontWeight: 500,
                    color: 'var(--text-muted)',
                    cursor: 'not-allowed',
                    borderBottom: '2px solid transparent',
                  }}
                  title={t('experiments.layout.disabledTabTitle')}
                >
                  {tab.icon} {tab.label}
                </div>
              );
            }

            return (
              <NavLink
                key={tab.id}
                to={isNew ? '#' : `/dashboard/experiments/${id}/${tab.id}`}
                style={{
                  padding: '0 4px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: '0.9rem',
                  fontWeight: 500,
                  color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                  borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                  textDecoration: 'none',
                  transition: 'all 0.2s',
                  marginBottom: -1, // overlap the border
                }}
              >
                {tab.icon} {tab.label}
              </NavLink>
            );
          })}
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 32 }}>
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : (
          <Outlet context={{ experiment, setExperiment }} />
        )}
      </div>
    </>
  );
}

/** Access the experiment loaded by the layout from inside a tab. */
export function useExperiment() {
  return useOutletContext<{
    experiment: MaskedExperiment | null;
    setExperiment: React.Dispatch<React.SetStateAction<MaskedExperiment | null>>;
  }>();
}
