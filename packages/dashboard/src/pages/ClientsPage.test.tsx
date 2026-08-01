import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  getClients: vi.fn(),
}));

import { ClientsPage } from './ClientsPage';
import { getClients } from '../api';

const mockGetClients = vi.mocked(getClients);

function apiError(message: string, status: number) {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
}

function makeClients() {
  return {
    enabled: true,
    advertisedAddresses: ['192.168.1.50'],
    clients: [
      {
        id: 'claude-code',
        label: 'Claude Code',
        supportState: 'auto-configurable' as const,
        wireFormat: 'anthropic' as const,
        docSlug: 'integrations/clients/claude-code',
        configKind: 'json' as const,
        configPathHint: '~/.claude/settings.json',
        modes: ['llm', 'mcp'] as const,
        baseUrl: 'http://localhost:3000',
      },
      {
        id: 'codex',
        label: 'Codex',
        supportState: 'auto-configurable' as const,
        wireFormat: 'openai' as const,
        docSlug: 'integrations/clients/codex',
        configKind: 'toml' as const,
        configPathHint: '~/.codex/config.toml',
        modes: ['llm', 'mcp'] as const,
        baseUrl: 'http://localhost:3000',
      },
      {
        id: 'cline',
        label: 'Cline',
        supportState: 'documented' as const,
        wireFormat: 'openai' as const,
        docSlug: 'integrations/clients/cline',
        configKind: 'ui' as const,
        configPathHint: 'VS Code Settings (Cline panel), no file',
        modes: ['llm'] as const,
        baseUrl: 'http://localhost:3000',
      },
    ],
  };
}

function renderPage() {
  return render(<MemoryRouter><ClientsPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClientsPage', () => {
  it('shows a loading state while fetching', () => {
    mockGetClients.mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelector('.spinner')).toBeTruthy();
  });

  it('renders each client with its support-state badge', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage();
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeTruthy());
    expect(screen.getByText('Codex')).toBeTruthy();
    expect(screen.getByText('Cline')).toBeTruthy();
    expect(screen.getAllByText('auto-configurable').length).toBe(2);
    expect(screen.getByText('documented')).toBeTruthy();
  });

  it('renders a copyable snippet with the token placeholder', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage();
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeTruthy());
    const placeholders = screen.getAllByText(/<YOUR_ROUTERLY_TOKEN>/);
    expect(placeholders.length).toBeGreaterThan(0);
  });

  it('gives a ui-only client (Cline) manual steps instead of a config file', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage();
    await waitFor(() => expect(screen.getByText('Cline')).toBeTruthy());
    expect(screen.getByText('Configure via VS Code Settings (Cline panel), no file.')).toBeTruthy();
    expect(screen.getByText(/API Provider: OpenAI Compatible/)).toBeTruthy();
  });

  it('copy button copies the snippet to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    mockGetClients.mockResolvedValue(makeClients());
    renderPage();
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeTruthy());
    const copyButtons = screen.getAllByRole('button', { name: /copy/i });
    await userEvent.click(copyButtons[0]!);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]![0]).toContain('<YOUR_ROUTERLY_TOKEN>');
  });

  it('renders a "create a token" link to the Projects page', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage();
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeTruthy());
    const link = screen.getByRole('link', { name: /create a token/i });
    expect(link.getAttribute('href')).toBe('/dashboard/projects');
  });

  it('renders a docs link per client', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage();
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeTruthy());
    const docsLinks = screen.getAllByRole('link', { name: /docs/i });
    expect(docsLinks.length).toBe(3);
    expect(docsLinks[0]!.getAttribute('href')).toBe('https://doc.routerly.ai/next/integrations/clients/claude-code');
  });

  it('shows a note that auto-apply is CLI-only', async () => {
    mockGetClients.mockResolvedValue(makeClients());
    renderPage();
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeTruthy());
    expect(screen.getByText(/routerly clients configure/)).toBeTruthy();
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
