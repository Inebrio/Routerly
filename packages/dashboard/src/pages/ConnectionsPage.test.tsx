import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  getConnections: vi.fn(),
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn(),
  getProviderDescriptors: vi.fn(),
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

import { ConnectionsPage } from './ConnectionsPage';
import { getConnections, createConnection, updateConnection, deleteConnection, getProviderDescriptors } from '../api';
import { useAuth } from '../AuthContext';

const mockGetConnections = vi.mocked(getConnections as () => Promise<unknown>);
const mockCreateConnection = vi.mocked(createConnection as (...a: unknown[]) => Promise<unknown>);
const mockUpdateConnection = vi.mocked(updateConnection as (...a: unknown[]) => Promise<unknown>);
const mockDeleteConnection = vi.mocked(deleteConnection as (...a: unknown[]) => Promise<unknown>);
const mockGetDescriptors = vi.mocked(getProviderDescriptors as () => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1', providerId: 'openai', label: 'My OpenAI', credentials: undefined,
    endpoint: 'https://api.openai.com/v1', enabled: true, ...overrides,
  };
}

function makeDescriptor(overrides: Record<string, unknown> = {}) {
  return { id: 'openai', label: 'OpenAI', protocol: 'openai', supportLevel: 'native', nativeCapabilities: {}, ...overrides };
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
  mockGetDescriptors.mockResolvedValue([makeDescriptor()]);
  mockCreateConnection.mockResolvedValue(makeConnection({ id: 'c-new' }));
  mockUpdateConnection.mockResolvedValue(makeConnection({ label: 'Updated' }));
  mockDeleteConnection.mockResolvedValue(undefined);
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

  it('shows an error state when loading fails', async () => {
    mockGetConnections.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => expect(screen.queryByText('boom')).not.toBeNull());
  });
});

describe('ConnectionsPage — add connection', () => {
  it('creates a connection via the inline form', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No connections yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /add connection/i }));
    await user.type(screen.getByLabelText(/label/i), 'My OpenAI');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(mockCreateConnection).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'openai', label: 'My OpenAI', enabled: true,
    })));
  });

  it('creates a connection with a custom provider, endpoint and disabled flag', async () => {
    const user = userEvent.setup();
    mockGetDescriptors.mockResolvedValue([
      makeDescriptor({ id: 'openai', label: 'OpenAI' }),
      makeDescriptor({ id: 'anthropic', label: 'Anthropic' }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No connections yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /add connection/i }));
    await user.selectOptions(screen.getByLabelText(/provider/i), 'anthropic');
    await user.type(screen.getByLabelText(/label/i), 'My Anthropic');
    await user.type(screen.getByLabelText(/endpoint/i), 'https://api.anthropic.com');
    await user.click(screen.getByLabelText(/enabled/i));
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(mockCreateConnection).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'anthropic', label: 'My Anthropic', endpoint: 'https://api.anthropic.com', enabled: false,
    })));
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

  it('hides edit/delete/add actions without connections:manage', async () => {
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
    expect(screen.getByTitle('Instances')).not.toBeNull();
  });
});

describe('ConnectionsPage — edit connection', () => {
  it('edits a connection via the inline form, including a new credential field', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue([makeConnection({ endpoint: undefined })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());

    await user.click(screen.getByTitle('Edit'));
    const labelInputs = screen.getAllByLabelText(/label/i);
    await user.clear(labelInputs[labelInputs.length - 1]!);
    await user.type(labelInputs[labelInputs.length - 1]!, 'Renamed');
    await user.click(screen.getAllByRole('button', { name: /add credential field/i })[0]!);
    await user.type(screen.getAllByPlaceholderText('e.g. apiKey')[0]!, 'apiKey');
    await user.type(screen.getAllByPlaceholderText('value')[0]!, 'sk-test');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockUpdateConnection).toHaveBeenCalledWith('c1', expect.objectContaining({
      label: 'Renamed', credentials: { apiKey: 'sk-test' },
    })));
  });

  it('cancels editing without saving', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue([makeConnection()]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());

    await user.click(screen.getByTitle('Edit'));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(mockUpdateConnection).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
  });

  it('shows an error when update fails', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue([makeConnection()]);
    mockUpdateConnection.mockRejectedValue(new Error('update failed'));
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());

    await user.click(screen.getByTitle('Edit'));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.queryByText('update failed')).not.toBeNull());
  });

  it('removes a credential row before saving', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue([makeConnection()]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());

    await user.click(screen.getByTitle('Edit'));
    await user.click(screen.getByRole('button', { name: /add credential field/i }));
    await user.click(screen.getByTitle('Remove field'));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockUpdateConnection).toHaveBeenCalledWith('c1', expect.not.objectContaining({ credentials: expect.anything() })));
  });
});

describe('ConnectionsPage — create errors and cancel', () => {
  it('cancels the create form without calling the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No connections yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /add connection/i }));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(mockCreateConnection).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^create$/i })).toBeNull();
  });

  it('shows an error when creation fails', async () => {
    const user = userEvent.setup();
    mockCreateConnection.mockRejectedValue(new Error('create failed'));
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No connections yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /add connection/i }));
    await user.type(screen.getByLabelText(/label/i), 'X');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(screen.queryByText('create failed')).not.toBeNull());
  });
});

describe('ConnectionsPage — no providers configured', () => {
  it('creates a connection when no provider descriptors exist', async () => {
    const user = userEvent.setup();
    mockGetDescriptors.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No connections yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /add connection/i }));
    await user.type(screen.getByLabelText(/label/i), 'No Provider');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(mockCreateConnection).toHaveBeenCalledWith(expect.objectContaining({
      providerId: '', label: 'No Provider',
    })));
  });

  it('cancels the create form when no providers are configured', async () => {
    const user = userEvent.setup();
    mockGetDescriptors.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No connections yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /add connection/i }));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(mockCreateConnection).not.toHaveBeenCalled();
  });
});

describe('ConnectionsPage — non-Error rejections', () => {
  it('shows a fallback message when loading fails with a non-Error value', async () => {
    mockGetConnections.mockRejectedValue('oops');
    renderPage();
    await waitFor(() => expect(screen.queryByText('Failed to load connections')).not.toBeNull());
  });

  it('shows a fallback message when creation fails with a non-Error value', async () => {
    const user = userEvent.setup();
    mockCreateConnection.mockRejectedValue('oops');
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No connections yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /add connection/i }));
    await user.type(screen.getByLabelText(/label/i), 'X');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(screen.queryByText('Failed to create connection')).not.toBeNull());
  });

  it('shows a fallback message when update fails with a non-Error value', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue([makeConnection()]);
    mockUpdateConnection.mockRejectedValue('oops');
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());

    await user.click(screen.getByTitle('Edit'));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.queryByText('Failed to update connection')).not.toBeNull());
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
});

describe('ConnectionsPage — credential rows and multi-connection edits', () => {
  it('skips credential rows with an empty key', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No connections yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /add connection/i }));
    await user.type(screen.getByLabelText(/label/i), 'X');
    await user.click(screen.getByRole('button', { name: /add credential field/i }));
    await user.type(screen.getByPlaceholderText('value'), 'orphan-value');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(mockCreateConnection).toHaveBeenCalledWith(expect.objectContaining({ credentials: {} })));
  });

  it('edits one of multiple credential rows independently', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No connections yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /add connection/i }));
    await user.click(screen.getByRole('button', { name: /add credential field/i }));
    await user.click(screen.getByRole('button', { name: /add credential field/i }));
    const keyInputs = screen.getAllByPlaceholderText('e.g. apiKey');
    await user.type(keyInputs[1]!, 'second');

    expect((keyInputs[0] as HTMLInputElement).value).toBe('');
    expect((keyInputs[1] as HTMLInputElement).value).toBe('second');
  });

  it('updates only the matching connection when multiple exist, and shows a disabled connection', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue([makeConnection(), makeConnection({ id: 'c2', label: 'Second', enabled: false })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());
    expect(screen.getByText('Disabled')).not.toBeNull();

    await user.click(screen.getAllByTitle('Edit')[0]!);
    await user.click(screen.getAllByRole('button', { name: /^save$/i })[0]!);

    await waitFor(() => expect(mockUpdateConnection).toHaveBeenCalledWith('c1', expect.anything()));
    await waitFor(() => expect(screen.getByText('Second')).not.toBeNull());
  });
});
