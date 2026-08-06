import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { RouterUsersTab } from './RouterUsersTab';

vi.mock('../../api', () => ({
  getUsers: vi.fn(),
  addRouterMember: vi.fn(),
  updateRouterMember: vi.fn(),
  removeRouterMember: vi.fn(),
}));

// ponytail: mock SearchableSelect as a plain <select> so onChange fires on selectOptions
vi.mock('../../components/SearchableSelect', () => ({
  SearchableSelect: ({
    options,
    value,
    onChange,
    placeholder,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <select
      data-testid={`searchable-${placeholder ?? 'select'}`}
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">—</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

// ponytail: ConfirmDialog just renders confirm/cancel buttons
vi.mock('../../components/ConfirmDialog', () => ({
  ConfirmDialog: ({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) => (
    <div data-testid="confirm-dialog">
      <p>{message}</p>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

import { getUsers, addRouterMember, updateRouterMember, removeRouterMember } from '../../api';
const mockGetUsers = vi.mocked(getUsers as () => Promise<unknown>);
const mockAddRouterMember = vi.mocked(addRouterMember as (...a: unknown[]) => Promise<unknown>);
const mockUpdateRouterMember = vi.mocked(updateRouterMember as (...a: unknown[]) => Promise<unknown>);
const mockRemoveRouterMember = vi.mocked(removeRouterMember as (...a: unknown[]) => Promise<unknown>);

const mockUsers = [
  { id: 'u1', email: 'alice@example.com' },
  { id: 'u2', email: 'bob@example.com' },
];

const mockRouter = {
  id: 'proj-1',
  name: 'Test',
  models: [],
  members: [
    { userId: 'u1', role: 'editor' },
  ],
};

function renderTab(initial: Record<string, unknown> = mockRouter) {
  // ponytail: real state so setRouter callbacks (lines 36-39, 57-59, 79-80) are exercised
  function LayoutWrapper() {
    const [router, setRouter] = useState<Record<string, unknown> | null>(initial);
    return <Outlet context={{ router, setRouter }} />;
  }
  return render(
    <MemoryRouter initialEntries={['/dashboard/routers/proj-1/users']}>
      <Routes>
        <Route path="/dashboard/routers/:id" element={<LayoutWrapper />}>
          <Route path="users" element={<RouterUsersTab />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetUsers.mockResolvedValue(mockUsers);
  mockAddRouterMember.mockResolvedValue({ userId: 'u2', role: 'viewer' });
  mockUpdateRouterMember.mockResolvedValue({ userId: 'u1', role: 'admin' });
  mockRemoveRouterMember.mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

// ── null router guard ────────────────────────────────────────────────────────

describe('RouterUsersTab — null router guard', () => {
  it('renders nothing when router is null', () => {
    function LayoutWrapper() {
      return <Outlet context={{ router: null, setRouter: vi.fn() }} />;
    }
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard/routers/proj-1/users']}>
        <Routes>
          <Route path="/dashboard/routers/:id" element={<LayoutWrapper />}>
            <Route path="users" element={<RouterUsersTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── Initial render ────────────────────────────────────────────────────────────

describe('RouterUsersTab — initial render', () => {
  it('shows Router Members heading', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Router Members')).toBeTruthy());
  });

  it('shows Add Member button', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByRole('button', { name: /Add Member/i })).toBeTruthy());
  });

  it('renders existing member in table', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('alice@example.com')).toBeTruthy());
  });

  it('shows member role badge', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('editor')).toBeTruthy());
  });

  it('shows empty state when no members', async () => {
    renderTab({ ...mockRouter, members: [] });
    await waitFor(() => expect(screen.getByText('No members found.')).toBeTruthy());
  });

  it('shows error when getUsers rejects', async () => {
    mockGetUsers.mockRejectedValueOnce(new Error('Load failed'));
    renderTab();
    await waitFor(() => expect(screen.getByText('Load failed')).toBeTruthy());
  });

  it('shows generic error on non-Error thrown by getUsers', async () => {
    mockGetUsers.mockRejectedValueOnce('oops');
    renderTab();
    await waitFor(() => expect(screen.getByText('Failed to load users')).toBeTruthy());
  });

  it('shows userId when user not found in users list', async () => {
    mockGetUsers.mockResolvedValueOnce([]);
    renderTab();
    await waitFor(() => expect(screen.getByText('u1')).toBeTruthy());
  });

  it('shows "No members" when members key absent', async () => {
    renderTab({ id: 'proj-1', name: 'Test', models: [] });
    await waitFor(() => expect(screen.getByText('No members found.')).toBeTruthy());
  });
});

// ── Add member flow ───────────────────────────────────────────────────────────

describe('RouterUsersTab — add member', () => {
  it('clicking Add Member shows the add form', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Add Member/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    expect(screen.getByText('Add New Member')).toBeTruthy();
  });

  it('add form shows available users (not already members)', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Add Member/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    // u1 is already a member — bob available, alice NOT in the dropdown <select>
    await waitFor(() => expect(screen.getByText('bob@example.com')).toBeTruthy());
    // alice appears in the members table but must NOT appear as a <option> in the add-form select
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    const addSelect = selects[0]!;
    const optionTexts = Array.from(addSelect.options).map(o => o.text);
    expect(optionTexts).not.toContain('alice@example.com');
  });

  it('Add button disabled when no user selected', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Add Member/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    const addBtn = screen.getByRole('button', { name: /^Add$/i }) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  it('selects user and calls addRouterMember', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Add Member/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    await waitFor(() => screen.getByText('bob@example.com'));
    // Select u2 in the user dropdown
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    await userEvent.selectOptions(selects[0]!, 'u2');
    const addBtn = screen.getByRole('button', { name: /^Add$/i });
    await userEvent.click(addBtn);
    await waitFor(() => expect(mockAddRouterMember).toHaveBeenCalledWith('proj-1', 'u2', 'viewer'));
  });

  it('hides form after successful add', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Add Member/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    await waitFor(() => screen.getByText('bob@example.com'));
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    await userEvent.selectOptions(selects[0]!, 'u2');
    await userEvent.click(screen.getByRole('button', { name: /^Add$/i }));
    await waitFor(() => expect(screen.queryByText('Add New Member')).toBeNull());
  });

  it('Cancel button hides the add form', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Add Member/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    await userEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(screen.queryByText('Add New Member')).toBeNull();
  });

  it('shows error on addRouterMember failure', async () => {
    mockAddRouterMember.mockRejectedValueOnce(new Error('Add failed'));
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Add Member/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    await waitFor(() => screen.getByText('bob@example.com'));
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    await userEvent.selectOptions(selects[0]!, 'u2');
    await userEvent.click(screen.getByRole('button', { name: /^Add$/i }));
    await waitFor(() => expect(screen.getByText('Add failed')).toBeTruthy());
  });

  it('shows generic error on non-Error from addRouterMember', async () => {
    mockAddRouterMember.mockRejectedValueOnce('oops');
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Add Member/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    await waitFor(() => screen.getByText('bob@example.com'));
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    await userEvent.selectOptions(selects[0]!, 'u2');
    await userEvent.click(screen.getByRole('button', { name: /^Add$/i }));
    await waitFor(() => expect(screen.getByText('Error adding member')).toBeTruthy());
  });

  it('role select defaults to viewer and can be changed', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Add Member/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    await waitFor(() => screen.getByText('bob@example.com'));
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    // selects[0] = user select, selects[1] = role select
    await userEvent.selectOptions(selects[1]!, 'admin');
    await userEvent.selectOptions(selects[0]!, 'u2');
    await userEvent.click(screen.getByRole('button', { name: /^Add$/i }));
    await waitFor(() => expect(mockAddRouterMember).toHaveBeenCalledWith('proj-1', 'u2', 'admin'));
  });

  it('handleAddMember no-ops when newUserId is empty (line 30 guard)', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Add Member/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    // Fire click directly on disabled Add button — bypasses disabled attr, exercises !newUserId guard
    const addBtn = screen.getByRole('button', { name: /^Add$/i });
    fireEvent.click(addBtn);
    await waitFor(() => expect(mockAddRouterMember).not.toHaveBeenCalled());
  });

  it('adds member when router has no members array (p.members falsy → [] branch)', async () => {
    // Router without members key → p.members is undefined → uses [] fallback
    renderTab({ id: 'proj-1', name: 'Test', models: [] });
    await waitFor(() => screen.getByRole('button', { name: /Add Member/i }));
    await userEvent.click(screen.getByRole('button', { name: /Add Member/i }));
    await waitFor(() => screen.getByText('alice@example.com'));
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    await userEvent.selectOptions(selects[0]!, 'u1');
    await userEvent.click(screen.getByRole('button', { name: /^Add$/i }));
    await waitFor(() => expect(mockAddRouterMember).toHaveBeenCalledWith('proj-1', 'u1', 'viewer'));
  });
});

// ── Edit member role ──────────────────────────────────────────────────────────

describe('RouterUsersTab — edit member role', () => {
  it('clicking Change Role shows role select', async () => {
    renderTab();
    await waitFor(() => screen.getByTitle('Change Role'));
    await userEvent.click(screen.getByTitle('Change Role'));
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('clicking the row enters edit mode too', async () => {
    renderTab();
    await waitFor(() => screen.getByTitle('Change Role'));
    await userEvent.click(screen.getByText('alice@example.com'));
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('save check calls updateRouterMember', async () => {
    renderTab();
    await waitFor(() => screen.getByTitle('Change Role'));
    await userEvent.click(screen.getByTitle('Change Role'));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    await userEvent.selectOptions(select, 'admin');
    await userEvent.click(screen.getByTitle('Save changes'));
    await waitFor(() => expect(mockUpdateRouterMember).toHaveBeenCalledWith('proj-1', 'u1', 'admin'));
  });

  it('Cancel (X) button exits edit mode without saving', async () => {
    renderTab();
    await waitFor(() => screen.getByTitle('Change Role'));
    await userEvent.click(screen.getByTitle('Change Role'));
    await userEvent.click(screen.getByTitle('Cancel'));
    await waitFor(() => expect(screen.queryByTitle('Save changes')).toBeNull());
    expect(mockUpdateRouterMember).not.toHaveBeenCalled();
  });

  it('shows error on updateRouterMember failure', async () => {
    mockUpdateRouterMember.mockRejectedValueOnce(new Error('Update fail'));
    renderTab();
    await waitFor(() => screen.getByTitle('Change Role'));
    await userEvent.click(screen.getByTitle('Change Role'));
    await userEvent.click(screen.getByTitle('Save changes'));
    await waitFor(() => expect(screen.getByText('Update fail')).toBeTruthy());
  });

  it('shows generic error on non-Error from updateRouterMember', async () => {
    mockUpdateRouterMember.mockRejectedValueOnce('oops');
    renderTab();
    await waitFor(() => screen.getByTitle('Change Role'));
    await userEvent.click(screen.getByTitle('Change Role'));
    await userEvent.click(screen.getByTitle('Save changes'));
    await waitFor(() => expect(screen.getByText('Error updating member')).toBeTruthy());
  });
});

// ── Remove member ─────────────────────────────────────────────────────────────

describe('RouterUsersTab — remove member', () => {
  it('clicking Remove shows confirm dialog', async () => {
    renderTab();
    await waitFor(() => screen.getByTitle('Remove Member'));
    await userEvent.click(screen.getByTitle('Remove Member'));
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
  });

  it('confirming remove calls removeRouterMember', async () => {
    renderTab();
    await waitFor(() => screen.getByTitle('Remove Member'));
    await userEvent.click(screen.getByTitle('Remove Member'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockRemoveRouterMember).toHaveBeenCalledWith('proj-1', 'u1'));
  });

  it('canceling remove closes dialog without calling API', async () => {
    renderTab();
    await waitFor(() => screen.getByTitle('Remove Member'));
    await userEvent.click(screen.getByTitle('Remove Member'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(mockRemoveRouterMember).not.toHaveBeenCalled();
  });

  it('shows error on removeRouterMember failure', async () => {
    mockRemoveRouterMember.mockRejectedValueOnce(new Error('Remove fail'));
    renderTab();
    await waitFor(() => screen.getByTitle('Remove Member'));
    await userEvent.click(screen.getByTitle('Remove Member'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText('Remove fail')).toBeTruthy());
  });

  it('shows generic error on non-Error from removeRouterMember', async () => {
    mockRemoveRouterMember.mockRejectedValueOnce('oops');
    renderTab();
    await waitFor(() => screen.getByTitle('Remove Member'));
    await userEvent.click(screen.getByTitle('Remove Member'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText('Error removing member')).toBeTruthy());
  });
});
