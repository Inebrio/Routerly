import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  getProjects: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock('../components/ConfirmDialog', () => ({
  ConfirmDialog: ({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) => (
    <div data-testid="confirm-dialog">
      <span>{message}</span>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

const navigateFn = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateFn };
});

import { ProjectsPage } from './ProjectsPage';
import { getProjects, deleteProject } from '../api';

const mockGetProjects  = vi.mocked(getProjects as () => Promise<unknown>);
const mockDeleteProject = vi.mocked(deleteProject as (...a: unknown[]) => Promise<unknown>);

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'My Project',
    models: [{ modelId: 'openai/gpt-4o' }],
    tokens: [{ id: 't1', name: 'tok' }],
    policies: [],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/projects']}>
      <ProjectsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetProjects.mockResolvedValue([]);
  mockDeleteProject.mockResolvedValue(undefined);
});

afterEach(() => { vi.clearAllMocks(); navigateFn.mockReset(); });

// ── Loading state ──────────────────────────────────────────────────────────────

describe('ProjectsPage — loading', () => {
  it('shows spinner while loading', () => {
    mockGetProjects.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(document.querySelector('.spinner')).toBeTruthy();
  });
});

// ── Empty state ────────────────────────────────────────────────────────────────

describe('ProjectsPage — empty state', () => {
  it('shows empty state when no projects', async () => {
    mockGetProjects.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('No projects yet.')).not.toBeNull());
  });

  it('shows 0 projects in toolbar', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('0 projects')).not.toBeNull());
  });
});

// ── Loaded with projects ───────────────────────────────────────────────────────

describe('ProjectsPage — loaded state', () => {
  it('renders project rows in table', async () => {
    mockGetProjects.mockResolvedValue([makeProject({ id: 'p1', name: 'Alpha' })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('Alpha')).not.toBeNull());
  });

  it('shows singular "1 project" in toolbar', async () => {
    mockGetProjects.mockResolvedValue([makeProject()]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('1 project')).not.toBeNull());
  });

  it('shows plural "2 projects" in toolbar', async () => {
    mockGetProjects.mockResolvedValue([makeProject({ id: 'p1', name: 'A' }), makeProject({ id: 'p2', name: 'B' })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('2 projects')).not.toBeNull());
  });

  it('shows token count', async () => {
    mockGetProjects.mockResolvedValue([makeProject({ tokens: [{ id: 't1' }, { id: 't2' }] })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('2 tokens')).not.toBeNull());
  });

  it('shows singular "1 token"', async () => {
    mockGetProjects.mockResolvedValue([makeProject({ tokens: [{ id: 't1' }] })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('1 token')).not.toBeNull());
  });

  it('shows "0 tokens" when tokens array is missing', async () => {
    mockGetProjects.mockResolvedValue([makeProject({ tokens: undefined })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('0 tokens')).not.toBeNull());
  });

  it('shows model IDs joined', async () => {
    mockGetProjects.mockResolvedValue([makeProject({ models: [{ modelId: 'openai/gpt-4o' }, { modelId: 'anthropic/claude-3' }] })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('openai/gpt-4o, anthropic/claude-3')).not.toBeNull());
  });

  it('renders enabled policy badges', async () => {
    mockGetProjects.mockResolvedValue([makeProject({
      policies: [{ type: 'budget', enabled: true }, { type: 'ratelimit', enabled: false }],
    })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('budget')).not.toBeNull());
    expect(screen.queryByText('ratelimit')).toBeNull();
  });

  it('shows dash when no enabled policies', async () => {
    mockGetProjects.mockResolvedValue([makeProject({ policies: [{ type: 'ratelimit', enabled: false }] })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('—')).not.toBeNull());
  });
});

// ── Navigation ────────────────────────────────────────────────────────────────

describe('ProjectsPage — navigation', () => {
  it('navigates to new project on button click', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /New Project/ }));
    await userEvent.click(screen.getByRole('button', { name: /New Project/ }));
    expect(navigateFn).toHaveBeenCalledWith('/dashboard/projects/new');
  });

  it('navigates to project detail on edit click', async () => {
    mockGetProjects.mockResolvedValue([makeProject({ id: 'p1', name: 'Alpha' })]);
    renderPage();
    await waitFor(() => screen.getByTitle('Edit project'));
    await userEvent.click(screen.getByTitle('Edit project'));
    expect(navigateFn).toHaveBeenCalledWith('/dashboard/projects/p1');
  });

  it('navigates to project detail on row click', async () => {
    mockGetProjects.mockResolvedValue([makeProject({ id: 'p1', name: 'Alpha' })]);
    renderPage();
    await waitFor(() => screen.getByText('Alpha'));
    await userEvent.click(screen.getByText('Alpha'));
    expect(navigateFn).toHaveBeenCalledWith('/dashboard/projects/p1');
  });
});

// ── Delete flow ────────────────────────────────────────────────────────────────

describe('ProjectsPage — delete flow', () => {
  it('shows confirm dialog when delete clicked', async () => {
    mockGetProjects.mockResolvedValue([makeProject()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Delete project'));
    await userEvent.click(screen.getByTitle('Delete project'));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeNull());
    expect(screen.queryByText('Delete this project?')).not.toBeNull();
  });

  it('dismisses dialog on cancel', async () => {
    mockGetProjects.mockResolvedValue([makeProject()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Delete project'));
    await userEvent.click(screen.getByTitle('Delete project'));
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    expect(mockDeleteProject).not.toHaveBeenCalled();
  });

  it('removes project from list after confirmed delete', async () => {
    mockGetProjects.mockResolvedValue([makeProject({ id: 'p1', name: 'Alpha' })]);
    renderPage();
    await waitFor(() => screen.getByTitle('Delete project'));
    await userEvent.click(screen.getByTitle('Delete project'));
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
    expect(mockDeleteProject).toHaveBeenCalledWith('p1');
  });

  it('shows error when deleteProject throws', async () => {
    mockGetProjects.mockResolvedValue([makeProject()]);
    mockDeleteProject.mockRejectedValue(new Error('Server error'));
    renderPage();
    await waitFor(() => screen.getByTitle('Delete project'));
    await userEvent.click(screen.getByTitle('Delete project'));
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByText('Server error')).not.toBeNull());
  });

  it('shows generic error when deleteProject throws non-Error', async () => {
    mockGetProjects.mockResolvedValue([makeProject()]);
    mockDeleteProject.mockRejectedValue('boom');
    renderPage();
    await waitFor(() => screen.getByTitle('Delete project'));
    await userEvent.click(screen.getByTitle('Delete project'));
    await waitFor(() => screen.getByTestId('confirm-dialog'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByText('Error deleting project')).not.toBeNull());
  });
});
