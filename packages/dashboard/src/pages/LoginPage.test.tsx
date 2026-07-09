import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  checkSetupStatus: vi.fn(),
  verify2fa: vi.fn(),
}));

vi.mock('../AuthContext', () => ({ useAuth: vi.fn() }));

vi.mock('../components/Logo', () => ({ Logo: () => <span>Logo</span> }));

import { LoginPage } from './LoginPage';
import { checkSetupStatus, verify2fa } from '../api';
import { useAuth } from '../AuthContext';

const mockCheckSetup = vi.mocked(checkSetupStatus as () => Promise<unknown>);
const mockVerify2fa  = vi.mocked(verify2fa as (...a: unknown[]) => Promise<unknown>);
const mockUseAuth    = vi.mocked(useAuth);

const loginFn       = vi.fn();
const loginDirectFn = vi.fn();
const navigateFn    = vi.fn();

vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateFn,
  };
});

function renderLogin(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/login${search}`]}>
      <LoginPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockCheckSetup.mockResolvedValue({ needsSetup: false });
  mockUseAuth.mockReturnValue({
    user: null,
    isLoading: false,
    login: loginFn,
    loginDirect: loginDirectFn,
    logout: vi.fn(),
    updateUser: vi.fn(),
    can: vi.fn(),
  });
  loginFn.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  navigateFn.mockReset();
});

// ── Loading spinner while checking setup ───────────────────────────────────────

describe('LoginPage — loading state', () => {
  it('shows spinner while checkSetupStatus is pending', () => {
    mockCheckSetup.mockReturnValue(new Promise(() => {}));
    renderLogin();
    expect(document.querySelector('.spinner')).toBeTruthy();
  });

  it('shows login form after setup check resolves', async () => {
    renderLogin();
    await waitFor(() => expect(screen.queryByText('Sign In')).not.toBeNull());
  });
});

// ── Redirect when already logged in ───────────────────────────────────────────

describe('LoginPage — redirect when already logged in', () => {
  it('navigates to overview when user is already set', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'a@b.com', role: 'admin', totpEnabled: false },
      isLoading: false,
      login: loginFn,
      loginDirect: loginDirectFn,
      logout: vi.fn(),
      updateUser: vi.fn(),
      can: vi.fn(),
    });
    renderLogin();
    await waitFor(() => expect(navigateFn).toHaveBeenCalledWith('/dashboard/overview', { replace: true }));
  });

  it('navigates to `to` param when valid', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'a@b.com', role: 'admin', totpEnabled: false },
      isLoading: false,
      login: loginFn,
      loginDirect: loginDirectFn,
      logout: vi.fn(),
      updateUser: vi.fn(),
      can: vi.fn(),
    });
    renderLogin('?to=/dashboard/projects');
    await waitFor(() => expect(navigateFn).toHaveBeenCalledWith('/dashboard/projects', { replace: true }));
  });

  it('ignores invalid `to` param (not /dashboard/)', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'a@b.com', role: 'admin', totpEnabled: false },
      isLoading: false,
      login: loginFn,
      loginDirect: loginDirectFn,
      logout: vi.fn(),
      updateUser: vi.fn(),
      can: vi.fn(),
    });
    renderLogin('?to=https://evil.com');
    await waitFor(() => expect(navigateFn).toHaveBeenCalledWith('/dashboard/overview', { replace: true }));
  });

  it('ignores `to=/dashboard/login` (loop prevention)', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'a@b.com', role: 'admin', totpEnabled: false },
      isLoading: false,
      login: loginFn,
      loginDirect: loginDirectFn,
      logout: vi.fn(),
      updateUser: vi.fn(),
      can: vi.fn(),
    });
    renderLogin('?to=/dashboard/login');
    await waitFor(() => expect(navigateFn).toHaveBeenCalledWith('/dashboard/overview', { replace: true }));
  });
});

// ── Redirect to setup when needsSetup ─────────────────────────────────────────

describe('LoginPage — redirect to setup', () => {
  it('navigates to /dashboard/setup when needsSetup is true', async () => {
    mockCheckSetup.mockResolvedValue({ needsSetup: true });
    renderLogin();
    await waitFor(() => expect(navigateFn).toHaveBeenCalledWith('/dashboard/setup', { replace: true }));
  });

  it('shows login form when checkSetupStatus throws', async () => {
    mockCheckSetup.mockRejectedValue(new Error('network'));
    renderLogin();
    await waitFor(() => expect(screen.queryByText('Sign In')).not.toBeNull());
  });
});

// ── Form field interactions ────────────────────────────────────────────────────

describe('LoginPage — form fields', () => {
  it('email and password inputs are controllable', async () => {
    renderLogin();
    await waitFor(() => screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'test@x.com');
    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('test@x.com');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('secret');
  });
});

// ── Submit success ─────────────────────────────────────────────────────────────

describe('LoginPage — submit success', () => {
  it('navigates to overview on successful login', async () => {
    loginFn.mockResolvedValue(undefined);
    renderLogin();
    await waitFor(() => screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(navigateFn).toHaveBeenCalledWith('/dashboard/overview', { replace: true }));
  });

  it('shows spinner while submitting', async () => {
    let resolve!: (v: void) => void;
    loginFn.mockReturnValue(new Promise<void>(r => { resolve = r; }));
    renderLogin();
    await waitFor(() => screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(document.querySelector('.spinner')).toBeTruthy());
    resolve();
  });
});

// ── Submit failure ─────────────────────────────────────────────────────────────

describe('LoginPage — submit failure', () => {
  it('shows error message when login throws Error', async () => {
    loginFn.mockRejectedValue(new Error('Invalid credentials'));
    renderLogin();
    await waitFor(() => screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(screen.queryByText('Invalid credentials')).not.toBeNull());
  });

  it('shows generic error when login throws non-Error', async () => {
    loginFn.mockRejectedValue('oops');
    renderLogin();
    await waitFor(() => screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(screen.queryByText('Login failed')).not.toBeNull());
  });
});

// ── 2FA flow ───────────────────────────────────────────────────────────────────

describe('LoginPage — 2FA flow', () => {
  it('shows 2FA form when login returns requiresTotp', async () => {
    loginFn.mockResolvedValue({ requiresTotp: true, userId: 'u-totp' });
    renderLogin();
    await waitFor(() => screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(screen.queryByText('Two-Factor Authentication')).not.toBeNull());
    expect(screen.queryByLabelText('Authenticator Code')).not.toBeNull();
  });

  it('verifies TOTP code and navigates on success', async () => {
    loginFn.mockResolvedValue({ requiresTotp: true, userId: 'u-totp' });
    mockVerify2fa.mockResolvedValue({ token: 'tok', user: { id: 'u-totp', email: 'a@b.com', role: 'admin' } });
    renderLogin();
    await waitFor(() => screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => screen.getByLabelText('Authenticator Code'));
    await userEvent.type(screen.getByLabelText('Authenticator Code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(loginDirectFn).toHaveBeenCalled());
    await waitFor(() => expect(navigateFn).toHaveBeenCalledWith('/dashboard/overview', { replace: true }));
  });

  it('shows 2FA error when verify2fa throws', async () => {
    loginFn.mockResolvedValue({ requiresTotp: true, userId: 'u-totp' });
    mockVerify2fa.mockRejectedValue(new Error('Invalid code'));
    renderLogin();
    await waitFor(() => screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => screen.getByLabelText('Authenticator Code'));
    await userEvent.type(screen.getByLabelText('Authenticator Code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(screen.queryByText('Invalid code')).not.toBeNull());
  });

  it('shows generic 2FA error when verify2fa throws non-Error', async () => {
    loginFn.mockResolvedValue({ requiresTotp: true, userId: 'u-totp' });
    mockVerify2fa.mockRejectedValue('oops');
    renderLogin();
    await waitFor(() => screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => screen.getByLabelText('Authenticator Code'));
    await userEvent.type(screen.getByLabelText('Authenticator Code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(screen.queryByText('2FA verification failed')).not.toBeNull());
  });

  it('switches to backup code mode', async () => {
    loginFn.mockResolvedValue({ requiresTotp: true, userId: 'u-totp' });
    renderLogin();
    await waitFor(() => screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => screen.getByRole('button', { name: 'Use a backup code instead' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use a backup code instead' }));
    await waitFor(() => expect(screen.queryByText('Backup Code')).not.toBeNull());
    expect(screen.queryByRole('button', { name: 'Use authenticator app instead' })).not.toBeNull();
  });

  it('backup code mode sends backup param to verify2fa', async () => {
    loginFn.mockResolvedValue({ requiresTotp: true, userId: 'u-totp' });
    mockVerify2fa.mockResolvedValue({ token: 'tok', user: { id: 'u-totp', email: 'a@b.com', role: 'admin' } });
    renderLogin();
    await waitFor(() => screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => screen.getByRole('button', { name: 'Use a backup code instead' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use a backup code instead' }));
    await waitFor(() => screen.getByLabelText('Backup Code'));
    await userEvent.type(screen.getByLabelText('Backup Code'), 'ABCDEFGH');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(mockVerify2fa).toHaveBeenCalledWith('u-totp', undefined, 'ABCDEFGH'));
  });

  it('switching back to authenticator from backup clears code and error', async () => {
    loginFn.mockResolvedValue({ requiresTotp: true, userId: 'u-totp' });
    renderLogin();
    await waitFor(() => screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => screen.getByRole('button', { name: 'Use a backup code instead' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use a backup code instead' }));
    await waitFor(() => screen.getByRole('button', { name: 'Use authenticator app instead' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use authenticator app instead' }));
    await waitFor(() => expect(screen.queryByLabelText('Authenticator Code')).not.toBeNull());
  });
});
