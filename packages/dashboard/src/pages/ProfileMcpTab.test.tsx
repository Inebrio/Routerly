import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProfileMcpTab } from './ProfileMcpTab';

vi.mock('../api', () => ({
  getMyMcpTokens: vi.fn(),
  getMyMcpTools: vi.fn(),
  deleteMyMcpToken: vi.fn(),
}));

vi.mock('../utils/clipboard', () => ({ writeToClipboard: vi.fn() }));

import { getMyMcpTokens, getMyMcpTools, deleteMyMcpToken } from '../api';
import { writeToClipboard } from '../utils/clipboard';

const mockGetTokens = vi.mocked(getMyMcpTokens as () => Promise<unknown>);
const mockGetTools = vi.mocked(getMyMcpTools as () => Promise<unknown>);
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

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/profile/mcp']}>
      <Routes>
        <Route path="/dashboard/profile/mcp" element={<ProfileMcpTab />} />
        <Route path="/dashboard/profile/mcp/new" element={<div>new token page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

async function renderTab() {
  renderAt();
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
    renderAt();

    await waitFor(() => expect(screen.getByText('network down')).toBeTruthy());
  });

  it('falls back to a generic message when the load throws a non-Error', async () => {
    mockGetTokens.mockRejectedValue('boom');
    renderAt();

    await waitFor(() => expect(screen.getByText('Failed to load the MCP surface')).toBeTruthy());
  });

  it('sends creation to its own page', async () => {
    await renderTab();

    await userEvent.click(screen.getByRole('button', { name: /New Token/ }));

    await waitFor(() => expect(screen.getByText('new token page')).toBeTruthy());
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

  it('falls back to a generic message when the revoke throws a non-Error', async () => {
    mockDelete.mockRejectedValue('boom');
    await renderTab();

    await userEvent.click(screen.getByTitle('Revoke token'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(screen.getByText('Failed to revoke the token')).toBeTruthy());
  });

  it('shows "Never" for a token with no expiry and no use', async () => {
    mockGetTokens.mockResolvedValue([{ ...TOKEN, lastUsedAt: undefined, expiresAt: undefined }]);
    await renderTab();

    expect(screen.getAllByText('Never')).toHaveLength(2);
  });

  it('wires a client with the placeholder token, and documents both transports', async () => {
    await renderTab();

    // The tab never holds a real token, so the guide ships the placeholder.
    expect(screen.getByText(/Bearer <YOUR_MCP_TOKEN>/)).toBeTruthy();
    expect(screen.getByText('routerly mcp serve')).toBeTruthy();
    expect(screen.getByText(`${window.location.origin}/mcp`)).toBeTruthy();
    expect(screen.getByText(/ROUTERLY_MCP_TOKEN=<your MCP token>/)).toBeTruthy();
  });
});
