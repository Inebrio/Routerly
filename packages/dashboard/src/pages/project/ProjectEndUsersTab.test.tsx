import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { ProjectEndUsersTab } from './ProjectEndUsersTab';

vi.mock('../../api', () => ({
  getEndUsers: vi.fn(),
}));

import { getEndUsers } from '../../api';
const mockGetEndUsers = vi.mocked(getEndUsers);

const mockProject = { id: 'proj-1', name: 'Test', models: [], tokens: [] };

function renderTab() {
  function LayoutWrapper() {
    return <Outlet context={{ project: mockProject, setProject: vi.fn() }} />;
  }
  return render(
    <MemoryRouter initialEntries={['/dashboard/projects/proj-1/end-users']}>
      <Routes>
        <Route path="/dashboard/projects/:id" element={<LayoutWrapper />}>
          <Route path="end-users" element={<ProjectEndUsersTab />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => vi.clearAllMocks());

describe('ProjectEndUsersTab', () => {
  it('shows loading spinner initially', () => {
    mockGetEndUsers.mockReturnValue(new Promise(() => {}));
    renderTab();
    expect(document.querySelector('.spinner')).toBeTruthy();
  });

  it('shows empty state when no users', async () => {
    mockGetEndUsers.mockResolvedValue([]);
    renderTab();
    await waitFor(() =>
      expect(screen.getByText('No end-user activity recorded yet.')).toBeTruthy()
    );
  });

  it('renders table with user rows', async () => {
    mockGetEndUsers.mockResolvedValue([
      {
        userId: 'user_123',
        projectId: 'proj-1',
        firstSeen: '2024-01-01T00:00:00Z',
        lastSeen: '2024-06-15T12:00:00Z',
        requests: 42,
        totalCost: 0.0234,
        totalTokens: 1500,
      },
    ]);
    renderTab();
    await waitFor(() => expect(screen.getByText('user_123')).toBeTruthy());
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('1,500')).toBeTruthy();
    expect(screen.getByText('$0.0234')).toBeTruthy();
  });

  it('shows error message on fetch failure', async () => {
    mockGetEndUsers.mockRejectedValue(new Error('Network error'));
    renderTab();
    await waitFor(() => expect(screen.getByText('Network error')).toBeTruthy());
  });
});
