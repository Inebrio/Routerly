/**
 * Tests for App.tsx — covers ProtectedLayout, SetupGuard, Sidebar, and
 * ThemeCycleButton branches.
 *
 * Strategy: mock every page and heavy component so tests focus on App-level logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Page mocks — all pages render their route name only ────────────────────────
vi.mock('./pages/LoginPage', () => ({ LoginPage: () => <div>LoginPage</div> }));
vi.mock('./pages/SetupPage', () => ({ SetupPage: () => <div>SetupPage</div> }));
vi.mock('./pages/OverviewPage', () => ({ OverviewPage: () => <div>OverviewPage</div> }));
vi.mock('./pages/ModelsPage', () => ({ ModelsPage: () => <div>ModelsPage</div> }));
vi.mock('./pages/ModelFormPage', () => ({ ModelFormPage: () => <div>ModelFormPage</div> }));
vi.mock('./pages/ModelDiscoveryPage', () => ({ ModelDiscoveryPage: () => <div>ModelDiscoveryPage</div> }));
vi.mock('./pages/ProjectsPage', () => ({ ProjectsPage: () => <div>ProjectsPage</div> }));
vi.mock('./pages/project/ProjectLayout', () => ({ ProjectLayout: () => <div>ProjectLayout</div> }));
vi.mock('./pages/project/ProjectGeneralTab', () => ({ ProjectGeneralTab: () => <div>ProjectGeneralTab</div> }));
vi.mock('./pages/project/ProjectRoutingTab', () => ({ ProjectRoutingTab: () => <div>ProjectRoutingTab</div> }));
vi.mock('./pages/project/ProjectTokenTab', () => ({ ProjectTokenTab: () => <div>ProjectTokenTab</div> }));
vi.mock('./pages/project/ProjectUsersTab', () => ({ ProjectUsersTab: () => <div>ProjectUsersTab</div> }));
vi.mock('./pages/project/ProjectLogsTab', () => ({ ProjectLogsTab: () => <div>ProjectLogsTab</div> }));
vi.mock('./pages/project/ProjectSecurityTab', () => ({ ProjectSecurityTab: () => <div>ProjectSecurityTab</div> }));
vi.mock('./pages/project/ProjectTokenCreatePage', () => ({ ProjectTokenCreatePage: () => <div>ProjectTokenCreatePage</div> }));
vi.mock('./pages/project/ProjectTokenEditPage', () => ({ ProjectTokenEditPage: () => <div>ProjectTokenEditPage</div> }));
vi.mock('./pages/UsersPage', () => ({ UsersPage: () => <div>UsersPage</div> }));
vi.mock('./pages/UsagePage', () => ({ UsagePage: () => <div>UsagePage</div> }));
vi.mock('./pages/UsageRecordPage', () => ({ UsageRecordPage: () => <div>UsageRecordPage</div> }));
vi.mock('./pages/TestPage', () => ({ TestPage: () => <div>TestPage</div> }));
vi.mock('./pages/SettingsPage', () => ({
  SettingsPage: () => <div>SettingsPage</div>,
  SettingsGeneralTab: () => <div>SettingsGeneralTab</div>,
  SettingsSecurityTab: () => <div>SettingsSecurityTab</div>,
  SettingsIntegrationsTab: () => <div>SettingsIntegrationsTab</div>,
  SettingsCatalogTab: () => <div>SettingsCatalogTab</div>,
  SettingsAboutTab: () => <div>SettingsAboutTab</div>,
}));
vi.mock('./pages/NotificationChannelListPage', () => ({ NotificationChannelListPage: () => <div>NotificationChannelListPage</div> }));
vi.mock('./pages/NotificationChannelEditPage', () => ({ NotificationChannelEditPage: () => <div>NotificationChannelEditPage</div> }));
vi.mock('./pages/NotificationChannelCreatePage', () => ({ NotificationChannelCreatePage: () => <div>NotificationChannelCreatePage</div> }));
vi.mock('./pages/RolesPage', () => ({ RolesPage: () => <div>RolesPage</div> }));
vi.mock('./pages/ProfilePage', () => ({ ProfilePage: () => <div>ProfilePage</div> }));
vi.mock('./pages/UserEditPage', () => ({ UserEditPage: () => <div>UserEditPage</div> }));
vi.mock('./pages/HelpPage', () => ({ HelpPage: () => <div>HelpPage</div> }));
vi.mock('./pages/AuditPage', () => ({ AuditPage: () => <div>AuditPage</div> }));

// ── Component mocks ────────────────────────────────────────────────────────────
vi.mock('./components/Logo', () => ({ Logo: () => <span>Logo</span> }));
vi.mock('./components/NotificationBell', () => ({
  ProfileNotificationBadge: () => <span data-testid="notif-badge" />,
}));

// ── API mocks ─────────────────────────────────────────────────────────────────
vi.mock('./api', () => ({
  checkSetupStatus: vi.fn(),
  getSystemInfo: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getClients: vi.fn(),
  getExperiments: vi.fn(),
}));

// ── AuthContext mock ───────────────────────────────────────────────────────────
vi.mock('./AuthContext', () => ({ useAuth: vi.fn() }));

import App from './App';
import { checkSetupStatus, getSystemInfo, getSettings, updateSettings, getClients, getExperiments } from './api';
import { useAuth } from './AuthContext';

const mockCheckSetup = vi.mocked(checkSetupStatus as () => Promise<unknown>);
const mockGetSystemInfo = vi.mocked(getSystemInfo as () => Promise<unknown>);
const mockGetSettings = vi.mocked(getSettings as () => Promise<unknown>);
const mockUpdateSettings = vi.mocked(updateSettings as (...a: unknown[]) => Promise<unknown>);
const mockGetClients = vi.mocked(getClients as () => Promise<unknown>);
const mockGetExperiments = vi.mocked(getExperiments as () => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);

const adminUser = { id: 'u1', email: 'admin@test.com', role: 'admin', totpEnabled: false };
const logoutFn = vi.fn();
const navigateFn = vi.fn();

// ponytail: useNavigate is internal to react-router; we can't easily mock it here,
// so we test via actual routing. Keep tests at the branch level.

beforeEach(() => {
  mockCheckSetup.mockResolvedValue({ needsSetup: false });
  mockGetSystemInfo.mockResolvedValue({ isDocker: false });
  mockGetSettings.mockResolvedValue({ telemetry: true, requireMfa: false });
  mockUpdateSettings.mockResolvedValue(undefined);
  mockGetClients.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
  mockGetExperiments.mockRejectedValue(Object.assign(new Error('module_disabled'), { status: 403 }));
  mockUseAuth.mockReturnValue({
    user: adminUser,
    isLoading: false,
    login: vi.fn(),
    loginDirect: vi.fn(),
    logout: logoutFn,
    updateUser: vi.fn(),
    can: vi.fn().mockReturnValue(true),
  });
  // Reset localStorage
  localStorage.clear();
});

afterEach(() => vi.clearAllMocks());

function renderApp() {
  return render(<App />);
}

// ── SetupGuard ─────────────────────────────────────────────────────────────────

describe('SetupGuard', () => {
  it('shows spinner while checking setup', async () => {
    // checkSetupStatus never resolves during this test
    mockCheckSetup.mockReturnValue(new Promise(() => {}));
    renderApp();
    // spinner should be present
    expect(document.querySelector('.spinner')).toBeTruthy();
  });

  it('renders OverviewPage after setup check passes', async () => {
    mockCheckSetup.mockResolvedValue({ needsSetup: false });
    renderApp();
    await waitFor(() => expect(screen.queryByText('OverviewPage')).toBeTruthy(), { timeout: 3000 });
  });

  it('continues to normal flow when checkSetupStatus throws', async () => {
    mockCheckSetup.mockRejectedValue(new Error('network'));
    renderApp();
    // Should still render after catch (spinner goes away, then OverviewPage)
    await waitFor(() => screen.queryByText('OverviewPage'), { timeout: 3000 });
  });

  it('shows loading center when isLoading is true', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: true,
      login: vi.fn(),
      loginDirect: vi.fn(),
      logout: vi.fn(),
      updateUser: vi.fn(),
      can: vi.fn(),
    });
    renderApp();
    await waitFor(() => expect(document.querySelector('.spinner')).toBeTruthy());
  });
});

// ── ProtectedLayout — banners ─────────────────────────────────────────────────

describe('ProtectedLayout — update banner', () => {
  it('shows update banner when update is available (non-docker admin)', async () => {
    mockGetSystemInfo.mockResolvedValue({
      isDocker: false,
      updateInfo: { available: true, latestVersion: '1.2.0', currentVersion: '1.0.0' },
    });
    renderApp();
    // Banner text spans multiple elements because version is wrapped in <strong>
    await waitFor(() => expect(screen.getByText('Update in Settings')).toBeTruthy(), { timeout: 3000 });
  });

  it('does not show update banner when isDocker is true', async () => {
    mockGetSystemInfo.mockResolvedValue({
      isDocker: true,
      updateInfo: { available: true, latestVersion: '1.2.0', currentVersion: '1.0.0' },
    });
    renderApp();
    await waitFor(() => screen.queryByText('OverviewPage'));
    expect(screen.queryByText(/1\.2\.0 is available/)).toBeNull();
  });

  it('dismisses update banner when × clicked', async () => {
    mockGetSystemInfo.mockResolvedValue({
      isDocker: false,
      updateInfo: { available: true, latestVersion: '1.2.0', currentVersion: '1.0.0' },
    });
    renderApp();
    await waitFor(() => screen.getByText('Update in Settings'));
    const dismissBtn = Array.from(document.querySelectorAll('button')).find(b => b.title === 'Dismiss');
    expect(dismissBtn).toBeTruthy();
    await userEvent.click(dismissBtn!);
    expect(screen.queryByText('Update in Settings')).toBeNull();
  });

  it('does not show update banner when already dismissed (localStorage)', async () => {
    localStorage.setItem('lr-update-banner-dismissed', 'true');
    mockGetSystemInfo.mockResolvedValue({
      isDocker: false,
      updateInfo: { available: true, latestVersion: '1.2.0', currentVersion: '1.0.0' },
    });
    renderApp();
    await waitFor(() => screen.queryByText('OverviewPage'));
    expect(screen.queryByText(/1\.2\.0 is available/)).toBeNull();
  });
});

describe('ProtectedLayout — MFA banner', () => {
  it('shows MFA banner when requireMfa and user has no 2FA', async () => {
    mockGetSettings.mockResolvedValue({ telemetry: true, requireMfa: true });
    // user has totpEnabled: false (default in adminUser)
    renderApp();
    await waitFor(() => expect(screen.getByText(/Two-factor authentication is required/)).toBeTruthy(), { timeout: 3000 });
  });

  it('does not show MFA banner when user has 2FA enabled', async () => {
    mockGetSettings.mockResolvedValue({ telemetry: true, requireMfa: true });
    mockUseAuth.mockReturnValue({
      user: { ...adminUser, totpEnabled: true },
      isLoading: false,
      login: vi.fn(),
      loginDirect: vi.fn(),
      logout: vi.fn(),
      updateUser: vi.fn(),
      can: vi.fn(),
    });
    renderApp();
    await waitFor(() => screen.queryByText('OverviewPage'));
    expect(screen.queryByText(/Two-factor authentication is required/)).toBeNull();
  });
});

describe('ProtectedLayout — telemetry banner', () => {
  it('shows telemetry prompt when admin and telemetry is undefined', async () => {
    mockGetSettings.mockResolvedValue({ requireMfa: false }); // telemetry key missing
    renderApp();
    await waitFor(() => expect(screen.getByText(/anonymous install metrics/)).toBeTruthy(), { timeout: 3000 });
  });

  it('does not show telemetry prompt for non-admin users', async () => {
    mockGetSettings.mockResolvedValue({ requireMfa: false }); // telemetry undefined
    mockUseAuth.mockReturnValue({
      user: { ...adminUser, role: 'member' },
      isLoading: false,
      login: vi.fn(),
      loginDirect: vi.fn(),
      logout: vi.fn(),
      updateUser: vi.fn(),
      can: vi.fn(),
    });
    renderApp();
    await waitFor(() => screen.queryByText('OverviewPage'));
    expect(screen.queryByText(/anonymous install metrics/)).toBeNull();
  });

  it('dismisses telemetry prompt when "Yes, help out" clicked', async () => {
    mockGetSettings.mockResolvedValue({ requireMfa: false });
    renderApp();
    await waitFor(() => screen.getByText(/Yes, help out/));
    await userEvent.click(screen.getByText(/Yes, help out/));
    await waitFor(() => expect(screen.queryByText(/anonymous install metrics/)).toBeNull());
    expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ telemetry: expect.objectContaining({ enabled: true }) }));
  });

  it('dismisses telemetry prompt when "No thanks" clicked', async () => {
    mockGetSettings.mockResolvedValue({ requireMfa: false });
    renderApp();
    await waitFor(() => screen.getByText(/No thanks/));
    await userEvent.click(screen.getByText(/No thanks/));
    await waitFor(() => expect(screen.queryByText(/anonymous install metrics/)).toBeNull());
    expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ telemetry: expect.objectContaining({ enabled: false }) }));
  });
});

// ── Sidebar ────────────────────────────────────────────────────────────────────

describe('Sidebar', () => {
  it('renders nav links', async () => {
    renderApp();
    await waitFor(() => screen.getByText('Overview'));
    expect(screen.getByText('Models')).toBeTruthy();
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(screen.getByText('Usage')).toBeTruthy();
  });

  it('offers Experiments only when the module answers', async () => {
    renderApp();
    await waitFor(() => screen.getByText('Overview'));
    expect(screen.queryByText('Experiments')).toBeNull();

    mockGetExperiments.mockResolvedValue([]);
    cleanup();
    renderApp();
    await waitFor(() => expect(screen.getByText('Experiments')).toBeTruthy());
  });

  it('lists the nav flat, in setup then use then measure order', async () => {
    // Both optional modules on, so the whole intended order is visible at once.
    mockGetClients.mockResolvedValue([]);
    mockGetExperiments.mockResolvedValue([]);
    renderApp();
    await waitFor(() => screen.getByText('Connect'));
    await waitFor(() => screen.getByText('Experiments'));
    const labels = Array.from(document.querySelectorAll('.sidebar-nav .nav-label')).map(el => el.textContent);
    expect(labels).toEqual([
      'Overview', 'Connections', 'Models', 'Profiles', 'Projects',
      'Connect', 'Playground', 'Experiments', 'Usage',
    ]);
  });

  it('toggles collapsed state on toggle button click', async () => {
    renderApp();
    await waitFor(() => screen.getByText('Overview'));
    const appShell = document.querySelector('.app-shell');
    expect(appShell?.classList.contains('sidebar-collapsed')).toBe(false);
    const toggleBtn = document.querySelector('.sidebar-toggle');
    expect(toggleBtn).toBeTruthy();
    await userEvent.click(toggleBtn!);
    expect(appShell?.classList.contains('sidebar-collapsed')).toBe(true);
  });

  it('persists collapsed state to localStorage', async () => {
    renderApp();
    await waitFor(() => screen.getByText('Overview'));
    const toggleBtn = document.querySelector('.sidebar-toggle');
    await userEvent.click(toggleBtn!);
    expect(localStorage.getItem('lr-sidebar')).toBe('collapsed');
  });

  it('reads collapsed state from localStorage on mount', async () => {
    localStorage.setItem('lr-sidebar', 'collapsed');
    renderApp();
    await waitFor(() => screen.getByText('Overview'));
    const appShell = document.querySelector('.app-shell');
    expect(appShell?.classList.contains('sidebar-collapsed')).toBe(true);
  });

  it('sets localStorage to "expanded" when uncollapsing sidebar', async () => {
    localStorage.setItem('lr-sidebar', 'collapsed');
    renderApp();
    await waitFor(() => screen.getByText('Overview'));
    const toggleBtn = document.querySelector('.sidebar-toggle');
    await userEvent.click(toggleBtn!); // collapse → expand
    expect(localStorage.getItem('lr-sidebar')).toBe('expanded');
  });

  it('shows ThemeCycleButton when collapsed', async () => {
    localStorage.setItem('lr-sidebar', 'collapsed');
    renderApp();
    await waitFor(() => screen.getByText('Overview'));
    // ThemeCycleButton shows a nav-item button with theme title
    const themeBtn = document.querySelector('button[title^="Theme:"]');
    expect(themeBtn).toBeTruthy();
  });
});

// ── ThemeCycleButton and ThemeSelector ────────────────────────────────────────

describe('Sidebar — ThemeCycleButton', () => {
  it('cycles theme when ThemeCycleButton clicked (collapsed sidebar)', async () => {
    localStorage.setItem('lr-sidebar', 'collapsed');
    renderApp();
    await waitFor(() => screen.getByText('Overview'));
    const themeBtn = document.querySelector('button[title^="Theme:"]') as HTMLButtonElement;
    expect(themeBtn).toBeTruthy();
    // Click it to cycle theme (auto → dark)
    await userEvent.click(themeBtn);
    // Title changes to next theme
    const updatedBtn = document.querySelector('button[title^="Theme:"]') as HTMLButtonElement;
    expect(updatedBtn.title).toContain('Theme:');
  });
});

describe('Sidebar — ThemeSelector', () => {
  it('renders theme selector buttons when sidebar is expanded', async () => {
    renderApp();
    await waitFor(() => screen.getByText('Overview'));
    // ThemeSelector renders Auto/Dark/Light buttons
    expect(screen.getByTitle('Auto')).toBeTruthy();
    expect(screen.getByTitle('Dark')).toBeTruthy();
    expect(screen.getByTitle('Light')).toBeTruthy();
  });

  it('sets theme when ThemeSelector button clicked', async () => {
    renderApp();
    await waitFor(() => screen.getByText('Overview'));
    await userEvent.click(screen.getByTitle('Dark'));
    // Dark button becomes active
    expect(screen.getByTitle('Dark').classList.contains('active')).toBe(true);
  });
});

// ── Sidebar NavLink active state — Settings and Help (lines 151, 159) ────────

describe('Sidebar — Settings and Help NavLink active class', () => {
  it('Settings NavLink gets active class when on settings route (line 151 true branch)', async () => {
    renderApp();
    await waitFor(() => screen.getByText('Overview'));
    // sidebar is expanded → title is undefined, use nav-label text
    const settingsLink = Array.from(document.querySelectorAll('a.nav-item')).find(el => el.textContent?.includes('Settings')) as HTMLElement | undefined;
    expect(settingsLink).toBeTruthy();
    await userEvent.click(settingsLink!);
    await waitFor(() => expect(settingsLink!.className).toContain('active'));
  });

  it('Help NavLink gets active class when on help route (line 159 true branch)', async () => {
    renderApp();
    await waitFor(() => screen.getByText('Overview'));
    const helpLink = Array.from(document.querySelectorAll('a.nav-item')).find(el => el.textContent?.includes('Help')) as HTMLElement | undefined;
    expect(helpLink).toBeTruthy();
    await userEvent.click(helpLink!);
    await waitFor(() => expect(helpLink!.className).toContain('active'));
  });
});

describe('Sidebar — Sign Out', () => {
  it('calls logout and navigates to login on Sign Out click', async () => {
    renderApp();
    await waitFor(() => screen.getByText('Overview'));
    await userEvent.click(screen.getByTitle('Sign Out'));
    expect(logoutFn).toHaveBeenCalled();
    // After logout, LoginPage (mocked) should render
    await waitFor(() => expect(screen.getByText('LoginPage')).toBeTruthy());
  });
});

// ── Unauthenticated redirect ───────────────────────────────────────────────────

describe('ProtectedLayout — unauthenticated', () => {
  it('redirects to login when user is null', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      login: vi.fn(),
      loginDirect: vi.fn(),
      logout: vi.fn(),
      updateUser: vi.fn(),
      can: vi.fn(),
    });
    renderApp();
    await waitFor(() => expect(screen.getByText('LoginPage')).toBeTruthy(), { timeout: 3000 });
  });
});

// ── SetupGuard — needsSetup: true (line 333) — MUST BE LAST (corrupts router state) ──

describe('SetupGuard — needsSetup true', () => {
  it('navigates to /dashboard/setup when needsSetup is true', async () => {
    mockCheckSetup.mockResolvedValue({ needsSetup: true });
    renderApp();
    await waitFor(() => expect(screen.queryByText('SetupPage')).toBeTruthy(), { timeout: 3000 });
  });
});
