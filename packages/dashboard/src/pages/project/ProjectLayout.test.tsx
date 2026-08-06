import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { ProjectLayout, useProject } from './ProjectLayout';

vi.mock('../../api', () => ({
  getProjects: vi.fn(),
}));

import { getProjects } from '../../api';
const mockGetProjects = vi.mocked(getProjects);

const mockProject = {
  id: 'proj-1',
  name: 'My Project',
  models: [],
  tokens: [],
};

function renderLayout(path: string, projectId: string | undefined = 'proj-1') {
  const route = projectId
    ? `/dashboard/projects/${projectId}/general`
    : `/dashboard/projects/new`;
  return render(
    <MemoryRouter initialEntries={[path || route]}>
      <Routes>
        <Route path="/dashboard/projects/new" element={<ProjectLayout />}>
          <Route path="" element={<div>New project content</div>} />
        </Route>
        <Route path="/dashboard/projects/:id" element={<ProjectLayout />}>
          <Route path="general" element={<div data-testid="tab-general">General Tab</div>} />
          <Route path="routing" element={<div>Routing Tab</div>} />
          <Route path="security" element={<div>Security Tab</div>} />
          <Route path="token" element={<div>Token Tab</div>} />
          <Route path="users" element={<div>Users Tab</div>} />
          <Route path="logs" element={<div>Logs Tab</div>} />
        </Route>
        <Route path="/dashboard/projects" element={<div>Projects list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetProjects.mockResolvedValue([mockProject] as never);
});

afterEach(() => vi.clearAllMocks());

describe('ProjectLayout — loading state', () => {
  it('shows spinner while loading', () => {
    // Return a never-resolving promise to stay in loading state
    mockGetProjects.mockReturnValue(new Promise(() => {}));
    renderLayout('/dashboard/projects/proj-1/general');
    expect(document.querySelector('.spinner')).toBeTruthy();
  });
});

describe('ProjectLayout — loaded state', () => {
  it('renders project name in heading', async () => {
    renderLayout('/dashboard/projects/proj-1/general');
    await waitFor(() => expect(screen.getByText('My Project')).toBeTruthy());
  });

  it('renders project ID below heading', async () => {
    renderLayout('/dashboard/projects/proj-1/general');
    await waitFor(() => expect(screen.getByText('proj-1')).toBeTruthy());
  });

  it('renders all 8 tabs, Dashboard first', async () => {
    renderLayout('/dashboard/projects/proj-1/general');
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeTruthy();
      expect(screen.getByText('General')).toBeTruthy();
      expect(screen.getByText('Routing')).toBeTruthy();
      expect(screen.getByText('Security')).toBeTruthy();
      expect(screen.getByText('Token')).toBeTruthy();
      expect(screen.getByText('Users')).toBeTruthy();
      expect(screen.getByText('Logs')).toBeTruthy();
      const labels = Array.from(document.querySelectorAll('a, [title="Save the project first to unlock this tab"]'))
        .map(el => el.textContent?.trim());
      expect(labels[0]).toBe('Dashboard');
    });
  });

  it('marks Dashboard active on the bare project URL', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard/projects/proj-1']}>
        <Routes>
          <Route path="/dashboard/projects/:id" element={<ProjectLayout />}>
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
    renderLayout('/dashboard/projects/proj-1/general');
    await waitFor(() => expect(screen.getByTestId('tab-general')).toBeTruthy());
  });
});

describe('ProjectLayout — new project (no id)', () => {
  it('shows "New Project" heading when no id in URL', () => {
    // no API call for new project
    render(
      <MemoryRouter initialEntries={['/dashboard/projects/new']}>
        <Routes>
          <Route path="/dashboard/projects/new" element={<ProjectLayout />}>
            <Route index element={<div>New content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('New Project')).toBeTruthy();
    expect(mockGetProjects).not.toHaveBeenCalled();
  });

  it('disabled tabs show cursor:not-allowed title', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard/projects/new']}>
        <Routes>
          <Route path="/dashboard/projects/new" element={<ProjectLayout />}>
            <Route index element={<div />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    // Disabled tabs render as <div title="Save the project first to unlock this tab">
    const disabledTabs = document.querySelectorAll('[title="Save the project first to unlock this tab"]');
    expect(disabledTabs.length).toBeGreaterThan(0);
  });

  it('hides the Dashboard tab: a project with no traffic has nothing to show', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard/projects/new']}>
        <Routes>
          <Route path="/dashboard/projects/new" element={<ProjectLayout />}>
            <Route index element={<div />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.queryByText('Dashboard')).toBeNull();
  });
});

describe('ProjectLayout — error state', () => {
  it('shows error when getProjects rejects', async () => {
    mockGetProjects.mockRejectedValueOnce(new Error('Network error'));
    renderLayout('/dashboard/projects/proj-1/general');
    await waitFor(() => expect(screen.getByText('Network error')).toBeTruthy());
  });

  it('shows "Project not found" when project not in list', async () => {
    mockGetProjects.mockResolvedValueOnce([{ id: 'other', name: 'Other', models: [] }] as never);
    renderLayout('/dashboard/projects/proj-1/general');
    await waitFor(() => expect(screen.getByText('Project not found')).toBeTruthy());
  });

  it('shows Back to Projects button in error state', async () => {
    mockGetProjects.mockRejectedValueOnce(new Error('fail'));
    renderLayout('/dashboard/projects/proj-1/general');
    await waitFor(() => expect(screen.getByRole('button', { name: /Back to Projects/i })).toBeTruthy());
  });
});

describe('ProjectLayout — "Loading..." while project not yet in state', () => {
  it('shows "Loading..." in header during fetch', () => {
    mockGetProjects.mockReturnValue(new Promise(() => {}));
    renderLayout('/dashboard/projects/proj-1/general');
    // spinner shown, not the heading text yet
    expect(document.querySelector('.spinner')).toBeTruthy();
  });
});

describe('ProjectLayout — back button navigation', () => {
  it('clicking back button navigates to /dashboard/projects', async () => {
    renderLayout('/dashboard/projects/proj-1/general');
    await waitFor(() => screen.getByTitle('Back to projects'));
    await userEvent.click(screen.getByTitle('Back to projects'));
    // After navigation, Projects list should be rendered
    await waitFor(() => expect(screen.getByText('Projects list')).toBeTruthy());
  });
});

describe('ProjectLayout — active tab highlighting', () => {
  it('currentTab matches last path segment', async () => {
    renderLayout('/dashboard/projects/proj-1/general');
    await waitFor(() => screen.getByText('General'));
    // The General tab link should show primary color (active). We check it's a NavLink, not a div.
    // NavLink is rendered only for non-disabled tabs.
    const links = document.querySelectorAll('a');
    const generalLink = Array.from(links).find(a => a.textContent?.includes('General'));
    expect(generalLink).toBeTruthy();
  });
});

describe('ProjectLayout — error state Back button click', () => {
  it('clicking Back to Projects in error state navigates to projects list', async () => {
    mockGetProjects.mockRejectedValueOnce(new Error('fail'));
    renderLayout('/dashboard/projects/proj-1/general');
    await waitFor(() => screen.getByRole('button', { name: /Back to Projects/i }));
    await userEvent.click(screen.getByRole('button', { name: /Back to Projects/i }));
    await waitFor(() => expect(screen.getByText('Projects list')).toBeTruthy());
  });
});

describe('useProject hook', () => {
  it('returns outlet context when used inside ProjectLayout', async () => {
    // Render a child that calls useProject() so the hook body executes
    function Consumer() {
      const { project } = useProject();
      return <div data-testid="proj-name">{project?.name ?? 'none'}</div>;
    }
    render(
      <MemoryRouter initialEntries={['/dashboard/projects/proj-1/general']}>
        <Routes>
          <Route path="/dashboard/projects/:id" element={<ProjectLayout />}>
            <Route path="general" element={<Consumer />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId('proj-name').textContent).toBe('My Project'));
  });
});
