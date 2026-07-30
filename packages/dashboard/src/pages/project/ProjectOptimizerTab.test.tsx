import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { ProjectOptimizerTab } from './ProjectOptimizerTab';

vi.mock('../../api', () => ({
  updateProject: vi.fn(),
  getInstalledOptimizers: vi.fn(),
  previewOptimizers: vi.fn(),
}));

vi.mock('../../AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { updateProject, getInstalledOptimizers, previewOptimizers } from '../../api';
import { useAuth } from '../../AuthContext';

const mockUpdateProject = vi.mocked(updateProject as (...a: unknown[]) => Promise<unknown>);
const mockGetInstalled = vi.mocked(getInstalledOptimizers as () => Promise<unknown>);
const mockPreview = vi.mocked(previewOptimizers as (...a: unknown[]) => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);

const installed = [
  { id: 'session-dedup', klass: 'lossless', installed: true },
  { id: 'ccr', klass: 'recoverable', installed: true },
  { id: 'caveman', klass: 'lossy', installed: true },
];

const mockProject = {
  id: 'proj-1',
  name: 'Test',
  models: [{ modelId: 'openai/gpt-4o' }],
  optimizers: { steps: [{ id: 'ccr', enabled: true, threshold: 6 }] },
};

const setProject = vi.fn();

function renderTab(project: Record<string, unknown> = mockProject) {
  function LayoutWrapper() {
    return <Outlet context={{ project, setProject }} />;
  }
  return render(
    <MemoryRouter initialEntries={['/dashboard/projects/proj-1/optimizer']}>
      <Routes>
        <Route path="/dashboard/projects/:id" element={<LayoutWrapper />}>
          <Route path="optimizer" element={<ProjectOptimizerTab />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

function setAuth(perms: string[]) {
  mockUseAuth.mockReturnValue({
    can: vi.fn((p: string) => perms.includes(p)),
  } as unknown as ReturnType<typeof useAuth>);
}

beforeEach(() => {
  mockGetInstalled.mockResolvedValue(installed);
  mockUpdateProject.mockResolvedValue({ ...mockProject });
  mockPreview.mockResolvedValue({
    estimatedTokensBefore: 100,
    estimatedTokensAfter: 60,
    perStep: [{ id: 'ccr', before: 100, after: 60 }],
  });
  setAuth(['optimizers:read', 'optimizers:manage']);
});

afterEach(() => vi.clearAllMocks());

describe('ProjectOptimizerTab', () => {
  it('renders installed optimizers merged with configured steps, configured first', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Conversation Context Reduction')).toBeInTheDocument());
    // configured ccr is enabled, its threshold is shown
    const cbs = screen.getAllByRole('checkbox');
    expect(cbs[0]).toBeChecked(); // ccr first (configured), enabled
    expect(screen.getByDisplayValue('6')).toBeInTheDocument();
    // extras appended, disabled
    expect(screen.getByText('Session Dedup')).toBeInTheDocument();
    expect(screen.getByText('Caveman')).toBeInTheDocument();
  });

  it('shows loading then content', async () => {
    renderTab();
    expect(document.querySelector('.spinner')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Optimizers')).toBeInTheDocument());
  });

  it('toggling and saving calls updateProject with the built steps', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByText('Session Dedup')).toBeInTheDocument());
    // enable session-dedup (3rd row: ccr, session-dedup, caveman)
    const cbs = screen.getAllByRole('checkbox');
    await user.click(cbs[1]!); // session-dedup
    await user.click(screen.getByRole('button', { name: /save optimizers/i }));
    await waitFor(() => expect(mockUpdateProject).toHaveBeenCalled());
    const [, payload] = mockUpdateProject.mock.calls[0] as [string, { optimizers: { steps: unknown[] } }];
    expect(payload.optimizers.steps).toEqual([
      { id: 'ccr', enabled: true, threshold: 6 },
      { id: 'session-dedup', enabled: true },
    ]);
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
  });

  it('preview panel renders the returned before/after deltas', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByLabelText(/preview token savings/i)).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText(/sample user message/i), 'hello world');
    await user.click(screen.getByRole('button', { name: /run preview/i }));
    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    // 100 (before) and 60 (after) appear in both the summary and per-step row
    expect(screen.getAllByText('100').length).toBeGreaterThan(0);
    expect(screen.getAllByText('60').length).toBeGreaterThan(0);
    // saved delta 40 shown in the summary
    expect(screen.getAllByText(/40/).length).toBeGreaterThan(0);
  });

  it('hides edit controls without optimizers:manage', async () => {
    setAuth(['optimizers:read']);
    renderTab();
    await waitFor(() => expect(screen.getByText('Conversation Context Reduction')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /save optimizers/i })).not.toBeInTheDocument();
    // checkboxes disabled
    expect(screen.getAllByRole('checkbox')[0]).toBeDisabled();
  });

  it('shows permission gate without optimizers:read', async () => {
    setAuth([]);
    renderTab();
    await waitFor(() => expect(screen.getByText(/don't have permission to view optimizers/i)).toBeInTheDocument());
  });

  it('shows empty state when no optimizers installed and none configured', async () => {
    mockGetInstalled.mockResolvedValue([]);
    renderTab({ id: 'proj-1', name: 'Test', models: [] });
    await waitFor(() => expect(screen.getByText(/no optimizers installed/i)).toBeInTheDocument());
  });

  it('surfaces preview errors', async () => {
    const user = userEvent.setup();
    mockPreview.mockRejectedValue(new Error('boom'));
    renderTab();
    await waitFor(() => expect(screen.getByLabelText(/preview token savings/i)).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText(/sample user message/i), 'hi');
    await user.click(screen.getByRole('button', { name: /run preview/i }));
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
  });

  it('surfaces save errors', async () => {
    const user = userEvent.setup();
    mockUpdateProject.mockRejectedValue(new Error('save failed'));
    renderTab();
    await waitFor(() => expect(screen.getByRole('button', { name: /save optimizers/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /save optimizers/i }));
    await waitFor(() => expect(screen.getByText('save failed')).toBeInTheDocument());
  });
});
