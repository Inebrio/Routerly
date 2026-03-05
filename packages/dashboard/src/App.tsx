import { useEffect, useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, NavLink, Navigate, useNavigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { ThemeProvider, useTheme, type Theme } from './ThemeContext';
import { checkSetupStatus } from './api';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { OverviewPage } from './pages/OverviewPage';
import { ModelsPage } from './pages/ModelsPage';
import { ModelFormPage } from './pages/ModelFormPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectLayout } from './pages/project/ProjectLayout';
import { ProjectGeneralTab } from './pages/project/ProjectGeneralTab';
import { ProjectRoutingTab } from './pages/project/ProjectRoutingTab';
import { ProjectTokenTab } from './pages/project/ProjectTokenTab';
import { ProjectUsersTab } from './pages/project/ProjectUsersTab';
import { ProjectLogsTab } from './pages/project/ProjectLogsTab';
import { ProjectTokenCreatePage } from './pages/project/ProjectTokenCreatePage';
import { ProjectTokenEditPage } from './pages/project/ProjectTokenEditPage';
import { UsersPage } from './pages/UsersPage';
import { UsagePage } from './pages/UsagePage';
import { UsageRecordPage } from './pages/UsageRecordPage';
import { TestPage } from './pages/TestPage';
import { SettingsPage } from './pages/SettingsPage';
import { SettingsGeneralTab, SettingsAboutTab, SettingsNotificationsTab } from './pages/SettingsPage';
import { ProfilePage } from './pages/ProfilePage';
import { UserEditPage } from './pages/UserEditPage';
import { LayoutDashboard, Cpu, FolderOpen, BarChart2, FlaskConical, Settings as SettingsIcon, UserCircle, LogOut, Sun, Moon, Monitor, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

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
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  }
  return (
    <button className="nav-item" title={`Theme: ${theme}`} onClick={cycle}>
      {icons[theme]}
    </button>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() { logout(); navigate('/dashboard/login'); }

  const navItems = [
    { to: '/dashboard/overview', icon: <LayoutDashboard size={17} />, label: 'Overview' },
    { to: '/dashboard/models', icon: <Cpu size={17} />, label: 'Models' },
    { to: '/dashboard/projects', icon: <FolderOpen size={17} />, label: 'Projects' },
    { to: '/dashboard/usage', icon: <BarChart2 size={17} />, label: 'Usage' },
    { to: '/dashboard/test', icon: <FlaskConical size={17} />, label: 'Test' },
  ];

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar-logo">
        <div className="sidebar-logo-inner">
          <div className="logo-name">LR</div>
          <span className="nav-label logo-full">
            <span className="logo-name-full">LocalRouter</span>
            <span className="logo-tag">LLM API Gateway</span>
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
        <NavLink
          to="/dashboard/profile"
          title={collapsed ? user?.email : undefined}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <UserCircle size={15} />
          <span className="nav-label">{user?.email}</span>
        </NavLink>
        <NavLink
          to="/dashboard/settings"
          title={collapsed ? 'Settings' : undefined}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <SettingsIcon size={15} />
          <span className="nav-label">Settings</span>
        </NavLink>
        <button className="nav-item" style={{ color: 'var(--danger)' }} title={collapsed ? 'Sign Out' : undefined} onClick={handleLogout}>
          <LogOut size={15} />
          <span className="nav-label">Sign Out</span>
        </button>
      </div>
    </aside>
  );
}

function ProtectedLayout() {
  const { user, isLoading } = useAuth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('lr-sidebar') === 'collapsed');

  function handleToggle() {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('lr-sidebar', next ? 'collapsed' : 'expanded');
      return next;
    });
  }

  if (isLoading) return <div className="loading-center"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/dashboard/login" replace />;
  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} onToggle={handleToggle} />
      <main className="main-content">
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
          { path: 'models/new', element: <ModelFormPage /> },
          { path: 'models/:id', element: <ModelFormPage /> },
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
              { path: 'token', element: <ProjectTokenTab /> },
              { path: 'users', element: <ProjectUsersTab /> },
              { path: 'logs', element: <ProjectLogsTab /> },
            ],
          },
          { path: 'usage', element: <UsagePage /> },
          { path: 'test', element: <TestPage /> },
          {
            path: 'settings',
            element: <SettingsPage />,
            children: [
              { index: true, element: <Navigate to="general" replace /> },
              { path: 'general', element: <SettingsGeneralTab /> },
              { path: 'notifications', element: <SettingsNotificationsTab /> },
              { path: 'users', element: <UsersPage /> },
              { path: 'users/:userId', element: <UserEditPage /> },
              { path: 'about', element: <SettingsAboutTab /> },
            ],
          },
          { path: 'profile', element: <ProfilePage /> },
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
