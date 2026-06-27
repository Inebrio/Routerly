import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ProfilePage, ProfileNotificationsTab } from './ProfilePage';

// ponytail: mock qrcode so tests don't need a canvas implementation
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,STUB') },
}));

// ponytail: mock api at module level
vi.mock('../api', () => ({
  updateMe: vi.fn(),
  setup2fa: vi.fn(),
  confirm2fa: vi.fn(),
  disable2fa: vi.fn(),
  regenerateBackupCodes: vi.fn(),
  getNotificationInbox: vi.fn(),
  markNotificationsRead: vi.fn(),
}));

// ponytail: mock AuthContext — ProfileSecurityTab reads user + updateUser
vi.mock('../AuthContext', () => ({
  useAuth: vi.fn(),
}));

// ponytail: mock NotificationBell exports used by ProfilePage
vi.mock('../components/NotificationBell', () => ({
  severityIcon: (sev: string) => sev,
  timeAgo: (iso: string) => iso,
}));

import {
  updateMe, setup2fa, confirm2fa, disable2fa,
  regenerateBackupCodes, getNotificationInbox, markNotificationsRead,
} from '../api';
import { useAuth } from '../AuthContext';

const mockUpdateMe = vi.mocked(updateMe as (...a: unknown[]) => Promise<unknown>);
const mockSetup2fa = vi.mocked(setup2fa as () => Promise<unknown>);
const mockConfirm2fa = vi.mocked(confirm2fa as (c: string) => Promise<unknown>);
const mockDisable2fa = vi.mocked(disable2fa as (c: string) => Promise<unknown>);
const mockRegenerateBackupCodes = vi.mocked(regenerateBackupCodes as (c: string) => Promise<unknown>);
const mockGetInbox = vi.mocked(getNotificationInbox as (...a: unknown[]) => Promise<unknown>);
const mockMarkRead = vi.mocked(markNotificationsRead as (...a: unknown[]) => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);

const defaultUser = { id: 'u1', email: 'test@test.com', role: 'admin', totpEnabled: false };
const updateUserFn = vi.fn();

beforeEach(() => {
  mockUseAuth.mockReturnValue({
    user: defaultUser,
    isLoading: false,
    login: vi.fn(),
    loginDirect: vi.fn(),
    logout: vi.fn(),
    updateUser: updateUserFn,
    can: vi.fn().mockReturnValue(true),
  });
  mockGetInbox.mockResolvedValue({ items: [], unreadCount: 0 });
  mockMarkRead.mockResolvedValue(undefined);
  mockUpdateMe.mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

function renderProfile(tab: 'profile' | 'notifications' = 'profile') {
  return render(
    <MemoryRouter>
      <ProfilePage initialTab={tab} />
    </MemoryRouter>
  );
}

// ── Profile tab (Change Password) ─────────────────────────────────────────────

describe('ProfilePage — change password', () => {
  it('renders Change Password form', () => {
    renderProfile();
    expect(screen.getByLabelText('Current Password')).toBeTruthy();
    expect(screen.getByLabelText('New Password')).toBeTruthy();
    expect(screen.getByLabelText('Confirm New Password')).toBeTruthy();
  });

  it('shows error when passwords do not match', async () => {
    renderProfile();
    await userEvent.type(screen.getByLabelText('Current Password'), 'old123');
    await userEvent.type(screen.getByLabelText('New Password'), 'newpass1');
    await userEvent.type(screen.getByLabelText('Confirm New Password'), 'newpass2');
    await userEvent.click(screen.getByRole('button', { name: /Change Password/ }));
    expect(screen.getByText(/Passwords do not match/)).toBeTruthy();
  });

  it('shows error when new password is too short', async () => {
    renderProfile();
    await userEvent.type(screen.getByLabelText('Current Password'), 'old123');
    await userEvent.type(screen.getByLabelText('New Password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm New Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: /Change Password/ }));
    expect(screen.getByText(/at least 8 characters/)).toBeTruthy();
  });

  it('calls updateMe and shows success on valid submit', async () => {
    mockUpdateMe.mockResolvedValue(undefined);
    renderProfile();
    await userEvent.type(screen.getByLabelText('Current Password'), 'oldpassword');
    await userEvent.type(screen.getByLabelText('New Password'), 'newpassword1');
    await userEvent.type(screen.getByLabelText('Confirm New Password'), 'newpassword1');
    await userEvent.click(screen.getByRole('button', { name: /Change Password/ }));
    await waitFor(() => expect(screen.getByText(/Password changed successfully/)).toBeTruthy());
    expect(mockUpdateMe).toHaveBeenCalledWith({
      currentPassword: 'oldpassword',
      newPassword: 'newpassword1',
    });
  });

  it('shows API error when updateMe throws', async () => {
    mockUpdateMe.mockRejectedValue(new Error('Wrong current password'));
    renderProfile();
    await userEvent.type(screen.getByLabelText('Current Password'), 'wrong');
    await userEvent.type(screen.getByLabelText('New Password'), 'newpassword1');
    await userEvent.type(screen.getByLabelText('Confirm New Password'), 'newpassword1');
    await userEvent.click(screen.getByRole('button', { name: /Change Password/ }));
    await waitFor(() => expect(screen.getByText(/Wrong current password/)).toBeTruthy());
  });
});

// ── 2FA — setup flow ──────────────────────────────────────────────────────────

describe('ProfilePage — 2FA setup flow', () => {
  it('shows Enable button when 2FA is not enabled', () => {
    renderProfile();
    expect(screen.getByRole('button', { name: /Enable Two-Factor Authentication/ })).toBeTruthy();
  });

  it('shows setup step after clicking Enable', async () => {
    mockSetup2fa.mockResolvedValue({
      secret: 'TESTSECRET',
      qrUrl: 'otpauth://totp/test',
      backupCodes: ['aaa', 'bbb'],
    });
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Enable Two-Factor Authentication/ }));
    await waitFor(() => expect(screen.getByText('TESTSECRET')).toBeTruthy());
    expect(screen.getByText('aaa')).toBeTruthy();
    expect(screen.getByText('bbb')).toBeTruthy();
  });

  it('renders QR code image with data: src after setup', async () => {
    mockSetup2fa.mockResolvedValue({
      secret: 'TESTSECRET',
      qrUrl: 'otpauth://totp/test',
      backupCodes: [],
    });
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Enable Two-Factor Authentication/ }));
    const img = await waitFor(() => screen.getByRole('img', { name: '2FA setup QR code' }));
    expect((img as HTMLImageElement).src).toMatch(/^data:/);
  });

  it('shows setup error when setup2fa throws', async () => {
    mockSetup2fa.mockRejectedValue(new Error('Setup failed'));
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Enable Two-Factor Authentication/ }));
    await waitFor(() => expect(screen.getByText(/Setup failed/)).toBeTruthy());
  });

  it('confirms 2FA with code and shows enabled state', async () => {
    mockSetup2fa.mockResolvedValue({
      secret: 'TESTSECRET',
      qrUrl: '',
      backupCodes: [],
    });
    mockConfirm2fa.mockResolvedValue(undefined);
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Enable Two-Factor Authentication/ }));
    await waitFor(() => screen.getByLabelText(/Enter code from your app/));
    await userEvent.type(screen.getByLabelText(/Enter code from your app/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Activate 2FA' }));
    await waitFor(() => expect(screen.getByText(/2FA is enabled/)).toBeTruthy());
    expect(mockConfirm2fa).toHaveBeenCalledWith('123456');
    expect(updateUserFn).toHaveBeenCalledWith({ totpEnabled: true });
  });

  it('shows confirm error when confirm2fa throws', async () => {
    mockSetup2fa.mockResolvedValue({ secret: 'S', qrUrl: '', backupCodes: [] });
    mockConfirm2fa.mockRejectedValue(new Error('Invalid code'));
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Enable Two-Factor Authentication/ }));
    await waitFor(() => screen.getByLabelText(/Enter code from your app/));
    await userEvent.type(screen.getByLabelText(/Enter code from your app/), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Activate 2FA' }));
    await waitFor(() => expect(screen.getByText(/Invalid code/)).toBeTruthy());
  });

  it('cancel from setup step returns to idle', async () => {
    mockSetup2fa.mockResolvedValue({ secret: 'S', qrUrl: '', backupCodes: [] });
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Enable Two-Factor Authentication/ }));
    await waitFor(() => screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: /Enable Two-Factor Authentication/ })).toBeTruthy();
  });
});

// ── 2FA — enabled state ───────────────────────────────────────────────────────

describe('ProfilePage — 2FA enabled state', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { ...defaultUser, totpEnabled: true },
      isLoading: false,
      login: vi.fn(),
      loginDirect: vi.fn(),
      logout: vi.fn(),
      updateUser: updateUserFn,
      can: vi.fn().mockReturnValue(true),
    });
  });

  it('shows "2FA is enabled" banner when totpEnabled', () => {
    renderProfile();
    expect(screen.getByText(/2FA is enabled/)).toBeTruthy();
  });

  it('shows Disable 2FA form', () => {
    renderProfile();
    expect(screen.getByLabelText(/Disable 2FA/)).toBeTruthy();
  });

  it('disables 2FA successfully', async () => {
    mockDisable2fa.mockResolvedValue(undefined);
    renderProfile();
    await userEvent.type(screen.getByLabelText(/Disable 2FA/), '654321');
    await userEvent.click(screen.getByRole('button', { name: /Disable 2FA/ }));
    await waitFor(() => expect(mockDisable2fa).toHaveBeenCalledWith('654321'));
    expect(updateUserFn).toHaveBeenCalledWith({ totpEnabled: false });
    // Should be back to idle
    await waitFor(() => expect(screen.getByRole('button', { name: /Enable Two-Factor Authentication/ })).toBeTruthy());
  });

  it('shows error when disable2fa throws', async () => {
    mockDisable2fa.mockRejectedValue(new Error('Invalid TOTP'));
    renderProfile();
    await userEvent.type(screen.getByLabelText(/Disable 2FA/), '000000');
    await userEvent.click(screen.getByRole('button', { name: /Disable 2FA/ }));
    await waitFor(() => expect(screen.getByText(/Invalid TOTP/)).toBeTruthy());
  });

  it('shows regenerate form on click', async () => {
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Regenerate backup codes/ }));
    expect(screen.getByLabelText(/Enter authenticator code to regenerate/)).toBeTruthy();
  });

  it('regenerates backup codes successfully', async () => {
    mockRegenerateBackupCodes.mockResolvedValue({ backupCodes: ['new1', 'new2'] });
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Regenerate backup codes/ }));
    await waitFor(() => screen.getByLabelText(/Enter authenticator code to regenerate/));
    await userEvent.type(screen.getByLabelText(/Enter authenticator code to regenerate/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(screen.getByText('new1')).toBeTruthy());
    expect(screen.getByText('new2')).toBeTruthy();
  });

  it('shows error when regenerateBackupCodes throws', async () => {
    mockRegenerateBackupCodes.mockRejectedValue(new Error('Bad code'));
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Regenerate backup codes/ }));
    await waitFor(() => screen.getByLabelText(/Enter authenticator code to regenerate/));
    await userEvent.type(screen.getByLabelText(/Enter authenticator code to regenerate/), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(screen.getByText(/Bad code/)).toBeTruthy());
  });

  it('cancel from regenerate form hides the form', async () => {
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Regenerate backup codes/ }));
    await waitFor(() => screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // Regenerate button should be visible again
    expect(screen.getByRole('button', { name: /Regenerate backup codes/ })).toBeTruthy();
  });
});

// ── Notifications tab ─────────────────────────────────────────────────────────

describe('ProfileNotificationsTab', () => {
  function renderTab() {
    return render(
      <MemoryRouter>
        <ProfileNotificationsTab />
      </MemoryRouter>
    );
  }

  it('shows empty state when no notifications', async () => {
    mockGetInbox.mockResolvedValue({ items: [], unreadCount: 0 });
    renderTab();
    await waitFor(() => expect(screen.getByText('No notifications')).toBeTruthy());
    expect(screen.getByText(/All caught up/)).toBeTruthy();
  });

  it('renders notification items', async () => {
    mockGetInbox.mockResolvedValue({
      items: [
        { id: 'n1', event: 'provider.error', severity: 'critical', timestamp: new Date().toISOString(), read: false, details: {} },
        { id: 'n2', event: 'system.startup', severity: 'info', timestamp: new Date().toISOString(), read: true, details: {} },
      ],
      unreadCount: 1,
    });
    renderTab();
    await waitFor(() => expect(screen.getByText('provider.error')).toBeTruthy());
    expect(screen.getByText('system.startup')).toBeTruthy();
  });

  it('shows unread count and Mark all read button', async () => {
    mockGetInbox.mockResolvedValue({
      items: [{ id: 'n1', event: 'x', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} }],
      unreadCount: 1,
    });
    renderTab();
    await waitFor(() => expect(screen.getByText(/1 unread/)).toBeTruthy());
    expect(screen.getByText(/Mark all read/)).toBeTruthy();
  });

  it('marks all read when button clicked', async () => {
    mockGetInbox.mockResolvedValue({
      items: [{ id: 'n1', event: 'x', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} }],
      unreadCount: 1,
    });
    mockMarkRead.mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => screen.getByText(/Mark all read/));
    await userEvent.click(screen.getByText(/Mark all read/));
    expect(mockMarkRead).toHaveBeenCalledWith({ all: true });
    await waitFor(() => expect(screen.getByText(/All caught up/)).toBeTruthy());
  });

  it('marks single notification as read', async () => {
    mockGetInbox.mockResolvedValue({
      items: [{ id: 'n1', event: 'x', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} }],
      unreadCount: 1,
    });
    mockMarkRead.mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => screen.getByText('x'));
    // find the CheckCheck button for single item
    const markBtn = document.querySelector('button[title="Mark as read"]');
    expect(markBtn).toBeTruthy();
    await userEvent.click(markBtn!);
    expect(mockMarkRead).toHaveBeenCalledWith({ ids: ['n1'] });
  });

  it('silently ignores inbox load errors', async () => {
    mockGetInbox.mockRejectedValue(new Error('network'));
    renderTab();
    // Should not crash; "No notifications" will show after loading finishes
    await waitFor(() => expect(screen.getByText('No notifications')).toBeTruthy());
  });
});

// ── ProfilePage tab navigation ────────────────────────────────────────────────

describe('ProfilePage — tab navigation', () => {
  it('renders Profile tab by default', () => {
    renderProfile('profile');
    // "Change Password" appears as section heading
    expect(screen.getAllByText('Change Password').length).toBeGreaterThan(0);
  });

  it('renders Notifications tab when initialTab is notifications', async () => {
    mockGetInbox.mockResolvedValue({ items: [], unreadCount: 0 });
    renderProfile('notifications');
    await waitFor(() => expect(screen.getByText('No notifications')).toBeTruthy());
  });
});
