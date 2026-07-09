import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../api', () => ({
  getUsers: vi.fn(),
  updateUser: vi.fn(),
  getRoles: vi.fn(),
}));

const navigateFn = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateFn };
});

import { UserEditPage } from './UserEditPage';
import { getUsers, updateUser, getRoles } from '../api';

const mockGetUsers  = vi.mocked(getUsers as () => Promise<unknown>);
const mockUpdateUser = vi.mocked(updateUser as (...a: unknown[]) => Promise<unknown>);
const mockGetRoles  = vi.mocked(getRoles as () => Promise<unknown>);

function makeUser(overrides: Record<string, unknown> = {}) {
  return { id: 'u1', email: 'alice@x.com', roleId: 'viewer', projectIds: [], totpEnabled: false, ...overrides };
}

function makeRole(overrides: Record<string, unknown> = {}) {
  return { id: 'viewer', name: 'Viewer', permissions: [], builtin: false, ...overrides };
}

function renderPage(userId = 'u1') {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/settings/users/${userId}`]}>
      <Routes>
        <Route path="/dashboard/settings/users/:userId" element={<UserEditPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetUsers.mockResolvedValue([makeUser()]);
  mockGetRoles.mockResolvedValue([makeRole(), makeRole({ id: 'admin', name: 'Admin' })]);
  mockUpdateUser.mockResolvedValue(makeUser());
});

afterEach(() => { vi.clearAllMocks(); navigateFn.mockReset(); });

// ── Loading state ──────────────────────────────────────────────────────────────

describe('UserEditPage — loading', () => {
  it('shows spinner while loading', () => {
    mockGetUsers.mockReturnValue(new Promise(() => {}));
    mockGetRoles.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(document.querySelector('.spinner')).toBeTruthy();
  });
});

// ── Redirect when user not found ───────────────────────────────────────────────

describe('UserEditPage — user not found', () => {
  it('navigates to users list when userId not in users', async () => {
    mockGetUsers.mockResolvedValue([makeUser({ id: 'other' })]);
    renderPage('u1');
    await waitFor(() =>
      expect(navigateFn).toHaveBeenCalledWith('/dashboard/settings/users', { replace: true })
    );
  });
});

// ── Error state ────────────────────────────────────────────────────────────────

describe('UserEditPage — error state', () => {
  it('shows error when getUsers/getRoles rejects', async () => {
    mockGetUsers.mockRejectedValue(new Error('Network failure'));
    renderPage();
    await waitFor(() => expect(screen.queryByText('Network failure')).not.toBeNull());
  });

  it('shows generic error when throws non-Error', async () => {
    mockGetUsers.mockRejectedValue('boom');
    renderPage();
    await waitFor(() => expect(screen.queryByText('Failed to load user')).not.toBeNull());
  });
});

// ── Renders form ───────────────────────────────────────────────────────────────

describe('UserEditPage — renders form', () => {
  it('populates email and role from loaded user', async () => {
    renderPage();
    await waitFor(() => {
      const emailInput = screen.getByRole('textbox') as HTMLInputElement;
      expect(emailInput.value).toBe('alice@x.com');
    });
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('viewer');
  });

  it('renders all available roles as options', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('combobox'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).toContain('viewer');
    expect(options).toContain('admin');
  });

  it('shows email in page subtitle', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('alice@x.com')).not.toBeNull());
  });
});

// ── Form interactions ──────────────────────────────────────────────────────────

describe('UserEditPage — form interactions', () => {
  it('email input is editable', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('textbox'));
    const emailInput = screen.getByRole('textbox') as HTMLInputElement;
    await userEvent.clear(emailInput);
    await userEvent.type(emailInput, 'new@x.com');
    expect(emailInput.value).toBe('new@x.com');
  });

  it('role select is changeable', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('combobox'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    await userEvent.selectOptions(select, 'admin');
    expect(select.value).toBe('admin');
  });

  it('new password input is editable', async () => {
    renderPage();
    await waitFor(() => screen.queryByPlaceholderText('••••••••'));
    const pwInput = screen.getByPlaceholderText('••••••••') as HTMLInputElement;
    await userEvent.type(pwInput, 'newpassword');
    expect(pwInput.value).toBe('newpassword');
  });
});

// ── Submit success ─────────────────────────────────────────────────────────────

describe('UserEditPage — submit success', () => {
  it('calls updateUser with changed email and shows Saved!', async () => {
    const updated = makeUser({ email: 'new@x.com' });
    mockUpdateUser.mockResolvedValue(updated);
    renderPage();
    await waitFor(() => screen.getByRole('textbox'));
    const emailInput = screen.getByRole('textbox') as HTMLInputElement;
    await userEvent.clear(emailInput);
    await userEvent.type(emailInput, 'new@x.com');
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith('u1', { email: 'new@x.com' }));
    await waitFor(() => expect(screen.queryByText('Saved!')).not.toBeNull());
  });

  it('calls updateUser with changed roleId', async () => {
    const updated = makeUser({ roleId: 'admin' });
    mockUpdateUser.mockResolvedValue(updated);
    renderPage();
    await waitFor(() => screen.getByRole('combobox'));
    await userEvent.selectOptions(screen.getByRole('combobox'), 'admin');
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith('u1', { roleId: 'admin' }));
  });

  it('calls updateUser with newPassword when filled in', async () => {
    mockUpdateUser.mockResolvedValue(makeUser());
    renderPage();
    await waitFor(() => screen.getByPlaceholderText('••••••••'));
    await userEvent.type(screen.getByPlaceholderText('••••••••'), 'newpass123');
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith('u1', { newPassword: 'newpass123' }));
  });

  it('clears newPassword field after successful save', async () => {
    mockUpdateUser.mockResolvedValue(makeUser());
    renderPage();
    await waitFor(() => screen.getByPlaceholderText('••••••••'));
    const pwInput = screen.getByPlaceholderText('••••••••') as HTMLInputElement;
    await userEvent.type(pwInput, 'newpass123');
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => screen.queryByText('Saved!'));
    expect(pwInput.value).toBe('');
  });

  it('does not include unchanged fields in payload', async () => {
    mockUpdateUser.mockResolvedValue(makeUser());
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Save/ }));
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith('u1', {}));
  });

  it('shows spinner while saving', async () => {
    let resolve!: (v: unknown) => void;
    mockUpdateUser.mockReturnValue(new Promise(r => { resolve = r; }));
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Save/ }));
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(document.querySelector('.spinner')).toBeTruthy());
    resolve(makeUser());
  });
});

// ── Submit failure ─────────────────────────────────────────────────────────────

describe('UserEditPage — submit failure', () => {
  it('shows error when updateUser throws', async () => {
    mockUpdateUser.mockRejectedValue(new Error('Email in use'));
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Save/ }));
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(screen.queryByText('Email in use')).not.toBeNull());
  });

  it('shows generic error when updateUser throws non-Error', async () => {
    mockUpdateUser.mockRejectedValue('oops');
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Save/ }));
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(screen.queryByText('Failed to save')).not.toBeNull());
  });
});

// ── Back navigation ────────────────────────────────────────────────────────────

describe('UserEditPage — back navigation', () => {
  it('navigates to users list on back button click', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Save/ }));
    const backBtn = Array.from(document.querySelectorAll('button.btn-secondary'))[0] as HTMLElement;
    await userEvent.click(backBtn);
    expect(navigateFn).toHaveBeenCalledWith('/dashboard/settings/users');
  });
});
