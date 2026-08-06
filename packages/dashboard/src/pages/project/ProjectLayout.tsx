import { useEffect, useState } from 'react';
import { useNavigate, useParams, Outlet, NavLink, useLocation } from 'react-router-dom';
import { ArrowLeft, Settings, Route, Users, FileText, Key, Shield, Gauge, LayoutDashboard } from 'lucide-react';
import { getProjects, type Project } from '../../api';

export function ProjectLayout() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const isNew = !id;

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    getProjects()
      .then(ps => {
        const found = ps.find(p => p.id === id);
        if (found) setProject(found);
        else setErr('Project not found');
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const tabs = [
    // Dashboard is the project landing page; a new project has no traffic yet,
    // so it starts on General instead.
    ...(isNew ? [] : [{ id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> }]),
    { id: 'general', label: 'General', icon: <Settings size={16} /> },
    { id: 'routing', label: 'Routing', icon: <Route size={16} />, disabled: isNew },
    { id: 'optimizer', label: 'Optimizer', icon: <Gauge size={16} />, disabled: isNew },
    { id: 'security', label: 'Security', icon: <Shield size={16} />, disabled: isNew },
    { id: 'token', label: 'Token', icon: <Key size={16} />, disabled: isNew },
    { id: 'users', label: 'Users', icon: <Users size={16} />, disabled: isNew },
    { id: 'logs', label: 'Logs', icon: <FileText size={16} />, disabled: isNew },
  ];

  if (err && !isNew) {
    return (
      <div className="page-body">
        <div className="form-error">{err}</div>
        <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => navigate('/dashboard/projects')}>
          Back to Projects
        </button>
      </div>
    );
  }

  // Determine current active tab from URL. On the bare `/projects/:id` the index
  // route renders Dashboard, so the last path segment is the project id itself.
  /* v8 ignore next */
  const currentTab = location.pathname.split('/').pop() || 'dashboard';
  const landingTab = isNew ? 'general' : 'dashboard';

  return (
    <>
      <div className="page-header" style={{ paddingBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 24 }}>
          <button className="btn-icon" onClick={() => navigate('/dashboard/projects')} title="Back to projects">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 style={{ margin: 0 }}>{isNew ? 'New Project' : project?.name || 'Loading...'}</h1>
            {!isNew && project && (
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Project ID: <span className="mono">{project.id}</span>
              </p>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)' }}>
          {tabs.map(tab => {
            /* v8 ignore next */
            const isActive = currentTab === tab.id || (currentTab === id && tab.id === landingTab);
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
                  title="Save the project first to unlock this tab"
                >
                  {tab.icon} {tab.label}
                </div>
              );
            }

            return (
              <NavLink
                key={tab.id}
                to={isNew ? '#' : `/dashboard/projects/${id}/${tab.id}`}
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
          <Outlet context={{ project, setProject }} />
        )}
      </div>
    </>
  );
}

// Custom hook to access project context inside tabs
import { useOutletContext } from 'react-router-dom';
export function useProject() {
  return useOutletContext<{
    project: Project | null;
    setProject: React.Dispatch<React.SetStateAction<Project | null>>;
  }>();
}
