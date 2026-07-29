import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../api', () => ({
  getConnections: vi.fn(),
  getInstances: vi.fn(),
  createInstance: vi.fn(),
  deleteInstance: vi.fn(),
  getModelCatalog: vi.fn(),
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

import { ModelInstancesPage } from './ModelInstancesPage';
import { getConnections, getInstances, createInstance, deleteInstance, getModelCatalog } from '../api';
import { useAuth } from '../AuthContext';

const mockGetConnections = vi.mocked(getConnections as () => Promise<unknown>);
const mockGetInstances = vi.mocked(getInstances as () => Promise<unknown>);
const mockCreateInstance = vi.mocked(createInstance as (...a: unknown[]) => Promise<unknown>);
const mockDeleteInstance = vi.mocked(deleteInstance as (...a: unknown[]) => Promise<unknown>);
const mockGetCatalog = vi.mocked(getModelCatalog as () => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);

function makeConnection(overrides: Record<string, unknown> = {}) {
  return { id: 'c1', providerId: 'openai', label: 'My OpenAI', credentials: undefined, enabled: true, ...overrides };
}

function makeInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i1', connectionId: 'c1', upstreamModelId: 'gpt-4o',
    cost: { inputPerMillion: 5, outputPerMillion: 15 }, contextWindow: 128000, ...overrides,
  };
}

function renderPage(connectionId = 'c1') {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/connections/${connectionId}/instances`]}>
      <Routes>
        <Route path="/dashboard/connections/:connectionId/instances" element={<ModelInstancesPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetConnections.mockResolvedValue([makeConnection()]);
  mockGetInstances.mockResolvedValue([]);
  mockCreateInstance.mockResolvedValue(makeInstance({ id: 'i-new' }));
  mockDeleteInstance.mockResolvedValue(undefined);
  mockGetCatalog.mockResolvedValue([]);
  mockUseAuth.mockReturnValue({
    user: { id: 'u1', email: 'admin@test.com', role: 'admin' },
    isLoading: false,
    login: vi.fn(), loginDirect: vi.fn(), logout: vi.fn(), updateUser: vi.fn(),
    can: vi.fn().mockReturnValue(true),
  });
});

afterEach(() => vi.clearAllMocks());

describe('ModelInstancesPage — list', () => {
  it('shows empty state when no instances', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No instances yet/i)).not.toBeNull());
    expect(screen.getByText('My OpenAI')).not.toBeNull();
  });

  it('renders instance rows bound to the connection', async () => {
    mockGetInstances.mockResolvedValue([makeInstance(), makeInstance({ id: 'i2', connectionId: 'other', upstreamModelId: 'other-model' })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('gpt-4o')).not.toBeNull());
    expect(screen.queryByText('other-model')).toBeNull();
  });

  it('shows error state when connection is not found', async () => {
    mockGetConnections.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.queryByText(/not found/i)).not.toBeNull());
  });

  it('shows an error when loading fails', async () => {
    mockGetConnections.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => expect(screen.queryByText('boom')).not.toBeNull());
  });

  it('navigates back to the connections list', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText('My OpenAI')).not.toBeNull());
    await user.click(screen.getByTitle('Back to connections'));
  });
});

describe('ModelInstancesPage — add instance', () => {
  it('creates an instance via the manual form', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No instances yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /add instance/i }));
    await user.type(screen.getByLabelText(/upstream model id/i), 'gpt-4o-mini');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(mockCreateInstance).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'c1', upstreamModelId: 'gpt-4o-mini',
    })));
  });
});

describe('ModelInstancesPage — import from catalog', () => {
  it('imports a catalog entry as a new instance', async () => {
    const user = userEvent.setup();
    mockGetCatalog.mockResolvedValue([
      { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', contextWindow: 128000, pricing: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 }, isConfigured: false },
      { id: 'claude', provider: 'anthropic', name: 'Claude', contextWindow: 200000, pricing: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015 }, isConfigured: false },
    ]);
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No instances yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /import from catalog/i }));
    await waitFor(() => expect(screen.queryByText('gpt-4o')).not.toBeNull());
    expect(screen.queryByText('claude')).toBeNull(); // filtered to connection's provider

    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => expect(mockCreateInstance).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'c1', upstreamModelId: 'gpt-4o', contextWindow: 128000,
      cost: expect.objectContaining({ inputPerMillion: 5, outputPerMillion: 15 }),
    })));
  });
});

describe('ModelInstancesPage — remove instance', () => {
  it('removes an instance after confirming', async () => {
    const user = userEvent.setup();
    mockGetInstances.mockResolvedValue([makeInstance()]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('gpt-4o')).not.toBeNull());

    await user.click(screen.getByTitle('Remove'));
    await user.click(screen.getByText('Confirm'));

    await waitFor(() => expect(mockDeleteInstance).toHaveBeenCalledWith('i1'));
  });

  it('cancels deletion without calling the API', async () => {
    const user = userEvent.setup();
    mockGetInstances.mockResolvedValue([makeInstance()]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('gpt-4o')).not.toBeNull());

    await user.click(screen.getByTitle('Remove'));
    await user.click(screen.getByText('Cancel'));

    expect(mockDeleteInstance).not.toHaveBeenCalled();
  });

  it('shows an error when deletion fails', async () => {
    const user = userEvent.setup();
    mockGetInstances.mockResolvedValue([makeInstance()]);
    mockDeleteInstance.mockRejectedValue(new Error('delete failed'));
    renderPage();
    await waitFor(() => expect(screen.queryByText('gpt-4o')).not.toBeNull());

    await user.click(screen.getByTitle('Remove'));
    await user.click(screen.getByText('Confirm'));

    await waitFor(() => expect(screen.queryByText('delete failed')).not.toBeNull());
  });
});

describe('ModelInstancesPage — cache/context display and cost fields', () => {
  it('shows cache cost and context window when set, dash when absent', async () => {
    mockGetInstances.mockResolvedValue([
      makeInstance({ id: 'i1', upstreamModelId: 'a', cost: { inputPerMillion: 1, outputPerMillion: 2, cachePerMillion: 0.5 }, contextWindow: 4000 }),
      makeInstance({ id: 'i2', upstreamModelId: 'b', cost: { inputPerMillion: 1, outputPerMillion: 2 }, contextWindow: 0 }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('a')).not.toBeNull());
    expect(screen.getByText('$0.5')).not.toBeNull();
  });

  it('creates an instance including a cache cost field', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No instances yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /add instance/i }));
    await user.type(screen.getByLabelText(/upstream model id/i), 'gpt-4o-mini');
    await user.type(screen.getByLabelText(/input \$\/1m/i), '1');
    await user.type(screen.getByLabelText(/output \$\/1m/i), '2');
    await user.type(screen.getByLabelText(/cache \$\/1m/i), '0.5');
    await user.type(screen.getByLabelText(/context size/i), '8000');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(mockCreateInstance).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'c1', upstreamModelId: 'gpt-4o-mini',
      cost: { inputPerMillion: 1, outputPerMillion: 2, cachePerMillion: 0.5 },
      contextWindow: 8000,
    })));
  });

  it('cancels the add form without calling the API', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No instances yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /add instance/i }));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(mockCreateInstance).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^create$/i })).toBeNull();
  });

  it('shows an error when creation fails', async () => {
    const user = userEvent.setup();
    mockCreateInstance.mockRejectedValue(new Error('create failed'));
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No instances yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /add instance/i }));
    await user.type(screen.getByLabelText(/upstream model id/i), 'gpt-4o-mini');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(screen.queryByText('create failed')).not.toBeNull());
  });
});

describe('ModelInstancesPage — import from catalog edge cases', () => {
  it('shows an empty state and marks already-imported entries', async () => {
    const user = userEvent.setup();
    mockGetInstances.mockResolvedValue([makeInstance({ upstreamModelId: 'gpt-4o' })]);
    mockGetCatalog.mockResolvedValue([
      { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', contextWindow: 128000, pricing: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 }, isConfigured: false },
    ]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('gpt-4o')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /import from catalog/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /imported/i })).not.toBeNull());
    expect((screen.getByRole('button', { name: /imported/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a no-entries message when the catalog has no matching provider entries', async () => {
    const user = userEvent.setup();
    mockGetCatalog.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No instances yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /import from catalog/i }));
    await waitFor(() => expect(screen.queryByText(/No catalog entries for this provider/i)).not.toBeNull());
  });

  it('shows an error when the catalog fails to load', async () => {
    const user = userEvent.setup();
    mockGetCatalog.mockRejectedValue(new Error('catalog failed'));
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No instances yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /import from catalog/i }));
    await waitFor(() => expect(screen.queryByText('catalog failed')).not.toBeNull());
  });

  it('shows an error when import fails', async () => {
    const user = userEvent.setup();
    mockGetCatalog.mockResolvedValue([
      { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', contextWindow: 128000, pricing: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 }, isConfigured: false },
    ]);
    mockCreateInstance.mockRejectedValue(new Error('import failed'));
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No instances yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /import from catalog/i }));
    await waitFor(() => expect(screen.queryByText('gpt-4o')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => expect(screen.queryByText('import failed')).not.toBeNull());
  });

  it('closes the catalog panel', async () => {
    const user = userEvent.setup();
    mockGetCatalog.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No instances yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /import from catalog/i }));
    await waitFor(() => expect(screen.queryByText(/No catalog entries for this provider/i)).not.toBeNull());
    await user.click(screen.getByTitle('Close'));

    expect(screen.queryByText(/No catalog entries for this provider/i)).toBeNull();
  });
});

describe('ModelInstancesPage — access control', () => {
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

  it('hides add/import/delete actions without connections:manage', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'u1', email: 'user@test.com', role: 'member' },
      isLoading: false,
      login: vi.fn(), loginDirect: vi.fn(), logout: vi.fn(), updateUser: vi.fn(),
      can: vi.fn().mockImplementation((p: string) => p === 'connections:read'),
    });
    mockGetInstances.mockResolvedValue([makeInstance()]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('gpt-4o')).not.toBeNull());

    expect(screen.queryByRole('button', { name: /add instance/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /import from catalog/i })).toBeNull();
    expect(screen.queryByTitle('Remove')).toBeNull();
  });
});

describe('ModelInstancesPage — non-Error rejections', () => {
  it('shows a fallback message when loading fails with a non-Error value', async () => {
    mockGetConnections.mockRejectedValue('oops');
    renderPage();
    await waitFor(() => expect(screen.queryByText('Failed to load instances')).not.toBeNull());
  });

  it('shows a fallback message when creation fails with a non-Error value', async () => {
    const user = userEvent.setup();
    mockCreateInstance.mockRejectedValue('oops');
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No instances yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /add instance/i }));
    await user.type(screen.getByLabelText(/upstream model id/i), 'x');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(screen.queryByText('Failed to create instance')).not.toBeNull());
  });

  it('shows a fallback message when the catalog fails to load with a non-Error value', async () => {
    const user = userEvent.setup();
    mockGetCatalog.mockRejectedValue('oops');
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No instances yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /import from catalog/i }));

    await waitFor(() => expect(screen.queryByText('Failed to load catalog')).not.toBeNull());
  });

  it('shows a fallback message when import fails with a non-Error value', async () => {
    const user = userEvent.setup();
    mockGetCatalog.mockResolvedValue([
      { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', contextWindow: 128000, pricing: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 }, isConfigured: false },
    ]);
    mockCreateInstance.mockRejectedValue('oops');
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No instances yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /import from catalog/i }));
    await waitFor(() => expect(screen.queryByText('gpt-4o')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => expect(screen.queryByText('Failed to import catalog entry')).not.toBeNull());
  });

  it('shows a fallback message when deletion fails with a non-Error value', async () => {
    const user = userEvent.setup();
    mockGetInstances.mockResolvedValue([makeInstance()]);
    mockDeleteInstance.mockRejectedValue('oops');
    renderPage();
    await waitFor(() => expect(screen.queryByText('gpt-4o')).not.toBeNull());

    await user.click(screen.getByTitle('Remove'));
    await user.click(screen.getByText('Confirm'));

    await waitFor(() => expect(screen.queryByText('Failed to delete instance')).not.toBeNull());
  });
});

describe('ModelInstancesPage — catalog reload behavior', () => {
  it('does not refetch the catalog once already loaded', async () => {
    const user = userEvent.setup();
    mockGetCatalog.mockResolvedValue([
      { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', contextWindow: 128000, pricing: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 }, isConfigured: false },
    ]);
    renderPage();
    await waitFor(() => expect(screen.queryByText(/No instances yet/i)).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /import from catalog/i }));
    await waitFor(() => expect(screen.queryByText('gpt-4o')).not.toBeNull());
    await user.click(screen.getByTitle('Close'));
    await user.click(screen.getByRole('button', { name: /import from catalog/i }));
    await waitFor(() => expect(screen.queryByText('gpt-4o')).not.toBeNull());

    expect(mockGetCatalog).toHaveBeenCalledTimes(1);
  });
});
