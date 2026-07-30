import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, NavLink, Navigate, useNavigate, useLocation, Outlet, Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { ThemeProvider, useTheme, type Theme } from './ThemeContext';
import { checkSetupStatus, getSystemInfo, getSettings, updateSettings } from './api';
import type { UpdateInfo } from './api';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { OverviewPage } from './pages/OverviewPage';
import { ModelsPage } from './pages/ModelsPage';
import { ModelFormPage } from './pages/ModelFormPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectLayout } from './pages/project/ProjectLayout';
import { ProjectGeneralTab } from './pages/project/ProjectGeneralTab';
import { ProjectRoutingTab } from './pages/project/ProjectRoutingTab';
import { ProjectOptimizerTab } from './pages/project/ProjectOptimizerTab';
import { ProjectTokenTab } from './pages/project/ProjectTokenTab';
import { ProjectUsersTab } from './pages/project/ProjectUsersTab';
import { ProjectLogsTab } from './pages/project/ProjectLogsTab';
import { ProjectSecurityTab } from './pages/project/ProjectSecurityTab';
import { ProjectEndUsersTab } from './pages/project/ProjectEndUsersTab';
import { ProjectTokenCreatePage } from './pages/project/ProjectTokenCreatePage';
import { ProjectTokenEditPage } from './pages/project/ProjectTokenEditPage';
import { UsersPage } from './pages/UsersPage';
import { UsagePage } from './pages/UsagePage';
import { UsageRecordPage } from './pages/UsageRecordPage';
import { TestPage } from './pages/TestPage';
import { SettingsPage } from './pages/SettingsPage';
import { SettingsGeneralTab, SettingsAboutTab, SettingsIntegrationsTab, SettingsCatalogTab } from './pages/SettingsPage';
import { SettingsModulesTab } from './pages/SettingsModulesTab';
import { NotificationChannelListPage } from './pages/NotificationChannelListPage';
import { NotificationChannelEditPage } from './pages/NotificationChannelEditPage';
import { NotificationChannelCreatePage } from './pages/NotificationChannelCreatePage';
import { RolesPage } from './pages/RolesPage';
import { ProfilePage } from './pages/ProfilePage';
import { UserEditPage } from './pages/UserEditPage';
import { HelpPage } from './pages/HelpPage';
import { ModelDiscoveryPage } from './pages/ModelDiscoveryPage';
import { AuditPage } from './pages/AuditPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { ModelInstancesPage } from './pages/ModelInstancesPage';
import { ResiliencePage } from './pages/ResiliencePage';
import { ProfilesPage } from './pages/ProfilesPage';

import { LayoutDashboard, Cpu, FolderOpen, BarChart2, FlaskConical, HelpCircle, Settings as SettingsIcon, UserCircle, LogOut, Sun, Moon, Monitor, PanelLeftClose, PanelLeftOpen, Plug, ShieldAlert, Route } from 'lucide-react';
import { Logo } from './components/Logo';
import { ProfileNotificationBadge } from './components/NotificationBell';

const THEME_OPTIONS: { value: Theme; icon: ReactNode; label: string }[] = [
  { value: 'auto',  icon: <Monitor size={14} />, label: 'Auto' },
  { value: 'dark',  icon: <Moon size={14} />, label: 'Dark' },
  { value: 'light', icon: <Sun size={14} />, label: 'Light' },
];

function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="theme-selector">
      {THEME_OPTIONS.map(opt => (
        <button
          key={opt.value}
          title={opt.label}
          className={`theme-btn${theme === opt.value ? ' active' : ''}`}
          onClick={() => setTheme(opt.value)}
        >
          {opt.icon}
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

function ThemeCycleButton() {
  const { theme, setTheme } = useTheme();
  const order: Theme[] = ['auto', 'dark', 'light'];
  const icons: Record<Theme, ReactNode> = {
    auto: <Monitor size={15} />,
    dark: <Moon size={15} />,
    light: <Sun size={15} />,
  };
  function cycle() {
    const next = order[(order.indexOf(theme) + 1) % order.length]!;
    setTheme(next);
  }
  return (
    <button className="nav-item" title={`Theme: ${theme}`} onClick={cycle}>
      {icons[theme]}
    </button>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const profileRowRef = useRef<HTMLDivElement>(null);

  function handleLogout() { logout(); navigate('/dashboard/login'); }

  const navItems = [
    { to: '/dashboard/overview', icon: <LayoutDashboard size={17} />, label: 'Overview' },
    { to: '/dashboard/models', icon: <Cpu size={17} />, label: 'Models' },
    ...(can('connections:read') ? [{ to: '/dashboard/connections', icon: <Plug size={17} />, label: 'Connections' }] : []),
    ...(can('resilience:read') ? [{ to: '/dashboard/resilience', icon: <ShieldAlert size={17} />, label: 'Resilience' }] : []),
    ...(can('profiles:read') ? [{ to: '/dashboard/routing-profiles', icon: <Route size={17} />, label: 'Routing Profiles' }] : []),
    { to: '/dashboard/projects', icon: <FolderOpen size={17} />, label: 'Projects' },
    { to: '/dashboard/usage', icon: <BarChart2 size={17} />, label: 'Usage' },
    { to: '/dashboard/test', icon: <FlaskConical size={17} />, label: 'Playground' },
  ];

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-logo">
        <div className="sidebar-logo-inner">
          <Logo size={28} className="sidebar-logo-icon" />
          <span className="nav-label logo-full">
            <span className="logo-name-full">Routerly.ai</span>
            <span className="logo-tag">One gateway. Any AI model. Total control.</span>
          </span>
        </div>
        <button className="sidebar-toggle" onClick={onToggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>
      <nav className="sidebar-nav">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            {item.icon}
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        {!collapsed && <ThemeSelector />}
        {collapsed && (
          <div className="sidebar-footer-icons">
            <ThemeCycleButton />
          </div>
        )}
        <div ref={profileRowRef} style={{ display: 'flex', alignItems: 'center' }}>
          <NavLink
            to="/dashboard/profile"
            title={collapsed ? user?.email : undefined}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}
          >
            <UserCircle size={15} />
            <span className="nav-label" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</span>
          </NavLink>
          <ProfileNotificationBadge anchorRef={profileRowRef} />
        </div>
        <NavLink
          to="/dashboard/settings"
          title={collapsed ? 'Settings' : undefined}
          className={({ isActive }) => `nav-item${/* v8 ignore next */ isActive ? ' active' : ''}`}
        >
          <SettingsIcon size={15} />
          <span className="nav-label">Settings</span>
        </NavLink>
        <NavLink
          to="/dashboard/help"
          title={collapsed ? 'Help' : undefined}
          className={({ isActive }) => `nav-item${/* v8 ignore next */ isActive ? ' active' : ''}`}
        >
          <HelpCircle size={15} />
          <span className="nav-label">Help</span>
        </NavLink>
        <button className="nav-item sign-out" title="Sign Out" onClick={handleLogout}>
          <LogOut size={15} />
          <span className="nav-label">Sign Out</span>
        </button>
      </div>
    </aside>
  );
}

function ProtectedLayout() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('lr-sidebar') === 'collapsed');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isDocker, setIsDocker] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    return localStorage.getItem('lr-update-banner-dismissed') === 'true';
  });
  const [telemetryUndecided, setTelemetryUndecided] = useState(false);
  const [requireMfa, setRequireMfa] = useState(false);

  useEffect(() => {
    getSystemInfo()
      .then(info => {
        setIsDocker(info.isDocker);
        if (info.updateInfo?.available) setUpdateInfo(info.updateInfo);
      })
      .catch(/* v8 ignore next */ () => { /* non-critical */ });
  }, []);

  useEffect(() => {
    getSettings()
      .then(s => {
        if (user?.role === 'admin' && s.telemetry === undefined) setTelemetryUndecided(true);
        setRequireMfa(!!s.requireMfa);
      })
      .catch(/* v8 ignore next */ () => { /* non-critical */ });
  }, [user]);

  useEffect(() => {
    if (!isLoading && requireMfa && !user?.totpEnabled && !location.pathname.startsWith('/dashboard/profile')) {
      /* v8 ignore next */
      navigate('/dashboard/profile');
    }
  }, [requireMfa, user?.totpEnabled, isLoading, location.pathname, navigate]);

  function handleToggle() {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('lr-sidebar', next ? 'collapsed' : 'expanded');
      return next;
    });
  }

  function dismissBanner() {
    localStorage.setItem('lr-update-banner-dismissed', 'true');
    setBannerDismissed(true);
  }

  function handleTelemetryChoice(enabled: boolean) {
    setTelemetryUndecided(false);
    updateSettings({ telemetry: { enabled } } as any).catch(/* v8 ignore next */ () => { /* non-critical */ });
  }

  const showUpdateBanner = !bannerDismissed && !isDocker && user?.role === 'admin' && updateInfo?.available;

  if (isLoading) return <div className="loading-center"><div className="spinner" /></div>;
  /* v8 ignore next */
  if (!user) return <Navigate to={`/dashboard/login?to=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} onToggle={handleToggle} />
      <main className="main-content">
        {showUpdateBanner && (
          <div style={{
            background: 'var(--warning-bg, #fffbeb)',
            borderBottom: '1px solid var(--warning-border, #f6e05e)',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: '0.85rem',
            color: 'var(--warning-text, #744210)',
          }}>
            <span>
              Routerly <strong>v{updateInfo!.latestVersion}</strong> is available. You are on v{updateInfo!.currentVersion}.{' '}
              <Link to="/dashboard/settings/about" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>
                Update in Settings
              </Link>
            </span>
            <button
              onClick={dismissBanner}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, color: 'inherit', opacity: 0.7 }}
              title="Dismiss"
            >
              ×
            </button>
          </div>
        )}
        {requireMfa && !user?.totpEnabled && (
          <div style={{
            background: 'var(--warning-bg, #fffbeb)',
            borderBottom: '1px solid var(--warning-border, #f6e05e)',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: '0.85rem',
            color: 'var(--warning-text, #744210)',
          }}>
            <span>
              Two-factor authentication is required for this instance.{' '}
              <Link to="/dashboard/profile" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>
                Set up 2FA in your Profile
              </Link>
              {' '}to secure your account.
            </span>
          </div>
        )}
        {telemetryUndecided && (
          <div style={{
            background: 'var(--info-bg, #eff6ff)',
            borderBottom: '1px solid var(--info-border, #bfdbfe)',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: '0.85rem',
            color: 'var(--info-text, #1e40af)',
          }}>
            <span style={{ flex: 1 }}>
              <strong>Routerly never sends data automatically.</strong>{' '}
              Would you like to help by sending anonymous install metrics? Only event type, version, platform, and a random ID — no personal data, no IP.{' '}
              <a
                href="https://doc.routerly.ai/next/reference/telemetry"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
                What is sent?
              </a>
            </span>
            <button
              onClick={() => handleTelemetryChoice(true)}
              style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid currentColor', cursor: 'pointer', background: 'none', fontSize: '0.82rem', fontWeight: 600, color: 'inherit', whiteSpace: 'nowrap' }}
            >
              Yes, help out
            </button>
            <button
              onClick={() => handleTelemetryChoice(false)}
              style={{ padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer', background: 'none', fontSize: '0.82rem', opacity: 0.7, color: 'inherit', whiteSpace: 'nowrap' }}
            >
              No thanks
            </button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}

/** Checks setup status once on first load and redirects to /dashboard/setup if needed. */
function SetupGuard() {
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    checkSetupStatus()
      .then(({ needsSetup }) => {
        if (needsSetup) navigate('/dashboard/setup', { replace: true });
      })
      .catch(() => { /* service not reachable – let the normal flow handle it */ })
      .finally(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checking) return <div className="loading-center"><div className="spinner" /></div>;
  return <Outlet />;
}

const router = createBrowserRouter([
  {
    element: <SetupGuard />,
    children: [
      { path: '/dashboard/setup', element: <SetupPage /> },
      { path: '/dashboard/login', element: <LoginPage /> },
      {
        path: '/dashboard',
        element: <ProtectedLayout />,
        children: [
          { index: true, element: <Navigate to="overview" replace /> },
          { path: 'overview', element: <OverviewPage /> },
          { path: 'models', element: <ModelsPage /> },
          { path: 'models/discover', element: <ModelDiscoveryPage /> },
          { path: 'models/new', element: <ModelFormPage /> },
          { path: 'models/:id', element: <ModelFormPage /> },
          { path: 'connections', element: <ConnectionsPage /> },
          { path: 'connections/:connectionId/instances', element: <ModelInstancesPage /> },
          { path: 'resilience', element: <ResiliencePage /> },
          { path: 'routing-profiles', element: <ProfilesPage /> },
          { path: 'projects', element: <ProjectsPage /> },
          {
            path: 'projects/new',
            element: <ProjectLayout />,
            children: [
              { index: true, element: <ProjectGeneralTab /> },
            ],
          },
          {
            path: 'projects/:id/token/new',
            element: <ProjectLayout />,
            children: [
              { index: true, element: <ProjectTokenCreatePage /> },
            ]
          },
          {
            path: 'projects/:id/token/:tokenId',
            element: <ProjectLayout />,
            children: [
              { index: true, element: <ProjectTokenEditPage /> },
            ]
          },
          {
            path: 'projects/:id',
            element: <ProjectLayout />,
            children: [
              { index: true, element: <ProjectGeneralTab /> },
              { path: 'general', element: <ProjectGeneralTab /> },
              { path: 'routing', element: <ProjectRoutingTab /> },
              { path: 'optimizer', element: <ProjectOptimizerTab /> },
              { path: 'token', element: <ProjectTokenTab /> },
              { path: 'users', element: <ProjectUsersTab /> },
              { path: 'logs', element: <ProjectLogsTab /> },
              { path: 'security', element: <ProjectSecurityTab /> },
              { path: 'end-users', element: <ProjectEndUsersTab /> },
            ],
          },
          { path: 'usage', element: <UsagePage /> },
          { path: 'health', element: <Navigate to="/dashboard/models?tab=health" replace /> },
          { path: 'test', element: <TestPage /> },
          {
            path: 'settings',
            element: <SettingsPage />,
            children: [
              { index: true, element: <Navigate to="general" replace /> },
              { path: 'general', element: <SettingsGeneralTab /> },
              { path: 'notifications', element: <NotificationChannelListPage /> },
              { path: 'notifications/new', element: <NotificationChannelCreatePage /> },
              { path: 'notifications/:id', element: <NotificationChannelEditPage /> },
              { path: 'integrations', element: <SettingsIntegrationsTab /> },
              { path: 'catalog', element: <SettingsCatalogTab /> },
              { path: 'modules', element: <SettingsModulesTab /> },
              { path: 'users', element: <UsersPage /> },
              { path: 'users/:userId', element: <UserEditPage /> },
              { path: 'roles', element: <RolesPage /> },
              { path: 'audit', element: <AuditPage /> },
              { path: 'about', element: <SettingsAboutTab /> },
            ],
          },
          { path: 'help', element: <HelpPage /> },
          { path: 'profile', element: <ProfilePage /> },
          { path: 'profile/notifications', element: <ProfilePage initialTab="notifications" /> },
          { path: 'usage/:id', element: <UsageRecordPage /> },
          { path: '*', element: <Navigate to="overview" replace /> },
        ],
      },
      { path: '/', element: <Navigate to="/dashboard/overview" replace /> },
    ],
  },
]);

export default function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}
