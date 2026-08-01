import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../api', () => ({
  getClients: vi.fn(),
}));

import { ConnectClientPage } from './ConnectClientPage';
import { getClients } from '../api';
import { makeClients, apiError } from './connectFixtures';

const mockGetClients = vi.mocked(getClients);

function renderPage(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/connect/${id}`]}>
      <Routes>
        <Route path="/dashboard/connect/:id" element={<ConnectClientPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConnectClientPage', () => {
  it('shows a loading state while fetching', () => {
    mockGetClients.mockReturnValue(new Promise(() => {}));
    const { container } = renderPage('codex');
    expect(container.querySelector('.spinner')).toBeTruthy();
  });

  it('renders the client header with its support state and docs link', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage('codex');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Codex' })).toBeTruthy());
    expect(screen.getByText('CLI setup')).toBeTruthy();
    expect(screen.getByRole('link', { name: /docs/i }).getAttribute('href'))
      .toBe('https://doc.routerly.ai/next/integrations/clients/codex');
  });

  it('offers the CLI command for an auto-configurable client', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage('codex');
    await waitFor(() => expect(screen.getByText('routerly clients configure codex')).toBeTruthy());
  });

  it('hides the CLI command for a client configured by hand', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage('cline');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Cline' })).toBeTruthy());
    expect(screen.queryByText('routerly clients configure cline')).toBeNull();
    expect(screen.getByText(/API Provider: OpenAI Compatible/)).toBeTruthy();
  });

  it('renders the manual snippet with the token placeholder and a link to create one', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage('codex');
    await waitFor(() => expect(screen.getAllByText(/sk-rt-YOUR_TOKEN/).length).toBeGreaterThan(0));
    expect(screen.getByRole('link', { name: /create one/i }).getAttribute('href'))
      .toBe('/dashboard/projects');
  });

  it('renders the MCP snippet only for a client that speaks MCP', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    const { unmount } = renderPage('codex');
    await waitFor(() => expect(screen.getByText('MCP server')).toBeTruthy());
    expect(screen.getByText(/<YOUR_MCP_TOKEN>/)).toBeTruthy();
    unmount();

    renderPage('cline');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Cline' })).toBeTruthy());
    expect(screen.queryByText('MCP server')).toBeNull();
  });

  it('copies a snippet to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    mockGetClients.mockResolvedValue(makeClients());
    renderPage('codex');
    await waitFor(() => expect(screen.getByText('routerly clients configure codex')).toBeTruthy());
    await userEvent.click(screen.getAllByRole('button', { name: /copy/i })[0]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('routerly clients configure codex'));
  });

  it('reports an unknown client id', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage('nope');
    await waitFor(() => expect(screen.getByText(/No client named/)).toBeTruthy());
  });

  it('shows a "feature not enabled" empty state on a 404', async () => {
    mockGetClients.mockRejectedValue(apiError('Not found', 404));
    renderPage('codex');
    await waitFor(() => expect(screen.getByText(/not enabled/i)).toBeTruthy());
  });

  it('shows a generic error state on a non-404 failure', async () => {
    mockGetClients.mockRejectedValue(apiError('Internal Server Error', 500));
    renderPage('codex');
    await waitFor(() => expect(screen.getByText(/Internal Server Error/)).toBeTruthy());
  });
});
