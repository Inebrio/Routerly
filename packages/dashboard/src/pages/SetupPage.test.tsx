import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  checkSetupStatus: vi.fn(),
  setupFirstAdmin: vi.fn(),
}));

vi.mock('../AuthContext', () => ({ useAuth: vi.fn() }));

vi.mock('../components/Logo', () => ({ Logo: () => <span>Logo</span> }));

const navigateFn = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateFn };
});

import { SetupPage } from './SetupPage';
import { checkSetupStatus, setupFirstAdmin } from '../api';
import { useAuth } from '../AuthContext';

const mockCheckSetup    = vi.mocked(checkSetupStatus as () => Promise<unknown>);
const mockSetupAdmin    = vi.mocked(setupFirstAdmin as (...a: unknown[]) => Promise<unknown>);
const mockUseAuth       = vi.mocked(useAuth);
const loginDirectFn     = vi.fn();

function renderSetup() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/setup']}>
      <SetupPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockCheckSetup.mockResolvedValue({ needsSetup: true });
  mockUseAuth.mockReturnValue({
    user: null,
    isLoading: false,
    login: vi.fn(),
    loginDirect: loginDirectFn,
    logout: vi.fn(),
    updateUser: vi.fn(),
    can: vi.fn(),
  });
  mockSetupAdmin.mockResolvedValue({ token: 'tok', user: { id: 'u1', email: 'admin@x.com', role: 'admin' } });
});

afterEach(() => { vi.clearAllMocks(); navigateFn.mockReset(); });

// ── Redirect when already logged in ───────────────────────────────────────────

describe('SetupPage — redirect when logged in', () => {
  it('navigates to overview when user is already set', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'a@b.com', role: 'admin', totpEnabled: false },
      isLoading: false,
      login: vi.fn(),
      loginDirect: loginDirectFn,
      logout: vi.fn(),
      updateUser: vi.fn(),
      can: vi.fn(),
    });
    renderSetup();
    await waitFor(() => expect(navigateFn).toHaveBeenCalledWith('/dashboard/overview', { replace: true }));
  });

  it('navigates to login when setup is already done', async () => {
    mockCheckSetup.mockResolvedValue({ needsSetup: false });
    renderSetup();
    await waitFor(() => expect(navigateFn).toHaveBeenCalledWith('/dashboard/login', { replace: true }));
  });

  it('does not throw when checkSetupStatus rejects', async () => {
    mockCheckSetup.mockRejectedValue(new Error('network'));
    renderSetup();
    await waitFor(() => expect(screen.queryByText('Create Admin Account')).not.toBeNull());
  });
});

// ── Renders form ───────────────────────────────────────────────────────────────

describe('SetupPage — renders form', () => {
  it('renders all three fields and submit button', async () => {
    renderSetup();
    expect(screen.getByLabelText('Admin Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByLabelText('Confirm Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Admin Account' })).toBeTruthy();
  });
});

// ── Validation ─────────────────────────────────────────────────────────────────

describe('SetupPage — validation', () => {
  it('shows error when passwords do not match', async () => {
    renderSetup();
    await userEvent.type(screen.getByLabelText('Admin Email'), 'admin@x.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password1');
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'password2');
    await userEvent.click(screen.getByRole('button', { name: 'Create Admin Account' }));
    await waitFor(() => expect(screen.queryByText('Passwords do not match')).not.toBeNull());
    expect(mockSetupAdmin).not.toHaveBeenCalled();
  });

  it('shows error when password is too short', async () => {
    renderSetup();
    await userEvent.type(screen.getByLabelText('Admin Email'), 'admin@x.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create Admin Account' }));
    await waitFor(() => expect(screen.queryByText('Password must be at least 8 characters')).not.toBeNull());
    expect(mockSetupAdmin).not.toHaveBeenCalled();
  });
});

// ── Submit success ─────────────────────────────────────────────────────────────

describe('SetupPage — submit success', () => {
  it('calls setupFirstAdmin and navigates to overview', async () => {
    renderSetup();
    await userEvent.type(screen.getByLabelText('Admin Email'), 'admin@x.com');
    await userEvent.type(screen.getByLabelText('Password'), 'validpassword');
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'validpassword');
    await userEvent.click(screen.getByRole('button', { name: 'Create Admin Account' }));
    await waitFor(() => expect(mockSetupAdmin).toHaveBeenCalledWith('admin@x.com', 'validpassword'));
    await waitFor(() => expect(loginDirectFn).toHaveBeenCalled());
    await waitFor(() => expect(navigateFn).toHaveBeenCalledWith('/dashboard/overview', { replace: true }));
  });

  it('shows spinner while submitting', async () => {
    let resolve!: (v: unknown) => void;
    mockSetupAdmin.mockReturnValue(new Promise(r => { resolve = r; }));
    renderSetup();
    await userEvent.type(screen.getByLabelText('Admin Email'), 'admin@x.com');
    await userEvent.type(screen.getByLabelText('Password'), 'validpassword');
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'validpassword');
    await userEvent.click(screen.getByRole('button', { name: 'Create Admin Account' }));
    await waitFor(() => expect(document.querySelector('.spinner')).toBeTruthy());
    resolve({ token: 'tok', user: { id: 'u1', email: 'admin@x.com', role: 'admin' } });
  });
});

// ── Submit failure ─────────────────────────────────────────────────────────────

describe('SetupPage — submit failure', () => {
  it('shows error message when setupFirstAdmin throws Error', async () => {
    mockSetupAdmin.mockRejectedValue(new Error('Email already in use'));
    renderSetup();
    await userEvent.type(screen.getByLabelText('Admin Email'), 'admin@x.com');
    await userEvent.type(screen.getByLabelText('Password'), 'validpassword');
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'validpassword');
    await userEvent.click(screen.getByRole('button', { name: 'Create Admin Account' }));
    await waitFor(() => expect(screen.queryByText('Email already in use')).not.toBeNull());
  });

  it('shows generic error when setupFirstAdmin throws non-Error', async () => {
    mockSetupAdmin.mockRejectedValue('oops');
    renderSetup();
    await userEvent.type(screen.getByLabelText('Admin Email'), 'admin@x.com');
    await userEvent.type(screen.getByLabelText('Password'), 'validpassword');
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'validpassword');
    await userEvent.click(screen.getByRole('button', { name: 'Create Admin Account' }));
    await waitFor(() => expect(screen.queryByText('Setup failed')).not.toBeNull());
  });
});
