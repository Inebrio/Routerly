import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { ProjectOptimizerTab } from './ProjectOptimizerTab';

vi.mock('../../api', () => ({
  updateProject: vi.fn(),
  getInstalledOptimizers: vi.fn(),
  previewOptimizers: vi.fn(),
  getProfiles: vi.fn(),
  assignProjectProfiles: vi.fn(),
}));

vi.mock('../../AuthContext', () => ({
  useAuth: vi.fn(),
}));

// ponytail: mock SearchableSelect as a plain <select> so onChange fires on selectOptions
vi.mock('../../components/SearchableSelect', () => ({
  SearchableSelect: ({
    options,
    value,
    onChange,
    ariaLabel,
    disabled,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    ariaLabel?: string;
    disabled?: boolean;
  }) => (
    <select aria-label={ariaLabel ?? 'select'} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>
      <option value="">—</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import { updateProject, getInstalledOptimizers, previewOptimizers, getProfiles, assignProjectProfiles } from '../../api';
import { useAuth } from '../../AuthContext';

const mockUpdateProject = vi.mocked(updateProject as (...a: unknown[]) => Promise<unknown>);
const mockGetInstalled = vi.mocked(getInstalledOptimizers as () => Promise<unknown>);
const mockPreview = vi.mocked(previewOptimizers as (...a: unknown[]) => Promise<unknown>);
const mockGetProfiles = vi.mocked(getProfiles as (...a: unknown[]) => Promise<unknown>);
const mockAssignProfile = vi.mocked(assignProjectProfiles as (...a: unknown[]) => Promise<unknown>);
const mockUseAuth = vi.mocked(useAuth);

const sampleProfiles = [
  {
    id: 'optimizer-safe',
    kind: 'optimizer',
    version: 1,
    label: 'Safe',
    builtin: true,
    optimizers: { steps: [{ id: 'session-dedup', enabled: true }] },
  },
  {
    id: 'custom-opt',
    kind: 'optimizer',
    version: 1,
    label: 'My Pipeline',
    builtin: false,
    optimizers: { steps: [{ id: 'ccr', enabled: true, threshold: 4 }] },
  },
];

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
  mockGetProfiles.mockResolvedValue(sampleProfiles);
  mockAssignProfile.mockResolvedValue({ ...mockProject });
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

// ── Profile assignment ───────────────────────────────────────────────────────

const assignedProject = { ...mockProject, optimizerProfileId: 'optimizer-safe' };

/** Like renderTab, but keeps the project in state so setProject re-renders the tab. */
function renderStatefulTab(initial: Record<string, unknown>) {
  function LayoutWrapper() {
    const [project, setProject] = React.useState(initial);
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

describe('ProjectOptimizerTab — optimizer profile assignment', () => {
  it('starts in custom mode: steps editor and save button visible', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Conversation Context Reduction')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /save optimizers/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Optimizer Profile')).not.toBeInTheDocument();
  });

  it('switching to Profile assigns the first built-in profile', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByText('Conversation Context Reduction')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Profile' }));
    await waitFor(() => expect(mockAssignProfile).toHaveBeenCalledWith('proj-1', { optimizer: 'optimizer-safe' }));
  });

  it('falls back to the first user profile when no built-in exists', async () => {
    const user = userEvent.setup();
    mockGetProfiles.mockResolvedValue([sampleProfiles[1]]);
    renderTab();
    await waitFor(() => expect(screen.getByText('Conversation Context Reduction')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Profile' }));
    await waitFor(() => expect(mockAssignProfile).toHaveBeenCalledWith('proj-1', { optimizer: 'custom-opt' }));
  });

  it('reports an error when no optimizer profile exists', async () => {
    const user = userEvent.setup();
    mockGetProfiles.mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(screen.getByText('Conversation Context Reduction')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Profile' }));
    await waitFor(() => expect(screen.getByText(/No optimizer profile available/)).toBeInTheDocument());
    expect(mockAssignProfile).not.toHaveBeenCalled();
  });

  it('while assigned, hides the editor and lists the profile steps', async () => {
    renderTab(assignedProject);
    await waitFor(() => expect(screen.getByLabelText('Optimizer Profile')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /save optimizers/i })).not.toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('Session Dedup');
  });

  it('lists built-in and user profiles in the select', async () => {
    renderTab(assignedProject);
    const select = await screen.findByLabelText('Optimizer Profile');
    const labels = Array.from(select.querySelectorAll('option')).map(o => o.textContent);
    expect(labels).toContain('Safe (built-in)');
    expect(labels).toContain('My Pipeline');
  });

  it('selecting another profile reassigns it', async () => {
    const user = userEvent.setup();
    renderTab(assignedProject);
    const select = await screen.findByLabelText('Optimizer Profile');
    await user.selectOptions(select, 'custom-opt');
    await waitFor(() => expect(mockAssignProfile).toHaveBeenCalledWith('proj-1', { optimizer: 'custom-opt' }));
  });

  it('switching to Custom clears the profile and prefills its steps', async () => {
    const user = userEvent.setup();
    mockAssignProfile.mockResolvedValue({ ...mockProject, optimizers: { steps: [] } });
    renderStatefulTab(assignedProject);
    await waitFor(() => expect(screen.getByLabelText('Optimizer Profile')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    await waitFor(() => expect(mockAssignProfile).toHaveBeenCalledWith('proj-1', { optimizer: null }));
    // The profile's enabled session-dedup step is now this project's own first row.
    await waitFor(() => expect(screen.getAllByRole('checkbox')[0]).toBeChecked());
    expect(screen.getAllByText(/Session Dedup/)[0]).toBeInTheDocument();
  });

  it('clicking the already active mode does nothing', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByText('Conversation Context Reduction')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    expect(mockAssignProfile).not.toHaveBeenCalled();
  });

  it('surfaces assignment errors', async () => {
    const user = userEvent.setup();
    mockAssignProfile.mockRejectedValue(new Error('assign boom'));
    renderTab();
    await waitFor(() => expect(screen.getByText('Conversation Context Reduction')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Profile' }));
    await waitFor(() => expect(screen.getByText('assign boom')).toBeInTheDocument());
  });

  it('hides the mode switch without optimizers:manage', async () => {
    setAuth(['optimizers:read']);
    renderTab();
    await waitFor(() => expect(screen.getByText('Conversation Context Reduction')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Profile' })).not.toBeInTheDocument();
  });

  it('a failed profiles fetch leaves the profile list empty', async () => {
    mockGetProfiles.mockRejectedValue(new Error('nope'));
    renderTab(assignedProject);
    const select = await screen.findByLabelText('Optimizer Profile');
    expect(Array.from(select.querySelectorAll('option')).map(o => (o as HTMLOptionElement).value)).toEqual(['']);
  });
});
