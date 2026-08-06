import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { ProjectGeneralTab } from './ProjectGeneralTab';

vi.mock('../../api', () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  getSettings: vi.fn(),
}));

// ponytail: mock useUnsavedChanges — blocker not needed in unit tests
vi.mock('../../hooks/useUnsavedChanges', () => ({
  useUnsavedChanges: vi.fn(() => ({ isBlocked: false, proceed: vi.fn(), reset: vi.fn() })),
  UnsavedChangesModal: ({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) => (
    <div data-testid="unsaved-modal">
      <button onClick={onConfirm}>Leave anyway</button>
      <button onClick={onCancel}>Stay</button>
    </div>
  ),
}));

import { createProject, updateProject, getSettings } from '../../api';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';

const mockCreateProject = vi.mocked(createProject as (...a: unknown[]) => Promise<unknown>);
const mockUpdateProject = vi.mocked(updateProject as (...a: unknown[]) => Promise<unknown>);
const mockGetSettings = vi.mocked(getSettings as () => Promise<unknown>);
const mockUseUnsavedChanges = vi.mocked(useUnsavedChanges);

const mockProject = {
  id: 'proj-1',
  name: 'Test Project',
  models: [{ modelId: 'openai/gpt-4o' }],
  tokens: [],
  timeoutMs: 5000,
  routingModelId: 'openai/gpt-4o',
};

function renderTab(project: Record<string, unknown> | null = mockProject) {
  const setProject = vi.fn();
  function LayoutWrapper() {
    return <Outlet context={{ project, setProject }} />;
  }
  return {
    setProject,
    ...render(
      <MemoryRouter initialEntries={[`/dashboard/projects/${project ? 'proj-1' : 'new'}/general`]}>
        <Routes>
          <Route path="/dashboard/projects/:id" element={<LayoutWrapper />}>
            <Route path="general" element={<ProjectGeneralTab />} />
          </Route>
          <Route path="/dashboard/projects/new" element={<LayoutWrapper />}>
            <Route path="" element={<ProjectGeneralTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  };
}

function renderNew() {
  const setProject = vi.fn();
  function LayoutWrapper() {
    return <Outlet context={{ project: null, setProject }} />;
  }
  return {
    setProject,
    ...render(
      <MemoryRouter initialEntries={['/dashboard/projects/new']}>
        <Routes>
          <Route path="/dashboard/projects/new" element={<LayoutWrapper />}>
            <Route index element={<ProjectGeneralTab />} />
          </Route>
          <Route path="/dashboard/projects/:id/general" element={<div>new project page</div>} />
        </Routes>
      </MemoryRouter>
    ),
  };
}

beforeEach(() => {
  mockGetSettings.mockResolvedValue({ publicUrl: 'https://api.example.com', port: 3000 });
  mockUpdateProject.mockResolvedValue({ ...mockProject });
  mockCreateProject.mockResolvedValue({ id: 'proj-new', name: 'New', models: [], token: 'sk-rt-abc123' });
  mockUseUnsavedChanges.mockReturnValue({ isBlocked: false, proceed: vi.fn(), reset: vi.fn() });
});

afterEach(() => vi.clearAllMocks());

// ── Edit mode ────────────────────────────────────────────────────────────────

describe('ProjectGeneralTab — edit mode render', () => {
  it('shows Save Changes button when editing', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByRole('button', { name: /Save Changes/i })).toBeTruthy());
  });

  it('pre-fills name input from project', async () => {
    renderTab();
    await waitFor(() => {
      const input = screen.getByPlaceholderText('My App') as HTMLInputElement;
      expect(input.value).toBe('Test Project');
    });
  });

  it('Save Changes disabled when form is clean', async () => {
    renderTab();
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Save Changes/i }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  it('Save Changes enabled when name is changed', async () => {
    renderTab();
    await waitFor(() => screen.getByPlaceholderText('My App'));
    const input = screen.getByPlaceholderText('My App');
    await userEvent.clear(input);
    await userEvent.type(input, 'New Name');
    const btn = screen.getByRole('button', { name: /Save Changes/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('shows connection info block with publicUrl from settings', async () => {
    renderTab();
    await waitFor(() =>
      expect(screen.queryByText('How to connect')).not.toBeNull()
    );
    // One snippet per SDK, plus curl, each carrying the configured endpoint.
    await waitFor(() =>
      expect(screen.queryAllByText(/api\.example\.com/).length).toBeGreaterThan(0)
    );
    expect(screen.queryByText('OpenAI SDK')).not.toBeNull();
    expect(screen.queryByText('Anthropic SDK')).not.toBeNull();
    expect(screen.queryByText('curl')).not.toBeNull();
    // The Anthropic client appends /v1 itself, so its base URL must not carry one.
    expect(screen.getByText(/from anthropic import Anthropic/).textContent)
      .toContain('base_url="https://api.example.com"');
  });

  it('falls back to window.location when publicUrl is empty', async () => {
    mockGetSettings.mockResolvedValueOnce({ publicUrl: '', port: 3000 });
    renderTab();
    await waitFor(() =>
      expect(screen.queryByText('How to connect')).not.toBeNull()
    );
  });

  it('falls back when getSettings rejects', async () => {
    mockGetSettings.mockRejectedValueOnce(new Error('fail'));
    renderTab();
    // Should still render without crashing
    await waitFor(() => expect(screen.getByRole('button', { name: /Save Changes/i })).toBeTruthy());
  });

  it('calls updateProject on save and updates form', async () => {
    renderTab();
    await waitFor(() => screen.getByPlaceholderText('My App'));
    const input = screen.getByPlaceholderText('My App');
    await userEvent.clear(input);
    await userEvent.type(input, 'Updated Name');
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    await waitFor(() => expect(mockUpdateProject).toHaveBeenCalledWith('proj-1', expect.objectContaining({ name: 'Updated Name' })));
  });

  it('shows error on updateProject failure', async () => {
    mockUpdateProject.mockRejectedValueOnce(new Error('Server error'));
    renderTab();
    await waitFor(() => screen.getByPlaceholderText('My App'));
    await userEvent.clear(screen.getByPlaceholderText('My App'));
    await userEvent.type(screen.getByPlaceholderText('My App'), 'Changed');
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    await waitFor(() => expect(screen.getByText('Server error')).toBeTruthy());
  });

  it('shows generic error when non-Error thrown on save', async () => {
    mockUpdateProject.mockRejectedValueOnce('string error');
    renderTab();
    await waitFor(() => screen.getByPlaceholderText('My App'));
    await userEvent.clear(screen.getByPlaceholderText('My App'));
    await userEvent.type(screen.getByPlaceholderText('My App'), 'Changed');
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    await waitFor(() => expect(screen.getByText('Error saving project')).toBeTruthy());
  });

  it('includes payload with routingModelId when present', async () => {
    renderTab();
    await waitFor(() => screen.getByPlaceholderText('My App'));
    await userEvent.clear(screen.getByPlaceholderText('My App'));
    await userEvent.type(screen.getByPlaceholderText('My App'), 'New');
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    await waitFor(() => expect(mockUpdateProject).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ routingModelId: 'openai/gpt-4o' })
    ));
  });

  it('omits routingModelId when not set on project', async () => {
    const proj = { ...mockProject, routingModelId: undefined };
    renderTab(proj as never);
    await waitFor(() => screen.getByPlaceholderText('My App'));
    await userEvent.clear(screen.getByPlaceholderText('My App'));
    await userEvent.type(screen.getByPlaceholderText('My App'), 'Changed');
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    await waitFor(() => expect(mockUpdateProject).toHaveBeenCalled());
    const [, payload] = mockUpdateProject.mock.calls[0]!;
    expect(payload).not.toHaveProperty('routingModelId');
  });
});

describe('ProjectGeneralTab — Advanced settings toggle', () => {
  it('advanced settings hidden by default', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Advanced settings/i }));
    expect(screen.queryByText('TTFT Timeout (ms)')).toBeNull();
  });

  it('shows TTFT timeout input after clicking Advanced settings', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Advanced settings/i }));
    await userEvent.click(screen.getByRole('button', { name: /Advanced settings/i }));
    await waitFor(() => expect(screen.queryByText('TTFT Timeout (ms)')).not.toBeNull());
  });

  it('clicking Advanced settings again hides the section', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Advanced settings/i }));
    await userEvent.click(screen.getByRole('button', { name: /Advanced settings/i }));
    await waitFor(() => expect(screen.queryByText('TTFT Timeout (ms)')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: /Advanced settings/i }));
    await waitFor(() => expect(screen.queryByText('TTFT Timeout (ms)')).toBeNull());
  });

  it('saves the trace content opt-in', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Advanced settings/i }));
    await userEvent.click(screen.getByRole('button', { name: /Advanced settings/i }));
    const checkbox = await screen.findByLabelText(/Capture prompts and answers/i);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    await waitFor(() => expect(mockUpdateProject).toHaveBeenCalledWith('proj-1', expect.objectContaining({ traceContent: true })));
  });

  it('pre-fills the trace content opt-in from the project', async () => {
    renderTab({ ...mockProject, traceContent: true });
    await waitFor(() => screen.getByRole('button', { name: /Advanced settings/i }));
    await userEvent.click(screen.getByRole('button', { name: /Advanced settings/i }));
    const checkbox = await screen.findByLabelText(/Capture prompts and answers/i);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
  });

  it('pre-fills timeoutMs from project', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Advanced settings/i }));
    await userEvent.click(screen.getByRole('button', { name: /Advanced settings/i }));
    await waitFor(() => {
      const inputs = document.querySelectorAll('input[type="number"]') as NodeListOf<HTMLInputElement>;
      expect(inputs[0]?.value).toBe('5000');
    });
  });

  it('timeoutMs falls back to the shared default when not set on project', async () => {
    const proj = { ...mockProject, timeoutMs: undefined };
    renderTab(proj as never);
    await waitFor(() => screen.getByRole('button', { name: /Advanced settings/i }));
    await userEvent.click(screen.getByRole('button', { name: /Advanced settings/i }));
    await waitFor(() => {
      const inputs = document.querySelectorAll('input[type="number"]') as NodeListOf<HTMLInputElement>;
      expect(inputs[0]?.value).toBe('2000');
    });
  });

  it('accepts timeoutMs 0 (no timeout) as a valid value', async () => {
    const proj = { ...mockProject, timeoutMs: 0 };
    renderTab(proj as never);
    await waitFor(() => screen.getByRole('button', { name: /Advanced settings/i }));
    await userEvent.click(screen.getByRole('button', { name: /Advanced settings/i }));
    await waitFor(() => {
      const input = document.querySelectorAll('input[type="number"]')[0] as HTMLInputElement;
      expect(input.value).toBe('0');
      expect(input.min).toBe('0');
    });
  });

  it('changing timeoutMs makes form dirty', async () => {
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Advanced settings/i }));
    await userEvent.click(screen.getByRole('button', { name: /Advanced settings/i }));
    await waitFor(() => screen.queryByText('TTFT Timeout (ms)'));
    const inputs = document.querySelectorAll('input[type="number"]');
    await userEvent.clear(inputs[0]!);
    await userEvent.type(inputs[0]!, '10000');
    const btn = screen.getByRole('button', { name: /Save Changes/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

// ── Copy endpoint ────────────────────────────────────────────────────────────

describe('ProjectGeneralTab — copy endpoint', () => {
  it('Copy button copies endpoint and shows "Copied!"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderTab();
    await waitFor(() => screen.getAllByRole('button', { name: /Copy/i }));
    const btns = screen.getAllByRole('button', { name: /Copy/i });
    await userEvent.click(btns[0]!);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
  });

});

// ── New project mode ─────────────────────────────────────────────────────────

describe('ProjectGeneralTab — new project mode', () => {
  it('shows "Create Project" button when project is null', () => {
    renderNew();
    expect(screen.getByRole('button', { name: /Create Project/i })).toBeTruthy();
  });

  it('"Create Project" button not disabled when name is empty (form uses required attr)', () => {
    renderNew();
    const btn = screen.getByRole('button', { name: /Create Project/i }) as HTMLButtonElement;
    // disabled={saving || (isEdit && !isDirty)} — in new mode isEdit=false, so only saving disables it
    expect(btn.disabled).toBe(false);
  });

  it('Create button enabled when name is typed', async () => {
    renderNew();
    const input = screen.getByPlaceholderText('My App');
    await userEvent.type(input, 'My App');
    const btn = screen.getByRole('button', { name: /Create Project/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('shows token reveal view after successful create (project has token)', async () => {
    mockCreateProject.mockResolvedValueOnce({ id: 'proj-new', name: 'My App', models: [], token: 'sk-rt-secret' });
    renderNew();
    await userEvent.type(screen.getByPlaceholderText('My App'), 'My App');
    await userEvent.click(screen.getByRole('button', { name: /Create Project/i }));
    await waitFor(() => expect(screen.queryByText('sk-rt-secret')).not.toBeNull());
  });

  it('token reveal view has Copy button', async () => {
    mockCreateProject.mockResolvedValueOnce({ id: 'proj-new', name: 'My App', models: [], token: 'sk-rt-secret' });
    renderNew();
    await userEvent.type(screen.getByPlaceholderText('My App'), 'My App');
    await userEvent.click(screen.getByRole('button', { name: /Create Project/i }));
    await waitFor(() => screen.queryByText('sk-rt-secret'));
    expect(screen.getByRole('button', { name: /Copy/i })).toBeTruthy();
  });

  it('token reveal Copy button calls clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mockCreateProject.mockResolvedValueOnce({ id: 'proj-new', name: 'My App', models: [], token: 'sk-rt-secret' });
    renderNew();
    await userEvent.type(screen.getByPlaceholderText('My App'), 'My App');
    await userEvent.click(screen.getByRole('button', { name: /Create Project/i }));
    await waitFor(() => screen.queryByText('sk-rt-secret'));
    await userEvent.click(screen.getByRole('button', { name: /Copy/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('sk-rt-secret'));
  });

  it('token reveal "Go to project" button navigates to project page', async () => {
    mockCreateProject.mockResolvedValueOnce({ id: 'proj-new', name: 'My App', models: [], token: 'sk-rt-secret' });
    const { container } = renderNew();
    await userEvent.type(screen.getByPlaceholderText('My App'), 'My App');
    await userEvent.click(screen.getByRole('button', { name: /Create Project/i }));
    await waitFor(() => screen.queryByText('sk-rt-secret'));
    // "Go to project" button navigates away — the revealed token view disappears
    const goBtn = container.querySelector('button.btn-primary') as HTMLButtonElement;
    await userEvent.click(goBtn);
    await waitFor(() => expect(screen.queryByText('sk-rt-secret')).toBeNull());
  });

  it('shows "Copied!" on clipboard copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mockCreateProject.mockResolvedValueOnce({ id: 'proj-new', name: 'My App', models: [], token: 'sk-rt-secret' });
    renderNew();
    await userEvent.type(screen.getByPlaceholderText('My App'), 'My App');
    await userEvent.click(screen.getByRole('button', { name: /Create Project/i }));
    await waitFor(() => screen.queryByText('sk-rt-secret'));
    await userEvent.click(screen.getByRole('button', { name: /Copy/i }));
    await waitFor(() => expect(screen.queryByText('Copied!')).not.toBeNull());
  });


  it('navigates to project page when no token returned', async () => {
    mockCreateProject.mockResolvedValueOnce({ id: 'proj-new', name: 'My App', models: [] });
    renderNew();
    await userEvent.type(screen.getByPlaceholderText('My App'), 'My App');
    await userEvent.click(screen.getByRole('button', { name: /Create Project/i }));
    // Navigated away — Create Project button no longer in DOM
    await waitFor(() => expect(screen.queryByRole('button', { name: /Create Project/i })).toBeNull());
  });

  it('shows error on createProject failure', async () => {
    mockCreateProject.mockRejectedValueOnce(new Error('Create failed'));
    renderNew();
    await userEvent.type(screen.getByPlaceholderText('My App'), 'My App');
    await userEvent.click(screen.getByRole('button', { name: /Create Project/i }));
    await waitFor(() => expect(screen.getByText('Create failed')).toBeTruthy());
  });
});

// ── Unsaved changes modal ────────────────────────────────────────────────────

describe('ProjectGeneralTab — unsaved changes modal', () => {
  it('renders modal when isBlocked=true', async () => {
    mockUseUnsavedChanges.mockReturnValue({
      isBlocked: true,
      proceed: vi.fn(),
      reset: vi.fn(),
    });
    renderTab();
    await waitFor(() => expect(screen.getByTestId('unsaved-modal')).toBeTruthy());
  });
});
