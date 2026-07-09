import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api', () => ({
  getModelCatalog: vi.fn(),
}));

// ponytail: mock MultiSelect as a plain <select multiple> so onChange fires
vi.mock('../components/MultiSelect', () => ({
  MultiSelect: ({
    options,
    value,
    onChange,
    placeholder,
  }: {
    options: { value: string; label: string }[];
    value: string[];
    onChange: (v: string[]) => void;
    placeholder?: string;
  }) => (
    <select
      multiple
      data-testid={`multiselect-${placeholder ?? 'select'}`}
      value={value}
      onChange={e => {
        const selected = Array.from(e.target.selectedOptions).map(o => o.value);
        onChange(selected);
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

const navigateFn = vi.fn();
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateFn };
});

import { ModelDiscoveryPage } from './ModelDiscoveryPage';
import { getModelCatalog } from '../api';

const mockGetCatalog = vi.mocked(getModelCatalog as () => Promise<unknown>);

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128_000,
    pricing: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015 },
    isConfigured: false,
    local: false,
    embedding: false,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/models/discovery']}>
      <ModelDiscoveryPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  mockGetCatalog.mockResolvedValue([makeEntry()]);
});

afterEach(() => { vi.clearAllMocks(); navigateFn.mockReset(); });

// ── Loading state ──────────────────────────────────────────────────────────────

describe('ModelDiscoveryPage — loading', () => {
  it('shows spinner while loading', () => {
    mockGetCatalog.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(document.querySelector('.spinner')).toBeTruthy();
  });

  it('does not show count while loading', () => {
    mockGetCatalog.mockReturnValue(new Promise(() => {}));
    renderPage();
    // The count span ("N models") is not shown while loading; the header <p> contains "models"
    // so scope to the count span specifically (it's the only <span> with /\d+ models/ text)
    const countSpan = Array.from(document.querySelectorAll('span')).find(el =>
      /^\d+ models$/.test(el.textContent?.trim() ?? '')
    );
    expect(countSpan).toBeUndefined();
  });
});

// ── Error state ────────────────────────────────────────────────────────────────

describe('ModelDiscoveryPage — error state', () => {
  it('shows error message when getModelCatalog throws', async () => {
    mockGetCatalog.mockRejectedValue(new Error('Network error'));
    renderPage();
    await waitFor(() => expect(screen.queryByText(/Failed to load catalog: Network error/)).not.toBeNull());
  });
});

// ── Empty filtered state ───────────────────────────────────────────────────────

describe('ModelDiscoveryPage — empty filtered state', () => {
  it('shows no-match message when search has no results', async () => {
    renderPage();
    await waitFor(() => screen.getByPlaceholderText('Model ID or name…'));
    await userEvent.type(screen.getByPlaceholderText('Model ID or name…'), 'nonexistentxyz');
    await waitFor(() => expect(screen.queryByText('No models match your filters.')).not.toBeNull());
  });

  it('Reset filters button in empty state resets search', async () => {
    renderPage();
    await waitFor(() => screen.getByPlaceholderText('Model ID or name…'));
    await userEvent.type(screen.getByPlaceholderText('Model ID or name…'), 'nonexistentxyz');
    await waitFor(() => screen.queryByText('No models match your filters.'));
    // Reset filters button appears in empty state
    const resetBtns = screen.getAllByRole('button', { name: 'Reset filters' });
    await userEvent.click(resetBtns[0]!);
    await waitFor(() => expect(screen.queryByText('gpt-4o')).not.toBeNull());
  });
});

// ── Loaded state ───────────────────────────────────────────────────────────────

describe('ModelDiscoveryPage — loaded state', () => {
  it('renders page header', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('Model Discovery')).not.toBeNull());
  });

  it('renders model row with id, provider, context', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('gpt-4o')).not.toBeNull());
    // 'openai' appears in both MultiSelect option and provider badge — either is fine
    expect(screen.queryAllByText('openai').length).toBeGreaterThan(0);
    expect(screen.queryByText('128k')).not.toBeNull();
  });

  it('shows total count when no filter active', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('1 models')).not.toBeNull());
  });

  it('shows model name when different from id', async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText('GPT-4o')).not.toBeNull());
  });

  it('does not show name when name equals id', async () => {
    mockGetCatalog.mockResolvedValue([makeEntry({ id: 'gpt-4o', name: 'gpt-4o' })]);
    renderPage();
    await waitFor(() => screen.queryByText('gpt-4o'));
    // name===id → name span not rendered
    const nameCells = Array.from(document.querySelectorAll('td')).filter(td =>
      td.querySelector('span.mono')?.textContent === 'gpt-4o'
    );
    expect(nameCells.length).toBeGreaterThan(0);
  });

  it('shows "Configured" badge when isConfigured=true', async () => {
    mockGetCatalog.mockResolvedValue([makeEntry({ isConfigured: true })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('Configured')).not.toBeNull());
  });

  it('shows "embedding" badge when embedding=true', async () => {
    mockGetCatalog.mockResolvedValue([makeEntry({ embedding: true })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('embedding')).not.toBeNull());
  });

  it('shows HardDrive icon (local badge) when local=true', async () => {
    mockGetCatalog.mockResolvedValue([makeEntry({ local: true })]);
    renderPage();
    await waitFor(() => screen.queryByText('gpt-4o'));
    // local=true → HardDrive icon rendered inside a span with title
    const localBadge = document.querySelector('[title="Runs locally"]');
    expect(localBadge).toBeTruthy();
  });

  it('shows "free" for local models instead of price', async () => {
    mockGetCatalog.mockResolvedValue([makeEntry({ local: true })]);
    renderPage();
    await waitFor(() => {
      const freeCells = screen.getAllByText('free');
      expect(freeCells.length).toBeGreaterThan(0);
    });
  });

  it('formats context as M when >= 1M', async () => {
    mockGetCatalog.mockResolvedValue([makeEntry({ contextWindow: 1_000_000 })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('1.0M')).not.toBeNull());
  });

  it('shows — when contextWindow is 0', async () => {
    mockGetCatalog.mockResolvedValue([makeEntry({ contextWindow: 0 })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('—')).not.toBeNull());
  });

  it('formats price correctly for high-cost model (>= $10/1M)', async () => {
    mockGetCatalog.mockResolvedValue([makeEntry({ pricing: { inputPer1kTokens: 0.015, outputPer1kTokens: 0.06 } })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('$15')).not.toBeNull());
    expect(screen.queryByText('$60')).not.toBeNull();
  });

  it('formats price correctly for mid-range model ($1-$10/1M)', async () => {
    mockGetCatalog.mockResolvedValue([makeEntry({ pricing: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.006 } })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('$3')).not.toBeNull());
  });

  it('formats price correctly for low-cost model (< $1/1M)', async () => {
    mockGetCatalog.mockResolvedValue([makeEntry({ pricing: { inputPer1kTokens: 0.0001, outputPer1kTokens: 0.0002 } })]);
    renderPage();
    await waitFor(() => expect(screen.queryByText('$0.1')).not.toBeNull());
  });

  it('formats price as "free" when inputPer1kTokens is 0', async () => {
    mockGetCatalog.mockResolvedValue([makeEntry({ local: false, pricing: { inputPer1kTokens: 0, outputPer1kTokens: 0 } })]);
    renderPage();
    await waitFor(() => {
      const freeCells = screen.getAllByText('free');
      expect(freeCells.length).toBeGreaterThan(0);
    });
  });

  it('Add button navigates to model form with provider and modelId params', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Add' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(navigateFn).toHaveBeenCalledWith(
      expect.stringContaining('provider=openai'),
      expect.objectContaining({ state: expect.objectContaining({ catalogEntry: expect.anything() }) })
    );
  });

  it('"Add again" text when isConfigured=true', async () => {
    mockGetCatalog.mockResolvedValue([makeEntry({ isConfigured: true })]);
    renderPage();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add again' })).not.toBeNull());
  });
});

// ── Back navigation ────────────────────────────────────────────────────────────

describe('ModelDiscoveryPage — back navigation', () => {
  it('navigates to models page on back button click', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Back to Models'));
    await userEvent.click(screen.getByText('Back to Models').closest('button')!);
    expect(navigateFn).toHaveBeenCalledWith('/dashboard/models');
  });
});

// ── Search filter ──────────────────────────────────────────────────────────────

describe('ModelDiscoveryPage — search', () => {
  it('filters by model id substring', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'gpt-4o', name: 'GPT-4o' }),
      makeEntry({ id: 'claude-3', provider: 'anthropic', name: 'Claude 3' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByPlaceholderText('Model ID or name…'));
    await userEvent.type(screen.getByPlaceholderText('Model ID or name…'), 'gpt');
    await waitFor(() => {
      expect(screen.queryByText('gpt-4o')).not.toBeNull();
      expect(screen.queryByText('claude-3')).toBeNull();
    });
  });

  it('filters by model name (case-insensitive)', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'gpt-4o', name: 'GPT-4o' }),
      makeEntry({ id: 'claude-3', provider: 'anthropic', name: 'Claude 3' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByPlaceholderText('Model ID or name…'));
    await userEvent.type(screen.getByPlaceholderText('Model ID or name…'), 'claude');
    await waitFor(() => {
      expect(screen.queryByText('claude-3')).not.toBeNull();
      expect(screen.queryByText('gpt-4o')).toBeNull();
    });
  });

  it('clear (X) button clears search', async () => {
    renderPage();
    await waitFor(() => screen.getByPlaceholderText('Model ID or name…'));
    await userEvent.type(screen.getByPlaceholderText('Model ID or name…'), 'gpt');
    await waitFor(() => screen.getByRole('button', { name: '' })); // X button
    const xBtn = Array.from(document.querySelectorAll('button')).find(b =>
      b.querySelector('svg') && b.style.position === 'absolute'
    ) as HTMLElement;
    expect(xBtn).toBeTruthy();
    await userEvent.click(xBtn);
    await waitFor(() => {
      const input = screen.getByPlaceholderText('Model ID or name…') as HTMLInputElement;
      expect(input.value).toBe('');
    });
  });
});

// ── Provider filter ────────────────────────────────────────────────────────────

describe('ModelDiscoveryPage — provider filter', () => {
  it('filters by selected provider', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'gpt-4o', provider: 'openai' }),
      makeEntry({ id: 'claude-3', provider: 'anthropic' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByTestId('multiselect-All providers'));
    const select = screen.getByTestId('multiselect-All providers') as HTMLSelectElement;
    await userEvent.selectOptions(select, ['openai']);
    await waitFor(() => {
      expect(screen.queryByText('gpt-4o')).not.toBeNull();
      expect(screen.queryByText('claude-3')).toBeNull();
    });
  });
});

// ── Context filter ────────────────────────────────────────────────────────────

describe('ModelDiscoveryPage — context filter', () => {
  it('small filter (<32k) shows only small-context models', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'small-model', contextWindow: 8_000 }),
      makeEntry({ id: 'big-model', contextWindow: 128_000 }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('< 32k'));
    await userEvent.click(screen.getByText('< 32k'));
    await waitFor(() => {
      expect(screen.queryByText('small-model')).not.toBeNull();
      expect(screen.queryByText('big-model')).toBeNull();
    });
  });

  it('medium filter (32k-200k) shows medium-context models', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'small-model', contextWindow: 8_000 }),
      makeEntry({ id: 'mid-model', contextWindow: 128_000 }),
      makeEntry({ id: 'xl-model', contextWindow: 2_000_000 }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('32k–200k'));
    await userEvent.click(screen.getByText('32k–200k'));
    await waitFor(() => {
      expect(screen.queryByText('mid-model')).not.toBeNull();
      expect(screen.queryByText('small-model')).toBeNull();
      expect(screen.queryByText('xl-model')).toBeNull();
    });
  });

  it('large filter (200k-1M) shows large-context models', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'mid-model', contextWindow: 128_000 }),
      makeEntry({ id: 'large-model', contextWindow: 500_000 }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('200k–1M'));
    await userEvent.click(screen.getByText('200k–1M'));
    await waitFor(() => {
      expect(screen.queryByText('large-model')).not.toBeNull();
      expect(screen.queryByText('mid-model')).toBeNull();
    });
  });

  it('xl filter (>1M) shows xl-context models', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'large-model', contextWindow: 500_000 }),
      makeEntry({ id: 'xl-model', contextWindow: 2_000_000 }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('> 1M'));
    await userEvent.click(screen.getByText('> 1M'));
    await waitFor(() => {
      expect(screen.queryByText('xl-model')).not.toBeNull();
      expect(screen.queryByText('large-model')).toBeNull();
    });
  });
});

// ── Price filter ───────────────────────────────────────────────────────────────

describe('ModelDiscoveryPage — price filter', () => {
  it('free filter shows only local models', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'local-model', local: true }),
      makeEntry({ id: 'paid-model', local: false, pricing: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.006 } }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('Free'));
    await userEvent.click(screen.getByText('Free'));
    await waitFor(() => {
      expect(screen.queryByText('local-model')).not.toBeNull();
      expect(screen.queryByText('paid-model')).toBeNull();
    });
  });

  it('low filter (<$1/1M) shows cheap non-local models', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'cheap', local: false, pricing: { inputPer1kTokens: 0.0003, outputPer1kTokens: 0.0006 } }),
      makeEntry({ id: 'expensive', local: false, pricing: { inputPer1kTokens: 0.01, outputPer1kTokens: 0.02 } }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('< $1'));
    await userEvent.click(screen.getByText('< $1'));
    await waitFor(() => {
      expect(screen.queryByText('cheap')).not.toBeNull();
      expect(screen.queryByText('expensive')).toBeNull();
    });
  });

  it('mid filter ($1-$5/1M) shows mid-range models', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'mid', local: false, pricing: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.006 } }),
      makeEntry({ id: 'cheap', local: false, pricing: { inputPer1kTokens: 0.0003, outputPer1kTokens: 0.0006 } }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('$1–$5'));
    await userEvent.click(screen.getByText('$1–$5'));
    await waitFor(() => {
      expect(screen.queryByText('mid')).not.toBeNull();
      expect(screen.queryByText('cheap')).toBeNull();
    });
  });

  it('high filter (>$5/1M) shows expensive models', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'expensive', local: false, pricing: { inputPer1kTokens: 0.01, outputPer1kTokens: 0.02 } }),
      makeEntry({ id: 'mid', local: false, pricing: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.006 } }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('> $5'));
    await userEvent.click(screen.getByText('> $5'));
    await waitFor(() => {
      expect(screen.queryByText('expensive')).not.toBeNull();
      expect(screen.queryByText('mid')).toBeNull();
    });
  });
});

// ── Toggle filters ────────────────────────────────────────────────────────────

describe('ModelDiscoveryPage — toggle filters', () => {
  it('Configured toggle shows only configured models', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'configured', isConfigured: true }),
      makeEntry({ id: 'unconfigured', isConfigured: false }),
    ]);
    renderPage();
    // 'Configured' appears in both filter button and row badge; target the button by role
    await waitFor(() => screen.getByRole('button', { name: 'Configured' }));
    await userEvent.click(screen.getByRole('button', { name: 'Configured' }));
    await waitFor(() => {
      expect(screen.queryByText('configured')).not.toBeNull();
      expect(screen.queryByText('unconfigured')).toBeNull();
    });
  });

  it('Embedding toggle shows only embedding models', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'embed-model', embedding: true }),
      makeEntry({ id: 'chat-model', embedding: false }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('Embedding'));
    await userEvent.click(screen.getByText('Embedding'));
    await waitFor(() => {
      expect(screen.queryByText('embed-model')).not.toBeNull();
      expect(screen.queryByText('chat-model')).toBeNull();
    });
  });
});

// ── Reset filters ──────────────────────────────────────────────────────────────

describe('ModelDiscoveryPage — reset filters', () => {
  it('Reset filters button appears when any filter is active', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Configured' }));
    await userEvent.click(screen.getByRole('button', { name: 'Configured' }));
    // There may be two Reset buttons (filter-bar + empty-state); either means it appeared
    await waitFor(() => expect(screen.queryAllByRole('button', { name: 'Reset filters' }).length).toBeGreaterThan(0));
  });

  it('Reset filters button clears all filters and shows all models', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'configured', isConfigured: true }),
      makeEntry({ id: 'unconfigured', isConfigured: false }),
    ]);
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: 'Configured' }));
    await userEvent.click(screen.getByRole('button', { name: 'Configured' }));
    await waitFor(() => screen.queryAllByRole('button', { name: 'Reset filters' }).length > 0);
    // Click the first Reset filters button (filter-bar one)
    await userEvent.click(screen.getAllByRole('button', { name: 'Reset filters' })[0]!);
    await waitFor(() => {
      expect(screen.queryByText('configured')).not.toBeNull();
      expect(screen.queryByText('unconfigured')).not.toBeNull();
    });
  });
});

// ── Sorting ────────────────────────────────────────────────────────────────────

// Helper: click a sortable <th> by its label text (avoids ambiguity with FilterLabel spans)
function clickTh(label: string) {
  const th = Array.from(document.querySelectorAll('thead th')).find(
    el => el.textContent?.includes(label)
  ) as HTMLElement | undefined;
  if (!th) throw new Error(`<th> with text "${label}" not found`);
  return userEvent.click(th);
}

describe('ModelDiscoveryPage — sorting', () => {
  it('clicking Provider header sorts by provider', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'b-model', provider: 'openai' }),
      makeEntry({ id: 'a-model', provider: 'anthropic' }),
    ]);
    renderPage();
    await waitFor(() => document.querySelector('thead'));
    await clickTh('Provider');
    // anthropic should come before openai in asc order
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      const firstProvider = rows[0]?.querySelector('.badge')?.textContent;
      expect(firstProvider).toBe('anthropic');
    });
  });

  it('clicking Provider header twice reverses sort direction', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'b-model', provider: 'openai' }),
      makeEntry({ id: 'a-model', provider: 'anthropic' }),
    ]);
    renderPage();
    await waitFor(() => document.querySelector('thead'));
    await clickTh('Provider');
    await clickTh('Provider');
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      const firstProvider = rows[0]?.querySelector('.badge')?.textContent;
      expect(firstProvider).toBe('openai');
    });
  });

  it('clicking Context header sorts by contextWindow', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'big', contextWindow: 200_000 }),
      makeEntry({ id: 'small', contextWindow: 8_000 }),
    ]);
    renderPage();
    await waitFor(() => document.querySelector('thead'));
    await clickTh('Context');
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      const firstId = rows[0]?.querySelector('.mono')?.textContent;
      expect(firstId).toBe('small');
    });
  });

  it('clicking Input / 1M header sorts by input price', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'expensive', pricing: { inputPer1kTokens: 0.01, outputPer1kTokens: 0.02 } }),
      makeEntry({ id: 'cheap', pricing: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.002 } }),
    ]);
    renderPage();
    await waitFor(() => document.querySelector('thead'));
    await clickTh('Input / 1M');
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      const firstId = rows[0]?.querySelector('.mono')?.textContent;
      expect(firstId).toBe('cheap');
    });
  });

  it('clicking Output / 1M header sorts by output price', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'expensive', pricing: { inputPer1kTokens: 0.01, outputPer1kTokens: 0.03 } }),
      makeEntry({ id: 'cheap', pricing: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.002 } }),
    ]);
    renderPage();
    await waitFor(() => document.querySelector('thead'));
    await clickTh('Output / 1M');
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      const firstId = rows[0]?.querySelector('.mono')?.textContent;
      expect(firstId).toBe('cheap');
    });
  });

  it('clicking Model header sorts by model id', async () => {
    mockGetCatalog.mockResolvedValue([
      makeEntry({ id: 'z-model', provider: 'openai' }),
      makeEntry({ id: 'a-model', provider: 'openai' }),
    ]);
    renderPage();
    await waitFor(() => document.querySelector('thead'));
    // Default sort is already model/asc; click Provider first to change col, then click Model to get asc
    await clickTh('Provider');
    await clickTh('Model');
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      const firstId = rows[0]?.querySelector('.mono')?.textContent;
      expect(firstId).toBe('a-model');
    });
  });
});

// ── Pagination ─────────────────────────────────────────────────────────────────

describe('ModelDiscoveryPage — pagination', () => {
  it('shows pagination controls when entries exceed PAGE_SIZE (25)', async () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      makeEntry({ id: `model-${i}`, provider: 'openai' })
    );
    mockGetCatalog.mockResolvedValue(entries);
    renderPage();
    await waitFor(() => screen.queryByText('Prev'));
    expect(screen.queryByText('Next')).not.toBeNull();
  });

  it('shows count range: 1-25 of 30', async () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      makeEntry({ id: `model-${i}`, provider: 'openai' })
    );
    mockGetCatalog.mockResolvedValue(entries);
    renderPage();
    await waitFor(() => expect(screen.queryByText('1–25 of 30')).not.toBeNull());
  });

  it('Prev button is disabled on first page', async () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      makeEntry({ id: `model-${i}`, provider: 'openai' })
    );
    mockGetCatalog.mockResolvedValue(entries);
    renderPage();
    await waitFor(() => screen.queryByText('Prev'));
    const prevBtn = screen.getByText('Prev').closest('button') as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
  });

  it('clicking Next shows page 2 and updates count', async () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      makeEntry({ id: `model-${i}`, provider: 'openai' })
    );
    mockGetCatalog.mockResolvedValue(entries);
    renderPage();
    await waitFor(() => screen.getByText('Next'));
    await userEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(screen.queryByText('26–30 of 30')).not.toBeNull());
  });

  it('Next button is disabled on last page', async () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      makeEntry({ id: `model-${i}`, provider: 'openai' })
    );
    mockGetCatalog.mockResolvedValue(entries);
    renderPage();
    await waitFor(() => screen.getByText('Next'));
    await userEvent.click(screen.getByText('Next'));
    await waitFor(() => screen.queryByText('26–30 of 30'));
    const nextBtn = screen.getByText('Next').closest('button') as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
  });

  it('clicking Prev returns to page 1', async () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      makeEntry({ id: `model-${i}`, provider: 'openai' })
    );
    mockGetCatalog.mockResolvedValue(entries);
    renderPage();
    await waitFor(() => screen.getByText('Next'));
    await userEvent.click(screen.getByText('Next'));
    await waitFor(() => screen.queryByText('26–30 of 30'));
    await userEvent.click(screen.getByText('Prev'));
    await waitFor(() => expect(screen.queryByText('1–25 of 30')).not.toBeNull());
  });

  it('filter change resets to page 1', async () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      makeEntry({ id: `model-${i}`, provider: 'openai' })
    );
    mockGetCatalog.mockResolvedValue(entries);
    renderPage();
    await waitFor(() => screen.getByText('Next'));
    await userEvent.click(screen.getByText('Next'));
    await waitFor(() => screen.queryByText('26–30 of 30'));
    // Change context filter → resets to page 1
    await userEvent.click(screen.getByText('< 32k'));
    await waitFor(() => expect(screen.queryByText('26–30 of 30')).toBeNull());
  });
});
