import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { ProjectTokenCreatePage } from './ProjectTokenCreatePage';

vi.mock('../../api', () => ({
  createProjectToken: vi.fn(),
}));

import { createProjectToken } from '../../api';
const mockCreateProjectToken = vi.mocked(createProjectToken as (...a: unknown[]) => Promise<unknown>);

const mockProject = {
  id: 'proj-1',
  name: 'Test',
  models: [],
  tokens: [
    { id: 'tok-existing', tokenSnippet: 'sk-rt-ex', labels: ['production'], createdAt: '2024-01-01T00:00:00Z' },
  ],
};

function renderPage(project: Record<string, unknown> = mockProject) {
  const setProject = vi.fn();
  function LayoutWrapper() {
    return <Outlet context={{ project, setProject }} />;
  }
  return {
    setProject,
    ...render(
      <MemoryRouter initialEntries={['/dashboard/projects/proj-1/token/new']}>
        <Routes>
          <Route path="/dashboard/projects/:id" element={<LayoutWrapper />}>
            <Route path="token/new" element={<ProjectTokenCreatePage />} />
            <Route path="token" element={<div data-testid="token-list">token list</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  };
}

beforeEach(() => {
  mockCreateProjectToken.mockResolvedValue({
    token: 'sk-rt-newtoken123',
    tokenInfo: { id: 'tok-new', tokenSnippet: 'sk-rt-new', createdAt: '2024-07-01T00:00:00Z', labels: [] },
  });
});

afterEach(() => vi.clearAllMocks());

// ── null project guard ────────────────────────────────────────────────────────

describe('ProjectTokenCreatePage — null project guard', () => {
  it('renders nothing when project is null', () => {
    function LayoutWrapper() {
      return <Outlet context={{ project: null, setProject: vi.fn() }} />;
    }
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard/projects/proj-1/token/new']}>
        <Routes>
          <Route path="/dashboard/projects/:id" element={<LayoutWrapper />}>
            <Route path="token/new" element={<ProjectTokenCreatePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── Initial render ────────────────────────────────────────────────────────────

describe('ProjectTokenCreatePage — initial render', () => {
  it('shows "New API Token" heading', () => {
    renderPage();
    expect(screen.getByText('New API Token')).toBeTruthy();
  });

  it('shows "Create Token" submit button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Create Token' })).toBeTruthy();
  });

  it('shows Cancel button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('shows Labels section', () => {
    renderPage();
    expect(screen.getByText('Labels')).toBeTruthy();
  });

  it('shows Tags section', () => {
    renderPage();
    expect(screen.getByText('Tags')).toBeTruthy();
  });

  it('shows Back to tokens link', () => {
    renderPage();
    expect(screen.getByText(/Back to tokens/)).toBeTruthy();
  });
});

// ── Navigation ────────────────────────────────────────────────────────────────

describe('ProjectTokenCreatePage — navigation', () => {
  it('Back to tokens navigates to token list', async () => {
    renderPage();
    await userEvent.click(screen.getByText(/Back to tokens/));
    await waitFor(() => expect(screen.getByTestId('token-list')).toBeTruthy());
  });

  it('Cancel button navigates to token list', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByTestId('token-list')).toBeTruthy());
  });
});

// ── Token creation ────────────────────────────────────────────────────────────

describe('ProjectTokenCreatePage — token creation', () => {
  it('submitting form calls createProjectToken', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => expect(mockCreateProjectToken).toHaveBeenCalledWith('proj-1', [], undefined, undefined));
  });

  it('shows revealed token after successful creation', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => expect(screen.getByText('sk-rt-newtoken123')).toBeTruthy());
  });

  it('shows Copy button after token is revealed', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => screen.getByText('sk-rt-newtoken123'));
    expect(screen.getByRole('button', { name: /Copy/i })).toBeTruthy();
  });

  it('shows Done button after token is revealed', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => screen.getByText('sk-rt-newtoken123'));
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('Copy button calls clipboard.writeText', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => screen.getByText('sk-rt-newtoken123'));
    await userEvent.click(screen.getByRole('button', { name: /Copy/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('sk-rt-newtoken123'));
  });

  it('shows "Copied!" after clicking Copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => screen.getByText('sk-rt-newtoken123'));
    await userEvent.click(screen.getByRole('button', { name: /Copy/i }));
    await waitFor(() => expect(screen.getByText('Copied!')).toBeTruthy());
  });

  it('Done button navigates back to token list', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => screen.getByRole('button', { name: 'Done' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByTestId('token-list')).toBeTruthy());
  });

  it('shows error when createProjectToken rejects', async () => {
    mockCreateProjectToken.mockRejectedValueOnce(new Error('Token creation failed'));
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => expect(screen.getByText('Token creation failed')).toBeTruthy());
  });

  it('shows generic error on non-Error rejection', async () => {
    mockCreateProjectToken.mockRejectedValueOnce('oops');
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => expect(screen.getByText('Error creating token')).toBeTruthy());
  });
});

// ── Tags ─────────────────────────────────────────────────────────────────────

// Helper: find the + tag button whose immediate previous sibling is the value input
function findAddTagButton() {
  return screen.getAllByRole('button').find(
    b => b.previousElementSibling?.getAttribute('placeholder') === 'value'
  ) as HTMLButtonElement | undefined;
}

describe('ProjectTokenCreatePage — tags', () => {
  it('Add tag button disabled when key is empty', () => {
    renderPage();
    const addBtn = findAddTagButton();
    expect(addBtn).toBeTruthy();
    expect(addBtn!.disabled).toBe(true);
  });

  it('fills key and value then adds a tag', async () => {
    renderPage();
    const keyInput = screen.getByPlaceholderText('key');
    const valInput = screen.getByPlaceholderText('value');
    await userEvent.type(keyInput, 'env');
    await userEvent.type(valInput, 'production');
    const addBtn = findAddTagButton()!;
    await userEvent.click(addBtn);
    await waitFor(() => expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el?.textContent === 'env=production')).toBeTruthy());
  });

  it('removing a tag with × removes it from the list', async () => {
    renderPage();
    const keyInput = screen.getByPlaceholderText('key');
    const valInput = screen.getByPlaceholderText('value');
    await userEvent.type(keyInput, 'env');
    await userEvent.type(valInput, 'prod');
    await userEvent.click(findAddTagButton()!);
    await waitFor(() => screen.getByText((_, el) => el?.tagName === 'SPAN' && el?.textContent === 'env=prod'));
    const tagSpan = screen.getByText((_, el) => el?.tagName === 'SPAN' && el?.textContent === 'env=prod');
    const removeX = tagSpan.parentElement!.querySelector('button')!;
    await userEvent.click(removeX);
    await waitFor(() => expect(screen.queryByText((_, el) => el?.tagName === 'SPAN' && el?.textContent === 'env=prod')).toBeNull());
  });

  it('createProjectToken called with tags when tags are set', async () => {
    renderPage();
    const keyInput = screen.getByPlaceholderText('key');
    await userEvent.type(keyInput, 'env');
    await userEvent.click(findAddTagButton()!);
    await waitFor(() => screen.getByText((_, el) => el?.tagName === 'SPAN' && el?.textContent === 'env='));
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => expect(mockCreateProjectToken).toHaveBeenCalledWith(
      'proj-1',
      [],
      expect.objectContaining({ env: '' }),
      undefined,
    ));
  });
});

// ── Scopes ────────────────────────────────────────────────────────────────────

describe('ProjectTokenCreatePage scopes', () => {
  it('shows Scopes section', () => {
    renderPage();
    expect(screen.getByText('Scopes')).toBeTruthy();
  });

  it('createProjectToken called with scopes when a scope is added', async () => {
    renderPage();
    const scopeTextbox = screen.getAllByPlaceholderText('Search or create a label…')[1]!;
    await userEvent.type(scopeTextbox, 'mcp');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => expect(mockCreateProjectToken).toHaveBeenCalledWith(
      'proj-1',
      [],
      undefined,
      ['mcp'],
    ));
  });
});

// ── clipboard fallback path ────────────────────────────────────────────────────
// When navigator.clipboard throws, the execCommand fallback runs.

describe('ProjectTokenCreatePage — clipboard fallback', () => {
  it('uses execCommand fallback when clipboard.writeText throws', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('no clipboard'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    // execCommand may not exist in the test environment — define it before spying
    if (!document.execCommand) Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true, writable: true });
    const execCommand = vi.spyOn(document, 'execCommand').mockReturnValue(true);

    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => screen.getByText('sk-rt-newtoken123'));
    await userEvent.click(screen.getByRole('button', { name: /Copy/i }));
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));

    execCommand.mockRestore();
  });

  it('does not crash when clipboard fails and execCommand returns false', async () => {
    // The error state is set internally but not displayed in the revealed-token view.
    // Verify execCommand was attempted and the token is still visible (no crash).
    const writeText = vi.fn().mockRejectedValue(new Error('no clipboard'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    if (!document.execCommand) Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true, writable: true });
    const execCommand = vi.spyOn(document, 'execCommand').mockReturnValue(false);

    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => screen.getByText('sk-rt-newtoken123'));
    await userEvent.click(screen.getByRole('button', { name: /Copy/i }));
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    expect(screen.getByText('sk-rt-newtoken123')).toBeTruthy();

    execCommand.mockRestore();
  });

  it('does not crash when clipboard fails and execCommand throws', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('no clipboard'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    if (!document.execCommand) Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true, writable: true });
    const execCommand = vi.spyOn(document, 'execCommand').mockImplementation(() => { throw new Error('no execCommand'); });

    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => screen.getByText('sk-rt-newtoken123'));
    await userEvent.click(screen.getByRole('button', { name: /Copy/i }));
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    expect(screen.getByText('sk-rt-newtoken123')).toBeTruthy();

    execCommand.mockRestore();
  });
});

// ── project.tokens undefined → allLabels fallback (line 26 branch 1) ─────────

describe('ProjectTokenCreatePage — no tokens property on project', () => {
  it('renders without crash when project has no tokens property', () => {
    const proj = { id: 'proj-2', name: 'NoTokens', models: [] };
    renderPage(proj as unknown as Record<string, unknown>);
    expect(screen.getByText('New API Token')).toBeTruthy();
  });
});

// ── setTimeout callback in copyToClipboard (line 29 anonymous_4) ─────────────

describe('ProjectTokenCreatePage — copied feedback clears after timeout', () => {
  it('Copied! disappears after 2 seconds via setTimeout callback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => screen.getByText('sk-rt-newtoken123'));
    await userEvent.click(screen.getByRole('button', { name: /Copy/i }));
    await waitFor(() => screen.getByText('Copied!'));
    // Wait for the 2-second setTimeout callback (() => setCopied(false)) to fire
    await waitFor(() => expect(screen.queryByText('Copied!')).toBeNull(), { timeout: 4000 });
  }, 8000);
});

// ── allLabels from existing tokens ────────────────────────────────────────────

describe('ProjectTokenCreatePage — existing labels from project tokens', () => {
  it('existing labels from project tokens are available as suggestions in LabelInput', async () => {
    renderPage();
    // Use placeholder to target the Labels LabelInput specifically (page has label + scope + tag inputs)
    const labelTextbox = screen.getAllByPlaceholderText('Search or create a label…')[0]!;
    await userEvent.type(labelTextbox, 'pro');
    // 'production' from existing token labels should appear
    await waitFor(() => expect(screen.getByText('production')).toBeTruthy());
  });
});

// ── allLabels with tokens that have no labels field (line 26 || [] branch) ────

describe('ProjectTokenCreatePage — tokens without labels field', () => {
  it('renders without crash when project tokens have no labels property', () => {
    // token without labels field → t.labels || [] takes the [] branch
    const proj = {
      ...mockProject,
      tokens: [{ id: 'tok-nolabel', tokenSnippet: 'sk-rt-no', createdAt: '2024-01-01T00:00:00Z' }],
    };
    renderPage(proj);
    expect(screen.getByText('New API Token')).toBeTruthy();
  });
});

// ── setProject updater — all branches (line 56) ──────────────────────────────

describe('ProjectTokenCreatePage — setProject null guard', () => {
  it('setProject updater handles null project gracefully', async () => {
    // The setProject mock captures the updater; call it with null to hit the p ? ... : p false branch
    const { setProject } = renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => expect(mockCreateProjectToken).toHaveBeenCalled());
    const updater = (setProject.mock.calls[0] as [((p: unknown) => unknown)])[0];
    expect(typeof updater).toBe('function');
    // false branch: p is null
    expect(updater(null)).toBeNull();
    // true branch, p.tokens exists: spread existing tokens array
    const withTokens = { ...mockProject, tokens: [{ id: 'old' }] };
    const result = updater(withTokens) as typeof withTokens;
    expect(Array.isArray(result.tokens)).toBe(true);
    expect(result.tokens.length).toBeGreaterThan(1);
    // true branch, p.tokens is undefined: falls back to [] then appends
    const withoutTokens = { id: 'proj-x', name: 'X', models: [] };
    const result2 = updater(withoutTokens) as { tokens: unknown[] };
    expect(Array.isArray(result2.tokens)).toBe(true);
  });
});

// ── onClick guard inside add-tag button (line 137 branch) ────────────────────

describe('ProjectTokenCreatePage — add tag onClick internal guard', () => {
  it('add tag onClick with whitespace-only key does nothing (internal guard)', async () => {
    renderPage();
    const keyInput = screen.getByPlaceholderText('key');
    await userEvent.type(keyInput, '   ');
    const addBtn = screen.getAllByRole('button').find(
      b => b.previousElementSibling?.getAttribute('placeholder') === 'value'
    ) as HTMLButtonElement;
    // fireEvent dispatches native event bypassing disabled check
    fireEvent.click(addBtn);
    // Also invoke via React fiber props to ensure the false branch inside onClick is covered
    const fiberKey = Object.keys(addBtn).find(k => k.startsWith('__reactFiber'));
    if (fiberKey) {
      let fiber = (addBtn as unknown as Record<string, unknown>)[fiberKey] as { memoizedProps?: Record<string, unknown>; return?: unknown } | null;
      while (fiber) {
        if (fiber.memoizedProps?.onClick) {
          (fiber.memoizedProps.onClick as (e: { preventDefault: () => void }) => void)({ preventDefault: () => {} });
          break;
        }
        fiber = (fiber as { return?: typeof fiber }).return ?? null;
      }
    }
    expect(screen.queryByText((_, el) => el?.tagName === 'SPAN' && (el?.textContent ?? '').includes('='))).toBeNull();
  });
});

// ── projectId missing guard (line 53) ────────────────────────────────────────

describe('ProjectTokenCreatePage — missing projectId guard', () => {
  it('handleCreate returns early when projectId is undefined', async () => {
    const setProject = vi.fn();
    function LayoutWrapper() {
      return <Outlet context={{ project: mockProject, setProject }} />;
    }
    render(
      <MemoryRouter initialEntries={['/token/new']}>
        <Routes>
          <Route path="/token/new" element={<LayoutWrapper />}>
            <Route index element={<ProjectTokenCreatePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await new Promise(r => setTimeout(r, 50));
    // With no :id param, projectId is undefined → early return before API call
    expect(mockCreateProjectToken).not.toHaveBeenCalled();
  });
});
