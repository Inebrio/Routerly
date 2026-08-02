import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../api', () => ({
  getConnections: vi.fn(),
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  getProviderDescriptors: vi.fn(),
  testOpenAIOAuth: vi.fn(),
}));

// The provider picker is a div-based combobox; driving it as a native select keeps these
// tests about the form and not about the widget, the way ModelFormPage.test.tsx does.
vi.mock('../components/SearchableSelect', () => ({
  SearchableSelect: ({ options, value, onChange }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
  }) => (
    <select aria-label="Provider" value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
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
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('');
    expect(mockGetConnections).not.toHaveBeenCalled();
  });

  it('creates a connection, sending endpoint top-level and credentials from the fields', async () => {
    const user = userEvent.setup();
    renderNew();
    await waitFor(() => expect(screen.queryByText('Add Connection')).not.toBeNull());

    await user.type(screen.getByLabelText('Label'), 'My OpenAI');
    // The endpoint is left untouched: it arrives prefilled with the provider default (T204).
    // API key credential input.
    await user.type(screen.getByPlaceholderText('sk-…'), 'sk-secret');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(mockCreateConnection).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'openai', label: 'My OpenAI', enabled: true,
      endpoint: 'https://api.openai.com/v1',
      credentials: { apiKey: 'sk-secret' },
    })));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard/connections'));
  });

  it('shows an error when creation fails', async () => {
    const user = userEvent.setup();
    mockCreateConnection.mockRejectedValue(new Error('create failed'));
    renderNew();
    await waitFor(() => expect(screen.queryByText('Add Connection')).not.toBeNull());

    await user.type(screen.getByLabelText('Label'), 'X');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(screen.queryByText('create failed')).not.toBeNull());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows a fallback message when creation fails with a non-Error value', async () => {
    const user = userEvent.setup();
    mockCreateConnection.mockRejectedValue('oops');
    renderNew();
    await waitFor(() => expect(screen.queryByText('Add Connection')).not.toBeNull());

    await user.type(screen.getByLabelText('Label'), 'X');
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

describe('ConnectionFormPage — provider defaults (T204)', () => {
  it('prefills the endpoint of the provider the form opens on', async () => {
    renderNew();
    await waitFor(() => expect(screen.queryByText('Add Connection')).not.toBeNull());

    expect(screen.getByDisplayValue('https://api.openai.com/v1')).not.toBeNull();
  });

  it('swaps the endpoint when another provider is picked', async () => {
    const user = userEvent.setup();
    mockGetDescriptors.mockResolvedValue([makeDescriptor(), makeDescriptor({ id: 'ollama', label: 'Ollama' })]);
    renderNew();
    await waitFor(() => expect(screen.queryByText('Add Connection')).not.toBeNull());

    await user.selectOptions(screen.getByLabelText('Provider'), 'ollama');

    expect(screen.getByDisplayValue('http://localhost:11434/v1')).not.toBeNull();
    expect(screen.queryByDisplayValue('https://api.openai.com/v1')).toBeNull();
  });

  it('leaves the endpoint empty for a provider that has no fixed address', async () => {
    const user = userEvent.setup();
    mockGetDescriptors.mockResolvedValue([makeDescriptor(), makeDescriptor({ id: 'bedrock', label: 'AWS Bedrock' })]);
    renderNew();
    await waitFor(() => expect(screen.queryByText('Add Connection')).not.toBeNull());

    await user.selectOptions(screen.getByLabelText('Provider'), 'bedrock');

    const labelInput = screen.getByLabelText('Label');
    const endpointInput = screen.getAllByRole('textbox').find(t => t !== labelInput) as HTMLInputElement;
    expect(endpointInput.value).toBe('');
  });

  it('keeps the stored endpoint when editing, rather than the provider default', async () => {
    mockGetConnections.mockResolvedValue([makeConnection({ endpoint: 'https://proxy.internal/v1' })]);
    renderEdit();
    await waitFor(() => expect(screen.queryByText('Edit Connection')).not.toBeNull());

    expect(screen.getByDisplayValue('https://proxy.internal/v1')).not.toBeNull();
  });
});

describe('ConnectionFormPage — edit mode', () => {
  it('loads and prefills the connection, with credentials left empty', async () => {
    renderEdit();
    await waitFor(() => expect(screen.queryByText('Edit Connection')).not.toBeNull());

    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('My OpenAI');
    expect(screen.getByDisplayValue('https://api.openai.com/v1')).not.toBeNull();
    expect(screen.queryByText(/leave credential fields blank/i)).not.toBeNull();
    expect((screen.getByPlaceholderText('Leave blank to keep existing key') as HTMLInputElement).value).toBe('');
  });

  it('updates the connection and navigates back to the list', async () => {
    const user = userEvent.setup();
    renderEdit();
    await waitFor(() => expect(screen.queryByText('Edit Connection')).not.toBeNull());

    const labelInput = screen.getByLabelText('Label');
    await user.clear(labelInput);
    await user.type(labelInput, 'Renamed');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockUpdateConnection).toHaveBeenCalledWith('c1', expect.objectContaining({
      label: 'Renamed', endpoint: 'https://api.openai.com/v1',
    })));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard/connections'));
  });

  it('prefills non-secret cloud fields when editing a bedrock connection, secret left blank', async () => {
    mockGetDescriptors.mockResolvedValue([makeDescriptor({ id: 'bedrock', label: 'AWS Bedrock', supportLevel: 'cloud' })]);
    mockGetConnections.mockResolvedValue([makeConnection({
      id: 'c1', providerId: 'bedrock', label: 'Bedrock',
      credentials: { awsRegion: 'us-east-1', awsAccessKeyId: 'AKIA-x' }, endpoint: undefined,
    })]);
    renderEdit();
    await waitFor(() => expect(screen.queryByText('Edit Connection')).not.toBeNull());

    // Required non-secret fields prefilled so HTML5 validation passes on save.
    expect(screen.getByDisplayValue('us-east-1')).not.toBeNull();
    expect(screen.getByDisplayValue('AKIA-x')).not.toBeNull();
    // Secret never returned by the server, stays blank.
    expect((screen.getByPlaceholderText('Leave blank to keep existing') as HTMLInputElement).value).toBe('');
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

  it('sends credentials on save when a credential field is filled', async () => {
    const user = userEvent.setup();
    renderEdit();
    await waitFor(() => expect(screen.queryByText('Edit Connection')).not.toBeNull());

    await user.type(screen.getByPlaceholderText('Leave blank to keep existing key'), 'sk-new');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockUpdateConnection).toHaveBeenCalledWith('c1', expect.objectContaining({
      credentials: { apiKey: 'sk-new' },
    })));
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

describe('ConnectionFormPage — custom provider (T205)', () => {
  const UPSTREAM = 'e.g. deepseek, mistral, groq';

  beforeEach(() => {
    mockGetDescriptors.mockResolvedValue([
      makeDescriptor(),
      makeDescriptor({ id: 'custom', label: 'Custom (OpenAI-compatible)', supportLevel: 'compatible' }),
    ]);
  });

  it('asks for the upstream provider name only when the provider is custom', async () => {
    const user = userEvent.setup();
    renderNew();
    await waitFor(() => expect(screen.queryByText('Add Connection')).not.toBeNull());

    expect(screen.queryByPlaceholderText(UPSTREAM)).toBeNull();
    await user.selectOptions(screen.getByLabelText('Provider'), 'custom');
    expect(screen.queryByPlaceholderText(UPSTREAM)).not.toBeNull();
  });

  it('creates a custom connection carrying its upstream provider name', async () => {
    const user = userEvent.setup();
    renderNew();
    await waitFor(() => expect(screen.queryByText('Add Connection')).not.toBeNull());

    await user.selectOptions(screen.getByLabelText('Provider'), 'custom');
    await user.type(screen.getByPlaceholderText(UPSTREAM), 'deepseek');
    await user.type(screen.getByLabelText('Label'), 'DeepSeek');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(mockCreateConnection).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'custom', providerName: 'deepseek', label: 'DeepSeek',
    })));
  });

  it('prefills the stored upstream name when editing a custom connection', async () => {
    mockGetConnections.mockResolvedValue([makeConnection({
      providerId: 'custom', providerName: 'deepseek', endpoint: 'https://api.deepseek.com/v1',
    })]);
    renderEdit();
    await waitFor(() => expect(screen.queryByText('Edit Connection')).not.toBeNull());

    expect((screen.getByPlaceholderText(UPSTREAM) as HTMLInputElement).value).toBe('deepseek');
  });

  it('clears the upstream name when the connection moves to a named provider', async () => {
    const user = userEvent.setup();
    mockGetConnections.mockResolvedValue([makeConnection({ providerId: 'custom', providerName: 'deepseek' })]);
    renderEdit();
    await waitFor(() => expect(screen.queryByText('Edit Connection')).not.toBeNull());

    await user.selectOptions(screen.getByLabelText('Provider'), 'openai');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mockUpdateConnection).toHaveBeenCalledWith('c1', expect.objectContaining({
      providerId: 'openai', providerName: '',
    })));
  });
});
