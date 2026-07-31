import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  getMcpTools: vi.fn(),
  getMcpTool: vi.fn(),
}));

vi.mock('../AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { McpPage } from './McpPage';
import { getMcpTools } from '../api';
import { useAuth } from '../AuthContext';

const mockGetMcpTools = vi.mocked(getMcpTools as () => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);

function makeTool(overrides: Record<string, unknown> = {}) {
  return {
    name: 'list_models',
    scope: 'read',
    description: 'List the models available to this project.',
    sourceModule: 'catalog.registry',
    enabled: true,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <McpPage />
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

beforeEach(() => {
  mockGetMcpTools.mockResolvedValue([
    makeTool(),
    makeTool({ name: 'toggle_model', scope: 'write', description: 'Enable or disable a model.', sourceModule: 'config.store', enabled: false }),
  ]);
  authAs(['mcp:read']);
});

afterEach(() => vi.clearAllMocks());

describe('McpPage — access control', () => {
  it('shows access-denied state and never fetches when lacking mcp:read', async () => {
    authAs([]);
    renderPage();
    await waitFor(() => expect(screen.queryByText(/don't have permission/i)).not.toBeNull());
    expect(mockGetMcpTools).not.toHaveBeenCalled();
  });
});

describe('McpPage — loading / empty / error states', () => {
  it('shows an empty state when there are no tools', async () => {
    mockGetMcpTools.mockResolvedValueOnce([]);
    renderPage();
    await waitFor(() => screen.getByText(/No MCP tools available/));
  });

  it('shows an inline error banner when loading fails', async () => {
    mockGetMcpTools.mockRejectedValueOnce(new Error('network down'));
    renderPage();
    await waitFor(() => expect(screen.queryByText('network down')).not.toBeNull());
  });

  it('shows the generic fallback on a non-Error rejection', async () => {
    mockGetMcpTools.mockRejectedValueOnce('boom');
    renderPage();
    await waitFor(() => expect(screen.queryByText('Failed to load MCP tools')).not.toBeNull());
  });
});

describe('McpPage — list rendering', () => {
  it('renders a row per tool with name, scope, description, source module, and enabled state', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('table'));
    const table = screen.getByRole('table');

    const readRow = within(table).getByText('list_models').closest('tr') as HTMLTableRowElement;
    expect(within(readRow).getByText('read')).not.toBeNull();
    expect(within(readRow).getByText(/List the models/)).not.toBeNull();
    expect(within(readRow).getByText('catalog.registry')).not.toBeNull();
    expect(within(readRow).getByText('Enabled')).not.toBeNull();

    const writeRow = within(table).getByText('toggle_model').closest('tr') as HTMLTableRowElement;
    expect(within(writeRow).getByText('write')).not.toBeNull();
    expect(within(writeRow).getByText('Disabled')).not.toBeNull();
  });

  it('renders the connection-instructions panel', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('table'));
    expect(screen.getByText('routerly mcp serve')).not.toBeNull();
    expect(screen.getByText(/\/mcp/)).not.toBeNull();
  });
});
