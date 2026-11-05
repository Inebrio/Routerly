import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  getConnections: vi.fn(),
  deleteConnection: vi.fn(),
  getModels: vi.fn(),
  syncConnection: vi.fn(),
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

import { ConnectionsPage } from './ConnectionsPage';
import { getConnections, deleteConnection, getModels, syncConnection } from '../api';
import { useAuth } from '../AuthContext';

const mockGetConnections = vi.mocked(getConnections as () => Promise<unknown>);
const mockDeleteConnection = vi.mocked(deleteConnection as (...a: unknown[]) => Promise<unknown>);
const mockGetModels = vi.mocked(getModels as () => Promise<unknown>);
const mockSyncConnection = vi.mocked(syncConnection as (id: string) => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1', providerId: 'openai', label: 'My OpenAI', credentials: undefined,
    endpoint: 'https://api.openai.com/v1', enabled: true, ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ConnectionsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetConnections.mockResolvedValue([]);
  mockDeleteConnection.mockResolvedValue(undefined);
  mockGetModels.mockResolvedValue([]);
  mockUseAuth.mockReturnValue({
    user: { id: 'u1', email: 'admin@test.com', role: 'admin' },
    isLoading: false,
    login: vi.fn(),
    loginDirect: vi.fn(),
    logout: vi.fn(),
    updateUser: vi.fn(),
    can: vi.fn().mockReturnValue(true),
  });
});

afterEach(() => vi.clearAllMocks());

describe('ConnectionsPage — access control', () => {
  it('shows access-denied state when lacking connections:read', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'user@test.com', role: 'member' },
      isLoading: false,
      login: vi.fn(), loginDirect: vi.fn(), logout: vi.fn(), updateUser: vi.fn(),
      can: vi.fn().mockReturnValue(false),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByText(/don't have permission/i)).not.toBeNull());
    expect(mockGetConnections).not.toHaveBeenCalled();
  });
});

describe('ConnectionsPage — list', () => {
  it('shows empty state when no connections', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No connections yet/i)).not.toBeNull());
  });

  it('renders connection rows without exposing credentials', async () => {
    mockGetConnections.mockResolvedValue([makeConnection()]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());
    expect(screen.getByText('openai')).not.toBeNull();
    expect(screen.queryByText(/credential/i)).toBeNull();
  });

  it('shows the upstream provider name of a custom connection (T205)', async () => {
    mockGetConnections.mockResolvedValue([makeConnection({ providerId: 'custom', providerName: 'deepseek', label: 'DeepSeek' })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('DeepSeek')).not.toBeNull());
    expect(screen.getByText('custom')).not.toBeNull();
    expect(screen.getByText('deepseek')).not.toBeNull();
  });

  it('shows an error state when loading fails', async () => {
    mockGetConnections.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => expect(screen.queryByText('boom')).not.toBeNull());
  });

  it('shows a fallback message when loading fails with a non-Error value', async () => {
    mockGetConnections.mockRejectedValue('oops');
    renderPage();
    await waitFor(() => expect(screen.queryByText('Failed to load connections')).not.toBeNull());
  });
});

describe('ConnectionsPage — navigation to dedicated pages', () => {
  it('navigates to the create page when clicking Add Connection', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No connections yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /add connection/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/connections/new');
  });

  it('navigates to the edit page when clicking the edit icon', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue([makeConnection()]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());

    await user.click(screen.getByTitle('Edit'));

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/connections/c1/edit');
  });

  it('opens the edit page when clicking the row', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue([makeConnection()]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());

    await user.click(screen.getByText('My OpenAI'));

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/connections/c1/edit');
  });

  it('leaves the row inert without connections:manage', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'user@test.com', role: 'member' },
      isLoading: false,
      login: vi.fn(), loginDirect: vi.fn(), logout: vi.fn(), updateUser: vi.fn(),
      can: vi.fn().mockImplementation((p: string) => p === 'connections:read'),
    });
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue([makeConnection()]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());

    await user.click(screen.getByText('My OpenAI'));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not render the add button without connections:manage', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'user@test.com', role: 'member' },
      isLoading: false,
      login: vi.fn(), loginDirect: vi.fn(), logout: vi.fn(), updateUser: vi.fn(),
      can: vi.fn().mockImplementation((p: string) => p === 'connections:read'),
    });
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No connections yet/i)).not.toBeNull());
    expect(screen.queryByRole('button', { name: /add connection/i })).toBeNull();
  });

  it('hides edit/delete actions without connections:manage', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'user@test.com', role: 'member' },
      isLoading: false,
      login: vi.fn(), loginDirect: vi.fn(), logout: vi.fn(), updateUser: vi.fn(),
      can: vi.fn().mockImplementation((p: string) => p === 'connections:read'),
    });
    mockGetConnections.mockResolvedValue([makeConnection()]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());

    expect(screen.queryByTitle('Edit')).toBeNull();
    expect(screen.queryByTitle('Remove')).toBeNull();
    expect(screen.getByTitle('Models')).not.toBeNull();
  });
});

describe('ConnectionsPage — remove connection', () => {
  it('removes a connection after confirming', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue([makeConnection()]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());

    await user.click(screen.getByTitle('Remove'));
    await user.click(screen.getByText('Confirm'));

    await waitFor(() => expect(mockDeleteConnection).toHaveBeenCalledWith('c1'));
  });

  it('cancels deletion without calling the API', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue([makeConnection()]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());

    await user.click(screen.getByTitle('Remove'));
    await user.click(screen.getByText('Cancel'));

    expect(mockDeleteConnection).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('shows an error when deletion fails', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue([makeConnection()]);
    mockDeleteConnection.mockRejectedValue(new Error('delete failed'));
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());

    await user.click(screen.getByTitle('Remove'));
    await user.click(screen.getByText('Confirm'));

    await waitFor(() => expect(screen.queryByText('delete failed')).not.toBeNull());
  });

  it('scrolls the deletion error into view and shows the 409 usedBy message', async () => {
    const user = userEvent.setup();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    mockGetConnections.mockResolvedValue([makeConnection()]);
    mockDeleteConnection.mockRejectedValue(new Error('Connection is used by model(s): gpt-4o'));
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());

    await user.click(screen.getByTitle('Remove'));
    await user.click(screen.getByText('Confirm'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('used by model(s): gpt-4o');
    expect(scroll).toHaveBeenCalled();
  });

  it('shows a fallback message when deletion fails with a non-Error value', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue([makeConnection()]);
    mockDeleteConnection.mockRejectedValue('oops');
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());

    await user.click(screen.getByTitle('Remove'));
    await user.click(screen.getByText('Confirm'));

    await waitFor(() => expect(screen.queryByText('Failed to delete connection')).not.toBeNull());
  });

  it('shows a disabled connection status', async () => {
    mockGetConnections.mockResolvedValue([makeConnection(), makeConnection({ id: 'c2', label: 'Second', enabled: false })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());
    expect(screen.getByText('Disabled')).not.toBeNull();
  });
});

describe('ConnectionsPage — catalog models and sync (ROUT-437)', () => {
  const asRole = (perms: string[]) => mockUseAuth.mockReturnValue({
    user: { id: 'u1', email: 'u@test.com', role: 'member' },
    isLoading: false, login: vi.fn(), loginDirect: vi.fn(), logout: vi.fn(), updateUser: vi.fn(),
    can: vi.fn((p: string) => perms.includes(p)),
  });
  const models = [
    { id: 'a', connectionId: 'c1', isNew: true },
    { id: 'b', connectionId: 'c1', isNew: true },
    { id: 'c', connectionId: 'c1', unavailable: 'removed' },
    { id: 'd', connectionId: 'c2' },
  ];

  it('shows total, new and unavailable counts linking to the filtered models page', async () => {
    mockGetConnections.mockResolvedValue([makeConnection({ catalogSync: true })]);
    mockGetModels.mockResolvedValue(models);
    renderPage();
    const link = await screen.findByRole('link', { name: /^3/ });
    expect(link.getAttribute('href')).toBe('/dashboard/models?connection=c1');
    expect(link.textContent).toContain('2 new');
    expect(link.textContent).toContain('1 unavailable');
  });

  it('operator syncs and sees the summary', async () => {
    mockGetConnections.mockResolvedValue([makeConnection({ catalogSync: true })]);
    mockSyncConnection.mockResolvedValue({ added: ['x', 'y'], unavailable: [], restored: [], skipped: [], catalogAvailable: true });
    renderPage();
    await userEvent.click(await screen.findByTitle('Sync models from the catalog'));
    expect(mockSyncConnection).toHaveBeenCalledWith('c1');
    expect(await screen.findByText(/2 added/)).not.toBeNull();
  });

  it('disables Sync with a tooltip when catalog sync is off', async () => {
    mockGetConnections.mockResolvedValue([makeConnection()]);
    renderPage();
    const btn = await screen.findByTitle(/Catalog sync is off/);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('viewer sees counts but no Sync button', async () => {
    asRole(['connections:read', 'model:read']);
    mockGetConnections.mockResolvedValue([makeConnection({ catalogSync: true })]);
    mockGetModels.mockResolvedValue(models);
    renderPage();
    await screen.findByText('My OpenAI');
    expect(screen.queryByTitle('Sync models from the catalog')).toBeNull();
    expect(screen.queryByTitle(/Catalog sync is off/)).toBeNull();
    expect(screen.getByRole('link', { name: /^3/ })).not.toBeNull();
  });
});
