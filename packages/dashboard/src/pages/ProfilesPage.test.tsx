import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  getProfiles: vi.fn(),
  getProjects: vi.fn(),
  cloneProfile: vi.fn(),
  updateProfile: vi.fn(),
  deleteProfile: vi.fn(),
  simulateRouting: vi.fn(),
}));

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

vi.mock('../components/SearchableSelect', () => ({
  SearchableSelect: ({
    options, value, onChange, placeholder, disabled,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    disabled?: boolean;
  }) => (
    <select
      data-testid={`searchable-${placeholder ?? 'select'}`}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">—</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

vi.mock('../components/TraceEntryRenderer', () => ({
  TraceEntryRenderer: ({ entry }: { entry: unknown }) => <div data-testid="trace-entry">{JSON.stringify(entry)}</div>,
}));

import { ProfilesPage } from './ProfilesPage';
import { getProfiles, getProjects, cloneProfile, updateProfile, deleteProfile, simulateRouting } from '../api';
import { useAuth } from '../AuthContext';

const mockGetProfiles = vi.mocked(getProfiles as () => Promise<unknown>);
const mockGetProjects = vi.mocked(getProjects as () => Promise<unknown>);
const mockCloneProfile = vi.mocked(cloneProfile as (...a: unknown[]) => Promise<unknown>);
const mockUpdateProfile = vi.mocked(updateProfile as (...a: unknown[]) => Promise<unknown>);
const mockDeleteProfile = vi.mocked(deleteProfile as (...a: unknown[]) => Promise<unknown>);
const mockSimulateRouting = vi.mocked(simulateRouting as (...a: unknown[]) => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);

function makeBuiltin(overrides: Record<string, unknown> = {}) {
  return {
    id: 'balanced', version: 1, label: 'Balanced', builtin: true,
    selector: 'argmax', fallbackStrategy: 'next-best',
    policies: [{ type: 'health', enabled: true }],
    ...overrides,
  };
}

function makeUserProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1', version: 2, label: 'My Profile', builtin: false, baseId: 'balanced',
    selector: 'cheapest', fallbackStrategy: 'abort',
    policies: [{ type: 'cheapest', enabled: true, config: { weight: 1 } }],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ProfilesPage />
    </MemoryRouter>
  );
}

function authAs(perms: string[]) {
  mockUseAuth.mockReturnValue({
    user: { id: 'u1', email: 'admin@test.com', role: 'admin' },
    isLoading: false,
    login: vi.fn(),
    loginDirect: vi.fn(),
    logout: vi.fn(),
    updateUser: vi.fn(),
    can: vi.fn((p: string) => perms.includes(p)),
  } as unknown as ReturnType<typeof useAuth>);
}

function getTable() {
  return screen.getByRole('table');
}

function getRow(label: string) {
  return within(getTable()).getByText(label).closest('tr') as HTMLTableRowElement;
}

beforeEach(() => {
  mockGetProfiles.mockResolvedValue([makeBuiltin(), makeUserProfile()]);
  mockGetProjects.mockResolvedValue([{ id: 'proj-1', name: 'Project One', models: [] }]);
  mockCloneProfile.mockResolvedValue(makeUserProfile({ id: 'user-2', label: 'Cloned' }));
  mockUpdateProfile.mockResolvedValue(makeUserProfile({ label: 'Renamed' }));
  mockDeleteProfile.mockResolvedValue(undefined);
  mockSimulateRouting.mockResolvedValue({
    picked: 'gpt-4o',
    ranked: [{ model: 'gpt-4o', score: 0.912, cost: 3 }],
    trace: [{ type: 'router:profile' }],
  });
  authAs(['profiles:read', 'profiles:manage']);
});

afterEach(() => vi.clearAllMocks());

describe('ProfilesPage — access control', () => {
  it('shows access-denied state and never fetches when lacking profiles:read', async () => {
    authAs([]);
    renderPage();
    await waitFor(() => expect(screen.queryByText(/don't have permission/i)).not.toBeNull());
    expect(mockGetProfiles).not.toHaveBeenCalled();
  });
});

describe('ProfilesPage — loading / empty / error states', () => {
  it('shows a loading spinner while fetching', async () => {
    let resolve!: (v: unknown) => void;
    mockGetProfiles.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const { container } = renderPage();
    expect(container.querySelector('.spinner')).not.toBeNull();
    resolve([]);
    await waitFor(() => screen.getByText(/No routing profiles yet/));
  });

  it('shows an empty state when there are no profiles', async () => {
    mockGetProfiles.mockResolvedValueOnce([]);
    renderPage();
    await waitFor(() => screen.getByText(/No routing profiles yet/));
  });

  it('shows an inline error banner when loading fails', async () => {
    mockGetProfiles.mockRejectedValueOnce(new Error('network down'));
    renderPage();
    await waitFor(() => expect(screen.queryByText('network down')).not.toBeNull());
  });
});

describe('ProfilesPage — list rendering', () => {
  it('renders a built-in profile with a Built-in badge, a View action, and no Edit/Delete', async () => {
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('Balanced');
    expect(within(row).getByText('Built-in')).not.toBeNull();
    expect(within(row).getByTitle('View')).not.toBeNull();
    expect(within(row).queryByTitle('Edit')).toBeNull();
    expect(within(row).queryByTitle('Delete')).toBeNull();
  });

  it('renders a user profile with a Custom badge and Edit/Delete/Clone actions', async () => {
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    expect(within(row).getByText('Custom')).not.toBeNull();
    expect(within(row).getByTitle('Edit')).not.toBeNull();
    expect(within(row).getByTitle('Delete')).not.toBeNull();
    expect(within(row).getByTitle('Clone')).not.toBeNull();
  });
});

describe('ProfilesPage — clone', () => {
  it('clones a built-in profile with the entered base id and label', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Clone a Profile'));
    await userEvent.click(screen.getByText('Clone a Profile'));

    const baseSelect = screen.getByTestId('searchable-Select a built-in profile') as HTMLSelectElement;
    await userEvent.selectOptions(baseSelect, 'balanced');
    const labelInput = screen.getByLabelText('Label') as HTMLInputElement;
    await userEvent.type(labelInput, 'My Clone');

    const card = labelInput.closest('.card') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: /Clone/ }));

    await waitFor(() => expect(mockCloneProfile).toHaveBeenCalledWith('balanced', 'My Clone'));
  });

  it('shows an inline error when cloning fails', async () => {
    mockCloneProfile.mockRejectedValueOnce(new Error('clone failed'));
    renderPage();
    await waitFor(() => screen.getByText('Clone a Profile'));
    await userEvent.click(screen.getByText('Clone a Profile'));

    const baseSelect = screen.getByTestId('searchable-Select a built-in profile') as HTMLSelectElement;
    await userEvent.selectOptions(baseSelect, 'balanced');
    const labelInput = screen.getByLabelText('Label') as HTMLInputElement;
    await userEvent.type(labelInput, 'My Clone');
    const card = labelInput.closest('.card') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: /Clone/ }));

    await waitFor(() => expect(screen.queryByText('clone failed')).not.toBeNull());
  });

  it('cancels the clone form without cloning', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Clone a Profile'));
    await userEvent.click(screen.getByText('Clone a Profile'));
    expect(screen.getByLabelText('Label')).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(screen.queryByLabelText('Label')).toBeNull();
    expect(mockCloneProfile).not.toHaveBeenCalled();
  });

  it('pre-fills the base profile id when cloning from a row action', async () => {
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('Balanced');
    await userEvent.click(within(row).getByTitle('Clone'));

    const baseSelect = screen.getByTestId('searchable-Select a built-in profile') as HTMLSelectElement;
    expect(baseSelect.value).toBe('balanced');
  });
});

describe('ProfilesPage — edit', () => {
  it('opens the editor for a user profile, edits label/selector/fallback, saves', async () => {
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Edit'));

    const labelInput = screen.getByLabelText('Label') as HTMLInputElement;
    expect(labelInput.value).toBe('My Profile');
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, 'Renamed');

    await userEvent.selectOptions(screen.getByTestId('searchable-Selector'), 'argmax');
    await userEvent.selectOptions(screen.getByTestId('searchable-Fallback strategy'), 'abort');

    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith('user-1', expect.objectContaining({
      label: 'Renamed',
      selector: 'argmax',
      fallbackStrategy: 'abort',
      policies: [{ type: 'cheapest', enabled: true, config: { weight: 1 } }],
    })));
  });

  it('opens a built-in profile read-only with disabled inputs and no Save button', async () => {
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('Balanced');
    await userEvent.click(within(row).getByTitle('View'));

    const labelInput = screen.getByLabelText('Label') as HTMLInputElement;
    expect(labelInput).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Close/ })).not.toBeNull();
  });

  it('shows an inline error and blocks save when a policy config field has invalid JSON', async () => {
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Edit'));

    const configArea = document.querySelector('textarea.form-input') as HTMLTextAreaElement;
    await userEvent.clear(configArea);
    await userEvent.type(configArea, '{{not valid json');
    await userEvent.tab();
    expect(screen.getByText('Invalid JSON')).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('adds a new policy via the add-policy select', async () => {
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Edit'));

    const addSelect = screen.getByTestId('searchable-Add a policy...') as HTMLSelectElement;
    await userEvent.selectOptions(addSelect, 'health');
    expect(screen.getByText('Health Policy')).not.toBeNull();
  });

  it('removes a policy and toggles its enabled checkbox', async () => {
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Edit'));

    const checkbox = screen.getByText('Enabled').closest('label')!.querySelector('input') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    await userEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);

    await userEvent.click(screen.getByTitle('Remove policy'));
    expect(document.querySelectorAll('div[draggable]')).toHaveLength(0);
  });

  it('reorders policies via drag and drop', async () => {
    mockGetProfiles.mockResolvedValueOnce([makeBuiltin(), makeUserProfile({
      policies: [
        { type: 'cheapest', enabled: true, config: { weight: 1 } },
        { type: 'health', enabled: true },
      ],
    })]);
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Edit'));

    const cards = Array.from(document.querySelectorAll('div[draggable]')) as HTMLElement[];
    expect(cards).toHaveLength(2);
    const dataTransfer = { effectAllowed: '', dropEffect: '' };

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.dragStart(cards[0]!, { dataTransfer });
    fireEvent.dragEnter(cards[1]!, { dataTransfer });
    fireEvent.dragEnd(cards[0]!, { dataTransfer });

    const reordered = Array.from(document.querySelectorAll('div[draggable]')) as HTMLElement[];
    expect(reordered[0]!.textContent).toContain('Health Policy');
    expect(reordered[1]!.textContent).toContain('Cheapest Policy');
  });

  it('clears a policy config field to blank on blur', async () => {
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Edit'));

    const configArea = document.querySelector('textarea.form-input') as HTMLTextAreaElement;
    await userEvent.clear(configArea);
    await userEvent.tab();
    expect(screen.queryByText('Invalid JSON')).toBeNull();
  });

  it('shows an inline error when saving a profile update fails', async () => {
    mockUpdateProfile.mockRejectedValueOnce(new Error('update failed'));
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Edit'));
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(screen.queryByText('update failed')).not.toBeNull());
  });
});

describe('ProfilesPage — delete', () => {
  it('deletes a user profile after confirming and removes it from the list', async () => {
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Delete'));
    await userEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(mockDeleteProfile).toHaveBeenCalledWith('user-1'));
    await waitFor(() => expect(within(getTable()).queryByText('My Profile')).toBeNull());
  });

  it('shows the server 409 error inline and keeps the profile in the list when in use', async () => {
    mockDeleteProfile.mockRejectedValueOnce(new Error('profile_in_use'));
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Delete'));
    await userEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(screen.queryByText('profile_in_use')).not.toBeNull());
    expect(within(getTable()).getByText('My Profile')).not.toBeNull();
  });

  it('cancels the confirm dialog without deleting', async () => {
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Delete'));
    await userEvent.click(screen.getByText('Cancel'));
    expect(mockDeleteProfile).not.toHaveBeenCalled();
    expect(within(getTable()).getByText('My Profile')).not.toBeNull();
  });
});

describe('ProfilesPage — simulate panel', () => {
  it('runs a simulation and renders the picked model, ranking, and trace', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Simulate Routing'));

    const projectSelect = screen.getByTestId('searchable-Select a project') as HTMLSelectElement;
    await userEvent.selectOptions(projectSelect, 'proj-1');
    await userEvent.click(screen.getByRole('button', { name: /Run Simulation/ }));

    await waitFor(() => expect(mockSimulateRouting).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj-1',
      request: { model: 'auto', messages: [{ role: 'user', content: 'Hello' }] },
    })));
    await waitFor(() => expect(screen.getAllByText('gpt-4o').length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText('0.912')).not.toBeNull();
    expect(screen.getByTestId('trace-entry')).not.toBeNull();
  });

  it('shows an inline error when the request body is not valid JSON', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Simulate Routing'));
    const projectSelect = screen.getByTestId('searchable-Select a project') as HTMLSelectElement;
    await userEvent.selectOptions(projectSelect, 'proj-1');

    const requestArea = screen.getByLabelText('Request body (JSON)') as HTMLTextAreaElement;
    await userEvent.clear(requestArea);
    await userEvent.type(requestArea, 'not json');
    await userEvent.click(screen.getByRole('button', { name: /Run Simulation/ }));

    await waitFor(() => expect(screen.queryByText('Request body is not valid JSON.')).not.toBeNull());
    expect(mockSimulateRouting).not.toHaveBeenCalled();
  });

  it('shows an inline error when the simulate call fails', async () => {
    mockSimulateRouting.mockRejectedValueOnce(new Error('simulation failed'));
    renderPage();
    await waitFor(() => screen.getByText('Simulate Routing'));
    const projectSelect = screen.getByTestId('searchable-Select a project') as HTMLSelectElement;
    await userEvent.selectOptions(projectSelect, 'proj-1');
    await userEvent.click(screen.getByRole('button', { name: /Run Simulation/ }));
    await waitFor(() => expect(screen.queryByText('simulation failed')).not.toBeNull());
  });

  it('disables Run Simulation until a project is selected', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Simulate Routing'));
    expect(screen.getByRole('button', { name: /Run Simulation/ })).toBeDisabled();
  });
});

describe('ProfilesPage — viewer role (profiles:read only)', () => {
  it('shows the list and simulate panel but no clone/edit/delete affordances', async () => {
    authAs(['profiles:read']);
    renderPage();
    await waitFor(() => getTable());

    expect(screen.queryByText('Clone a Profile')).toBeNull();

    const userRow = getRow('My Profile');
    expect(within(userRow).queryByTitle('Edit')).toBeNull();
    expect(within(userRow).queryByTitle('Delete')).toBeNull();
    expect(within(userRow).queryByTitle('Clone')).toBeNull();
    expect(within(userRow).queryByTitle('View')).toBeNull();

    const builtinRow = getRow('Balanced');
    expect(within(builtinRow).getByTitle('View')).not.toBeNull();
    expect(within(builtinRow).queryByTitle('Clone')).toBeNull();

    expect(screen.getByText('Simulate Routing')).not.toBeNull();
  });

  it('opening a built-in profile as viewer renders it read-only', async () => {
    authAs(['profiles:read']);
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('Balanced');
    await userEvent.click(within(row).getByTitle('View'));
    expect((screen.getByLabelText('Label') as HTMLInputElement)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
  });
});

describe('ProfilesPage — non-Error rejections fall back to a generic message', () => {
  it('load failure with a non-Error rejection shows the generic fallback', async () => {
    mockGetProfiles.mockRejectedValueOnce('boom');
    renderPage();
    await waitFor(() => expect(screen.queryByText('Failed to load profiles')).not.toBeNull());
  });

  it('clone failure with a non-Error rejection shows the generic fallback', async () => {
    mockCloneProfile.mockRejectedValueOnce('boom');
    renderPage();
    await waitFor(() => screen.getByText('Clone a Profile'));
    await userEvent.click(screen.getByText('Clone a Profile'));
    const baseSelect = screen.getByTestId('searchable-Select a built-in profile') as HTMLSelectElement;
    await userEvent.selectOptions(baseSelect, 'balanced');
    const labelInput = screen.getByLabelText('Label') as HTMLInputElement;
    await userEvent.type(labelInput, 'My Clone');
    const card = labelInput.closest('.card') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: /Clone/ }));
    await waitFor(() => expect(screen.queryByText('Failed to clone profile')).not.toBeNull());
  });

  it('update failure with a non-Error rejection shows the generic fallback', async () => {
    mockUpdateProfile.mockRejectedValueOnce('boom');
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Edit'));
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(screen.queryByText('Failed to update profile')).not.toBeNull());
  });

  it('delete failure with a non-Error rejection shows the generic fallback', async () => {
    mockDeleteProfile.mockRejectedValueOnce('boom');
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Delete'));
    await userEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(screen.queryByText('Failed to delete profile')).not.toBeNull());
  });

  it('simulate failure with a non-Error rejection shows the generic fallback', async () => {
    mockSimulateRouting.mockRejectedValueOnce('boom');
    renderPage();
    await waitFor(() => screen.getByText('Simulate Routing'));
    const projectSelect = screen.getByTestId('searchable-Select a project') as HTMLSelectElement;
    await userEvent.selectOptions(projectSelect, 'proj-1');
    await userEvent.click(screen.getByRole('button', { name: /Run Simulation/ }));
    await waitFor(() => expect(screen.queryByText('Simulation failed')).not.toBeNull());
  });
});

describe('ProfilesPage — simulate panel, additional branches', () => {
  it('includes profileId when a profile override is selected', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Simulate Routing'));
    const projectSelect = screen.getByTestId('searchable-Select a project') as HTMLSelectElement;
    await userEvent.selectOptions(projectSelect, 'proj-1');
    const profileSelect = screen.getByTestId('searchable-Project\'s assigned profile') as HTMLSelectElement;
    await userEvent.selectOptions(profileSelect, 'user-1');
    await userEvent.click(screen.getByRole('button', { name: /Run Simulation/ }));
    await waitFor(() => expect(mockSimulateRouting).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj-1',
      profileId: 'user-1',
    })));
  });

  it('renders a dash for a ranked entry with no cost', async () => {
    mockSimulateRouting.mockResolvedValueOnce({
      picked: 'gpt-4o',
      ranked: [{ model: 'gpt-4o', score: 0.5 }],
      trace: [],
    });
    renderPage();
    await waitFor(() => screen.getByText('Simulate Routing'));
    const projectSelect = screen.getByTestId('searchable-Select a project') as HTMLSelectElement;
    await userEvent.selectOptions(projectSelect, 'proj-1');
    await userEvent.click(screen.getByRole('button', { name: /Run Simulation/ }));
    await waitFor(() => expect(screen.getByText('gpt-4o', { selector: 'td' })).not.toBeNull());
    const costCell = screen.getByText('gpt-4o', { selector: 'td' }).closest('tr')!.querySelectorAll('td')[2]!;
    expect(costCell.textContent).toBe('—');
  });
});

describe('ProfilesPage — edit form, additional branches', () => {
  it('shows the raw type as the title for a policy type unrecognized by the frontend', async () => {
    mockGetProfiles.mockResolvedValueOnce([makeBuiltin(), makeUserProfile({
      policies: [{ type: 'future-policy', enabled: true }],
    })]);
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Edit'));
    expect(screen.getByText('future-policy')).not.toBeNull();
  });

  it('saves an updated policy config after entering valid JSON on blur', async () => {
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Edit'));

    const configArea = document.querySelector('textarea.form-input') as HTMLTextAreaElement;
    await userEvent.clear(configArea);
    await userEvent.type(configArea, '{{"weight":2}');
    await userEvent.tab();
    expect(screen.queryByText('Invalid JSON')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith('user-1', expect.objectContaining({
      policies: [{ type: 'cheapest', enabled: true, config: { weight: 2 } }],
    })));
  });

  it('pre-fills an empty base id when cloning from a non-builtin row', async () => {
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Clone'));
    const baseSelect = screen.getByTestId('searchable-Select a built-in profile') as HTMLSelectElement;
    expect(baseSelect.value).toBe('');
  });

  it('toggles one policy without affecting the other', async () => {
    mockGetProfiles.mockResolvedValueOnce([makeBuiltin(), makeUserProfile({
      policies: [
        { type: 'cheapest', enabled: true, config: { weight: 1 } },
        { type: 'health', enabled: true },
      ],
    })]);
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Edit'));

    const cards = Array.from(document.querySelectorAll('div[draggable]')) as HTMLElement[];
    const firstCheckbox = cards[0]!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const secondCheckbox = cards[1]!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await userEvent.click(firstCheckbox);
    expect(firstCheckbox.checked).toBe(false);
    expect(secondCheckbox.checked).toBe(true);
  });

  it('clears a previously-invalid config field to blank, dropping its stored error', async () => {
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Edit'));

    const configArea = document.querySelector('textarea.form-input') as HTMLTextAreaElement;
    await userEvent.clear(configArea);
    await userEvent.type(configArea, '{{not valid json');
    await userEvent.tab();
    expect(screen.getByText('Invalid JSON')).not.toBeNull();

    await userEvent.clear(configArea);
    await userEvent.tab();
    expect(screen.queryByText('Invalid JSON')).toBeNull();
  });

  it('fixes a previously-invalid config field with valid JSON, dropping its stored error', async () => {
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Edit'));

    const configArea = document.querySelector('textarea.form-input') as HTMLTextAreaElement;
    await userEvent.clear(configArea);
    await userEvent.type(configArea, '{{not valid json');
    await userEvent.tab();
    expect(screen.getByText('Invalid JSON')).not.toBeNull();

    await userEvent.clear(configArea);
    await userEvent.type(configArea, '{{}');
    await userEvent.tab();
    expect(screen.queryByText('Invalid JSON')).toBeNull();
  });

  it('ignores a dragEnter with no active drag and a dragEnter onto the dragged card itself', async () => {
    mockGetProfiles.mockResolvedValueOnce([makeBuiltin(), makeUserProfile({
      policies: [
        { type: 'cheapest', enabled: true, config: { weight: 1 } },
        { type: 'health', enabled: true },
      ],
    })]);
    renderPage();
    await waitFor(() => getTable());
    const row = getRow('My Profile');
    await userEvent.click(within(row).getByTitle('Edit'));

    const { fireEvent } = await import('@testing-library/react');
    const dataTransfer = { effectAllowed: '', dropEffect: '' };
    let cards = Array.from(document.querySelectorAll('div[draggable]')) as HTMLElement[];

    fireEvent.dragEnter(cards[1]!, { dataTransfer });
    cards = Array.from(document.querySelectorAll('div[draggable]')) as HTMLElement[];
    expect(cards[0]!.textContent).toContain('Cheapest Policy');
    expect(cards[1]!.textContent).toContain('Health Policy');

    fireEvent.dragStart(cards[0]!, { dataTransfer });
    fireEvent.dragEnter(cards[0]!, { dataTransfer });
    cards = Array.from(document.querySelectorAll('div[draggable]')) as HTMLElement[];
    expect(cards[0]!.textContent).toContain('Cheapest Policy');
    expect(cards[1]!.textContent).toContain('Health Policy');
  });
});
