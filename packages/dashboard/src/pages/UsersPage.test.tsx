import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

let mockCan = true;

// ponytail: pages gate write affordances on can(); default the mock to a full-permission user
vi.mock('../AuthContext', () => ({
  useAuth: () => ({ can: () => mockCan }),
}));

vi.mock('../api', () => ({
  getUsers: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  reset2faForUser: vi.fn(),
}));

// ponytail: mock SearchableSelect as a plain <select> so selectOptions/getByRole('combobox') tests keep working
vi.mock('../components/SearchableSelect', () => ({
  SearchableSelect: ({
    options,
    value,
    onChange,
    disabled,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
  }) => (
    <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

vi.mock('../components/ConfirmDialog', () => ({
  ConfirmDialog: ({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) => (
    <div data-testid="confirm-dialog">
      <span>{message}</span>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

const navigateFn = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateFn };
});

import { UsersPage } from './UsersPage';
import { getUsers, createUser, deleteUser, reset2faForUser } from '../api';

const mockGetUsers      = vi.mocked(getUsers as () => Promise<unknown>);
const mockCreateUser    = vi.mocked(createUser as (...a: unknown[]) => Promise<unknown>);
const mockDeleteUser    = vi.mocked(deleteUser as (...a: unknown[]) => Promise<unknown>);
const mockReset2fa      = vi.mocked(reset2faForUser as (...a: unknown[]) => Promise<unknown>);

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'alice@x.com',
    roleId: 'viewer',
    routerIds: [],
    totpEnabled: false,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/settings/users']}>
      <UsersPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockCan = true;
  mockGetUsers.mockResolvedValue([]);
  mockCreateUser.mockResolvedValue(makeUser());
  mockDeleteUser.mockResolvedValue(undefined);
  mockReset2fa.mockResolvedValue(undefined);
});

afterEach(() => { vi.clearAllMocks(); navigateFn.mockReset(); });

// ── Loading state ──────────────────────────────────────────────────────────────

describe('UsersPage — loading', () => {
  it('shows spinner while loading', () => {
    mockGetUsers.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(document.querySelector('.spinner')).toBeTruthy();
  });
});

// ── Empty state ────────────────────────────────────────────────────────────────

describe('UsersPage — empty state', () => {
  it('shows empty state when no users', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('No users yet.')).not.toBeNull());
  });

  it('shows 0 users in toolbar', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('0 users')).not.toBeNull());
  });
});

// ── Loaded state ───────────────────────────────────────────────────────────────

describe('UsersPage — loaded state', () => {
  it('renders user email and role', async () => {
    mockGetUsers.mockResolvedValue([makeUser({ email: 'alice@x.com', roleId: 'admin' })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('alice@x.com')).not.toBeNull());
    expect(screen.queryByText('admin')).not.toBeNull();
  });

  it('shows singular "1 user" in toolbar', async () => {
    mockGetUsers.mockResolvedValue([makeUser()]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('1 user')).not.toBeNull());
  });

  it('shows plural "2 users" in toolbar', async () => {
    mockGetUsers.mockResolvedValue([makeUser({ id: 'u1' }), makeUser({ id: 'u2', email: 'bob@x.com' })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('2 users')).not.toBeNull());
  });

  it('shows "All" for empty routerIds', async () => {
    mockGetUsers.mockResolvedValue([makeUser({ routerIds: [] })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('All')).not.toBeNull());
  });

  it('shows joined routerIds when non-empty', async () => {
    mockGetUsers.mockResolvedValue([makeUser({ routerIds: ['p1', 'p2'] })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('p1, p2')).not.toBeNull());
  });

  it('shows 2FA reset button when totpEnabled is true', async () => {
    mockGetUsers.mockResolvedValue([makeUser({ totpEnabled: true })]);
    renderPage();
    await waitFor(() => expect(screen.queryByTitle('Reset 2FA')).not.toBeNull());
  });

  it('does not show 2FA reset button when totpEnabled is false', async () => {
    mockGetUsers.mockResolvedValue([makeUser({ totpEnabled: false })]);
    renderPage();
    await waitFor(() => screen.queryByText('alice@x.com'));
    expect(screen.queryByTitle('Reset 2FA')).toBeNull();
  });

  it('applies badge-success class for admin role', async () => {
    mockGetUsers.mockResolvedValue([makeUser({ roleId: 'admin' })]);
    renderPage();
    await waitFor(() => screen.queryByText('admin'));
    const badge = document.querySelector('.badge-success');
    expect(badge).toBeTruthy();
  });

  it('applies badge-ollama class for non-admin role', async () => {
    mockGetUsers.mockResolvedValue([makeUser({ roleId: 'viewer' })]);
    renderPage();
    await waitFor(() => screen.queryByText('viewer'));
    const badge = document.querySelector('.badge-ollama');
    expect(badge).toBeTruthy();
  });
});

// ── Navigation ────────────────────────────────────────────────────────────────

describe('UsersPage — navigation', () => {
  it('navigates to user edit page on pencil click', async () => {
    mockGetUsers.mockResolvedValue([makeUser({ id: 'u1' })]);
    renderPage();
    await waitFor(() => screen.queryByText('alice@x.com'));
    // Pencil button has no title; it is the btn-icon without danger class that wraps a Pencil icon
    const btnIcons = Array.from(document.querySelectorAll('button.btn-icon:not(.danger)'))
      .filter(b => !b.getAttribute('title'));
    expect(btnIcons.length).toBeGreaterThan(0);
    await userEvent.click(btnIcons[0] as HTMLElement);
    expect(navigateFn).toHaveBeenCalledWith('/dashboard/settings/users/u1');
  });

  it('opens the user edit page on row click', async () => {
    mockGetUsers.mockResolvedValue([makeUser({ id: 'u1', email: 'alice@x.com' })]);
    renderPage();
    await waitFor(() => screen.getByText('alice@x.com'));
    await userEvent.click(screen.getByText('alice@x.com'));
    expect(navigateFn).toHaveBeenCalledWith('/dashboard/settings/users/u1');
  });
});

// ── Add user modal ─────────────────────────────────────────────────────────────

// ponytail: toolbar has the only "Add User" button before modal opens; after open,
// two exist (toolbar + submit). Use toolbar scope to open; submit type to submit.
function getToolbarAddBtn() {
  return within(document.querySelector('.toolbar') as HTMLElement).getByRole('button', { name: /Add User/ });
}
function getModalSubmitBtn() {
  return document.querySelector('.modal button[type="submit"]') as HTMLElement;
}

describe('UsersPage — add user modal', () => {
  it('shows modal when Add User clicked', async () => {
    renderPage();
    await waitFor(() => getToolbarAddBtn());
    await userEvent.click(getToolbarAddBtn());
    await waitFor(() => expect(screen.queryByPlaceholderText('user@example.com')).not.toBeNull());
    expect(screen.queryByPlaceholderText('user@example.com')).not.toBeNull();
  });

  it('closes modal on Cancel click', async () => {
    renderPage();
    await waitFor(() => getToolbarAddBtn());
    await userEvent.click(getToolbarAddBtn());
    await waitFor(() => screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('user@example.com')).toBeNull());
  });

  it('closes modal when clicking outside (overlay)', async () => {
    renderPage();
    await waitFor(() => getToolbarAddBtn());
    await userEvent.click(getToolbarAddBtn());
    await waitFor(() => document.querySelector('.modal-overlay'));
    const overlay = document.querySelector('.modal-overlay') as HTMLElement;
    await userEvent.click(overlay);
    await waitFor(() => expect(screen.queryByPlaceholderText('user@example.com')).toBeNull());
  });

  it('role select is controllable', async () => {
    renderPage();
    await waitFor(() => getToolbarAddBtn());
    await userEvent.click(getToolbarAddBtn());
    await waitFor(() => screen.getByRole('combobox'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('viewer');
    await userEvent.selectOptions(select, 'admin');
    expect(select.value).toBe('admin');
  });

  it('submits add form and reloads users', async () => {
    const newUser = makeUser({ id: 'u2', email: 'bob@x.com' });
    mockGetUsers
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([newUser]);
    mockCreateUser.mockResolvedValue(newUser);
    renderPage();
    await waitFor(() => getToolbarAddBtn());
    await userEvent.click(getToolbarAddBtn());
    await waitFor(() => screen.getByPlaceholderText('user@example.com'));
    await userEvent.type(screen.getByPlaceholderText('user@example.com'), 'bob@x.com');
    await userEvent.type(screen.getByPlaceholderText('••••••••'), 'password');
    await userEvent.click(getModalSubmitBtn());
    await waitFor(() => expect(mockCreateUser).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('bob@x.com')).not.toBeNull());
  });

  it('shows error when createUser throws', async () => {
    mockCreateUser.mockRejectedValue(new Error('Email taken'));
    renderPage();
    await waitFor(() => getToolbarAddBtn());
    await userEvent.click(getToolbarAddBtn());
    await waitFor(() => screen.getByPlaceholderText('user@example.com'));
    await userEvent.type(screen.getByPlaceholderText('user@example.com'), 'x@x.com');
    await userEvent.type(screen.getByPlaceholderText('••••••••'), 'pw');
    await userEvent.click(getModalSubmitBtn());
    await waitFor(() => expect(screen.queryByText('Email taken')).not.toBeNull());
  });

  it('shows generic error when createUser throws non-Error', async () => {
    mockCreateUser.mockRejectedValue('oops');
    renderPage();
    await waitFor(() => getToolbarAddBtn());
    await userEvent.click(getToolbarAddBtn());
    await waitFor(() => screen.getByPlaceholderText('user@example.com'));
    await userEvent.type(screen.getByPlaceholderText('user@example.com'), 'x@x.com');
    await userEvent.type(screen.getByPlaceholderText('••••••••'), 'pw');
    await userEvent.click(getModalSubmitBtn());
    await waitFor(() => expect(screen.queryByText('Error')).not.toBeNull());
  });

  it('shows spinner while adding user', async () => {
    let resolve!: (v: unknown) => void;
    mockCreateUser.mockReturnValue(new Promise(r => { resolve = r; }));
    renderPage();
    await waitFor(() => getToolbarAddBtn());
    await userEvent.click(getToolbarAddBtn());
    await waitFor(() => screen.getByPlaceholderText('user@example.com'));
    await userEvent.type(screen.getByPlaceholderText('user@example.com'), 'x@x.com');
    await userEvent.type(screen.getByPlaceholderText('••••••••'), 'pw');
    await userEvent.click(getModalSubmitBtn());
    await waitFor(() => expect(document.querySelector('.spinner')).toBeTruthy());
    resolve(makeUser());
  });
});

// ── Delete user ────────────────────────────────────────────────────────────────

describe('UsersPage — delete user', () => {
  it('shows confirm dialog when delete clicked', async () => {
    mockGetUsers.mockResolvedValue([makeUser()]);
    renderPage();
    await waitFor(() => document.querySelector('button.btn-icon.danger'));
    await userEvent.click(document.querySelector('button.btn-icon.danger') as HTMLElement);
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeNull());
    expect(screen.queryByText('Delete this user?')).not.toBeNull();
  });

  it('cancels delete on cancel', async () => {
    mockGetUsers.mockResolvedValue([makeUser()]);
    renderPage();
    await waitFor(() => document.querySelector('button.btn-icon.danger'));
    await userEvent.click(document.querySelector('button.btn-icon.danger') as HTMLElement);
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('removes user from list after confirmed delete', async () => {
    mockGetUsers.mockResolvedValue([makeUser({ id: 'u1', email: 'alice@x.com' })]);
    renderPage();
    await waitFor(() => document.querySelector('button.btn-icon.danger'));
    await userEvent.click(document.querySelector('button.btn-icon.danger') as HTMLElement);
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockDeleteUser).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(screen.queryByText('alice@x.com')).toBeNull());
  });
});

// ── Reset 2FA ──────────────────────────────────────────────────────────────────

describe('UsersPage — reset 2FA', () => {
  it('shows confirm dialog for 2FA reset', async () => {
    mockGetUsers.mockResolvedValue([makeUser({ totpEnabled: true, email: 'alice@x.com' })]);
    renderPage();
    await waitFor(() => screen.getByTitle('Reset 2FA'));
    await userEvent.click(screen.getByTitle('Reset 2FA'));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeNull());
    expect(screen.queryByText(/Reset 2FA for alice@x\.com/)).not.toBeNull();
  });

  it('calls reset2faForUser and sets totpEnabled=false on confirm', async () => {
    mockGetUsers.mockResolvedValue([makeUser({ id: 'u1', totpEnabled: true, email: 'alice@x.com' })]);
    renderPage();
    await waitFor(() => screen.getByTitle('Reset 2FA'));
    await userEvent.click(screen.getByTitle('Reset 2FA'));
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockReset2fa).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(screen.queryByTitle('Reset 2FA')).toBeNull());
  });

  it('cancels 2FA reset dialog on cancel', async () => {
    mockGetUsers.mockResolvedValue([makeUser({ totpEnabled: true })]);
    renderPage();
    await waitFor(() => screen.getByTitle('Reset 2FA'));
    await userEvent.click(screen.getByTitle('Reset 2FA'));
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(mockReset2fa).not.toHaveBeenCalled();
  });

  it('x.id !== id branch: other users keep totpEnabled when one is reset', async () => {
    // two users: u1 (totpEnabled=true) and u2 (totpEnabled=true).
    // After reset of u1, u2 still has totpEnabled=true (the x.id !== id branch in map).
    mockGetUsers.mockResolvedValue([
      makeUser({ id: 'u1', email: 'alice@x.com', totpEnabled: true }),
      makeUser({ id: 'u2', email: 'bob@x.com',   totpEnabled: true }),
    ]);
    renderPage();
    // wait for both users
    await waitFor(() => expect(screen.queryAllByTitle('Reset 2FA')).toHaveLength(2));
    // Reset u1 (first Reset 2FA button)
    await userEvent.click(screen.getAllByTitle('Reset 2FA')[0]!);
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockReset2fa).toHaveBeenCalledWith('u1'));
    // u1 no longer shows Reset 2FA; u2 still does
    await waitFor(() => expect(screen.queryAllByTitle('Reset 2FA')).toHaveLength(1));
  });
});

// ── Permissions ───────────────────────────────────────────────────────────────

describe('UsersPage — permissions', () => {
  it('shows a permission notice and skips the fetch without user:read', async () => {
    mockCan = false;
    renderPage();
    await waitFor(() => screen.getByText(/don't have permission to view users/i));
    expect(mockGetUsers).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Add User/i })).toBeNull();
  });

  it('surfaces a load failure instead of rendering an empty list', async () => {
    mockGetUsers.mockRejectedValue(new Error('Forbidden'));
    renderPage();
    await waitFor(() => screen.getByText('Forbidden'));
  });
});
