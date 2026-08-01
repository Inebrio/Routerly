import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../api', () => ({
  getProfiles: vi.fn(),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  getModels: vi.fn(),
  getInstalledOptimizers: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../AuthContext', () => ({
  useAuth: vi.fn(),
}));

// The three config editors are covered by their own tests; here they only need
// to prove the right one is mounted for the selected kind.
vi.mock('../components/RoutingPoliciesEditor', () => ({
  RoutingPoliciesEditor: () => <div data-testid="routing-editor" />,
  mkPolicyId: () => 'pid',
}));
vi.mock('../components/OptimizerStepsEditor', () => ({
  OptimizerStepsEditor: () => <div data-testid="optimizer-editor" />,
  buildOptimizerSteps: (rows: unknown[]) => rows,
  mergeOptimizerRows: (steps: unknown[]) => steps,
}));
vi.mock('../components/SecurityRulesEditor', () => ({
  SecurityRulesEditor: () => <div data-testid="security-editor" />,
  normalizeGuardActions: (r: unknown) => r,
  validateSecurityRules: () => ({ regexErrorsByRule: {}, moderationErrorIds: new Set() }),
}));

// ponytail: mock SearchableSelect as a plain <select> so onChange fires on selectOptions
vi.mock('../components/SearchableSelect', () => ({
  SearchableSelect: ({
    options,
    value,
    onChange,
    ariaLabel,
    disabled,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    ariaLabel?: string;
    disabled?: boolean;
  }) => (
    <select aria-label={ariaLabel ?? 'select'} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import { ProfileFormPage } from './ProfileFormPage';
import { getProfiles, createProfile, updateProfile, getModels, getInstalledOptimizers } from '../api';
import { useAuth } from '../AuthContext';

const mockGetProfiles = vi.mocked(getProfiles as () => Promise<unknown>);
const mockCreateProfile = vi.mocked(createProfile as (...a: unknown[]) => Promise<unknown>);
const mockUpdateProfile = vi.mocked(updateProfile as (...a: unknown[]) => Promise<unknown>);
const mockGetModels = vi.mocked(getModels as () => Promise<unknown>);
const mockGetInstalled = vi.mocked(getInstalledOptimizers as () => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);

const routingProfile = {
  id: 'auto', kind: 'routing', version: 1, label: 'Auto', builtin: true,
  policies: [{ type: 'cheapest', enabled: true }],
  selector: 'argmax', fallbackStrategy: 'next-best',
};
const customRouting = {
  id: 'mine', kind: 'routing', version: 1, label: 'Mine', builtin: false,
  policies: [{ type: 'health', enabled: true }],
  selector: 'cheapest', fallbackStrategy: 'abort',
};
const optimizerProfile = {
  id: 'opt', kind: 'optimizer', version: 1, label: 'Opt', builtin: false,
  optimizers: { steps: [{ id: 'ccr', enabled: true }] },
};
const securityProfile = {
  id: 'sec', kind: 'security', version: 1, label: 'Sec', builtin: false,
  guardrails: { rules: [{ type: 'regex', target: 'request', config: { patterns: ['x'] } }] },
  pii: { policies: [] },
};

function setAuth(perms: string[]) {
  mockUseAuth.mockReturnValue({
    can: vi.fn((p: string) => perms.includes(p)),
  } as unknown as ReturnType<typeof useAuth>);
}

/** Renders the page at an arbitrary URL so both create and edit routes are exercised. */
function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboard/profiles/new" element={<ProfileFormPage />} />
        <Route path="/dashboard/profiles/:id" element={<ProfileFormPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetProfiles.mockResolvedValue([routingProfile, customRouting, optimizerProfile, securityProfile]);
  mockGetModels.mockResolvedValue([]);
  mockGetInstalled.mockResolvedValue([{ id: 'ccr', klass: 'recoverable', installed: true }]);
  mockCreateProfile.mockResolvedValue({ id: 'new-id' });
  mockUpdateProfile.mockResolvedValue({ id: 'mine' });
  setAuth(['profiles:read', 'profiles:manage']);
});

afterEach(() => vi.clearAllMocks());

describe('ProfileFormPage — create', () => {
  it('starts empty on the routing kind', async () => {
    renderPage('/dashboard/profiles/new');
    await waitFor(() => expect(screen.getByText('New Profile')).toBeInTheDocument());
    expect(screen.getByLabelText('Label')).toHaveValue('');
    expect(screen.getByTestId('routing-editor')).toBeInTheDocument();
  });

  it('switching kind swaps the config editor', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/profiles/new');
    await waitFor(() => expect(screen.getByTestId('routing-editor')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Kind'), 'optimizer');
    expect(screen.getByTestId('optimizer-editor')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Kind'), 'security');
    expect(screen.getByTestId('security-editor')).toBeInTheDocument();
  });

  it('creates a routing profile on the engine defaults, with no selector knobs on screen', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/profiles/new');
    await waitFor(() => expect(screen.getByTestId('routing-editor')).toBeInTheDocument());
    expect(screen.queryByLabelText('Selector')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Fallback strategy')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Label'), 'My Routing');
    await user.click(screen.getByRole('button', { name: /create profile/i }));
    await waitFor(() => expect(mockCreateProfile).toHaveBeenCalledWith({
      kind: 'routing', label: 'My Routing', policies: [], selector: 'argmax', fallbackStrategy: 'next-best',
    }));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/profiles');
  });

  it('opens on the kind the list was showing', async () => {
    renderPage('/dashboard/profiles/new?kind=security');
    await waitFor(() => expect(screen.getByTestId('security-editor')).toBeInTheDocument());
  });

  it('creates a security profile with its guardrails and PII payload', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/profiles/new');
    await waitFor(() => expect(screen.getByTestId('routing-editor')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Kind'), 'security');
    await user.type(screen.getByLabelText('Label'), 'My Sec');
    await user.click(screen.getByRole('button', { name: /create profile/i }));
    await waitFor(() => expect(mockCreateProfile).toHaveBeenCalledWith({
      kind: 'security', label: 'My Sec', guardrails: { rules: [] }, pii: { policies: [] },
    }));
  });

  it('cannot be submitted without a label', async () => {
    renderPage('/dashboard/profiles/new');
    await waitFor(() => expect(screen.getByTestId('routing-editor')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /create profile/i })).toBeDisabled();
  });

  it('surfaces create errors', async () => {
    mockCreateProfile.mockRejectedValue(new Error('create boom'));
    const user = userEvent.setup();
    renderPage('/dashboard/profiles/new');
    await waitFor(() => expect(screen.getByTestId('routing-editor')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Label'), 'X');
    await user.click(screen.getByRole('button', { name: /create profile/i }));
    await waitFor(() => expect(screen.getByText('create boom')).toBeInTheDocument());
  });

  it('cancel goes back to the list', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/profiles/new');
    await waitFor(() => expect(screen.getByTestId('routing-editor')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/profiles');
  });
});

describe('ProfileFormPage — clone', () => {
  it('prefills the base profile config and locks the kind', async () => {
    renderPage('/dashboard/profiles/new?base=auto');
    await waitFor(() => expect(screen.getByLabelText('Label')).toHaveValue('Auto copy'));
    expect(screen.getByLabelText('Kind')).toBeDisabled();
    expect(screen.getByTestId('routing-editor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create profile/i })).toBeInTheDocument();
  });

  it('cloning an optimizer profile prefills its steps', async () => {
    renderPage('/dashboard/profiles/new?base=opt');
    await waitFor(() => expect(screen.getByTestId('optimizer-editor')).toBeInTheDocument());
    expect(screen.getByLabelText('Label')).toHaveValue('Opt copy');
  });
});

describe('ProfileFormPage — edit', () => {
  it('loads the profile and saves the update', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/profiles/mine');
    await waitFor(() => expect(screen.getByLabelText('Label')).toHaveValue('Mine'));
    expect(screen.getByText('Edit Mine')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Label'));
    await user.type(screen.getByLabelText('Label'), 'Renamed');
    await user.click(screen.getByRole('button', { name: /save profile/i }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith('mine', {
      label: 'Renamed', policies: [{ type: 'health', enabled: true }], selector: 'cheapest', fallbackStrategy: 'abort',
    }));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/profiles');
  });

  it('saves an optimizer profile with its steps', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/profiles/opt');
    await waitFor(() => expect(screen.getByTestId('optimizer-editor')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /save profile/i }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith('opt', {
      label: 'Opt', optimizers: { steps: [{ id: 'ccr', enabled: true }] },
    }));
  });

  it('built-in profiles are read-only', async () => {
    renderPage('/dashboard/profiles/auto');
    await waitFor(() => expect(screen.getByLabelText('Label')).toBeDisabled());
    expect(screen.getByText(/Built-in profiles cannot be edited/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save profile/i })).not.toBeInTheDocument();
  });

  it('reports an unknown profile id', async () => {
    renderPage('/dashboard/profiles/ghost');
    await waitFor(() => expect(screen.getByText('Profile not found.')).toBeInTheDocument());
  });

  it('surfaces load errors', async () => {
    mockGetProfiles.mockRejectedValue(new Error('load boom'));
    renderPage('/dashboard/profiles/mine');
    await waitFor(() => expect(screen.getByText('load boom')).toBeInTheDocument());
  });

  it('surfaces update errors', async () => {
    mockUpdateProfile.mockRejectedValue(new Error('update boom'));
    const user = userEvent.setup();
    renderPage('/dashboard/profiles/mine');
    await waitFor(() => expect(screen.getByLabelText('Label')).toHaveValue('Mine'));
    await user.click(screen.getByRole('button', { name: /save profile/i }));
    await waitFor(() => expect(screen.getByText('update boom')).toBeInTheDocument());
  });

  it('without profiles:manage the form is read-only', async () => {
    setAuth(['profiles:read']);
    renderPage('/dashboard/profiles/mine');
    await waitFor(() => expect(screen.getByLabelText('Label')).toBeDisabled());
    expect(screen.queryByRole('button', { name: /save profile/i })).not.toBeInTheDocument();
  });

  it('without profiles:read shows the permission gate', async () => {
    setAuth([]);
    renderPage('/dashboard/profiles/mine');
    expect(screen.getByText(/don't have permission to view profiles/i)).toBeInTheDocument();
    expect(mockGetProfiles).not.toHaveBeenCalled();
  });

  it('back button returns to the list', async () => {
    const user = userEvent.setup();
    renderPage('/dashboard/profiles/mine');
    await waitFor(() => expect(screen.getByLabelText('Label')).toHaveValue('Mine'));
    await user.click(screen.getByRole('button', { name: /back to profiles/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/profiles');
  });
});
