import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  getClients: vi.fn(),
}));

import { ConnectPage } from './ConnectPage';
import { getClients } from '../api';
import { makeClients, apiError } from './connectFixtures';

const mockGetClients = vi.mocked(getClients);

function renderPage() {
  return render(<MemoryRouter><ConnectPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConnectPage', () => {
  it('shows a loading state while fetching', () => {
    mockGetClients.mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelector('.spinner')).toBeTruthy();
  });

  it('renders one tile per client with its support state in plain words', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage();
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeTruthy());
    expect(screen.getByText('Codex')).toBeTruthy();
    expect(screen.getByText('Cline')).toBeTruthy();
    expect(screen.getAllByText('CLI setup').length).toBe(2);
    expect(screen.getByText('Manual setup')).toBeTruthy();
  });

  it('links each tile to the client detail page', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage();
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeTruthy());
    expect(screen.getByRole('link', { name: /Claude Code/ }).getAttribute('href'))
      .toBe('/dashboard/connect/claude-code');
  });

  it('shows the connect modes of each client, spelled out on hover', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage();
    await waitFor(() => expect(screen.getByText('Cline')).toBeTruthy());
    const badges = [...document.querySelectorAll('.badge-neutral')];
    expect(badges.map(b => b.textContent)).toEqual(['LLM', 'MCP', 'LLM', 'MCP', 'LLM']);
    expect(badges[0]!.getAttribute('title')).toBe('Routes the client model traffic through Routerly');
    expect(badges[1]!.getAttribute('title')).toBe('Loads Routerly as an MCP tool server');
  });

  it('groups the clients by how they get set up', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage();
    await waitFor(() => expect(screen.getByText('One command')).toBeTruthy());
    expect(screen.getByText('By hand')).toBeTruthy();
    // Claude Code and Codex are auto-configurable, Cline is not.
    const groups = document.querySelectorAll('section');
    expect(groups[0]!.querySelectorAll('a').length).toBe(2);
    expect(groups[1]!.querySelectorAll('a').length).toBe(1);
  });

  it('drops a group with no clients in it', async () => {
    const { clients, ...rest } = makeClients();
    mockGetClients.mockResolvedValue({ ...rest, clients: clients.filter(c => c.id === 'cline') });
    renderPage();
    await waitFor(() => expect(screen.getByText('By hand')).toBeTruthy());
    expect(screen.queryByText('One command')).toBeNull();
  });

  it('shows a generic error state on a non-404 failure', async () => {
    mockGetClients.mockRejectedValue(apiError('Internal Server Error', 500));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Internal Server Error/)).toBeTruthy());
  });

  it('shows a "feature not enabled" empty state on a 404', async () => {
    mockGetClients.mockRejectedValue(apiError('Not found', 404));
    renderPage();
    await waitFor(() => expect(screen.getByText(/not enabled/i)).toBeTruthy());
    expect(screen.getByText('routerly modules enable clients')).toBeTruthy();
  });
});
