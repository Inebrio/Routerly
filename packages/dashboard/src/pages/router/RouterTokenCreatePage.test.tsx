import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { RouterTokenCreatePage } from './RouterTokenCreatePage';

vi.mock('../../api', () => ({
  createRouterToken: vi.fn(),
}));

import { createRouterToken } from '../../api';
const mockCreateRouterToken = vi.mocked(createRouterToken as (...a: unknown[]) => Promise<unknown>);

const mockRouter = {
  id: 'proj-1',
  name: 'Test',
  models: [],
  tokens: [
    { id: 'tok-existing', tokenSnippet: 'sk-rt-ex', labels: ['production'], createdAt: '2024-01-01T00:00:00Z' },
  ],
};

function renderPage(router: Record<string, unknown> = mockRouter) {
  const setRouter = vi.fn();
  function LayoutWrapper() {
    return <Outlet context={{ router, setRouter }} />;
  }
  return {
    setRouter,
    ...render(
      <MemoryRouter initialEntries={['/dashboard/routers/proj-1/token/new']}>
        <Routes>
          <Route path="/dashboard/routers/:id" element={<LayoutWrapper />}>
            <Route path="token/new" element={<RouterTokenCreatePage />} />
            <Route path="token" element={<div data-testid="token-list">token list</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  };
}

beforeEach(() => {
  mockCreateRouterToken.mockResolvedValue({
    token: 'sk-rt-newtoken123',
    tokenInfo: { id: 'tok-new', tokenSnippet: 'sk-rt-new', createdAt: '2024-07-01T00:00:00Z', labels: [] },
  });
});

afterEach(() => vi.clearAllMocks());

// ── null router guard ────────────────────────────────────────────────────────

describe('RouterTokenCreatePage — null router guard', () => {
  it('renders nothing when router is null', () => {
    function LayoutWrapper() {
      return <Outlet context={{ router: null, setRouter: vi.fn() }} />;
    }
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard/routers/proj-1/token/new']}>
        <Routes>
          <Route path="/dashboard/routers/:id" element={<LayoutWrapper />}>
            <Route path="token/new" element={<RouterTokenCreatePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── Initial render ────────────────────────────────────────────────────────────

describe('RouterTokenCreatePage — initial render', () => {
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

describe('RouterTokenCreatePage — navigation', () => {
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

describe('RouterTokenCreatePage — token creation', () => {
  it('submitting form calls createRouterToken', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => expect(mockCreateRouterToken).toHaveBeenCalledWith('proj-1', [], undefined, undefined));
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

  it('shows error when createRouterToken rejects', async () => {
    mockCreateRouterToken.mockRejectedValueOnce(new Error('Token creation failed'));
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => expect(screen.getByText('Token creation failed')).toBeTruthy());
  });

  it('shows generic error on non-Error rejection', async () => {
    mockCreateRouterToken.mockRejectedValueOnce('oops');
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

describe('RouterTokenCreatePage — tags', () => {
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

  it('createRouterToken called with tags when tags are set', async () => {
    renderPage();
    const keyInput = screen.getByPlaceholderText('key');
    await userEvent.type(keyInput, 'env');
    await userEvent.click(findAddTagButton()!);
    await waitFor(() => screen.getByText((_, el) => el?.tagName === 'SPAN' && el?.textContent === 'env='));
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => expect(mockCreateRouterToken).toHaveBeenCalledWith(
      'proj-1',
      [],
      expect.objectContaining({ env: '' }),
      undefined,
    ));
  });
});

// ── Scopes ────────────────────────────────────────────────────────────────────

describe('RouterTokenCreatePage scopes', () => {
  it('shows Scopes section', () => {
    renderPage();
    expect(screen.getByText('Scopes')).toBeTruthy();
  });

  it('createRouterToken called with scopes when a scope is added', async () => {
    renderPage();
    const scopeTextbox = screen.getAllByPlaceholderText('Search or create a label…')[1]!;
    await userEvent.type(scopeTextbox, 'mcp');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => expect(mockCreateRouterToken).toHaveBeenCalledWith(
      'proj-1',
      [],
      undefined,
      ['mcp'],
    ));
  });
});

// ── clipboard fallback path ────────────────────────────────────────────────────
// When navigator.clipboard throws, the execCommand fallback runs.

describe('RouterTokenCreatePage — clipboard fallback', () => {
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

// ── router.tokens undefined → allLabels fallback (line 26 branch 1) ─────────

describe('RouterTokenCreatePage — no tokens property on router', () => {
  it('renders without crash when router has no tokens property', () => {
    const proj = { id: 'proj-2', name: 'NoTokens', models: [] };
    renderPage(proj as unknown as Record<string, unknown>);
    expect(screen.getByText('New API Token')).toBeTruthy();
  });
});

// ── setTimeout callback in copyToClipboard (line 29 anonymous_4) ─────────────

describe('RouterTokenCreatePage — copied feedback clears after timeout', () => {
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

describe('RouterTokenCreatePage — existing labels from router tokens', () => {
  it('existing labels from router tokens are available as suggestions in LabelInput', async () => {
    renderPage();
    // Use placeholder to target the Labels LabelInput specifically (page has label + scope + tag inputs)
    const labelTextbox = screen.getAllByPlaceholderText('Search or create a label…')[0]!;
    await userEvent.type(labelTextbox, 'pro');
    // 'production' from existing token labels should appear
    await waitFor(() => expect(screen.getByText('production')).toBeTruthy());
  });
});

// ── allLabels with tokens that have no labels field (line 26 || [] branch) ────

describe('RouterTokenCreatePage — tokens without labels field', () => {
  it('renders without crash when router tokens have no labels property', () => {
    // token without labels field → t.labels || [] takes the [] branch
    const proj = {
      ...mockRouter,
      tokens: [{ id: 'tok-nolabel', tokenSnippet: 'sk-rt-no', createdAt: '2024-01-01T00:00:00Z' }],
    };
    renderPage(proj);
    expect(screen.getByText('New API Token')).toBeTruthy();
  });
});

// ── setRouter updater — all branches (line 56) ──────────────────────────────

describe('RouterTokenCreatePage — setRouter null guard', () => {
  it('setRouter updater handles null router gracefully', async () => {
    // The setRouter mock captures the updater; call it with null to hit the p ? ... : p false branch
    const { setRouter } = renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await waitFor(() => expect(mockCreateRouterToken).toHaveBeenCalled());
    const updater = (setRouter.mock.calls[0] as [((p: unknown) => unknown)])[0];
    expect(typeof updater).toBe('function');
    // false branch: p is null
    expect(updater(null)).toBeNull();
    // true branch, p.tokens exists: spread existing tokens array
    const withTokens = { ...mockRouter, tokens: [{ id: 'old' }] };
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

describe('RouterTokenCreatePage — add tag onClick internal guard', () => {
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

// ── routerId missing guard (line 53) ────────────────────────────────────────

describe('RouterTokenCreatePage — missing routerId guard', () => {
  it('handleCreate returns early when routerId is undefined', async () => {
    const setRouter = vi.fn();
    function LayoutWrapper() {
      return <Outlet context={{ router: mockRouter, setRouter }} />;
    }
    render(
      <MemoryRouter initialEntries={['/token/new']}>
        <Routes>
          <Route path="/token/new" element={<LayoutWrapper />}>
            <Route index element={<RouterTokenCreatePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    await new Promise(r => setTimeout(r, 50));
    // With no :id param, routerId is undefined → early return before API call
    expect(mockCreateRouterToken).not.toHaveBeenCalled();
  });
});
