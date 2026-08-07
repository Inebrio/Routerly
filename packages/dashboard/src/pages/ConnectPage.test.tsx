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
    expect(screen.getByText('One command').closest('section')!.querySelectorAll('a').length).toBe(2);
    expect(screen.getByText('By hand').closest('section')!.querySelectorAll('a').length).toBe(1);
  });

  it('opens with the endpoints any client needs, whether or not it is in the grid', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage();
    await waitFor(() => expect(screen.getByText('Point any client here')).toBeTruthy());
    const card = screen.getByText('Point any client here').closest('section')!;
    expect(card.textContent).toContain('http://localhost:3000/v1');
    expect(card.textContent).toContain('routerly/ada');
    expect(card.querySelector('a')!.getAttribute('href')).toBe('/dashboard/routers');
    // Two copy buttons: the OpenAI base URL and the Anthropic one.
    expect(card.querySelectorAll('button').length).toBe(2);
  });

  it('leaves the endpoints out when the service reports no client at all', async () => {
    mockGetClients.mockResolvedValue({ ...makeClients(), clients: [] });
    renderPage();
    await waitFor(() => expect(mockGetClients).toHaveBeenCalled());
    expect(screen.queryByText('Point any client here')).toBeNull();
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
