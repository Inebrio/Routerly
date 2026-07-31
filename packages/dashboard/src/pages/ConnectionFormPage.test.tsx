import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../api', () => ({
  getConnections: vi.fn(),
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  getProviderDescriptors: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import { ConnectionFormPage } from './ConnectionFormPage';
import { getConnections, createConnection, updateConnection, getProviderDescriptors } from '../api';

const mockGetConnections = vi.mocked(getConnections as () => Promise<unknown>);
const mockCreateConnection = vi.mocked(createConnection as (...a: unknown[]) => Promise<unknown>);
const mockUpdateConnection = vi.mocked(updateConnection as (...a: unknown[]) => Promise<unknown>);
const mockGetDescriptors = vi.mocked(getProviderDescriptors as () => Promise<unknown>);

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1', providerId: 'openai', label: 'My OpenAI', credentials: undefined,
    endpoint: 'https://api.openai.com/v1', enabled: true, ...overrides,
  };
}

function makeDescriptor(overrides: Record<string, unknown> = {}) {
  return { id: 'openai', label: 'OpenAI', protocol: 'openai', supportLevel: 'native', nativeCapabilities: {}, ...overrides };
}

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/connections/new']}>
      <Routes>
        <Route path="/dashboard/connections/new" element={<ConnectionFormPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderEdit(id = 'c1') {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/connections/${id}/edit`]}>
      <Routes>
        <Route path="/dashboard/connections/:id/edit" element={<ConnectionFormPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetDescriptors.mockResolvedValue([makeDescriptor()]);
  mockGetConnections.mockResolvedValue([makeConnection()]);
  mockCreateConnection.mockResolvedValue(makeConnection({ id: 'c-new' }));
  mockUpdateConnection.mockResolvedValue(makeConnection({ label: 'Updated' }));
});

afterEach(() => vi.clearAllMocks());

describe('ConnectionFormPage — create mode', () => {
  it('renders an empty form', async () => {
    renderNew();
    await waitFor(() => expect(screen.queryByText('Add Connection')).not.toBeNull());
    expect((screen.getByLabelText(/label/i) as HTMLInputElement).value).toBe('');
    expect(mockGetConnections).not.toHaveBeenCalled();
  });

  it('creates a connection and navigates back to the list', async () => {
    const user = userEvent.setup();
    renderNew();
    await waitFor(() => expect(screen.queryByText('Add Connection')).not.toBeNull());

    await user.type(screen.getByLabelText(/label/i), 'My OpenAI');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(mockCreateConnection).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'openai', label: 'My OpenAI', enabled: true,
    })));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard/connections'));
  });

  it('shows an error when creation fails', async () => {
    const user = userEvent.setup();
    mockCreateConnection.mockRejectedValue(new Error('create failed'));
    renderNew();
    await waitFor(() => expect(screen.queryByText('Add Connection')).not.toBeNull());

    await user.type(screen.getByLabelText(/label/i), 'X');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(screen.queryByText('create failed')).not.toBeNull());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows a fallback message when creation fails with a non-Error value', async () => {
    const user = userEvent.setup();
    mockCreateConnection.mockRejectedValue('oops');
    renderNew();
    await waitFor(() => expect(screen.queryByText('Add Connection')).not.toBeNull());

    await user.type(screen.getByLabelText(/label/i), 'X');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(screen.queryByText('Failed to create connection')).not.toBeNull());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates back to the list on cancel', async () => {
    const user = userEvent.setup();
    renderNew();
    await waitFor(() => expect(screen.queryByText('Add Connection')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/connections');
    expect(mockCreateConnection).not.toHaveBeenCalled();
  });
});

describe('ConnectionFormPage — edit mode', () => {
  it('loads and prefills the connection, with credentials left empty', async () => {
    renderEdit();
    await waitFor(() => expect(screen.queryByText('Edit Connection')).not.toBeNull());

    expect((screen.getByLabelText(/label/i) as HTMLInputElement).value).toBe('My OpenAI');
    expect((screen.getByLabelText(/endpoint/i) as HTMLInputElement).value).toBe('https://api.openai.com/v1');
    expect(screen.queryByText(/leave empty to keep existing/i)).not.toBeNull();
  });

  it('updates the connection and navigates back to the list', async () => {
    const user = userEvent.setup();
    renderEdit();
    await waitFor(() => expect(screen.queryByText('Edit Connection')).not.toBeNull());

    const labelInput = screen.getByLabelText(/label/i);
    await user.clear(labelInput);
    await user.type(labelInput, 'Renamed');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockUpdateConnection).toHaveBeenCalledWith('c1', expect.objectContaining({
      label: 'Renamed',
    })));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard/connections'));
  });

  it('shows a not-found error when the connection does not exist', async () => {
    mockGetConnections.mockResolvedValue([]);
    renderEdit('missing');
    await waitFor(() => expect(screen.queryByText('Connection not found')).not.toBeNull());
  });

  it('shows an error when update fails', async () => {
    const user = userEvent.setup();
    mockUpdateConnection.mockRejectedValue(new Error('update failed'));
    renderEdit();
    await waitFor(() => expect(screen.queryByText('Edit Connection')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.queryByText('update failed')).not.toBeNull());
  });

  it('does not overwrite stored credentials when the credential fields are left blank on save', async () => {
    const user = userEvent.setup();
    renderEdit();
    await waitFor(() => expect(screen.queryByText('Edit Connection')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockUpdateConnection).toHaveBeenCalledWith('c1', expect.not.objectContaining({ credentials: expect.anything() })));
  });

  it('shows a fallback message when update fails with a non-Error value', async () => {
    const user = userEvent.setup();
    mockUpdateConnection.mockRejectedValue('oops');
    renderEdit();
    await waitFor(() => expect(screen.queryByText('Edit Connection')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.queryByText('Failed to update connection')).not.toBeNull());
  });
});
