import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { McpTokenNewPage } from './McpTokenNewPage';

vi.mock('../api', () => ({ createMyMcpToken: vi.fn() }));
vi.mock('../utils/clipboard', () => ({ writeToClipboard: vi.fn() }));

import { createMyMcpToken } from '../api';
import { writeToClipboard } from '../utils/clipboard';

const mockCreate = vi.mocked(createMyMcpToken as (...a: unknown[]) => Promise<unknown>);
const mockCopy = vi.mocked(writeToClipboard as (t: string) => Promise<void>);

const CREATED = {
  id: 'tok-2',
  name: 'desktop',
  tokenSnippet: 'sk-rt-mcp-raw',
  createdAt: '2026-01-01T00:00:00.000Z',
  token: 'sk-rt-mcp-raw-value',
};

beforeEach(() => {
  mockCreate.mockResolvedValue(CREATED);
  mockCopy.mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/profile/mcp/new']}>
      <Routes>
        <Route path="/dashboard/profile/mcp/new" element={<McpTokenNewPage />} />
        <Route path="/dashboard/profile/mcp" element={<div>mcp tab</div>} />
      </Routes>
    </MemoryRouter>
  );
}

async function create(name = 'desktop') {
  await userEvent.type(screen.getByLabelText('Name'), name);
  await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
}

describe('McpTokenNewPage', () => {
  it('creates a token with no expiry, reveals it once and wires a client with it', async () => {
    renderPage();
    await create();

    await waitFor(() => expect(screen.getByText('sk-rt-mcp-raw-value')).toBeTruthy());
    // No expiry chosen means no expiresAt at all: the token lives until revoked.
    expect(mockCreate).toHaveBeenCalledWith({ name: 'desktop' });
    // The guide carries the real value, not a placeholder.
    expect(screen.getByText(/Bearer sk-rt-mcp-raw-value/)).toBeTruthy();
    expect(screen.getByText('routerly mcp serve')).toBeTruthy();
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('says the expiry is optional', () => {
    renderPage();

    expect(screen.getByText(/Leave it empty and the token never expires/)).toBeTruthy();
  });

  it('sends the chosen expiry as an ISO instant at the end of that day', async () => {
    renderPage();

    await userEvent.type(screen.getByLabelText('Name'), 'ci');
    await userEvent.type(screen.getByLabelText(/Expires on/), '2027-06-30');
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({
      name: 'ci',
      expiresAt: '2027-06-30T23:59:59.000Z',
    }));
  });

  it('copies the revealed token', async () => {
    renderPage();
    await create();
    await waitFor(() => expect(screen.getByText('sk-rt-mcp-raw-value')).toBeTruthy());

    await userEvent.click(screen.getByTitle('Copy token'));

    await waitFor(() => expect(screen.getByText('Copied!')).toBeTruthy());
    expect(mockCopy).toHaveBeenCalledWith('sk-rt-mcp-raw-value');
  });

  it('reports a failed copy', async () => {
    mockCopy.mockRejectedValue(new Error('no clipboard'));
    renderPage();
    await create();
    await waitFor(() => expect(screen.getByText('sk-rt-mcp-raw-value')).toBeTruthy());

    await userEvent.click(screen.getByTitle('Copy token'));

    await waitFor(() => expect(screen.getByText(/Copy failed/)).toBeTruthy());
  });

  it('reports a rejected creation and keeps the form', async () => {
    mockCreate.mockRejectedValue(new Error('An MCP token named "laptop" already exists'));
    renderPage();
    await create('laptop');

    await waitFor(() => expect(screen.getByText(/already exists/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Create token' })).toBeTruthy();
  });

  it('falls back to a generic message when the creation throws a non-Error', async () => {
    mockCreate.mockRejectedValue('boom');
    renderPage();
    await create();

    await waitFor(() => expect(screen.getByText('Failed to create the token')).toBeTruthy());
  });

  it.each(['Cancel', 'Back to MCP'])('goes back to the tab from %s', async (label) => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: label }));

    await waitFor(() => expect(screen.getByText('mcp tab')).toBeTruthy());
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('goes back to the tab once the token is copied', async () => {
    renderPage();
    await create();
    await waitFor(() => expect(screen.getByText('sk-rt-mcp-raw-value')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(screen.getByText('mcp tab')).toBeTruthy());
  });
});
