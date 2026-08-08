import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { RouterOptimizerTab } from './RouterOptimizerTab';

vi.mock('../../api', () => ({
  updateRouter: vi.fn(),
  getInstalledOptimizers: vi.fn(),
  previewOptimizers: vi.fn(),
  getProfiles: vi.fn(),
  assignRouterProfiles: vi.fn(),
  getModels: vi.fn(),
  getLlmLinguaModel: vi.fn(),
  installLlmLinguaModel: vi.fn(),
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

import { updateRouter, getInstalledOptimizers, previewOptimizers, getProfiles, assignRouterProfiles, getModels, getLlmLinguaModel } from '../../api';
import { optimizerFixture } from '@routerly/shared';
import { useAuth } from '../../AuthContext';

const mockUpdateRouter = vi.mocked(updateRouter as (...a: unknown[]) => Promise<unknown>);
const mockGetInstalled = vi.mocked(getInstalledOptimizers as () => Promise<unknown>);
const mockPreview = vi.mocked(previewOptimizers as (...a: unknown[]) => Promise<unknown>);
const mockGetProfiles = vi.mocked(getProfiles as (...a: unknown[]) => Promise<unknown>);
const mockAssignProfile = vi.mocked(assignRouterProfiles as (...a: unknown[]) => Promise<unknown>);
const mockGetModels = vi.mocked(getModels as () => Promise<unknown>);
const mockGetModel = vi.mocked(getLlmLinguaModel as (...a: unknown[]) => Promise<unknown>);

const checkpoint = {
  key: 'bert-multilingual-q8',
  label: 'BERT multilingual, quantized',
  repo: 'org/repo',
  dtype: 'q8',
  sizeMb: 182,
  license: 'Apache-2.0.',
  note: 'The default.',
  isDefault: true,
};
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

const mockRouter = {
  id: 'proj-1',
  name: 'Test',
  models: [{ modelId: 'openai/gpt-4o' }],
  optimizers: { steps: [{ id: 'ccr', enabled: true, threshold: 6 }] },
};

const setRouter = vi.fn();

function renderTab(router: Record<string, unknown> = mockRouter) {
  function LayoutWrapper() {
    return <Outlet context={{ router, setRouter }} />;
  }
  return render(
    <MemoryRouter initialEntries={['/dashboard/routers/proj-1/optimizer']}>
      <Routes>
        <Route path="/dashboard/routers/:id" element={<LayoutWrapper />}>
          <Route path="optimizer" element={<RouterOptimizerTab />} />
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
  mockAssignProfile.mockResolvedValue({ ...mockRouter });
  mockUpdateRouter.mockResolvedValue({ ...mockRouter });
  mockGetModels.mockResolvedValue([{ id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai', endpoint: '', cost: { inputPerMillion: 0, outputPerMillion: 0 }, contextWindow: 128000 }]);
  mockGetModel.mockResolvedValue({ runtimeInstalled: false, checkpoints: [{ ...checkpoint, state: 'absent' }] });
  mockPreview.mockResolvedValue({
    estimatedTokensBefore: 100,
    estimatedTokensAfter: 60,
    perStep: [{ id: 'ccr', before: 100, after: 60, messages: [{ role: 'user', content: 'hello' }] }],
    messages: [{ role: 'user', content: 'hello' }],
  });
  setAuth(['optimizers:read', 'optimizers:manage']);
});

afterEach(() => vi.clearAllMocks());

describe('RouterOptimizerTab', () => {
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

  it('toggling and saving calls updateRouter with the built steps', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByText('Session Dedup')).toBeInTheDocument());
    // enable session-dedup (3rd row: ccr, session-dedup, caveman)
    const cbs = screen.getAllByRole('checkbox');
    await user.click(cbs[1]!); // session-dedup
    await user.click(screen.getByRole('button', { name: /save optimizers/i }));
    await waitFor(() => expect(mockUpdateRouter).toHaveBeenCalled());
    const [, payload] = mockUpdateRouter.mock.calls[0] as [string, { optimizers: { steps: unknown[] } }];
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
    mockUpdateRouter.mockRejectedValue(new Error('save failed'));
    renderTab();
    await waitFor(() => expect(screen.getByRole('button', { name: /save optimizers/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /save optimizers/i }));
    await waitFor(() => expect(screen.getByText('save failed')).toBeInTheDocument());
  });
});

// ── Profile assignment ───────────────────────────────────────────────────────

const assignedRouter = { ...mockRouter, optimizerProfileId: 'optimizer-safe' };

/** Like renderTab, but keeps the router in state so setRouter re-renders the tab. */
function renderStatefulTab(initial: Record<string, unknown>) {
  function LayoutWrapper() {
    const [router, setRouter] = React.useState(initial);
    return <Outlet context={{ router, setRouter }} />;
  }
  return render(
    <MemoryRouter initialEntries={['/dashboard/routers/proj-1/optimizer']}>
      <Routes>
        <Route path="/dashboard/routers/:id" element={<LayoutWrapper />}>
          <Route path="optimizer" element={<RouterOptimizerTab />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('RouterOptimizerTab — optimizer profile assignment', () => {
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
    renderTab(assignedRouter);
    await waitFor(() => expect(screen.getByLabelText('Optimizer Profile')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /save optimizers/i })).not.toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('Session Dedup');
  });

  it('lists built-in and user profiles in the select', async () => {
    renderTab(assignedRouter);
    const select = await screen.findByLabelText('Optimizer Profile');
    const labels = Array.from(select.querySelectorAll('option')).map(o => o.textContent);
    expect(labels).toContain('Safe (built-in)');
    expect(labels).toContain('My Pipeline');
  });

  it('selecting another profile reassigns it', async () => {
    const user = userEvent.setup();
    renderTab(assignedRouter);
    const select = await screen.findByLabelText('Optimizer Profile');
    await user.selectOptions(select, 'custom-opt');
    await waitFor(() => expect(mockAssignProfile).toHaveBeenCalledWith('proj-1', { optimizer: 'custom-opt' }));
  });

  it('switching to Custom clears the profile and prefills its steps', async () => {
    const user = userEvent.setup();
    mockAssignProfile.mockResolvedValue({ ...mockRouter, optimizers: { steps: [] } });
    renderStatefulTab(assignedRouter);
    await waitFor(() => expect(screen.getByLabelText('Optimizer Profile')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    await waitFor(() => expect(mockAssignProfile).toHaveBeenCalledWith('proj-1', { optimizer: null }));
    // The profile's enabled session-dedup step is now this router's own first row.
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
    renderTab(assignedRouter);
    const select = await screen.findByLabelText('Optimizer Profile');
    expect(Array.from(select.querySelectorAll('option')).map(o => (o as HTMLOptionElement).value)).toEqual(['']);
  });
});

// ── Fixture preview and per-step diff (T63) ──────────────────────────────────

describe('RouterOptimizerTab — fixtures and diff', () => {
  it('offers the shipped conversations and says real prompts are not recorded', async () => {
    renderTab();
    const select = await screen.findByLabelText('Prompt to preview');
    // placeholder + 'type below' + the four shipped fixtures
    await waitFor(() => expect(select.querySelectorAll('option')).toHaveLength(6));
    expect(screen.getByText(/routerly does not record real prompts/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Sample prompt')).toBeInTheDocument();
  });

  it('previews a shipped conversation instead of the textarea', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.selectOptions(await screen.findByLabelText('Prompt to preview'), 'support-chat-en');
    // The textarea gives way to a read-only rendering of the fixture.
    expect(screen.queryByLabelText('Sample prompt')).not.toBeInTheDocument();
    expect(screen.getByText(/exercises session-dedup, ccr, rtk, relevance and caveman/i)).toBeInTheDocument();
    expect(screen.getByText(/system: You are a customer care agent for Northwind Supply/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /run preview/i }));
    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    const [body] = mockPreview.mock.calls[0] as [{ sampleMessages: { role: string }[] }];
    expect(body.sampleMessages).toEqual(optimizerFixture('support-chat-en')!.messages);
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

  it('explains a step that never ran, so a zero saving is not a mystery', async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValue({
      estimatedTokensBefore: 10,
      estimatedTokensAfter: 10,
      perStep: [{
        id: 'ccr', before: 10, after: 10, messages: [{ role: 'user', content: 'untouched' }],
        skipReason: 'the conversation is shorter than the 3 turn window',
      }],
      messages: [{ role: 'user', content: 'untouched' }],
    });
    renderTab();
    await user.type(await screen.findByLabelText('Sample prompt'), 'untouched');
    await user.click(screen.getByRole('button', { name: /run preview/i }));
    await waitFor(() => expect(screen.getByText(/skipped: the conversation is shorter than the 3 turn window/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /conversation context reduction/i }));
    expect(screen.getByText(/this step did not run: the conversation is shorter/i)).toBeInTheDocument();
  });

  it('survives a failed model fetch', async () => {
    mockGetModel.mockRejectedValue(new Error('nope'));
    renderTab();
    await waitFor(() => expect(screen.getByLabelText('Prompt to preview')).toBeInTheDocument());
    expect(screen.queryByText(/checkpoints on the service host/i)).not.toBeInTheDocument();
  });
});

// ── The model the sample is addressed to ─────────────────────────────────────

describe('RouterOptimizerTab — preview model', () => {
  it('offers the router models with their context window', async () => {
    renderTab();
    const select = await screen.findByLabelText('Model to preview against');
    await waitFor(() => expect(screen.getByText('openai/gpt-4o (128k context)')).toBeInTheDocument());
    // placeholder + 'no model' + the one router model
    expect(select.querySelectorAll('option')).toHaveLength(3);
  });

  it('sends the picked model, so context-window steps have a window to fit', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.selectOptions(await screen.findByLabelText('Model to preview against'), 'openai/gpt-4o');
    await user.type(screen.getByLabelText('Sample prompt'), 'hello');
    await user.click(screen.getByRole('button', { name: /run preview/i }));
    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    expect((mockPreview.mock.calls[0] as [{ model?: string }])[0].model).toBe('openai/gpt-4o');
  });

  it('omits the model when none is picked', async () => {
    const user = userEvent.setup();
    renderTab();
    await user.type(await screen.findByLabelText('Sample prompt'), 'hello');
    await user.click(screen.getByRole('button', { name: /run preview/i }));
    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    expect((mockPreview.mock.calls[0] as [{ model?: string }])[0]).not.toHaveProperty('model');
  });
});

// ── The optional LLMLingua-2 checkpoint, rendered inside its own row ─────────

describe('RouterOptimizerTab — llmlingua-2 checkpoints', () => {
  const withStep = {
    ...mockRouter,
    optimizers: { steps: [{ id: 'llmlingua-2', enabled: true }] },
  };

  it('says nothing about checkpoints when the pipeline does not list the step', async () => {
    mockGetModel.mockResolvedValue({ runtimeInstalled: true, checkpoints: [{ ...checkpoint, state: 'ready' }] });
    renderTab();
    await waitFor(() => expect(screen.getByLabelText('Prompt to preview')).toBeInTheDocument());
    expect(screen.queryByText(/checkpoints on the service host/i)).not.toBeInTheDocument();
  });

  it('puts the checkpoints inside the llmlingua-2 row, not in a box of their own', async () => {
    mockGetModel.mockResolvedValue({ runtimeInstalled: true, checkpoints: [{ ...checkpoint, state: 'ready' }] });
    renderTab(withStep);
    const panel = await screen.findByText(/checkpoints on the service host/i);
    expect(document.querySelector('[data-testid="optimizer-row-body-llmlingua-2"]')).toContainElement(panel);
  });

  it('saves the picked checkpoint on the step', async () => {
    const user = userEvent.setup();
    mockGetModel.mockResolvedValue({
      runtimeInstalled: true,
      checkpoints: [
        { ...checkpoint, state: 'ready' },
        { ...checkpoint, key: 'xlm-roberta-large-int8', label: 'XLM-RoBERTa large, int8', isDefault: false, state: 'ready' },
      ],
    });
    renderTab(withStep);
    await user.selectOptions(await screen.findByLabelText('LLMLingua-2 checkpoint'), 'xlm-roberta-large-int8');
    await user.click(screen.getByRole('button', { name: /save optimizers/i }));
    await waitFor(() => expect(mockUpdateRouter).toHaveBeenCalled());
    const [, payload] = mockUpdateRouter.mock.calls[0] as [string, { optimizers: { steps: unknown[] } }];
    expect(payload.optimizers.steps[0]).toEqual({ id: 'llmlingua-2', enabled: true, model: 'xlm-roberta-large-int8' });
  });
});
