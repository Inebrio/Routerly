import { useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider, NavLink, Navigate, useNavigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';
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
import { LayoutDashboard, Cpu, FolderOpen, BarChart2, FlaskConical, Settings as SettingsIcon, UserCircle, LogOut } from 'lucide-react';

function Sidebar() {
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
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-name">LocalRouter</div>
        <div className="logo-tag">LLM API Gateway</div>
      </div>
      <nav className="sidebar-nav">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <NavLink
          to="/dashboard/profile"
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <UserCircle size={15} /> {user?.email}
        </NavLink>
        <NavLink
          to="/dashboard/settings"
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <SettingsIcon size={15} /> Settings
        </NavLink>
        <button className="nav-item" style={{ color: 'var(--danger)' }} onClick={handleLogout}>
          <LogOut size={15} /> Sign Out
        </button>
      </div>
    </aside>
  );
}

function ProtectedLayout() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="loading-center"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/dashboard/login" replace />;
  return (
    <div className="app-shell">
      <Sidebar />
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
  return <RouterProvider router={router} />;
}
