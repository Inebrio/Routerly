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

// ponytail: mock SearchableSelect as a plain <select> so onChange fires on selectOptions
vi.mock('../components/SearchableSelect', () => ({
  SearchableSelect: ({
    options,
    value,
    onChange,
    ariaLabel,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    ariaLabel?: string;
  }) => (
    <select aria-label={ariaLabel ?? 'select'} value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
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
    expect(profileSummary(routingProfile as never)).toBe('1 policy, argmax');
    expect(profileSummary(optimizerProfile as never)).toBe('1 step enabled');
    expect(profileSummary(securityProfile as never)).toBe('1 guardrail, 1 PII policy');
  });

  it('pluralizes empty configurations', () => {
    expect(profileSummary({ ...routingProfile, policies: [] } as never)).toBe('0 policies, argmax');
    expect(profileSummary({ ...optimizerProfile, optimizers: { steps: [] } } as never)).toBe('0 steps enabled');
    expect(profileSummary({ ...securityProfile, guardrails: {}, pii: {} } as never)).toBe('0 guardrails, 0 PII policies');
  });
});

describe('ProfilesPage', () => {
  it('lists every profile kind with its summary', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Auto')).toBeInTheDocument());
    expect(screen.getByText('Safe')).toBeInTheDocument();
    expect(screen.getByText('My Security')).toBeInTheDocument();
    expect(screen.getByText('1 policy, argmax')).toBeInTheDocument();
    expect(screen.getByText('3 profiles')).toBeInTheDocument();
  });

  it('filters by kind', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Auto')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Kind'), 'security');
    expect(screen.queryByText('Auto')).not.toBeInTheDocument();
    expect(screen.getByText('My Security')).toBeInTheDocument();
    expect(screen.getByText('1 profile')).toBeInTheDocument();
  });

  it('shows an empty state when the filter matches nothing', async () => {
    mockGetProfiles.mockResolvedValue([securityProfile]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('My Security')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Kind'), 'routing');
    expect(screen.getByText('No profiles yet.')).toBeInTheDocument();
  });

  it('navigates to the create page', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Auto')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /new profile/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/profiles/new');
  });

  it('navigates to the edit page', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('My Security')).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText('My Security')).toBeInTheDocument());
    await user.click(screen.getByTitle('Delete'));
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockDeleteProfile).toHaveBeenCalledWith('my-sec'));
    await waitFor(() => expect(screen.queryByText('My Security')).not.toBeInTheDocument());
  });

  it('cancelling the confirmation keeps the profile', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('My Security')).toBeInTheDocument());
    await user.click(screen.getByTitle('Delete'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    expect(mockDeleteProfile).not.toHaveBeenCalled();
  });

  it('surfaces delete errors', async () => {
    mockDeleteProfile.mockRejectedValue(new Error('delete boom'));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('My Security')).toBeInTheDocument());
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
    renderPage();
    await waitFor(() => expect(screen.getByText('My Security')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /new profile/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Clone')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
    expect(screen.getAllByTitle('View').length).toBe(3);
  });

  it('without profiles:read shows the permission gate', async () => {
    setAuth([]);
    renderPage();
    expect(screen.getByText(/don't have permission to view profiles/i)).toBeInTheDocument();
    expect(mockGetProfiles).not.toHaveBeenCalled();
  });
});
