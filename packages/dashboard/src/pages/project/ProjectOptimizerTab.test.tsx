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
  getOptimizerSamples: vi.fn(),
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

import { updateProject, getInstalledOptimizers, previewOptimizers, getProfiles, assignProjectProfiles, getOptimizerSamples } from '../../api';
import { useAuth } from '../../AuthContext';

const mockUpdateProject = vi.mocked(updateProject as (...a: unknown[]) => Promise<unknown>);
const mockGetInstalled = vi.mocked(getInstalledOptimizers as () => Promise<unknown>);
const mockPreview = vi.mocked(previewOptimizers as (...a: unknown[]) => Promise<unknown>);
const mockGetProfiles = vi.mocked(getProfiles as (...a: unknown[]) => Promise<unknown>);
const mockAssignProfile = vi.mocked(assignProjectProfiles as (...a: unknown[]) => Promise<unknown>);
const mockGetSamples = vi.mocked(getOptimizerSamples as (...a: unknown[]) => Promise<unknown>);
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
  mockGetSamples.mockResolvedValue([]);
  mockPreview.mockResolvedValue({
    estimatedTokensBefore: 100,
    estimatedTokensAfter: 60,
    perStep: [{ id: 'ccr', before: 100, after: 60, messages: [{ role: 'user', content: 'hello' }] }],
    messages: [{ role: 'user', content: 'hello' }],
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
    await waitFor(() => expect(screen.getByLabelText('Sample prompt')).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByLabelText('Sample prompt')).toBeInTheDocument());
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

// ── Replay of captured prompts and per-step diff (T63) ───────────────────────

const capturedSamples = [
  {
    capturedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    messages: [{ role: 'user', content: 'summarize the quarterly report' }],
    estimatedTokens: 812,
  },
  {
    capturedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'and then?' }],
    estimatedTokens: 40,
    truncated: true,
  },
];

describe('ProjectOptimizerTab — replay and diff', () => {
  it('explains the picker is empty until traffic arrives', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByLabelText('Prompt to preview')).toBeInTheDocument());
    expect(screen.getByText(/no recent prompts captured yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Sample prompt')).toBeInTheDocument();
  });

  it('lists the captured prompts with their size', async () => {
    mockGetSamples.mockResolvedValue(capturedSamples);
    renderTab();
    const select = await screen.findByLabelText('Prompt to preview');
    await waitFor(() => expect(select.querySelectorAll('option')).toHaveLength(4)); // placeholder + 'type below' + 2
    expect(screen.getByText(/5m ago · 812 tokens · 1 message$/)).toBeInTheDocument();
    expect(screen.getByText(/2h ago · 40 tokens · 2 messages$/)).toBeInTheDocument();
  });

  it('replays a captured prompt instead of the textarea', async () => {
    const user = userEvent.setup();
    mockGetSamples.mockResolvedValue(capturedSamples);
    renderTab();
    await user.selectOptions(await screen.findByLabelText('Prompt to preview'), '1');
    // The textarea gives way to a read-only excerpt of the captured prompt.
    expect(screen.queryByLabelText('Sample prompt')).not.toBeInTheDocument();
    expect(screen.getByText(/system: be brief/)).toBeInTheDocument();
    expect(screen.getByText(/\(excerpt\)/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /run preview/i }));
    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    const [body] = mockPreview.mock.calls[0] as [{ sampleMessages: unknown[] }];
    expect(body.sampleMessages).toEqual(capturedSamples[1]!.messages);
  });

  it('shows what a step removed when its row is expanded', async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValue({
      estimatedTokensBefore: 10,
      estimatedTokensAfter: 6,
      perStep: [{ id: 'ccr', before: 10, after: 6, messages: [{ role: 'user', content: 'keep this' }] }],
      messages: [{ role: 'user', content: 'keep this' }],
    });
    renderTab();
    await user.type(await screen.findByLabelText('Sample prompt'), 'keep this drop that');
    await user.click(screen.getByRole('button', { name: /run preview/i }));

    const row = await screen.findByRole('button', { name: /conversation context reduction/i });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    // The words the step dropped are rendered as a removal.
    const removed = Array.from(document.querySelectorAll('pre span'))
      .filter(s => (s as HTMLElement).style.textDecoration === 'line-through')
      .map(s => s.textContent)
      .join('');
    expect(removed).toContain('drop that');
    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  it('flags a step whose change was rolled back', async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValue({
      estimatedTokensBefore: 10,
      estimatedTokensAfter: 10,
      perStep: [{ id: 'ccr', before: 10, after: 10, messages: [{ role: 'user', content: 'untouched' }], rolledBack: true }],
      messages: [{ role: 'user', content: 'untouched' }],
    });
    renderTab();
    await user.type(await screen.findByLabelText('Sample prompt'), 'untouched');
    await user.click(screen.getByRole('button', { name: /run preview/i }));
    await waitFor(() => expect(screen.getByText(/rolled back: the change was rejected as unsafe/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /conversation context reduction/i }));
    expect(screen.getByText(/rolled back, so the prompt reached the next step untouched/i)).toBeInTheDocument();
  });

  it('survives a failed samples fetch', async () => {
    mockGetSamples.mockRejectedValue(new Error('nope'));
    renderTab();
    await waitFor(() => expect(screen.getByText(/no recent prompts captured yet/i)).toBeInTheDocument());
  });
});
