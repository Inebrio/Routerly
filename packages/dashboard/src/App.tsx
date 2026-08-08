import './i18n';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, NavLink, Navigate, useNavigate, useLocation, Outlet, Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { ThemeProvider, useTheme, type Theme } from './ThemeContext';
import { LanguageProvider, useLanguage } from './LanguageContext';
import { SUPPORTED_LANGUAGES } from './locales/languages';
import { SearchableSelect } from './components/SearchableSelect';
import { checkSetupStatus, getSystemInfo, getSettings, updateSettings, getPermissionStatus } from './api';
import type { UpdateInfo } from './api';
import { PermissionGuardModal, type PermissionBlockedDetail } from './components/PermissionGuardModal';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { OverviewPage } from './pages/OverviewPage';
import { ModelsPage } from './pages/ModelsPage';
import { ModelFormPage } from './pages/ModelFormPage';
import { RoutersPage } from './pages/RoutersPage';
import { RouterLayout } from './pages/router/RouterLayout';
import { RouterDashboardTab } from './pages/router/RouterDashboardTab';
import { RouterGeneralTab } from './pages/router/RouterGeneralTab';
import { RouterFormRouter } from './pages/router/RouterFormRouter';
import { RouterFormOrchestrator } from './pages/router/RouterFormOrchestrator';
import { RouterFormPassthrough } from './pages/router/RouterFormPassthrough';
import { RouterRoutingTab } from './pages/router/RouterRoutingTab';
import { RouterOptimizerTab } from './pages/router/RouterOptimizerTab';
import { RouterTokenTab } from './pages/router/RouterTokenTab';
import { RouterUsersTab } from './pages/router/RouterUsersTab';
import { RouterLogsTab } from './pages/router/RouterLogsTab';
import { RouterSecurityTab } from './pages/router/RouterSecurityTab';
import { RouterOrchestratorTab } from './pages/router/RouterOrchestratorTab';
import { RouterTokenCreatePage } from './pages/router/RouterTokenCreatePage';
import { RouterTokenEditPage } from './pages/router/RouterTokenEditPage';
import { UsersPage } from './pages/UsersPage';
import { UsagePage } from './pages/UsagePage';
import { UsageRecordPage } from './pages/UsageRecordPage';
import { TestPage } from './pages/TestPage';
import { SettingsPage } from './pages/SettingsPage';
import { SettingsGeneralTab, SettingsSecurityTab, SettingsAboutTab, SettingsIntegrationsTab, SettingsCatalogTab } from './pages/SettingsPage';
import { NotificationChannelListPage } from './pages/NotificationChannelListPage';
import { NotificationChannelEditPage } from './pages/NotificationChannelEditPage';
import { NotificationChannelCreatePage } from './pages/NotificationChannelCreatePage';
import { RolesPage } from './pages/RolesPage';
import { ProfilePage } from './pages/ProfilePage';
import { McpTokenNewPage } from './pages/McpTokenNewPage';
import { UserEditPage } from './pages/UserEditPage';
import { HelpPage } from './pages/HelpPage';
import { ModelDiscoveryPage } from './pages/ModelDiscoveryPage';
import { AuditPage } from './pages/AuditPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { ConnectionFormPage } from './pages/ConnectionFormPage';
import { ProfilesPage } from './pages/ProfilesPage';
import { ProfileFormPage } from './pages/ProfileFormPage';
import { ConnectPage, useClientsEnabled } from './pages/ConnectPage';
import { ConnectClientPage } from './pages/ConnectClientPage';
import { ExperimentsPage, useExperimentsEnabled } from './pages/ExperimentsPage';
import { ExperimentLayout } from './pages/experiment/ExperimentLayout';
import { ExperimentConfigTab } from './pages/experiment/ExperimentConfigTab';
import { ExperimentMetricsTab } from './pages/experiment/ExperimentMetricsTab';
import { ExperimentTokenTab } from './pages/experiment/ExperimentTokenTab';

import { LayoutDashboard, Cpu, FolderOpen, BarChart2, FlaskConical, HelpCircle, Settings as SettingsIcon, UserCircle, LogOut, Sun, Moon, Monitor, PanelLeftClose, PanelLeftOpen, Cloud, Route, AppWindow, Split } from 'lucide-react';
import { Logo } from './components/Logo';
import { ProfileNotificationBadge } from './components/NotificationBell';

function useThemeOptions(): { value: Theme; icon: ReactNode; label: string }[] {
  const { t } = useTranslation();
  return [
    { value: 'auto',  icon: <Monitor size={14} />, label: t('app.theme.auto') },
    { value: 'dark',  icon: <Moon size={14} />, label: t('app.theme.dark') },
    { value: 'light', icon: <Sun size={14} />, label: t('app.theme.light') },
  ];
}

function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const THEME_OPTIONS = useThemeOptions();
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

function LanguageSelector() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  return (
    <SearchableSelect
      options={SUPPORTED_LANGUAGES.map(l => ({ value: l.code, label: `${l.flag}  ${l.name}` }))}
      value={language}
      placeholder={t('app.language.label')}
      ariaLabel={t('app.language.label')}
      onChange={setLanguage}
      style={{ fontSize: '0.78rem' }}
    />
  );
}

function ThemeCycleButton() {
  const { t } = useTranslation();
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
    <button className="nav-item" title={t('app.themeCycle.title', { theme })} onClick={cycle}>
      {icons[theme]}
    </button>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const profileRowRef = useRef<HTMLDivElement>(null);
  // Clients has no permission gate (session-only); visibility instead depends on
  // whether the module is enabled, only known after this async check resolves.
  const clientsEnabled = useClientsEnabled();
  // Same treatment for Experiments: the permission plus the module both have to be on.
  const experimentsEnabled = useExperimentsEnabled();

  function handleLogout() { logout(); navigate('/dashboard/login'); }

  // One flat list, ordered the way the product is used: what you set up
  // (Providers to Routers), then what it tells you back (Experiments, Usage),
  // and last the Playground, the bench you drop into to try things out. Connect
  // app is not here: it configures the tools around Routerly rather than
  // Routerly itself, so it sits in the footer next to Settings.
  const navItems = [
    { to: '/dashboard/overview', icon: <LayoutDashboard size={17} />, label: t('app.nav.overview') },
    ...(can('connections:read') ? [{ to: '/dashboard/connections', icon: <Cloud size={17} />, label: t('app.nav.providers') }] : []),
    { to: '/dashboard/models', icon: <Cpu size={17} />, label: t('app.nav.models') },
    ...(can('profiles:read') ? [{ to: '/dashboard/profiles', icon: <Route size={17} />, label: t('app.nav.profiles') }] : []),
    { to: '/dashboard/routers', icon: <FolderOpen size={17} />, label: t('app.nav.routers') },
    ...(experimentsEnabled ? [{ to: '/dashboard/experiments', icon: <Split size={17} />, label: t('app.nav.experiments') }] : []),
    { to: '/dashboard/usage', icon: <BarChart2 size={17} />, label: t('app.nav.usage') },
    { to: '/dashboard/test', icon: <FlaskConical size={17} />, label: t('app.nav.playground') },
  ];

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-logo">
        <div className="sidebar-logo-inner">
          <Logo size={28} className="sidebar-logo-icon" />
          <span className="nav-label logo-full">
            <span className="logo-name-full">Routerly.ai</span>
            <span className="logo-tag">{t('app.tagline')}</span>
          </span>
        </div>
        <button className="sidebar-toggle" onClick={onToggle} title={collapsed ? t('app.sidebar.expand') : t('app.sidebar.collapse')}>
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
        {!collapsed && <LanguageSelector />}
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
          title={collapsed ? t('app.nav.settings') : undefined}
          className={({ isActive }) => `nav-item${/* v8 ignore next */ isActive ? ' active' : ''}`}
        >
          <SettingsIcon size={15} />
          <span className="nav-label">{t('app.nav.settings')}</span>
        </NavLink>
        {clientsEnabled && (
          <NavLink
            to="/dashboard/connect"
            title={collapsed ? t('app.nav.connectApp') : undefined}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <AppWindow size={15} />
            <span className="nav-label">{t('app.nav.connectApp')}</span>
          </NavLink>
        )}
        <NavLink
          to="/dashboard/help"
          title={collapsed ? t('app.nav.help') : undefined}
          className={({ isActive }) => `nav-item${/* v8 ignore next */ isActive ? ' active' : ''}`}
        >
          <HelpCircle size={15} />
          <span className="nav-label">{t('app.nav.help')}</span>
        </NavLink>
        <button className="nav-item sign-out" title={t('app.nav.signOut')} onClick={handleLogout}>
          <LogOut size={15} />
          <span className="nav-label">{t('app.nav.signOut')}</span>
        </button>
      </div>
    </aside>
  );
}

// Permission warning banner is checked once per session, not once per page instance:
// a module-level flag survives navigation (component remounts) but resets on full reload,
// which is fine — a fresh reload is a fresh session-level check (EC4: no re-prompt storm).
let permissionCheckDone = false;
let permissionWarningFiles: string[] = [];

/** Test-only: clears the module-level "checked this session" flag between test cases. */
export function __resetPermissionCheckForTests() {
  permissionCheckDone = false;
  permissionWarningFiles = [];
}

function ProtectedLayout() {
  const { t } = useTranslation();
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
  const [permissionWarning, setPermissionWarning] = useState<string[]>(permissionWarningFiles);
  const [permissionWarningDismissed, setPermissionWarningDismissed] = useState(false);
  const [permissionBlockedDetail, setPermissionBlockedDetail] = useState<PermissionBlockedDetail | null>(null);

  useEffect(() => {
    getSystemInfo()
      .then(info => {
        setIsDocker(info.isDocker);
        if (info.updateInfo?.available) setUpdateInfo(info.updateInfo);
      })
      .catch(/* v8 ignore next */ () => { /* non-critical */ });
  }, []);

  // AC6/AC8/EC4: fetch permission status once per session (module-level flag), show a
  // warning banner if any general-severity file is unsafe, never block on it.
  useEffect(() => {
    if (permissionCheckDone) {
      setPermissionWarning(permissionWarningFiles);
      return;
    }
    permissionCheckDone = true;
    getPermissionStatus()
      .then(status => {
        const warnings = status.unsafe.filter(u => u.severity === 'general').map(u => u.file);
        permissionWarningFiles = warnings;
        setPermissionWarning(warnings);
      })
      .catch(/* v8 ignore next */ () => { /* non-critical: hard block, if any, surfaces via the 423 event */ });
  }, []);

  // AC6: any 423 from api.ts surfaces here as a blocking modal.
  useEffect(() => {
    function onBlocked(e: Event) {
      const detail = (e as CustomEvent<PermissionBlockedDetail>).detail;
      if (detail) setPermissionBlockedDetail(detail);
    }
    window.addEventListener('lr-permission-blocked', onBlocked);
    return () => window.removeEventListener('lr-permission-blocked', onBlocked);
  }, []);

  function handlePermissionFixed() {
    setPermissionBlockedDetail(null);
    permissionWarningFiles = [];
    setPermissionWarning([]);
  }

  // Fix can also happen from FilePermissionsSection (Settings → Security),
  // not just this modal — pick that up too so the top banner clears either way.
  useEffect(() => {
    window.addEventListener('lr-permission-fixed', handlePermissionFixed);
    return () => window.removeEventListener('lr-permission-fixed', handlePermissionFixed);
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
  const showPermissionWarning = !permissionWarningDismissed && permissionWarning.length > 0;

  if (isLoading) return <div className="loading-center"><div className="spinner" /></div>;
  /* v8 ignore next */
  if (!user) return <Navigate to={`/dashboard/login?to=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} onToggle={handleToggle} />
      <main className="main-content">
        {showPermissionWarning && (
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
              {t('app.banner.permissionWarning', { files: permissionWarning.join(', ') })}
            </span>
            <button
              onClick={() => setPermissionWarningDismissed(true)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, color: 'inherit', opacity: 0.7 }}
              title={t('app.banner.dismiss')}
            >
              ×
            </button>
          </div>
        )}
        {permissionBlockedDetail && (
          <PermissionGuardModal
            detail={permissionBlockedDetail}
            onFixed={handlePermissionFixed}
            onCancel={() => setPermissionBlockedDetail(null)}
          />
        )}
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
              {t('app.banner.updateAvailable', { latest: updateInfo!.latestVersion, current: updateInfo!.currentVersion })}{' '}
              <Link to="/dashboard/settings/about" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>
                {t('app.banner.updateLink')}
              </Link>
            </span>
            <button
              onClick={dismissBanner}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, color: 'inherit', opacity: 0.7 }}
              title={t('app.banner.dismiss')}
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
              {t('app.banner.mfaRequired')}{' '}
              <Link to="/dashboard/profile" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>
                {t('app.banner.mfaLink')}
              </Link>
              {' '}{t('app.banner.mfaSuffix')}
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
              <strong>{t('app.banner.telemetryTitle')}</strong>{' '}
              {t('app.banner.telemetryBody')}{' '}
              <a
                href="https://doc.routerly.ai/next/reference/telemetry"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
                {t('app.banner.telemetryLink')}
              </a>
            </span>
            <button
              onClick={() => handleTelemetryChoice(true)}
              style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid currentColor', cursor: 'pointer', background: 'none', fontSize: '0.82rem', fontWeight: 600, color: 'inherit', whiteSpace: 'nowrap' }}
            >
              {t('app.banner.telemetryYes')}
            </button>
            <button
              onClick={() => handleTelemetryChoice(false)}
              style={{ padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer', background: 'none', fontSize: '0.82rem', opacity: 0.7, color: 'inherit', whiteSpace: 'nowrap' }}
            >
              {t('app.banner.telemetryNo')}
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
          { path: 'connections/new', element: <ConnectionFormPage /> },
          { path: 'connections/:id/edit', element: <ConnectionFormPage /> },
          { path: 'profiles', element: <ProfilesPage /> },
          { path: 'profiles/new', element: <ProfileFormPage /> },
          { path: 'profiles/:id', element: <ProfileFormPage /> },
          { path: 'connect', element: <ConnectPage /> },
          { path: 'connect/:id', element: <ConnectClientPage /> },
          // Kept for links minted before the section was renamed.
          { path: 'clients', element: <Navigate to="/dashboard/connect" replace /> },
          { path: 'routers', element: <RoutersPage /> },
          // Kept for links minted before per-kind creation routes existed.
          { path: 'routers/new', element: <Navigate to="/dashboard/routers/new/router" replace /> },
          {
            path: 'routers/new/router',
            element: <RouterLayout />,
            children: [
              { index: true, element: <RouterFormRouter /> },
            ],
          },
          {
            path: 'routers/new/orchestrator',
            element: <RouterLayout />,
            children: [
              { index: true, element: <RouterFormOrchestrator /> },
            ],
          },
          {
            path: 'routers/new/passthrough',
            element: <RouterLayout />,
            children: [
              { index: true, element: <RouterFormPassthrough /> },
            ],
          },
          {
            path: 'routers/:id/token/new',
            element: <RouterLayout />,
            children: [
              { index: true, element: <RouterTokenCreatePage /> },
            ]
          },
          {
            path: 'routers/:id/token/:tokenId',
            element: <RouterLayout />,
            children: [
              { index: true, element: <RouterTokenEditPage /> },
            ]
          },
          {
            path: 'routers/:id',
            element: <RouterLayout />,
            children: [
              { index: true, element: <RouterDashboardTab /> },
              { path: 'dashboard', element: <RouterDashboardTab /> },
              { path: 'general', element: <RouterGeneralTab /> },
              { path: 'routing', element: <RouterRoutingTab /> },
              { path: 'optimizer', element: <RouterOptimizerTab /> },
              { path: 'token', element: <RouterTokenTab /> },
              { path: 'users', element: <RouterUsersTab /> },
              { path: 'logs', element: <RouterLogsTab /> },
              { path: 'security', element: <RouterSecurityTab /> },
              { path: 'orchestrator', element: <RouterOrchestratorTab /> },
            ],
          },
          { path: 'experiments', element: <ExperimentsPage /> },
          {
            path: 'experiments/new',
            element: <ExperimentLayout />,
            children: [
              { index: true, element: <ExperimentConfigTab /> },
            ],
          },
          {
            path: 'experiments/:id',
            element: <ExperimentLayout />,
            children: [
              { index: true, element: <ExperimentConfigTab /> },
              { path: 'config', element: <ExperimentConfigTab /> },
              { path: 'metrics', element: <ExperimentMetricsTab /> },
              { path: 'token', element: <ExperimentTokenTab /> },
            ],
          },
          { path: 'usage', element: <UsagePage /> },
          { path: 'health', element: <Navigate to="/dashboard/models?tab=health" replace /> },
          // Instances were folded into the Models list; keep the old path landing there
          // instead of the generic overview fallback (mirrors the 'health' redirect above).
          { path: 'instances', element: <Navigate to="/dashboard/models" replace /> },
          { path: 'test', element: <TestPage /> },
          {
            path: 'settings',
            element: <SettingsPage />,
            children: [
              { index: true, element: <Navigate to="general" replace /> },
              { path: 'general', element: <SettingsGeneralTab /> },
              { path: 'security', element: <SettingsSecurityTab /> },
              { path: 'notifications', element: <NotificationChannelListPage /> },
              { path: 'notifications/new', element: <NotificationChannelCreatePage /> },
              { path: 'notifications/:id', element: <NotificationChannelEditPage /> },
              { path: 'integrations', element: <SettingsIntegrationsTab /> },
              { path: 'catalog', element: <SettingsCatalogTab /> },
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
          { path: 'profile/mcp', element: <ProfilePage initialTab="mcp" /> },
          { path: 'profile/mcp/new', element: <McpTokenNewPage /> },
          { path: 'profile/preferences', element: <ProfilePage initialTab="preferences" /> },
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
      <LanguageProvider>
        <RouterProvider router={router} />
      </LanguageProvider>
    </ThemeProvider>
  );
}
