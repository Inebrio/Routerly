import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProfileApiTokensTab } from './ProfileApiTokensTab';

vi.mock('../api', () => ({ getMyApiTokens: vi.fn(), deleteMyApiToken: vi.fn() }));

import { getMyApiTokens, deleteMyApiToken } from '../api';

const mockGet = vi.mocked(getMyApiTokens as () => Promise<unknown>);
const mockDelete = vi.mocked(deleteMyApiToken as (id: string) => Promise<unknown>);

const day = 86_400_000;
const token = (over: Record<string, unknown> = {}) => ({
  id: 'tok-1', name: 'ci', tokenSnippet: 'sk-rt-api-abc',
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: new Date(Date.now() + 90 * day).toISOString(),
  permissions: ['model:read'], ...over,
});

beforeEach(() => { mockGet.mockResolvedValue([token()]); });
afterEach(() => vi.clearAllMocks());

async function renderTab() {
  render(
    <MemoryRouter initialEntries={['/dashboard/profile/api-tokens']}>
      <Routes>
        <Route path="/dashboard/profile/api-tokens" element={<ProfileApiTokensTab />} />
        <Route path="/dashboard/profile/api-tokens/new" element={<div>new token page</div>} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByText('API Tokens')).toBeTruthy());
}

describe('ProfileApiTokensTab', () => {
  it('lists tokens with their permission scope and no warning when far from expiry', async () => {
    await renderTab();
    expect(screen.getByText('ci')).toBeTruthy();
    expect(screen.getByText('model:read')).toBeTruthy();
    expect(screen.queryByText('Expires soon')).toBeNull();
    expect(screen.queryByText('Expired')).toBeNull();
  });

  it('warns when a token expires within 7 days', async () => {
    mockGet.mockResolvedValue([token({ expiresAt: new Date(Date.now() + 3 * day).toISOString() })]);
    await renderTab();
    expect(screen.getByText('Expires soon')).toBeTruthy();
  });

  it('flags an expired token', async () => {
    mockGet.mockResolvedValue([token({ expiresAt: new Date(Date.now() - day).toISOString() })]);
    await renderTab();
    expect(screen.getByText('Expired')).toBeTruthy();
  });

  it('shows the empty state', async () => {
    mockGet.mockResolvedValue([]);
    await renderTab();
    expect(screen.getByText(/No API tokens yet/)).toBeTruthy();
  });

  it('reports a failed load', async () => {
    mockGet.mockRejectedValue(new Error('network down'));
    render(<MemoryRouter initialEntries={['/x']}><Routes><Route path="/x" element={<ProfileApiTokensTab />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('network down')).toBeTruthy());
  });

  it('revokes after confirmation', async () => {
    mockDelete.mockResolvedValue(undefined);
    await renderTab();
    await userEvent.click(screen.getByTitle('Revoke token'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('tok-1'));
    await waitFor(() => expect(screen.queryByText('ci')).toBeNull());
  });

  it('sends creation to its own page', async () => {
    await renderTab();
    await userEvent.click(screen.getByRole('button', { name: /New Token/ }));
    expect(screen.getByText('new token page')).toBeTruthy();
  });
});
