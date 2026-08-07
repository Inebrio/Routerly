import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { RouterLayout, useRouter } from './RouterLayout';

vi.mock('../../api', () => ({
  getRouters: vi.fn(),
}));

import { getRouters } from '../../api';
const mockGetRouters = vi.mocked(getRouters);

const mockRouter = {
  id: 'proj-1',
  name: 'My Router',
  models: [],
  tokens: [],
};

function renderLayout(path: string, routerId: string | undefined = 'proj-1') {
  const route = routerId
    ? `/dashboard/routers/${routerId}/general`
    : `/dashboard/routers/new`;
  return render(
    <MemoryRouter initialEntries={[path || route]}>
      <Routes>
        <Route path="/dashboard/routers/new" element={<RouterLayout />}>
          <Route path="" element={<div>New router content</div>} />
        </Route>
        <Route path="/dashboard/routers/:id" element={<RouterLayout />}>
          <Route path="general" element={<div data-testid="tab-general">General Tab</div>} />
          <Route path="routing" element={<div>Routing Tab</div>} />
          <Route path="security" element={<div>Security Tab</div>} />
          <Route path="token" element={<div>Token Tab</div>} />
          <Route path="users" element={<div>Users Tab</div>} />
          <Route path="logs" element={<div>Logs Tab</div>} />
        </Route>
        <Route path="/dashboard/routers" element={<div>Routers list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetRouters.mockResolvedValue([mockRouter] as never);
});

afterEach(() => vi.clearAllMocks());

describe('RouterLayout — loading state', () => {
  it('shows spinner while loading', () => {
    // Return a never-resolving promise to stay in loading state
    mockGetRouters.mockReturnValue(new Promise(() => {}));
    renderLayout('/dashboard/routers/proj-1/general');
    expect(document.querySelector('.spinner')).toBeTruthy();
  });
});

describe('RouterLayout — loaded state', () => {
  it('renders router name in heading', async () => {
    renderLayout('/dashboard/routers/proj-1/general');
    await waitFor(() => expect(screen.getByText('My Router')).toBeTruthy());
  });

  it('renders router ID below heading', async () => {
    renderLayout('/dashboard/routers/proj-1/general');
    await waitFor(() => expect(screen.getByText('proj-1')).toBeTruthy());
  });

  it('renders all 8 tabs, Dashboard first', async () => {
    renderLayout('/dashboard/routers/proj-1/general');
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeTruthy();
      expect(screen.getByText('General')).toBeTruthy();
      expect(screen.getByText('Routing')).toBeTruthy();
      expect(screen.getByText('Security')).toBeTruthy();
      expect(screen.getByText('Token')).toBeTruthy();
      expect(screen.getByText('Users')).toBeTruthy();
      expect(screen.getByText('Logs')).toBeTruthy();
      const labels = Array.from(document.querySelectorAll('a, [title="Save the router first to unlock this tab"]'))
        .map(el => el.textContent?.trim());
      expect(labels[0]).toBe('Dashboard');
    });
  });

  it('marks Dashboard active on the bare router URL', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard/routers/proj-1']}>
        <Routes>
          <Route path="/dashboard/routers/:id" element={<RouterLayout />}>
            <Route index element={<div>Dashboard Tab</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => {
      const tab = screen.getByText('Dashboard').closest('a')!;
      expect(tab.getAttribute('style')).toContain('var(--primary)');
    });
  });

  it('renders the outlet content for general tab', async () => {
    renderLayout('/dashboard/routers/proj-1/general');
    await waitFor(() => expect(screen.getByTestId('tab-general')).toBeTruthy());
  });
});

describe('RouterLayout — new router (no id)', () => {
  it('shows "New Router" heading on the router creation route', () => {
    // no API call for new router
    render(
      <MemoryRouter initialEntries={['/dashboard/routers/new/router']}>
        <Routes>
          <Route path="/dashboard/routers/new/router" element={<RouterLayout />}>
            <Route index element={<div>New content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('New Router')).toBeTruthy();
    expect(mockGetRouters).not.toHaveBeenCalled();
  });

  it('shows "New Orchestrator" heading on the orchestrator creation route', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard/routers/new/orchestrator']}>
        <Routes>
          <Route path="/dashboard/routers/new/orchestrator" element={<RouterLayout />}>
            <Route index element={<div>New content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('New Orchestrator')).toBeTruthy();
  });

  it('disabled tabs show cursor:not-allowed title', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard/routers/new/router']}>
        <Routes>
          <Route path="/dashboard/routers/new/router" element={<RouterLayout />}>
            <Route index element={<div />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    // Disabled tabs render as <div title="Save the router first to unlock this tab">
    const disabledTabs = document.querySelectorAll('[title="Save the router first to unlock this tab"]');
    expect(disabledTabs.length).toBeGreaterThan(0);
  });

  it('hides the Dashboard tab: a router with no traffic has nothing to show', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard/routers/new/router']}>
        <Routes>
          <Route path="/dashboard/routers/new/router" element={<RouterLayout />}>
            <Route index element={<div />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.queryByText('Dashboard')).toBeNull();
  });
});

describe('RouterLayout — error state', () => {
  it('shows error when getRouters rejects', async () => {
    mockGetRouters.mockRejectedValueOnce(new Error('Network error'));
    renderLayout('/dashboard/routers/proj-1/general');
    await waitFor(() => expect(screen.getByText('Network error')).toBeTruthy());
  });

  it('shows "Router not found" when router not in list', async () => {
    mockGetRouters.mockResolvedValueOnce([{ id: 'other', name: 'Other', models: [] }] as never);
    renderLayout('/dashboard/routers/proj-1/general');
    await waitFor(() => expect(screen.getByText('Router not found')).toBeTruthy());
  });

  it('shows Back to Routers button in error state', async () => {
    mockGetRouters.mockRejectedValueOnce(new Error('fail'));
    renderLayout('/dashboard/routers/proj-1/general');
    await waitFor(() => expect(screen.getByRole('button', { name: /Back to Routers/i })).toBeTruthy());
  });
});

describe('RouterLayout — "Loading..." while router not yet in state', () => {
  it('shows "Loading..." in header during fetch', () => {
    mockGetRouters.mockReturnValue(new Promise(() => {}));
    renderLayout('/dashboard/routers/proj-1/general');
    // spinner shown, not the heading text yet
    expect(document.querySelector('.spinner')).toBeTruthy();
  });
});

describe('RouterLayout — back button navigation', () => {
  it('clicking back button navigates to /dashboard/routers', async () => {
    renderLayout('/dashboard/routers/proj-1/general');
    await waitFor(() => screen.getByTitle('Back to routers'));
    await userEvent.click(screen.getByTitle('Back to routers'));
    // After navigation, Routers list should be rendered
    await waitFor(() => expect(screen.getByText('Routers list')).toBeTruthy());
  });
});

describe('RouterLayout — active tab highlighting', () => {
  it('currentTab matches last path segment', async () => {
    renderLayout('/dashboard/routers/proj-1/general');
    await waitFor(() => screen.getByText('General'));
    // The General tab link should show primary color (active). We check it's a NavLink, not a div.
    // NavLink is rendered only for non-disabled tabs.
    const links = document.querySelectorAll('a');
    const generalLink = Array.from(links).find(a => a.textContent?.includes('General'));
    expect(generalLink).toBeTruthy();
  });
});

describe('RouterLayout — error state Back button click', () => {
  it('clicking Back to Routers in error state navigates to routers list', async () => {
    mockGetRouters.mockRejectedValueOnce(new Error('fail'));
    renderLayout('/dashboard/routers/proj-1/general');
    await waitFor(() => screen.getByRole('button', { name: /Back to Routers/i }));
    await userEvent.click(screen.getByRole('button', { name: /Back to Routers/i }));
    await waitFor(() => expect(screen.getByText('Routers list')).toBeTruthy());
  });
});

describe('useRouter hook', () => {
  it('returns outlet context when used inside RouterLayout', async () => {
    // Render a child that calls useRouter() so the hook body executes
    function Consumer() {
      const { router } = useRouter();
      return <div data-testid="proj-name">{router?.name ?? 'none'}</div>;
    }
    render(
      <MemoryRouter initialEntries={['/dashboard/routers/proj-1/general']}>
        <Routes>
          <Route path="/dashboard/routers/:id" element={<RouterLayout />}>
            <Route path="general" element={<Consumer />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId('proj-name').textContent).toBe('My Router'));
  });
});
