import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiTokenNewPage } from './ApiTokenNewPage';

vi.mock('../api', () => ({ createMyApiToken: vi.fn(), getMe: vi.fn() }));
vi.mock('../utils/clipboard', () => ({ writeToClipboard: vi.fn() }));

import { createMyApiToken, getMe } from '../api';

const mockCreate = vi.mocked(createMyApiToken as (...a: unknown[]) => Promise<unknown>);
const mockMe = vi.mocked(getMe as () => Promise<unknown>);

beforeEach(() => {
  mockMe.mockResolvedValue({ id: 'u1', email: 'a@b.c', roleId: 'admin', permissions: ['model:read', 'router:read'] });
  mockCreate.mockResolvedValue({ id: 't', name: 'ci', token: 'sk-rt-api-raw-value' });
});
afterEach(() => vi.clearAllMocks());

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/dashboard/profile/api-tokens/new']}>
      <Routes>
        <Route path="/dashboard/profile/api-tokens/new" element={<ApiTokenNewPage />} />
        <Route path="/dashboard/profile/api-tokens" element={<div>tokens tab</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ApiTokenNewPage', () => {
  it('offers only the permissions the user holds and needs at least one', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('router:read')).toBeTruthy());
    expect(screen.queryByText('model:write')).toBeNull();
    await userEvent.type(screen.getByLabelText('Name'), 'ci');
    expect((screen.getByRole('button', { name: 'Create token' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('creates with name, expiry and scope, then reveals the token once', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('model:read')).toBeTruthy());
    await userEvent.type(screen.getByLabelText('Name'), 'ci');
    await userEvent.click(screen.getByLabelText('model:read'));
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));

    await waitFor(() => expect(screen.getByText('sk-rt-api-raw-value')).toBeTruthy());
    const body = mockCreate.mock.calls[0]![0] as { name: string; expiresAt: string; permissions: string[] };
    expect(body.name).toBe('ci');
    expect(body.permissions).toEqual(['model:read']);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('shows the API error', async () => {
    mockCreate.mockRejectedValue(new Error('name already used'));
    renderPage();
    await waitFor(() => expect(screen.getByText('model:read')).toBeTruthy());
    await userEvent.type(screen.getByLabelText('Name'), 'ci');
    await userEvent.click(screen.getByLabelText('model:read'));
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
    await waitFor(() => expect(screen.getByText('name already used')).toBeTruthy());
  });
});
