import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  getRoles: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
  ALL_PERMISSIONS: [
    'project:read', 'project:write', 'model:read', 'model:write',
    'user:read', 'user:write', 'report:read', 'settings:read', 'settings:write',
    'notification:write', 'token:read', 'token:write', 'role:write', 'audit:read',
  ],
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

import { RolesPage } from './RolesPage';
import { getRoles, createRole, updateRole, deleteRole } from '../api';

const mockGetRoles    = vi.mocked(getRoles as () => Promise<unknown>);
const mockCreateRole  = vi.mocked(createRole as (...a: unknown[]) => Promise<unknown>);
const mockUpdateRole  = vi.mocked(updateRole as (...a: unknown[]) => Promise<unknown>);
const mockDeleteRole  = vi.mocked(deleteRole as (...a: unknown[]) => Promise<unknown>);

function makeRole(overrides: Record<string, unknown> = {}) {
  return { id: 'r1', name: 'Operator', permissions: ['project:read'], builtin: false, ...overrides };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <RolesPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetRoles.mockResolvedValue([]);
  mockCreateRole.mockResolvedValue(makeRole({ id: 'r-new', name: 'New Role' }));
  mockUpdateRole.mockResolvedValue(makeRole({ name: 'Updated' }));
  mockDeleteRole.mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

// ── Loading state ──────────────────────────────────────────────────────────────

describe('RolesPage — loading', () => {
  it('shows spinner while loading', () => {
    mockGetRoles.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(document.querySelector('.spinner')).toBeTruthy();
  });
});

// ── Error state ────────────────────────────────────────────────────────────────

describe('RolesPage — error state', () => {
  it('shows error message when getRoles throws', async () => {
    mockGetRoles.mockRejectedValue(new Error('Network error'));
    renderPage();
    await waitFor(() => expect(screen.queryByText('Network error')).not.toBeNull());
  });

  it('shows generic error when getRoles throws non-Error', async () => {
    mockGetRoles.mockRejectedValue('boom');
    renderPage();
    await waitFor(() => expect(screen.queryByText('Failed to load roles')).not.toBeNull());
  });
});

// ── Empty state ────────────────────────────────────────────────────────────────

describe('RolesPage — empty state', () => {
  it('renders toolbar with New Role button when no roles', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByRole('button', { name: /New Role/ })).not.toBeNull());
  });
});

// ── Loaded roles ───────────────────────────────────────────────────────────────

describe('RolesPage — loaded roles', () => {
  it('renders role name and id', async () => {
    mockGetRoles.mockResolvedValue([makeRole({ id: 'op', name: 'Operator' })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('Operator')).not.toBeNull());
    expect(screen.queryByText('op')).not.toBeNull();
  });

  it('renders builtin badge for builtin roles', async () => {
    mockGetRoles.mockResolvedValue([makeRole({ builtin: true, name: 'Admin' })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('built-in')).not.toBeNull());
  });

  it('does not show Edit/Delete buttons for builtin roles', async () => {
    mockGetRoles.mockResolvedValue([makeRole({ builtin: true, name: 'Admin' })]);
    renderPage();
    await waitFor(() => screen.queryByText('Admin'));
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('shows Edit and Delete buttons for non-builtin roles', async () => {
    mockGetRoles.mockResolvedValue([makeRole()]);
    renderPage();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeNull());
    // delete button is btn-danger with only a Trash2 SVG (no text/aria-label)
    expect(document.querySelector('button.btn-danger')).not.toBeNull();
  });

  it('renders all permissions as pill spans', async () => {
    mockGetRoles.mockResolvedValue([makeRole({ permissions: ['project:read', 'model:write'] })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('Projects – Read')).not.toBeNull());
    expect(screen.queryByText('Models – Write')).not.toBeNull();
  });
});

// ── Create role ────────────────────────────────────────────────────────────────

describe('RolesPage — create role', () => {
  it('shows create form when New Role clicked', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /New Role/ }));
    await userEvent.click(screen.getByRole('button', { name: /New Role/ }));
    await waitFor(() => expect(screen.queryByPlaceholderText('e.g. operator')).not.toBeNull());
    expect(screen.queryByPlaceholderText('Role name')).not.toBeNull();
  });

  it('hides New Role button while create form is shown', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /New Role/ }));
    await userEvent.click(screen.getByRole('button', { name: /New Role/ }));
    await waitFor(() => screen.queryByPlaceholderText('e.g. operator'));
    expect(screen.queryByRole('button', { name: /New Role/ })).toBeNull();
  });

  it('cancels create form on Cancel click', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /New Role/ }));
    await userEvent.click(screen.getByRole('button', { name: /New Role/ }));
    await waitFor(() => screen.getByRole('button', { name: /Cancel/ }));
    await userEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    await waitFor(() => expect(screen.queryByPlaceholderText('e.g. operator')).toBeNull());
    expect(screen.queryByRole('button', { name: /New Role/ })).not.toBeNull();
  });

  it('submits create and adds role to list', async () => {
    const created = makeRole({ id: 'r-new', name: 'Operator Plus', permissions: [] });
    mockCreateRole.mockResolvedValue(created);
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /New Role/ }));
    await userEvent.click(screen.getByRole('button', { name: /New Role/ }));
    await waitFor(() => screen.getByPlaceholderText('e.g. operator'));
    await userEvent.type(screen.getByPlaceholderText('e.g. operator'), 'r-new');
    await userEvent.type(screen.getByPlaceholderText('Role name'), 'Operator Plus');
    await userEvent.click(screen.getByRole('button', { name: /Create/ }));
    await waitFor(() => expect(mockCreateRole).toHaveBeenCalled());
    // role card appears; toolbar "New Role" button also reappears — use getAllByText
    await waitFor(() => expect(screen.queryByText('Operator Plus')).not.toBeNull());
  });

  it('shows error when createRole throws', async () => {
    mockCreateRole.mockRejectedValue(new Error('Duplicate ID'));
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /New Role/ }));
    await userEvent.click(screen.getByRole('button', { name: /New Role/ }));
    await waitFor(() => screen.getByPlaceholderText('e.g. operator'));
    await userEvent.click(screen.getByRole('button', { name: /Create/ }));
    await waitFor(() => expect(screen.queryByText('Duplicate ID')).not.toBeNull());
  });

  it('shows generic error when createRole throws non-Error', async () => {
    mockCreateRole.mockRejectedValue('oops');
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /New Role/ }));
    await userEvent.click(screen.getByRole('button', { name: /New Role/ }));
    await waitFor(() => screen.getByPlaceholderText('e.g. operator'));
    await userEvent.click(screen.getByRole('button', { name: /Create/ }));
    await waitFor(() => expect(screen.queryByText('Failed to create role')).not.toBeNull());
  });

  it('toggles permission checkbox in create form', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /New Role/ }));
    await userEvent.click(screen.getByRole('button', { name: /New Role/ }));
    await waitFor(() => screen.getByPlaceholderText('e.g. operator'));
    const projReadLabel = screen.getByText('Projects – Read').closest('label') as HTMLElement;
    const cb = projReadLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    await userEvent.click(cb);
    expect(cb.checked).toBe(true);
    await userEvent.click(cb);
    expect(cb.checked).toBe(false);
  });
});

// ── Edit role ──────────────────────────────────────────────────────────────────

describe('RolesPage — edit role', () => {
  it('shows edit form when Edit clicked', async () => {
    mockGetRoles.mockResolvedValue([makeRole({ id: 'r1', name: 'Operator', permissions: ['project:read'] })]);
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText('Role name') as HTMLInputElement;
      expect(nameInput.value).toBe('Operator');
    });
  });

  it('hides edit form and clicking New Role hides edit form', async () => {
    mockGetRoles.mockResolvedValue([makeRole()]);
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => screen.getByRole('button', { name: /New Role/ }));
    await userEvent.click(screen.getByRole('button', { name: /New Role/ }));
    // create form shown, edit form hidden
    await waitFor(() => expect(screen.queryByPlaceholderText('e.g. operator')).not.toBeNull());
  });

  it('cancels edit on Cancel click', async () => {
    mockGetRoles.mockResolvedValue([makeRole({ id: 'r1', name: 'Operator' })]);
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => screen.getByRole('button', { name: /Cancel/ }));
    await userEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeNull());
  });

  it('submits edit and updates role in list', async () => {
    const role = makeRole({ id: 'r1', name: 'Operator', permissions: ['project:read'] });
    const updated = makeRole({ id: 'r1', name: 'SuperOperator', permissions: ['project:read'] });
    mockGetRoles.mockResolvedValue([role]);
    mockUpdateRole.mockResolvedValue(updated);
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => screen.getByPlaceholderText('Role name'));
    const nameInput = screen.getByPlaceholderText('Role name') as HTMLInputElement;
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'SuperOperator');
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(mockUpdateRole).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('SuperOperator')).not.toBeNull());
  });

  it('r.id !== updated.id branch: other roles unchanged after edit', async () => {
    // Two roles so map iterates both: one matches (updated), one does not (stays).
    const role1 = makeRole({ id: 'r1', name: 'Alpha', permissions: [] });
    const role2 = makeRole({ id: 'r2', name: 'Beta',  permissions: [] });
    const updatedRole1 = makeRole({ id: 'r1', name: 'Alpha+', permissions: [] });
    mockGetRoles.mockResolvedValue([role1, role2]);
    mockUpdateRole.mockResolvedValue(updatedRole1);
    renderPage();
    await waitFor(() => expect(screen.queryAllByRole('button', { name: 'Edit' })).toHaveLength(2));
    // Edit the first role
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    await waitFor(() => screen.getByPlaceholderText('Role name'));
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(mockUpdateRole).toHaveBeenCalled());
    // Both names present: updated r1 and unchanged r2
    await waitFor(() => expect(screen.queryByText('Alpha+')).not.toBeNull());
    expect(screen.queryByText('Beta')).not.toBeNull();
  });

  it('shows error when updateRole throws', async () => {
    mockGetRoles.mockResolvedValue([makeRole()]);
    mockUpdateRole.mockRejectedValue(new Error('Conflict'));
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => screen.getByRole('button', { name: /Save/ }));
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(screen.queryByText('Conflict')).not.toBeNull());
  });

  it('shows generic error when updateRole throws non-Error', async () => {
    mockGetRoles.mockResolvedValue([makeRole()]);
    mockUpdateRole.mockRejectedValue('oops');
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => screen.getByRole('button', { name: /Save/ }));
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(screen.queryByText('Failed to update role')).not.toBeNull());
  });

  it('toggles permission in edit form', async () => {
    mockGetRoles.mockResolvedValue([makeRole({ permissions: ['project:read'] })]);
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => screen.getByPlaceholderText('Role name'));
    const projReadLabel = screen.getByText('Projects – Read').closest('label') as HTMLElement;
    const cb = projReadLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(cb.checked).toBe(true);
    await userEvent.click(cb);
    expect(cb.checked).toBe(false);
  });
});

// ── Delete role ────────────────────────────────────────────────────────────────

describe('RolesPage — delete role', () => {
  it('shows confirm dialog when delete clicked', async () => {
    mockGetRoles.mockResolvedValue([makeRole()]);
    renderPage();
    // Delete button is the Trash2 button (no text, last button in row)
    await waitFor(() => screen.getAllByRole('button'));
    const buttons = screen.getAllByRole('button');
    const trashBtn = buttons.find(b => b.querySelector('svg'));
    // Find the danger-class button
    const dangerBtns = Array.from(document.querySelectorAll('button.btn-danger'));
    expect(dangerBtns.length).toBeGreaterThan(0);
    await userEvent.click(dangerBtns[0] as HTMLElement);
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeNull());
    expect(screen.queryByText(/Delete this role/)).not.toBeNull();
  });

  it('cancels delete on cancel', async () => {
    mockGetRoles.mockResolvedValue([makeRole()]);
    renderPage();
    await waitFor(() => document.querySelector('button.btn-danger'));
    await userEvent.click(document.querySelector('button.btn-danger') as HTMLElement);
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(mockDeleteRole).not.toHaveBeenCalled();
  });

  it('removes role from list after confirmed delete', async () => {
    mockGetRoles.mockResolvedValue([makeRole({ id: 'r1', name: 'Operator' })]);
    renderPage();
    await waitFor(() => document.querySelector('button.btn-danger'));
    await userEvent.click(document.querySelector('button.btn-danger') as HTMLElement);
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockDeleteRole).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(screen.queryByText('Operator')).toBeNull());
  });

  it('shows error when deleteRole throws', async () => {
    mockGetRoles.mockResolvedValue([makeRole()]);
    mockDeleteRole.mockRejectedValue(new Error('Role in use'));
    renderPage();
    await waitFor(() => document.querySelector('button.btn-danger'));
    await userEvent.click(document.querySelector('button.btn-danger') as HTMLElement);
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByText('Role in use')).not.toBeNull());
  });

  it('shows generic error when deleteRole throws non-Error', async () => {
    mockGetRoles.mockResolvedValue([makeRole()]);
    mockDeleteRole.mockRejectedValue('boom');
    renderPage();
    await waitFor(() => document.querySelector('button.btn-danger'));
    await userEvent.click(document.querySelector('button.btn-danger') as HTMLElement);
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByText('Failed to delete role')).not.toBeNull());
  });
});

// ── Permission matrix — all 14 permissions rendered ──────────────────────────

describe('RolesPage — permission labels', () => {
  it('renders all 14 permission labels in the permission grid during edit', async () => {
    mockGetRoles.mockResolvedValue([makeRole({ permissions: [] })]);
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => screen.getByPlaceholderText('Role name'));
    const labels = [
      'Projects – Read', 'Projects – Write', 'Models – Read', 'Models – Write',
      'Users – Read', 'Users – Write', 'Reports – Read', 'Settings – Read',
      'Settings – Write', 'Notifications – Write', 'Tokens – Read', 'Tokens – Write',
      'Roles – Write', 'Audit Log – Read',
    ];
    for (const label of labels) {
      expect(screen.queryByText(label)).not.toBeNull();
    }
  });
});
