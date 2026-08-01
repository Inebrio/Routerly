import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileMcpTab } from './ProfileMcpTab';

vi.mock('../api', () => ({
  getMyMcpTokens: vi.fn(),
  getMyMcpTools: vi.fn(),
  createMyMcpToken: vi.fn(),
  deleteMyMcpToken: vi.fn(),
}));

vi.mock('../utils/clipboard', () => ({ writeToClipboard: vi.fn() }));

import { getMyMcpTokens, getMyMcpTools, createMyMcpToken, deleteMyMcpToken } from '../api';
import { writeToClipboard } from '../utils/clipboard';

const mockGetTokens = vi.mocked(getMyMcpTokens as () => Promise<unknown>);
const mockGetTools = vi.mocked(getMyMcpTools as () => Promise<unknown>);
const mockCreate = vi.mocked(createMyMcpToken as (...a: unknown[]) => Promise<unknown>);
const mockDelete = vi.mocked(deleteMyMcpToken as (id: string) => Promise<unknown>);
const mockCopy = vi.mocked(writeToClipboard as (t: string) => Promise<void>);

const TOKEN = {
  id: 'tok-1',
  name: 'laptop',
  tokenSnippet: 'sk-rt-mcp-abc',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: '2026-02-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
};

const TOOL = {
  name: 'list_models',
  scope: 'read' as const,
  description: 'List the models in the catalog',
  sourceModule: 'catalog.registry',
  permission: 'model:read' as const,
};

beforeEach(() => {
  mockGetTokens.mockResolvedValue([TOKEN]);
  mockGetTools.mockResolvedValue([TOOL]);
  mockCopy.mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

async function renderTab() {
  render(<ProfileMcpTab />);
  await waitFor(() => expect(screen.getByText('MCP Tokens')).toBeTruthy());
}

describe('ProfileMcpTab', () => {
  it('lists the tokens and the tools the caller can reach', async () => {
    await renderTab();

    expect(screen.getByText('laptop')).toBeTruthy();
    expect(screen.getByText('sk-rt-mcp-abc')).toBeTruthy();
    expect(screen.getByText('list_models')).toBeTruthy();
    expect(screen.getByText('model:read')).toBeTruthy();
    expect(screen.getByText('catalog.registry')).toBeTruthy();
  });

  it('shows both empty states when the caller has neither tokens nor tools', async () => {
    mockGetTokens.mockResolvedValue([]);
    mockGetTools.mockResolvedValue([]);
    await renderTab();

    expect(screen.getByText(/No MCP tokens yet/)).toBeTruthy();
    expect(screen.getByText(/Your role grants no MCP tool/)).toBeTruthy();
  });

  it('reports a failed load', async () => {
    mockGetTokens.mockRejectedValue(new Error('network down'));
    render(<ProfileMcpTab />);

    await waitFor(() => expect(screen.getByText('network down')).toBeTruthy());
  });

  it('falls back to a generic message when the load throws a non-Error', async () => {
    mockGetTokens.mockRejectedValue('boom');
    render(<ProfileMcpTab />);

    await waitFor(() => expect(screen.getByText('Failed to load the MCP surface')).toBeTruthy());
  });

  it('creates a token and reveals the raw value once', async () => {
    mockCreate.mockResolvedValue({ ...TOKEN, id: 'tok-2', name: 'desktop', token: 'sk-rt-mcp-raw-value' });
    await renderTab();

    await userEvent.click(screen.getByRole('button', { name: /New Token/ }));
    await userEvent.type(screen.getByLabelText('Name'), 'desktop');
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));

    await waitFor(() => expect(screen.getByText('sk-rt-mcp-raw-value')).toBeTruthy());
    expect(mockCreate).toHaveBeenCalledWith({ name: 'desktop' });
    // The new token joins the list, and the form closes.
    expect(screen.getByText('desktop')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create token' })).toBeNull();
  });

  it('sends the chosen expiry as an ISO instant', async () => {
    mockCreate.mockResolvedValue({ ...TOKEN, id: 'tok-2', name: 'ci', token: 'sk-rt-mcp-raw' });
    await renderTab();

    await userEvent.click(screen.getByRole('button', { name: /New Token/ }));
    await userEvent.type(screen.getByLabelText('Name'), 'ci');
    await userEvent.type(screen.getByLabelText(/Expires on/), '2027-06-30');
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({
      name: 'ci',
      expiresAt: '2027-06-30T23:59:59.000Z',
    }));
  });

  it('reports a rejected creation and keeps the form open', async () => {
    mockCreate.mockRejectedValue(new Error('An MCP token named "laptop" already exists'));
    await renderTab();

    await userEvent.click(screen.getByRole('button', { name: /New Token/ }));
    await userEvent.type(screen.getByLabelText('Name'), 'laptop');
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));

    await waitFor(() => expect(screen.getByText(/already exists/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Create token' })).toBeTruthy();
  });

  it('cancels the create form', async () => {
    await renderTab();

    await userEvent.click(screen.getByRole('button', { name: /New Token/ }));
    await userEvent.type(screen.getByLabelText('Name'), 'scratch');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('copies the revealed token, then lets it be dismissed', async () => {
    mockCreate.mockResolvedValue({ ...TOKEN, id: 'tok-2', name: 'desktop', token: 'sk-rt-mcp-raw-value' });
    await renderTab();

    await userEvent.click(screen.getByRole('button', { name: /New Token/ }));
    await userEvent.type(screen.getByLabelText('Name'), 'desktop');
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
    await waitFor(() => expect(screen.getByText('sk-rt-mcp-raw-value')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: /Copy/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Copied!/ })).toBeTruthy());
    expect(mockCopy).toHaveBeenCalledWith('sk-rt-mcp-raw-value');

    await userEvent.click(screen.getByTitle('Dismiss'));
    expect(screen.queryByText('sk-rt-mcp-raw-value')).toBeNull();
  });

  it('reports a failed copy', async () => {
    mockCreate.mockResolvedValue({ ...TOKEN, id: 'tok-2', name: 'desktop', token: 'sk-rt-mcp-raw-value' });
    mockCopy.mockRejectedValue(new Error('no clipboard'));
    await renderTab();

    await userEvent.click(screen.getByRole('button', { name: /New Token/ }));
    await userEvent.type(screen.getByLabelText('Name'), 'desktop');
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
    await waitFor(() => expect(screen.getByText('sk-rt-mcp-raw-value')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: /Copy/ }));
    await waitFor(() => expect(screen.getByText(/Copy failed/)).toBeTruthy());
  });

  it('revokes a token after confirmation', async () => {
    mockDelete.mockResolvedValue(undefined);
    await renderTab();

    await userEvent.click(screen.getByTitle('Revoke token'));
    expect(screen.getByText(/Revoke MCP token "laptop"/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('tok-1'));
    await waitFor(() => expect(screen.getByText(/No MCP tokens yet/)).toBeTruthy());
  });

  it('keeps the token when the confirmation is cancelled', async () => {
    await renderTab();

    await userEvent.click(screen.getByTitle('Revoke token'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByText('laptop')).toBeTruthy();
  });

  it('reports a failed revoke and keeps the token listed', async () => {
    mockDelete.mockRejectedValue(new Error('Token not found'));
    await renderTab();

    await userEvent.click(screen.getByTitle('Revoke token'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(screen.getByText('Token not found')).toBeTruthy());
    expect(screen.getByText('laptop')).toBeTruthy();
  });

  it('shows "Never" for a token with no expiry and no use', async () => {
    mockGetTokens.mockResolvedValue([{ ...TOKEN, lastUsedAt: undefined, expiresAt: undefined }]);
    await renderTab();

    expect(screen.getAllByText('Never')).toHaveLength(2);
  });

  it('gives both transports of the connection instructions', async () => {
    await renderTab();

    expect(screen.getByText('routerly mcp serve')).toBeTruthy();
    expect(screen.getByText(`${window.location.origin}/mcp`)).toBeTruthy();
    expect(screen.getByText(/ROUTERLY_MCP_TOKEN=<your MCP token>/)).toBeTruthy();
  });
});
