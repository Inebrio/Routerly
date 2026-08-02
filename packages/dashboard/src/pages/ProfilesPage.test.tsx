import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  getProfiles: vi.fn(),
  deleteProfile: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../AuthContext', () => ({
  useAuth: vi.fn(),
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

import { ProfilesPage, profileSummary } from './ProfilesPage';
import { getProfiles, deleteProfile } from '../api';
import { useAuth } from '../AuthContext';

const mockGetProfiles = vi.mocked(getProfiles as () => Promise<unknown>);
const mockDeleteProfile = vi.mocked(deleteProfile as (...a: unknown[]) => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);

const routingProfile = {
  id: 'auto', kind: 'routing', version: 1, label: 'Auto', builtin: true,
  policies: [{ type: 'cheapest', enabled: true }, { type: 'health', enabled: false }],
  selector: 'argmax', fallbackStrategy: 'next-best',
};
const optimizerProfile = {
  id: 'optimizer-safe', kind: 'optimizer', version: 2, label: 'Safe', builtin: true,
  optimizers: { steps: [{ id: 'session-dedup', enabled: true }] },
};
const securityProfile = {
  id: 'my-sec', kind: 'security', version: 3, label: 'My Security', builtin: false,
  guardrails: { rules: [{ type: 'regex', target: 'request', config: { patterns: ['x'] } }] },
  pii: { policies: [{ enabled: true, target: 'request', entities: ['EMAIL'] }] },
};
const allProfiles = [routingProfile, optimizerProfile, securityProfile];

function setAuth(perms: string[]) {
  mockUseAuth.mockReturnValue({
    can: vi.fn((p: string) => perms.includes(p)),
  } as unknown as ReturnType<typeof useAuth>);
}

function renderPage() {
  return render(<MemoryRouter><ProfilesPage /></MemoryRouter>);
}

beforeEach(() => {
  mockGetProfiles.mockResolvedValue(allProfiles);
  mockDeleteProfile.mockResolvedValue(undefined);
  setAuth(['profiles:read', 'profiles:manage']);
});

afterEach(() => vi.clearAllMocks());

describe('profileSummary', () => {
  it('summarizes each kind', () => {
    expect(profileSummary(routingProfile as never)).toBe('1 policy enabled');
    expect(profileSummary(optimizerProfile as never)).toBe('1 step enabled');
    expect(profileSummary(securityProfile as never)).toBe('1 guardrail, 1 PII policy');
  });

  it('pluralizes empty configurations', () => {
    expect(profileSummary({ ...routingProfile, policies: [] } as never)).toBe('0 policies enabled');
    expect(profileSummary({ ...optimizerProfile, optimizers: { steps: [] } } as never)).toBe('0 steps enabled');
    expect(profileSummary({ ...securityProfile, guardrails: {}, pii: {} } as never)).toBe('0 guardrails, 0 PII policies');
  });
});

/** Clicks the tab whose label starts with the given kind. */
async function openTab(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
}

describe('ProfilesPage', () => {
  it('opens on the routing tab and shows only routing profiles', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Auto')).toBeInTheDocument());
    expect(screen.getByText('1 policy enabled')).toBeInTheDocument();
    expect(screen.queryByText('Safe')).not.toBeInTheDocument();
    expect(screen.queryByText('My Security')).not.toBeInTheDocument();
  });

  it('counts the profiles of each kind on its tab', async () => {
    mockGetProfiles.mockResolvedValue([routingProfile, { ...routingProfile, id: 'auto2', label: 'Auto 2' }, securityProfile]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Auto')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^Routing/ }).textContent).toBe('Routing2');
    expect(screen.getByRole('button', { name: /^Optimizer/ }).textContent).toBe('Optimizer0');
    expect(screen.getByRole('button', { name: /^Security/ }).textContent).toBe('Security1');
  });

  it('switches kind from the tabs', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Auto')).toBeInTheDocument());
    await openTab(user, 'Security');
    expect(screen.queryByText('Auto')).not.toBeInTheDocument();
    expect(screen.getByText('My Security')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Security/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows a kind-specific empty state when a tab has no profiles', async () => {
    mockGetProfiles.mockResolvedValue([securityProfile]);
    renderPage();
    await waitFor(() => expect(screen.getByText('No routing profiles yet.')).toBeInTheDocument());
  });

  it('navigates to the create page for the open tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Auto')).toBeInTheDocument());
    await openTab(user, 'Security');
    // The button names the kind it creates: there is no kind to pick on the form.
    await user.click(screen.getByRole('button', { name: 'New Security Profile' }));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/profiles/new?kind=security');
  });

  it('navigates to the edit page', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Auto')).toBeInTheDocument());
    await openTab(user, 'Security');
    await user.click(screen.getByTitle('Edit'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/profiles/my-sec');
  });

  it('clone navigates to the create page with the base profile', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Auto')).toBeInTheDocument());
    await user.click(screen.getAllByTitle('Clone')[0]!);
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/profiles/new?base=auto');
  });

  it('built-in profiles are view-only and cannot be deleted', async () => {
    mockGetProfiles.mockResolvedValue([routingProfile]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Auto')).toBeInTheDocument());
    expect(screen.getByTitle('View')).toBeInTheDocument();
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
  });

  it('deletes a custom profile after confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Auto')).toBeInTheDocument());
    await openTab(user, 'Security');
    await user.click(screen.getByTitle('Delete'));
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockDeleteProfile).toHaveBeenCalledWith('my-sec'));
    await waitFor(() => expect(screen.queryByText('My Security')).not.toBeInTheDocument());
  });

  it('cancelling the confirmation keeps the profile', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Auto')).toBeInTheDocument());
    await openTab(user, 'Security');
    await user.click(screen.getByTitle('Delete'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    expect(mockDeleteProfile).not.toHaveBeenCalled();
  });

  it('surfaces delete errors', async () => {
    mockDeleteProfile.mockRejectedValue(new Error('delete boom'));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Auto')).toBeInTheDocument());
    await openTab(user, 'Security');
    await user.click(screen.getByTitle('Delete'));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText('delete boom')).toBeInTheDocument());
  });

  it('surfaces load errors', async () => {
    mockGetProfiles.mockRejectedValue(new Error('load boom'));
    renderPage();
    await waitFor(() => expect(screen.getByText('load boom')).toBeInTheDocument());
  });

  it('without profiles:manage the page is read-only', async () => {
    setAuth(['profiles:read']);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Auto')).toBeInTheDocument());
    await openTab(user, 'Security');
    expect(screen.getByText('My Security')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new .* profile/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Clone')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
    expect(screen.getAllByTitle('View').length).toBe(1);
  });

  it('without profiles:read shows the permission gate', async () => {
    setAuth([]);
    renderPage();
    expect(screen.getByText(/don't have permission to view profiles/i)).toBeInTheDocument();
    expect(mockGetProfiles).not.toHaveBeenCalled();
  });
});
