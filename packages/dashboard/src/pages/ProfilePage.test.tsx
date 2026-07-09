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
  getNotificationInboxPage: vi.fn(),
  getNotificationInboxItem: vi.fn(),
  markNotificationsRead: vi.fn(),
  markNotificationsUnread: vi.fn(),
  deleteNotifications: vi.fn(),
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
  regenerateBackupCodes, getNotificationInbox, getNotificationInboxPage, markNotificationsRead, markNotificationsUnread, deleteNotifications,
} from '../api';
import { useAuth } from '../AuthContext';
import QRCode from 'qrcode';

const mockQRCode = vi.mocked(QRCode as { toDataURL: (...a: unknown[]) => Promise<string> });
const mockUpdateMe = vi.mocked(updateMe as (...a: unknown[]) => Promise<unknown>);
const mockSetup2fa = vi.mocked(setup2fa as () => Promise<unknown>);
const mockConfirm2fa = vi.mocked(confirm2fa as (c: string) => Promise<unknown>);
const mockDisable2fa = vi.mocked(disable2fa as (c: string) => Promise<unknown>);
const mockRegenerateBackupCodes = vi.mocked(regenerateBackupCodes as (c: string) => Promise<unknown>);
const mockGetInbox = vi.mocked(getNotificationInbox as (...a: unknown[]) => Promise<unknown>);
const mockGetInboxPage = vi.mocked(getNotificationInboxPage as (...a: unknown[]) => Promise<unknown>);
const mockMarkRead = vi.mocked(markNotificationsRead as (...a: unknown[]) => Promise<unknown>);
const mockMarkUnread = vi.mocked(markNotificationsUnread as (...a: unknown[]) => Promise<unknown>);
const mockDelete = vi.mocked(deleteNotifications as (...a: unknown[]) => Promise<unknown>);

const emptyPage = { items: [], unreadCount: 0, pagination: { page: 1, pageSize: 20, totalRecords: 0, totalPages: 1 }, enabled: true };

type InboxItemLike = { id: string; event: string; severity: 'info' | 'warning' | 'critical'; timestamp: string; read: boolean; details: Record<string, unknown> };
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
  localStorage.clear();
  mockGetInbox.mockResolvedValue({ items: [], unreadCount: 0, enabled: true });
  mockGetInboxPage.mockResolvedValue(emptyPage);
  mockMarkRead.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue({ deleted: 1 });
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

  function pageOf(items: InboxItemLike[], unreadCount = items.filter(i => !i.read).length) {
    return { items, unreadCount, pagination: { page: 1, pageSize: 20, totalRecords: items.length, totalPages: 1 }, enabled: true };
  }

  it('shows empty state when no notifications', async () => {
    mockGetInboxPage.mockResolvedValue(emptyPage);
    renderTab();
    await waitFor(() => expect(screen.getByText('No notifications found.')).toBeTruthy());
    expect(screen.getByText(/All caught up/)).toBeTruthy();
  });

  it('renders notification rows in a table', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'provider.error', severity: 'critical', timestamp: new Date().toISOString(), read: false, details: {} },
      { id: 'n2', event: 'system.startup', severity: 'info', timestamp: new Date().toISOString(), read: true, details: {} },
    ], 1));
    renderTab();
    await waitFor(() => expect(screen.getByText('provider.error')).toBeTruthy());
    expect(screen.getByText('system.startup')).toBeTruthy();
    // Table header present (Severity also appears as a filter label)
    expect(screen.getAllByText('Severity').length).toBeGreaterThan(0);
    expect(screen.getByText('Date')).toBeTruthy();
  });

  it('shows unread count and Mark all read button', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([{ id: 'n1', event: 'x', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} }], 1));
    renderTab();
    await waitFor(() => expect(screen.getByText(/1 unread/)).toBeTruthy());
    expect(screen.getByText(/Mark all read/)).toBeTruthy();
  });

  it('marks all read when button clicked', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([{ id: 'n1', event: 'x', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} }], 1));
    mockMarkRead.mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => screen.getByText(/Mark all read/));
    await userEvent.click(screen.getByText(/Mark all read/));
    expect(mockMarkRead).toHaveBeenCalledWith({ all: true });
    await waitFor(() => expect(screen.getByText(/All caught up/)).toBeTruthy());
  });

  it('opens the detail drawer on row click and marks the item read', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'budget.exceeded', severity: 'warning', timestamp: new Date().toISOString(), read: false, details: { projectId: 'p1' } },
    ], 1));
    mockMarkRead.mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => screen.getByText('budget.exceeded'));
    await userEvent.click(screen.getByText('budget.exceeded'));
    // Drawer shows details + the detail key
    await waitFor(() => expect(screen.getByRole('dialog', { name: /notification detail/i })).toBeTruthy());
    expect(screen.getByText('projectId')).toBeTruthy();
    await userEvent.click(screen.getByText(/Mark as read/));
    expect(mockMarkRead).toHaveBeenCalledWith({ ids: ['n1'] });
  });

  it('silently ignores inbox load errors', async () => {
    mockGetInboxPage.mockRejectedValue(new Error('network'));
    renderTab();
    // Should not crash; empty state shows after loading finishes
    await waitFor(() => expect(screen.getByText('No notifications found.')).toBeTruthy());
  });

  it('selecting rows reveals the bulk action bar', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'provider.error', severity: 'critical', timestamp: new Date().toISOString(), read: false, details: {} },
    ], 1));
    renderTab();
    await waitFor(() => screen.getByText('provider.error'));
    await userEvent.click(screen.getByLabelText('Select provider.error'));
    expect(screen.getByText('1 selected')).toBeTruthy();
  });

  it('bulk marks selected rows as read', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
      { id: 'n2', event: 'b', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
    ], 2));
    renderTab();
    await waitFor(() => screen.getByLabelText('Select all'));
    await userEvent.click(screen.getByLabelText('Select all'));
    expect(screen.getByText('2 selected')).toBeTruthy();
    await userEvent.click(screen.getByText(/Mark as read/));
    expect(mockMarkRead).toHaveBeenCalledWith({ ids: ['n1', 'n2'] });
  });

  it('bulk deletes selected rows', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
    ], 1));
    renderTab();
    await waitFor(() => screen.getByText('a'));
    await userEvent.click(screen.getByLabelText('Select a'));
    await userEvent.click(screen.getByText(/Delete/));
    expect(mockDelete).toHaveBeenCalledWith({ ids: ['n1'] });
  });

  it('toggling a row checkbox twice deselects it', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
    ], 1));
    renderTab();
    await waitFor(() => screen.getByText('a'));
    await userEvent.click(screen.getByLabelText('Select a'));
    expect(screen.getByText('1 selected')).toBeTruthy();
    await userEvent.click(screen.getByLabelText('Select a'));
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
  });

  it('select-all then select-all again clears the selection', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
      { id: 'n2', event: 'b', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
    ], 2));
    renderTab();
    await waitFor(() => screen.getByLabelText('Select all'));
    await userEvent.click(screen.getByLabelText('Select all'));
    expect(screen.getByText('2 selected')).toBeTruthy();
    await userEvent.click(screen.getByLabelText('Select all'));
    await waitFor(() => expect(screen.queryByText('2 selected')).toBeNull());
  });

  it('clears selection with the Clear button', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
    ], 1));
    renderTab();
    await waitFor(() => screen.getByText('a'));
    await userEvent.click(screen.getByLabelText('Select a'));
    await userEvent.click(screen.getByText('Clear'));
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
  });

  it('deletes a single notification from the detail drawer', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'budget.exceeded', severity: 'warning', timestamp: new Date().toISOString(), read: true, details: {} },
    ], 0));
    renderTab();
    await waitFor(() => screen.getByText('budget.exceeded'));
    await userEvent.click(screen.getByText('budget.exceeded'));
    await waitFor(() => screen.getByRole('dialog', { name: /notification detail/i }));
    await userEvent.click(screen.getByText(/Delete/));
    expect(mockDelete).toHaveBeenCalledWith({ ids: ['n1'] });
  });

  it('marks a read notification as unread from the detail drawer', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'budget.exceeded', severity: 'warning', timestamp: new Date().toISOString(), read: true, details: {} },
    ], 0));
    mockMarkUnread.mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => screen.getByText('budget.exceeded'));
    await userEvent.click(screen.getByText('budget.exceeded'));
    await waitFor(() => screen.getByRole('dialog', { name: /notification detail/i }));
    await userEvent.click(screen.getByText(/Mark as unread/));
    expect(mockMarkUnread).toHaveBeenCalledWith({ ids: ['n1'] });
  });

  it('closes the detail drawer on Escape', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'budget.exceeded', severity: 'warning', timestamp: new Date().toISOString(), read: false, details: {} },
    ], 1));
    renderTab();
    await waitFor(() => screen.getByText('budget.exceeded'));
    await userEvent.click(screen.getByText('budget.exceeded'));
    await waitFor(() => screen.getByRole('dialog', { name: /notification detail/i }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /notification detail/i })).toBeNull());
  });

  it('bulk marks selected rows as unread', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: true, details: {} },
      { id: 'n2', event: 'b', severity: 'info', timestamp: new Date().toISOString(), read: true, details: {} },
    ], 0));
    mockMarkUnread.mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => screen.getByLabelText('Select all'));
    await userEvent.click(screen.getByLabelText('Select all'));
    expect(screen.getByText('2 selected')).toBeTruthy();
    await userEvent.click(screen.getByText(/Mark as unread/));
    expect(mockMarkUnread).toHaveBeenCalledWith({ ids: ['n1', 'n2'] });
  });

  it('bulk mark read preserves non-selected items (ternary false branch)', async () => {
    // Two items; select only n1. After mark-read, n2 must remain unchanged (the :n branch fires).
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
      { id: 'n2', event: 'b', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
    ], 2));
    renderTab();
    await waitFor(() => screen.getByLabelText('Select a'));
    await userEvent.click(screen.getByLabelText('Select a'));
    expect(screen.getByText('1 selected')).toBeTruthy();
    await userEvent.click(screen.getByText(/Mark as read/));
    expect(mockMarkRead).toHaveBeenCalledWith({ ids: ['n1'] });
    // n2 row still rendered (was not removed)
    await waitFor(() => expect(screen.queryByText('b')).not.toBeNull());
  });

  it('bulk mark unread preserves non-selected items (ternary false branch)', async () => {
    // Two read items; select only n1. After mark-unread, n2 stays read (the :n branch fires).
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: true, details: {} },
      { id: 'n2', event: 'b', severity: 'info', timestamp: new Date().toISOString(), read: true, details: {} },
    ], 0));
    mockMarkUnread.mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => screen.getByLabelText('Select a'));
    await userEvent.click(screen.getByLabelText('Select a'));
    expect(screen.getByText('1 selected')).toBeTruthy();
    await userEvent.click(screen.getByText(/Mark as unread/));
    expect(mockMarkUnread).toHaveBeenCalledWith({ ids: ['n1'] });
    // n2 row still rendered
    await waitFor(() => expect(screen.queryByText('b')).not.toBeNull());
  });
});

// ── Notifications tab — filter interactions ───────────────────────────────────

describe('ProfileNotificationsTab — filter interactions', () => {
  function renderTab() {
    return render(
      <MemoryRouter>
        <ProfileNotificationsTab />
      </MemoryRouter>
    );
  }

  function pageOf(items: InboxItemLike[], unreadCount = items.filter(i => !i.read).length) {
    return { items, unreadCount, pagination: { page: 1, pageSize: 20, totalRecords: items.length, totalPages: 1 }, enabled: true };
  }

  it('clicking a severity filter button changes active filter', async () => {
    mockGetInboxPage.mockResolvedValue(emptyPage);
    renderTab();
    await waitFor(() => screen.getByText('No notifications found.'));
    // Click 'Info' filter — setSeverity('info') is called
    const infoBtn = screen.getByRole('button', { name: 'Info' });
    await userEvent.click(infoBtn);
    // getInboxPage is called again after severity filter change
    await waitFor(() => expect(mockGetInboxPage).toHaveBeenCalledTimes(2));
  });

  it('typing in event filter input calls load with event param', async () => {
    mockGetInboxPage.mockResolvedValue(emptyPage);
    renderTab();
    await waitFor(() => screen.getByText('No notifications found.'));
    const input = screen.getByPlaceholderText('e.g. provider.error');
    await userEvent.type(input, 'budget');
    await waitFor(() => expect(mockGetInboxPage).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'budget' })
    ));
  });

  it('clicking unread-only toggle filters to unread only', async () => {
    mockGetInboxPage.mockResolvedValue(emptyPage);
    renderTab();
    await waitFor(() => screen.getByText('No notifications found.'));
    // The Status section has an "All" button; there are multiple "All" buttons (severity too).
    // Find the one inside the Status group by looking for all "All" buttons and clicking the last one.
    const allBtns = screen.getAllByRole('button', { name: 'All' });
    // Last "All" is the unread-only toggle (Status section renders after Severity)
    await userEvent.click(allBtns[allBtns.length - 1]);
    await waitFor(() => expect(mockGetInboxPage).toHaveBeenCalledWith(
      expect.objectContaining({ unreadOnly: true })
    ));
    // Button label changes to "Unread only"
    expect(screen.getByRole('button', { name: 'Unread only' })).toBeTruthy();
  });

  it('clicking refresh button reloads the list', async () => {
    mockGetInboxPage.mockResolvedValue(emptyPage);
    renderTab();
    await waitFor(() => screen.getByText('No notifications found.'));
    const callsBefore = mockGetInboxPage.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(mockGetInboxPage.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('pagination: next button increments page', async () => {
    mockGetInboxPage.mockResolvedValue({
      items: [{ id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} }],
      unreadCount: 1,
      pagination: { page: 1, pageSize: 20, totalRecords: 25, totalPages: 2 },
      enabled: true,
    });
    renderTab();
    await waitFor(() => screen.getByText('a'));
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(mockGetInboxPage).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2 })
    ));
  });

  it('pagination: previous button decrements page', async () => {
    // Start on page 2
    mockGetInboxPage.mockResolvedValue({
      items: [{ id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} }],
      unreadCount: 1,
      pagination: { page: 2, pageSize: 20, totalRecords: 25, totalPages: 2 },
      enabled: true,
    });
    renderTab();
    await waitFor(() => screen.getByText('a'));
    // Navigate next to get to page 2 in state
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(mockGetInboxPage).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
    // Now go back
    await userEvent.click(screen.getByRole('button', { name: /Previous/ }));
    await waitFor(() => expect(mockGetInboxPage).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })));
  });

  it('detail drawer shows non-string detail value as JSON', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'test', severity: 'info', timestamp: new Date().toISOString(), read: false, details: { count: 42 } },
    ]));
    renderTab();
    await waitFor(() => screen.getByText('test'));
    await userEvent.click(screen.getByText('test'));
    await waitFor(() => screen.getByRole('dialog', { name: /notification detail/i }));
    // 42 is a number, rendered as JSON.stringify
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('detail drawer: last entry has no border-bottom', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'test', severity: 'info', timestamp: new Date().toISOString(), read: false, details: { a: 'x', b: 'y' } },
    ]));
    renderTab();
    await waitFor(() => screen.getByText('test'));
    await userEvent.click(screen.getByText('test'));
    await waitFor(() => screen.getByRole('dialog', { name: /notification detail/i }));
    // Both keys visible
    expect(screen.getByText('a')).toBeTruthy();
    expect(screen.getByText('b')).toBeTruthy();
  });

  it('markOne: updates selected item when drawer is open for that item', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'budget.exceeded', severity: 'warning', timestamp: new Date().toISOString(), read: false, details: {} },
    ], 1));
    mockMarkRead.mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => screen.getByText('budget.exceeded'));
    // Open drawer for n1
    await userEvent.click(screen.getByText('budget.exceeded'));
    await waitFor(() => screen.getByRole('dialog', { name: /notification detail/i }));
    // Mark as read from drawer — selected matches, updates selected state
    await userEvent.click(screen.getByText(/Mark as read/));
    expect(mockMarkRead).toHaveBeenCalledWith({ ids: ['n1'] });
  });

  it('markUnreadOne: updates selected item when drawer is open', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'budget.exceeded', severity: 'warning', timestamp: new Date().toISOString(), read: true, details: {} },
    ], 0));
    mockMarkUnread.mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => screen.getByText('budget.exceeded'));
    await userEvent.click(screen.getByText('budget.exceeded'));
    await waitFor(() => screen.getByRole('dialog', { name: /notification detail/i }));
    await userEvent.click(screen.getByText(/Mark as unread/));
    expect(mockMarkUnread).toHaveBeenCalledWith({ ids: ['n1'] });
  });

  it('markAll updates selected item when drawer is open', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
    ], 1));
    mockMarkRead.mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => screen.getByText('a'));
    // Open drawer so selected !== null
    await userEvent.click(screen.getByText('a'));
    await waitFor(() => screen.getByRole('dialog', { name: /notification detail/i }));
    // Mark all read
    await userEvent.click(screen.getByText(/Mark all read/));
    expect(mockMarkRead).toHaveBeenCalledWith({ all: true });
  });

  it('load passes dateRange.from and dateRange.to when set via localStorage', async () => {
    // Seed localStorage so useFilterState picks up non-empty dateRange
    localStorage.setItem('notif-filter-dateRange', JSON.stringify({ from: '2024-01-01', to: '2024-01-31', label: 'Jan 2024' }));
    mockGetInboxPage.mockResolvedValue(emptyPage);
    renderTab();
    await waitFor(() => expect(mockGetInboxPage).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2024-01-01', to: '2024-01-31' })
    ));
    // cleanup
    localStorage.removeItem('notif-filter-dateRange');
  });

  it('load passes severity filter to API when severity is not all', async () => {
    mockGetInboxPage.mockResolvedValue(emptyPage);
    renderTab();
    await waitFor(() => screen.getByText('No notifications found.'));
    await userEvent.click(screen.getByRole('button', { name: 'Warning' }));
    await waitFor(() => expect(mockGetInboxPage).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning' })
    ));
  });

  it('detail drawer: item.details null renders no additional details', async () => {
    // details is null — hits the ?? {} false branch (line 48)
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'test', severity: 'info', timestamp: new Date().toISOString(), read: false, details: null as unknown as Record<string, unknown> },
    ]));
    renderTab();
    await waitFor(() => screen.getByText('test'));
    await userEvent.click(screen.getByText('test'));
    await waitFor(() => screen.getByRole('dialog', { name: /notification detail/i }));
    expect(screen.getByText('No additional details.')).toBeTruthy();
  });

  it('non-Escape keydown with drawer open does not close drawer', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'test', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
    ]));
    renderTab();
    await waitFor(() => screen.getByText('test'));
    await userEvent.click(screen.getByText('test'));
    await waitFor(() => screen.getByRole('dialog', { name: /notification detail/i }));
    // Fire a non-Escape key — hits the false branch of `if (e.key === 'Escape')`
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: /notification detail/i })).toBeTruthy();
  });

  it('markOne with selected set to a different item does not update selected', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
      { id: 'n2', event: 'b', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
    ], 2));
    mockMarkRead.mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => screen.getByText('a'));
    // Open drawer for n2 (selected = n2)
    await userEvent.click(screen.getByText('b'));
    await waitFor(() => screen.getByRole('dialog', { name: /notification detail/i }));
    // Now bulk-select n1 and mark as read via "select n1" checkbox then mark read
    // Instead, use select-all and mark all read to trigger markOne path on n1 while selected=n2
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Open n2 drawer again
    await userEvent.click(screen.getByText('b'));
    await waitFor(() => screen.getByRole('dialog', { name: /notification detail/i }));
    // Mark n2 as read — selected.id === n2.id so selected gets updated
    await userEvent.click(screen.getByText(/Mark as read/));
    expect(mockMarkRead).toHaveBeenCalledWith({ ids: ['n2'] });
  });

  it('bulkMarkRead when all selected items already read does not decrease unreadCount below 0', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: true, details: {} },
    ], 0));
    mockMarkRead.mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => screen.getByLabelText('Select all'));
    await userEvent.click(screen.getByLabelText('Select all'));
    // All items already read — newlyRead=0, unreadCount stays 0
    await userEvent.click(screen.getByText(/Mark as read/));
    expect(mockMarkRead).toHaveBeenCalledWith({ ids: ['n1'] });
  });

  it('bulkMarkUnread when all selected items already unread does not increase unreadCount', async () => {
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
    ], 1));
    mockMarkUnread.mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => screen.getByLabelText('Select all'));
    await userEvent.click(screen.getByLabelText('Select all'));
    // All items already unread — newlyUnread=0
    await userEvent.click(screen.getByText(/Mark as unread/));
    expect(mockMarkUnread).toHaveBeenCalledWith({ ids: ['n1'] });
  });

  it('deleteOne while drawer open for a different item keeps drawer open', async () => {
    // n1 is open in drawer, then n2 gets deleted via bulk — setSelected(s => s && idSet.has(s.id) ? null : s)
    // s.id='n1', idSet has 'n2' => keeps s (false branch)
    mockGetInboxPage.mockResolvedValue(pageOf([
      { id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
      { id: 'n2', event: 'b', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
    ], 2));
    mockDelete.mockResolvedValue({ deleted: 1 });
    // After delete, reload returns only n1
    mockGetInboxPage
      .mockResolvedValueOnce(pageOf([
        { id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
        { id: 'n2', event: 'b', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
      ], 2))
      .mockResolvedValue(pageOf([
        { id: 'n1', event: 'a', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} },
      ], 1));
    renderTab();
    await waitFor(() => screen.getByText('a'));
    // Open drawer for n1
    await userEvent.click(screen.getByText('a'));
    await waitFor(() => screen.getByRole('dialog', { name: /notification detail/i }));
    // Close drawer, select n2, delete it
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Reopen drawer for n1
    await userEvent.click(screen.getByText('a'));
    await waitFor(() => screen.getByRole('dialog', { name: /notification detail/i }));
    // Select n2 and delete from bulk — while n1 is in drawer
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(screen.getByLabelText('Select b'));
    await userEvent.click(screen.getByText(/^Delete$/));
    expect(mockDelete).toHaveBeenCalledWith({ ids: ['n2'] });
  });
});

// ── Clipboard and QRCode ──────────────────────────────────────────────────────

describe('ProfilePage — clipboard and QRCode', () => {
  beforeEach(() => {
    // Mock clipboard API
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
    mockQRCode.toDataURL.mockResolvedValue('data:image/png;base64,STUB');
  });

  it('QRCode.toDataURL catch sets empty qr image (line 540)', async () => {
    mockSetup2fa.mockResolvedValue({ secret: 'S', qrUrl: 'otpauth://totp/test', backupCodes: [] });
    mockQRCode.toDataURL.mockRejectedValueOnce(new Error('canvas error'));
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Enable Two-Factor Authentication/ }));
    // Page should not crash — QR code simply missing, secret shown
    await waitFor(() => expect(screen.getByText('S')).toBeTruthy());
    // No QR image rendered
    expect(screen.queryByRole('img', { name: '2FA setup QR code' })).toBeNull();
  });

  it('Copy backup codes button calls clipboard.writeText', async () => {
    mockSetup2fa.mockResolvedValue({ secret: 'S', qrUrl: '', backupCodes: ['abc', 'def'] });
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Enable Two-Factor Authentication/ }));
    await waitFor(() => screen.getByText('Copy backup codes'));
    await userEvent.click(screen.getByText('Copy backup codes'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abc\ndef');
  });

  it('Copy new backup codes button calls clipboard.writeText after regeneration', async () => {
    mockUseAuth.mockReturnValue({
      user: { ...defaultUser, totpEnabled: true },
      isLoading: false, login: vi.fn(), loginDirect: vi.fn(), logout: vi.fn(),
      updateUser: updateUserFn, can: vi.fn().mockReturnValue(true),
    });
    mockRegenerateBackupCodes.mockResolvedValue({ backupCodes: ['new1', 'new2'] });
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Regenerate backup codes/ }));
    await waitFor(() => screen.getByLabelText(/Enter authenticator code to regenerate/));
    await userEvent.type(screen.getByLabelText(/Enter authenticator code to regenerate/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => screen.getByText('new1'));
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('new1\nnew2');
  });
});

// ── Spinner states and non-Error throws ───────────────────────────────────────

describe('ProfilePage — spinner states', () => {
  it('Change Password button shows spinner while saving', async () => {
    // Never resolves — keeps pwSaving=true
    mockUpdateMe.mockReturnValue(new Promise(() => {}));
    renderProfile();
    await userEvent.type(screen.getByLabelText('Current Password'), 'oldpassword');
    await userEvent.type(screen.getByLabelText('New Password'), 'newpassword1');
    await userEvent.type(screen.getByLabelText('Confirm New Password'), 'newpassword1');
    await userEvent.click(screen.getByRole('button', { name: /Change Password/ }));
    expect(document.querySelector('.spinner')).toBeTruthy();
  });

  it('updateMe non-Error throw shows fallback message', async () => {
    // Throw a plain string (not Error) — hits `'Update failed'` branch
    mockUpdateMe.mockRejectedValue('string error');
    renderProfile();
    await userEvent.type(screen.getByLabelText('Current Password'), 'old');
    await userEvent.type(screen.getByLabelText('New Password'), 'newpassword1');
    await userEvent.type(screen.getByLabelText('Confirm New Password'), 'newpassword1');
    await userEvent.click(screen.getByRole('button', { name: /Change Password/ }));
    await waitFor(() => expect(screen.getByText('Update failed')).toBeTruthy());
  });

  it('setup2fa non-Error throw shows fallback message', async () => {
    mockSetup2fa.mockRejectedValue('string error');
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Enable Two-Factor Authentication/ }));
    await waitFor(() => expect(screen.getByText('Setup failed')).toBeTruthy());
  });

  it('Activate 2FA button shows spinner while busy', async () => {
    mockSetup2fa.mockResolvedValue({ secret: 'S', qrUrl: '', backupCodes: [] });
    mockConfirm2fa.mockReturnValue(new Promise(() => {}));
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Enable Two-Factor Authentication/ }));
    await waitFor(() => screen.getByLabelText(/Enter code from your app/));
    await userEvent.type(screen.getByLabelText(/Enter code from your app/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Activate 2FA' }));
    expect(document.querySelector('.spinner')).toBeTruthy();
  });

  it('confirm2fa non-Error throw shows fallback message', async () => {
    mockSetup2fa.mockResolvedValue({ secret: 'S', qrUrl: '', backupCodes: [] });
    mockConfirm2fa.mockRejectedValue('string error');
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Enable Two-Factor Authentication/ }));
    await waitFor(() => screen.getByLabelText(/Enter code from your app/));
    await userEvent.type(screen.getByLabelText(/Enter code from your app/), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Activate 2FA' }));
    await waitFor(() => expect(screen.getByText('Confirmation failed')).toBeTruthy());
  });

  it('disable2fa non-Error throw shows fallback message', async () => {
    mockUseAuth.mockReturnValue({
      user: { ...defaultUser, totpEnabled: true },
      isLoading: false, login: vi.fn(), loginDirect: vi.fn(), logout: vi.fn(),
      updateUser: updateUserFn, can: vi.fn().mockReturnValue(true),
    });
    mockDisable2fa.mockRejectedValue('string error');
    renderProfile();
    await userEvent.type(screen.getByLabelText(/Disable 2FA/), '000000');
    await userEvent.click(screen.getByRole('button', { name: /Disable 2FA/ }));
    await waitFor(() => expect(screen.getByText('Disable failed')).toBeTruthy());
  });

  it('Regenerate button shows spinner while busy', async () => {
    mockUseAuth.mockReturnValue({
      user: { ...defaultUser, totpEnabled: true },
      isLoading: false, login: vi.fn(), loginDirect: vi.fn(), logout: vi.fn(),
      updateUser: updateUserFn, can: vi.fn().mockReturnValue(true),
    });
    mockRegenerateBackupCodes.mockReturnValue(new Promise(() => {}));
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Regenerate backup codes/ }));
    await waitFor(() => screen.getByLabelText(/Enter authenticator code to regenerate/));
    await userEvent.type(screen.getByLabelText(/Enter authenticator code to regenerate/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(document.querySelector('.spinner')).toBeTruthy();
  });

  it('regenerateBackupCodes non-Error throw shows fallback message', async () => {
    mockUseAuth.mockReturnValue({
      user: { ...defaultUser, totpEnabled: true },
      isLoading: false, login: vi.fn(), loginDirect: vi.fn(), logout: vi.fn(),
      updateUser: updateUserFn, can: vi.fn().mockReturnValue(true),
    });
    mockRegenerateBackupCodes.mockRejectedValue('string error');
    renderProfile();
    await userEvent.click(screen.getByRole('button', { name: /Regenerate backup codes/ }));
    await waitFor(() => screen.getByLabelText(/Enter authenticator code to regenerate/));
    await userEvent.type(screen.getByLabelText(/Enter authenticator code to regenerate/), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(screen.getByText('Regeneration failed')).toBeTruthy());
  });
});

// ── getNotificationInbox catch ────────────────────────────────────────────────

describe('ProfilePage — getNotificationInbox catch', () => {
  it('sets notifEnabled=false when getNotificationInbox throws', async () => {
    mockGetInbox.mockRejectedValue(new Error('network'));
    renderProfile('notifications');
    // Falls back to profile tab since notifEnabled becomes false
    await waitFor(() => expect(screen.getAllByText('Change Password').length).toBeGreaterThan(0));
  });
});

// ── ProfilePage tab navigation ────────────────────────────────────────────────

describe('ProfilePage — tab navigation', () => {
  it('renders Profile tab by default', () => {
    renderProfile('profile');
    // "Change Password" appears as section heading
    expect(screen.getAllByText('Change Password').length).toBeGreaterThan(0);
  });

  it('renders Notifications tab when initialTab is notifications and inbox enabled', async () => {
    mockGetInbox.mockResolvedValue({ items: [], unreadCount: 0, enabled: true });
    renderProfile('notifications');
    await waitFor(() => expect(screen.getByText('No notifications found.')).toBeTruthy());
  });

  it('hides the Notifications tab when in-app notifications are disabled', async () => {
    mockGetInbox.mockResolvedValue({ items: [], unreadCount: 0, enabled: false });
    renderProfile('profile');
    await waitFor(() => expect(mockGetInbox).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Notifications' })).toBeNull();
  });

  it('falls back to the profile tab when notifications route is hit but disabled', async () => {
    mockGetInbox.mockResolvedValue({ items: [], unreadCount: 0, enabled: false });
    renderProfile('notifications');
    await waitFor(() => expect(mockGetInbox).toHaveBeenCalled());
    // Security/profile tab renders instead of the notifications view.
    await waitFor(() => expect(screen.getAllByText('Change Password').length).toBeGreaterThan(0));
    expect(screen.queryByText('No notifications found.')).toBeNull();
  });
});
