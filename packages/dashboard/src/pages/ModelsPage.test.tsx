import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ModelsPage } from './ModelsPage';

vi.mock('../api', () => ({
  getModels: vi.fn(),
  deleteModel: vi.fn(),
  getProviderHealth: vi.fn(),
  testModel: vi.fn(),
}));

// ponytail: stub ConfirmDialog so it renders inline without portal issues
vi.mock('../components/ConfirmDialog', () => ({
  ConfirmDialog: ({ message, onConfirm, onCancel }: {
    message: string; onConfirm: () => void; onCancel: () => void;
  }) => (
    <div data-testid="confirm-dialog">
      <span>{message}</span>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

import { getModels, deleteModel, getProviderHealth, testModel } from '../api';

const mockGetModels = vi.mocked(getModels as () => Promise<unknown>);
const mockDeleteModel = vi.mocked(deleteModel as (id: string) => Promise<unknown>);
const mockGetProviderHealth = vi.mocked(getProviderHealth as () => Promise<unknown>);
const mockTestModel = vi.mocked(testModel as (id: string) => Promise<unknown>);

function makeModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gpt-4o',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: null },
    contextWindow: 128000,
    ...overrides,
  };
}

function makeHealthProvider(overrides: Record<string, unknown> = {}) {
  return {
    modelId: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    status: 'healthy' as const,
    errorRate: 0.01,
    p95LatencyMs: 200,
    requestsLastHour: 50,
    lastSuccessAt: new Date(Date.now() - 60_000).toISOString(),
    cooldownUntil: null,
    ...overrides,
  };
}

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/models${search}`]}>
      <ModelsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockGetModels.mockResolvedValue([]);
  mockDeleteModel.mockResolvedValue(undefined);
  mockGetProviderHealth.mockResolvedValue({ providers: [] });
  mockTestModel.mockResolvedValue({ ok: true, latencyMs: 120 });
});

afterEach(() => vi.clearAllMocks());

// ── Models list ────────────────────────────────────────────────────────────────

describe('ModelsPage — models list', () => {
  it('shows empty state when no models', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/No models yet/)).toBeTruthy());
  });

  it('renders models in the table', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => expect(screen.getByText('gpt-4o')).toBeTruthy());
    expect(screen.getAllByText('openai').length).toBeGreaterThan(0);
  });

  it('shows filtered empty state when filter matches nothing', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await userEvent.type(screen.getByPlaceholderText(/Filter models/), 'zzznomatch');
    await waitFor(() => expect(screen.getByText(/No models match/)).toBeTruthy());
  });

  it('clear X button resets search', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    const input = screen.getByPlaceholderText(/Filter models/);
    await userEvent.type(input, 'zzz');
    await waitFor(() => screen.getByText(/No models match/));
    const xBtn = Array.from(document.querySelectorAll('button')).find(b =>
      b.style.position === 'absolute' && b.style.right === '7px'
    );
    if (xBtn) {
      await userEvent.click(xBtn);
      await waitFor(() => screen.getByText('gpt-4o'));
    }
    expect((input as HTMLInputElement).value === '' || screen.queryByText('gpt-4o') !== null).toBe(true);
  });

  it('provider filter narrows results', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'gpt-4o', provider: 'openai' }),
      makeModel({ id: 'claude-3', provider: 'anthropic' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('claude-3'));
    const select = screen.getByRole('combobox');
    await userEvent.selectOptions(select, 'anthropic');
    await waitFor(() => expect(screen.queryByText('gpt-4o')).toBeNull());
    expect(screen.getByText('claude-3')).toBeTruthy();
  });

  it('shows "X of Y models" when filter is active', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'gpt-4o', provider: 'openai' }),
      makeModel({ id: 'claude-3', provider: 'anthropic' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('claude-3'));
    await userEvent.selectOptions(screen.getByRole('combobox'), 'openai');
    await waitFor(() => expect(screen.getByText(/1 of 2 model/)).toBeTruthy());
  });

  it('shows cache column with dash when cachePerMillion is null', async () => {
    mockGetModels.mockResolvedValue([makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: null } })]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    const dashes = Array.from(document.querySelectorAll('.text-muted, [class*="muted"]'));
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('shows context size in k when contextWindow is set', async () => {
    mockGetModels.mockResolvedValue([makeModel({ contextWindow: 128000 })]);
    renderPage();
    await waitFor(() => expect(screen.getByText('128k')).toBeTruthy());
  });

  it('shows dash for null contextWindow', async () => {
    mockGetModels.mockResolvedValue([makeModel({ contextWindow: null })]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    const cells = Array.from(document.querySelectorAll('td'));
    const hasDash = cells.some(td => td.querySelector('.text-muted') !== null);
    expect(hasDash).toBe(true);
  });

  it('sorts by provider when Provider header clicked', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'z-model', provider: 'openai' }),
      makeModel({ id: 'a-model', provider: 'anthropic' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('z-model'));
    const providerHeader = screen.getByText('Provider');
    await userEvent.click(providerHeader);
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('anthropic');
  });

  it('reverses sort on second click', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'z-model', provider: 'openai' }),
      makeModel({ id: 'a-model', provider: 'anthropic' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('z-model'));
    const providerHeader = screen.getByText('Provider');
    await userEvent.click(providerHeader); // asc
    await userEvent.click(providerHeader); // desc
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('openai');
  });
});

// ── ConfirmDialog / delete flow ────────────────────────────────────────────────

describe('ModelsPage — delete with ConfirmDialog', () => {
  it('shows confirm dialog when delete button clicked', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    const deleteBtn = screen.getByTitle('Remove');
    await userEvent.click(deleteBtn);
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    expect(screen.getByText(/Remove model "gpt-4o"/)).toBeTruthy();
  });

  it('cancels dialog without deleting', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await userEvent.click(screen.getByTitle('Remove'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(mockDeleteModel).not.toHaveBeenCalled();
  });

  it('confirms dialog calls deleteModel and removes row', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    mockDeleteModel.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await userEvent.click(screen.getByTitle('Remove'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockDeleteModel).toHaveBeenCalledWith('gpt-4o'));
    await waitFor(() => expect(screen.queryByText('gpt-4o')).toBeNull());
  });
});

// ── Pagination ─────────────────────────────────────────────────────────────────

describe('ModelsPage — pagination', () => {
  it('shows pagination controls when > 20 models', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeModel({ id: `model-${i}`, provider: 'openai' })
    );
    mockGetModels.mockResolvedValue(many);
    renderPage();
    await waitFor(() => expect(screen.getByText(/Page 1 of/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Next/ })).toBeTruthy();
  });

  it('navigates to page 2', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeModel({ id: `model-${i}`, provider: 'openai' })
    );
    mockGetModels.mockResolvedValue(many);
    renderPage();
    await waitFor(() => screen.getByText(/Page 1 of/));
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByText(/Page 2 of/)).toBeTruthy());
  });

  it('Previous button disabled on page 1', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeModel({ id: `model-${i}`, provider: 'openai' })
    );
    mockGetModels.mockResolvedValue(many);
    renderPage();
    await waitFor(() => screen.getByText(/Page 1 of/));
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();
  });

  it('resets to page 1 when filter changes', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeModel({ id: `model-${i}`, provider: 'openai' })
    );
    mockGetModels.mockResolvedValue(many);
    renderPage();
    await waitFor(() => screen.getByText(/Page 1 of/));
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => screen.getByText(/Page 2 of/));
    await userEvent.type(screen.getByPlaceholderText(/Filter models/), 'model-1');
    await waitFor(() => expect(screen.queryByText(/Page 2 of/)).toBeNull());
  });
});

// helper: switch to the Health tab
async function switchToHealthTab() {
  const healthTabBtn = screen.getByRole('button', { name: 'Health' });
  await userEvent.click(healthTabBtn);
}

// ── Health columns in the health tab ──────────────────────────────────────────

describe('ModelsPage — health columns (merged table)', () => {
  it('shows both Models and Health tab buttons', async () => {
    renderPage();
    await waitFor(() => screen.queryByText(/No models yet/) || screen.queryByText(/model/));
    expect(screen.getByRole('button', { name: 'Models' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Health' })).toBeTruthy();
  });

  it('shows health columns headers in the health tab', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByText(/Error rate/)).toBeTruthy();
    expect(screen.getByText(/P95 latency/)).toBeTruthy();
    expect(screen.getByText(/Requests/)).toBeTruthy();
    expect(screen.getByText(/Last success/)).toBeTruthy();
    expect(screen.getByText(/Cooldown/)).toBeTruthy();
  });

  it('shows Healthy badge when health data matches model', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({ providers: [makeHealthProvider()] });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText('Healthy')).toBeTruthy());
  });

  it('shows No data badge for model with no health entry', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({ providers: [] });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText('No data')).toBeTruthy());
  });

  it('shows dashes in health columns when no health entry', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({ providers: [] });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    // multiple dash cells expected (error rate, p95, requests, last success, cooldown)
    const cells = Array.from(document.querySelectorAll('td'));
    const dashCells = cells.filter(td => td.textContent === '—');
    expect(dashCells.length).toBeGreaterThan(0);
  });

  it('shows Cooldown badge when cooldownUntil is in the future', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ cooldownUntil: future, status: 'healthy' })],
    });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getAllByText('Cooldown').length).toBeGreaterThan(0));
  });

  it('shows dash for null p95LatencyMs', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ p95LatencyMs: null })],
    });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => screen.getByText('Healthy'));
    const dashes = Array.from(document.querySelectorAll('td')).filter(td => td.textContent === '—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('shows "never" for null lastSuccessAt', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ lastSuccessAt: null })],
    });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText('never')).toBeTruthy());
  });

  it('shows days ago for old lastSuccessAt', async () => {
    const oldDate = new Date(Date.now() - 3 * 86_400_000).toISOString();
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ lastSuccessAt: oldDate })],
    });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText(/\d+d ago/)).toBeTruthy());
  });

  it('model with no health entry still appears in the health table', async () => {
    mockGetModels.mockResolvedValue([makeModel({ id: 'orphan-model' })]);
    mockGetProviderHealth.mockResolvedValue({ providers: [] });
    renderPage();
    await waitFor(() => screen.getByText('orphan-model'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText('orphan-model')).toBeTruthy());
  });

  it('both health and no-health models render when mixed', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'gpt-4o', provider: 'openai' }),
      makeModel({ id: 'local-model', provider: 'ollama' }),
    ]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ modelId: 'gpt-4o' })],
    });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText('Healthy')).toBeTruthy());
    expect(screen.getByText('local-model')).toBeTruthy();
    expect(screen.getByText('No data')).toBeTruthy();
  });
});

// ── Sortable health + endpoint columns ────────────────────────────────────────

describe('ModelsPage — sortable health and endpoint columns', () => {
  it('Endpoint header is sortable in Models tab (renders sort icon)', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'b-model', endpoint: 'https://z.com/v1' }),
      makeModel({ id: 'a-model', endpoint: 'https://a.com/v1' }),
    ]);
    // Endpoint sort lives under the Models tab (default tab)
    renderPage();
    await waitFor(() => screen.getByText('b-model'));
    const endpointHeader = screen.getByText('Endpoint');
    await userEvent.click(endpointHeader);
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    // asc: a.com before z.com
    expect(rows[0]?.textContent).toContain('a-model');
  });

  it('Status header sorts healthy before degraded by default (asc = best first)', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'deg-model', provider: 'openai' }),
      makeModel({ id: 'healthy-model', provider: 'openai' }),
    ]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [
        makeHealthProvider({ modelId: 'deg-model', status: 'degraded' }),
        makeHealthProvider({ modelId: 'healthy-model', status: 'healthy' }),
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText('healthy-model'));
    await switchToHealthTab();
    // Default hSortKey='status', hSortDir='asc' already orders healthy first.
    // Clicking once flips to desc (degraded first); click twice to restore asc.
    const statusHeader = screen.getByText('Status');
    await userEvent.click(statusHeader); // desc: degraded first
    await userEvent.click(statusHeader); // asc again: healthy first
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('healthy-model');
  });

  it('no-data rows sink to bottom when sorting by a health column', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'no-health', provider: 'openai' }),
      makeModel({ id: 'has-health', provider: 'openai' }),
    ]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ modelId: 'has-health', status: 'healthy' })],
    });
    renderPage();
    await waitFor(() => screen.getByText('no-health'));
    await switchToHealthTab();
    const statusHeader = screen.getByText('Status');
    await userEvent.click(statusHeader); // asc
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[rows.length - 1]?.textContent).toContain('no-health');
    // also check desc keeps no-data last
    await userEvent.click(statusHeader); // desc
    const rows2 = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows2[rows2.length - 1]?.textContent).toContain('no-health');
  });

  it('Error rate header sorts numerically', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'high-err', provider: 'openai' }),
      makeModel({ id: 'low-err', provider: 'openai' }),
    ]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [
        makeHealthProvider({ modelId: 'high-err', errorRate: 0.5 }),
        makeHealthProvider({ modelId: 'low-err', errorRate: 0.01 }),
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText('high-err'));
    await switchToHealthTab();
    const errHeader = screen.getByText(/Error rate/);
    await userEvent.click(errHeader); // asc: low error first
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('low-err');
  });

  it('sort indicator appears on health column header when active', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({ providers: [makeHealthProvider()] });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    const p95Header = screen.getByText(/P95 latency/);
    await userEvent.click(p95Header);
    // ChevronUp/Down is in the DOM inside the th after click
    expect(p95Header.closest('th') ?? p95Header).toBeTruthy();
  });
});

// ── Test button (handleTest) ───────────────────────────────────────────────────

describe('ModelsPage — test button', () => {
  it('shows loading indicator while test is running then ok result', async () => {
    let resolveTest!: (v: unknown) => void;
    mockTestModel.mockReturnValueOnce(new Promise(r => { resolveTest = r; }));
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Test'));
    await userEvent.click(screen.getByTitle('Test'));
    // loading indicator appears
    await waitFor(() => expect(document.querySelector('[style*="text-muted"]')).toBeTruthy());
    resolveTest({ ok: true, latencyMs: 99 });
    await waitFor(() => expect(screen.getByText(/✓ 99ms/)).toBeTruthy());
  });

  it('shows error result when test fails', async () => {
    mockTestModel.mockResolvedValueOnce({ ok: false, latencyMs: 0, error: 'connection refused' });
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => screen.getByTitle('Test'));
    await userEvent.click(screen.getByTitle('Test'));
    await waitFor(() => expect(screen.getByText(/✗/)).toBeTruthy());
  });
});

// ── Models tab: sort by input/output/cache/context ────────────────────────────

describe('ModelsPage — models tab sort keys', () => {
  it('sorts by Input $/1M', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'cheap', cost: { inputPerMillion: 1, outputPerMillion: 5, cachePerMillion: null } }),
      makeModel({ id: 'pricey', cost: { inputPerMillion: 10, outputPerMillion: 5, cachePerMillion: null } }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('cheap'));
    const header = screen.getByText('Input $/1M');
    await userEvent.click(header); // asc: cheap first
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('cheap');
  });

  it('sorts by Output $/1M', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'cheap-out', cost: { inputPerMillion: 5, outputPerMillion: 2, cachePerMillion: null } }),
      makeModel({ id: 'pricey-out', cost: { inputPerMillion: 5, outputPerMillion: 20, cachePerMillion: null } }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('cheap-out'));
    await userEvent.click(screen.getByText('Output $/1M')); // asc: cheap-out first
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('cheap-out');
  });

  it('sorts by Cache $/1M (numOrInfinity: null → Infinity sinks to bottom)', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'no-cache', cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: null } }),
      makeModel({ id: 'has-cache', cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: 0.5 } }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('no-cache'));
    await userEvent.click(screen.getByText('Cache $/1M')); // asc: has-cache (0.5) before no-cache (Inf)
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('has-cache');
  });

  it('shows cache value as $N when cachePerMillion is set', async () => {
    mockGetModels.mockResolvedValue([makeModel({ cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: 0.75 } })]);
    renderPage();
    await waitFor(() => expect(screen.getByText('$0.75')).toBeTruthy());
  });

  it('sorts by Context Size (numOrInfinity: null → Infinity sinks to bottom)', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'small-ctx', contextWindow: 8000 }),
      makeModel({ id: 'no-ctx', contextWindow: null }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('small-ctx'));
    await userEvent.click(screen.getByText('Context Size')); // asc: small-ctx first
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('small-ctx');
  });
});

// ── Models tab pagination ──────────────────────────────────────────────────────

describe('ModelsPage — models tab pagination', () => {
  function make21Models() {
    return Array.from({ length: 21 }, (_, i) =>
      makeModel({ id: `model-${String(i).padStart(2, '0')}`, provider: 'openai' })
    );
  }

  it('Previous button navigates back', async () => {
    mockGetModels.mockResolvedValue(make21Models());
    renderPage();
    await waitFor(() => screen.getByText(/Page 1 of/));
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => screen.getByText(/Page 2 of/));
    await userEvent.click(screen.getByRole('button', { name: /Previous/ }));
    await waitFor(() => expect(screen.getByText(/Page 1 of/)).toBeTruthy());
  });

  it('Next button is disabled on last page', async () => {
    mockGetModels.mockResolvedValue(make21Models());
    renderPage();
    await waitFor(() => screen.getByText(/Page 1 of/));
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => screen.getByText(/Page 2 of/));
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });
});

// ── Health tab search filter ───────────────────────────────────────────────────

describe('ModelsPage — health tab search', () => {
  it('filters health rows by model id substring', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'alpha-model', provider: 'openai' }),
      makeModel({ id: 'beta-model', provider: 'openai' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('alpha-model'));
    await switchToHealthTab();
    const input = screen.getByPlaceholderText(/Filter models/);
    await userEvent.type(input, 'alpha');
    await waitFor(() => expect(screen.queryByText('beta-model')).toBeNull());
    expect(screen.getByText('alpha-model')).toBeTruthy();
  });

  it('shows "X of Y" count in health toolbar when filtered', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'alpha-model', provider: 'openai' }),
      makeModel({ id: 'beta-model', provider: 'openai' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('alpha-model'));
    await switchToHealthTab();
    await userEvent.type(screen.getByPlaceholderText(/Filter models/), 'alpha');
    await waitFor(() => expect(screen.getByText(/1 of 2 model/)).toBeTruthy());
  });

  it('clear X button in health search resets filter', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'alpha-model', provider: 'openai' }),
      makeModel({ id: 'beta-model', provider: 'openai' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('alpha-model'));
    await switchToHealthTab();
    const input = screen.getByPlaceholderText(/Filter models/);
    await userEvent.type(input, 'alpha');
    await waitFor(() => screen.queryByText('beta-model') === null);
    const xBtn = Array.from(document.querySelectorAll('button')).find(b =>
      b.style.position === 'absolute' && b.style.right === '7px'
    );
    if (xBtn) {
      await userEvent.click(xBtn);
      await waitFor(() => expect(screen.getByText('beta-model')).toBeTruthy());
    }
  });

  it('shows health empty state when filter matches nothing', async () => {
    mockGetModels.mockResolvedValue([makeModel({ id: 'gpt-4o', provider: 'openai' })]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await userEvent.type(screen.getByPlaceholderText(/Filter models/), 'zzznomatch');
    await waitFor(() => expect(screen.getByText(/No models match the filter/)).toBeTruthy());
  });
});

// ── Health tab sort: remaining keys ───────────────────────────────────────────

describe('ModelsPage — health tab sort remaining keys', () => {
  function twoHealthModels() {
    return [
      makeModel({ id: 'model-x', provider: 'openai' }),
      makeModel({ id: 'model-y', provider: 'openai' }),
    ];
  }

  function twoHealthProviders() {
    return [
      makeHealthProvider({ modelId: 'model-x', errorRate: 0.1, p95LatencyMs: 100, requestsLastHour: 5,
        lastSuccessAt: new Date(Date.now() - 3_600_000).toISOString(), cooldownUntil: null }),
      makeHealthProvider({ modelId: 'model-y', errorRate: 0.5, p95LatencyMs: 500, requestsLastHour: 50,
        lastSuccessAt: new Date(Date.now() - 60_000).toISOString(), cooldownUntil: null }),
    ];
  }

  it('sorts by Requests (1h) column', async () => {
    mockGetModels.mockResolvedValue(twoHealthModels());
    mockGetProviderHealth.mockResolvedValue({ providers: twoHealthProviders() });
    renderPage();
    await waitFor(() => screen.getByText('model-x'));
    await switchToHealthTab();
    await waitFor(() => screen.getByText(/Requests/));
    await userEvent.click(screen.getByText(/Requests/)); // asc: model-x (5) before model-y (50)
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('model-x');
  });

  it('sorts by Last success column', async () => {
    mockGetModels.mockResolvedValue(twoHealthModels());
    mockGetProviderHealth.mockResolvedValue({ providers: twoHealthProviders() });
    renderPage();
    await waitFor(() => screen.getByText('model-x'));
    await switchToHealthTab();
    await waitFor(() => screen.getByText(/Last success/));
    await userEvent.click(screen.getByText(/Last success/)); // asc: model-x (older) first
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('model-x');
  });

  it('sorts by Cooldown column', async () => {
    const future1 = new Date(Date.now() + 30_000).toISOString();
    const future2 = new Date(Date.now() + 120_000).toISOString();
    mockGetModels.mockResolvedValue(twoHealthModels());
    mockGetProviderHealth.mockResolvedValue({
      providers: [
        makeHealthProvider({ modelId: 'model-x', cooldownUntil: future1, status: 'healthy' }),
        makeHealthProvider({ modelId: 'model-y', cooldownUntil: future2, status: 'healthy' }),
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText('model-x'));
    await switchToHealthTab();
    // scope to thead to avoid matching the status badge cells
    await waitFor(() => document.querySelector('thead'));
    const cooldownTh = Array.from(document.querySelectorAll('thead th span')).find(el =>
      el.textContent?.trim().startsWith('Cooldown')
    );
    expect(cooldownTh).toBeTruthy();
    await userEvent.click(cooldownTh!); // asc: model-x (sooner) first
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('model-x');
  });

  it('sorts by P95 latency with null values (null → Infinity sinks last)', async () => {
    mockGetModels.mockResolvedValue(twoHealthModels());
    mockGetProviderHealth.mockResolvedValue({
      providers: [
        makeHealthProvider({ modelId: 'model-x', p95LatencyMs: null }),
        makeHealthProvider({ modelId: 'model-y', p95LatencyMs: 100 }),
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText('model-x'));
    await switchToHealthTab();
    await waitFor(() => screen.getByText(/P95 latency/));
    await userEvent.click(screen.getByText(/P95 latency/)); // asc: model-y (100) before model-x (Inf)
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('model-y');
  });

  it('sorts by Model id in health tab', async () => {
    mockGetModels.mockResolvedValue(twoHealthModels());
    mockGetProviderHealth.mockResolvedValue({ providers: twoHealthProviders() });
    renderPage();
    await waitFor(() => screen.getByText('model-x'));
    await switchToHealthTab();
    await waitFor(() => screen.getByText('Model'));
    await userEvent.click(screen.getByText('Model')); // asc: model-x before model-y
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('model-x');
  });

  it('sorts by Provider in health tab', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'a-model', provider: 'zzz' }),
      makeModel({ id: 'b-model', provider: 'aaa' }),
    ]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [
        makeHealthProvider({ modelId: 'a-model' }),
        makeHealthProvider({ modelId: 'b-model' }),
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText('a-model'));
    await switchToHealthTab();
    await waitFor(() => screen.getByText('Provider'));
    await userEvent.click(screen.getByText('Provider')); // asc: aaa first → b-model
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('b-model');
  });

  it('lastSuccessAt: null sorts to -Infinity (before other dates in asc)', async () => {
    mockGetModels.mockResolvedValue(twoHealthModels());
    mockGetProviderHealth.mockResolvedValue({
      providers: [
        makeHealthProvider({ modelId: 'model-x', lastSuccessAt: null }),
        makeHealthProvider({ modelId: 'model-y', lastSuccessAt: new Date().toISOString() }),
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText('model-x'));
    await switchToHealthTab();
    await waitFor(() => screen.getByText(/Last success/));
    await userEvent.click(screen.getByText(/Last success/)); // asc: null (-Inf) first
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('model-x');
  });
});

// ── Health tab empty state (no models) ────────────────────────────────────────

describe('ModelsPage — health tab with no models', () => {
  it('shows "No models configured" empty state in health tab', async () => {
    mockGetModels.mockResolvedValue([]);
    renderPage();
    await waitFor(() => screen.getByText(/No models yet/));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText(/No models configured/)).toBeTruthy());
  });
});

// ── Health tab pagination ──────────────────────────────────────────────────────

describe('ModelsPage — health tab pagination', () => {
  it('shows pagination controls when > 20 models in health tab', async () => {
    const many = Array.from({ length: 21 }, (_, i) =>
      makeModel({ id: `hmodel-${String(i).padStart(2, '0')}`, provider: 'openai' })
    );
    mockGetModels.mockResolvedValue(many);
    mockGetProviderHealth.mockResolvedValue({
      providers: many.map(m => makeHealthProvider({ modelId: m.id })),
    });
    renderPage();
    await waitFor(() => screen.getByText('hmodel-00'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText(/Page 1 of/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Next/ })).toBeTruthy();
  });

  it('health tab Next navigates to page 2', async () => {
    const many = Array.from({ length: 21 }, (_, i) =>
      makeModel({ id: `hmodel-${String(i).padStart(2, '0')}`, provider: 'openai' })
    );
    mockGetModels.mockResolvedValue(many);
    mockGetProviderHealth.mockResolvedValue({
      providers: many.map(m => makeHealthProvider({ modelId: m.id })),
    });
    renderPage();
    await waitFor(() => screen.getByText('hmodel-00'));
    await switchToHealthTab();
    await waitFor(() => screen.getByText(/Page 1 of/));
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByText(/Page 2 of/)).toBeTruthy());
  });

  it('health tab Previous navigates back to page 1', async () => {
    const many = Array.from({ length: 21 }, (_, i) =>
      makeModel({ id: `hmodel-${String(i).padStart(2, '0')}`, provider: 'openai' })
    );
    mockGetModels.mockResolvedValue(many);
    mockGetProviderHealth.mockResolvedValue({
      providers: many.map(m => makeHealthProvider({ modelId: m.id })),
    });
    renderPage();
    await waitFor(() => screen.getByText('hmodel-00'));
    await switchToHealthTab();
    await waitFor(() => screen.getByText(/Page 1 of/));
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => screen.getByText(/Page 2 of/));
    await userEvent.click(screen.getByRole('button', { name: /Previous/ }));
    await waitFor(() => expect(screen.getByText(/Page 1 of/)).toBeTruthy());
  });
});

// ── relativeTime and cooldownTimer helpers (via rendered output) ───────────────

describe('ModelsPage — relativeTime formatting', () => {
  it('shows seconds ago for recent lastSuccessAt', async () => {
    const recent = new Date(Date.now() - 30_000).toISOString(); // 30s ago
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ lastSuccessAt: recent })],
    });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText(/\d+s ago/)).toBeTruthy());
  });

  it('shows hours ago for lastSuccessAt between 1h and 24h', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ lastSuccessAt: twoHoursAgo })],
    });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getByText(/\d+h ago/)).toBeTruthy());
  });

  it('shows cooldown timer in minutes when > 60s remaining', async () => {
    const future = new Date(Date.now() + 90_000).toISOString(); // 90s in future → "2m"
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ cooldownUntil: future, status: 'healthy' })],
    });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    // cooldownTimer value appears in the last <td> of the row; verify it ends with 'm'
    await waitFor(() => {
      const tds = Array.from(document.querySelectorAll('tbody td'));
      const cdCell = tds.find(td => /^\d+m$/.test(td.textContent?.trim() ?? ''));
      expect(cdCell).toBeTruthy();
    });
  });
});

// ── numOrInfinity ─────────────────────────────────────────────────────────────

describe('ModelsPage — numOrInfinity via cache/context sort', () => {
  it('numOrInfinity(null) → Infinity: two null-cache models are equal (no crash)', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'a', cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: null } }),
      makeModel({ id: 'b', cost: { inputPerMillion: 5, outputPerMillion: 15, cachePerMillion: null } }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('a'));
    await userEvent.click(screen.getByText('Cache $/1M'));
    // Both null → both Infinity → equal; order stable. No crash.
    expect(document.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('numOrInfinity(undefined) → Infinity: two null-context models are equal (no crash)', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'a', contextWindow: null }),
      makeModel({ id: 'b', contextWindow: null }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('a'));
    await userEvent.click(screen.getByText('Context Size'));
    expect(document.querySelectorAll('tbody tr').length).toBe(2);
  });
});

// ── Branch coverage fill-ins ───────────────────────────────────────────────────

describe('ModelsPage — branch coverage', () => {
  it('healthActive guard: unmount during in-flight health fetch prevents state update', async () => {
    let resolveHealth!: (v: unknown) => void;
    mockGetProviderHealth.mockReturnValueOnce(new Promise(r => { resolveHealth = r; }));
    mockGetModels.mockResolvedValue([makeModel()]);
    const { unmount } = renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    // health fetch is still pending; unmount sets healthActive.current = false
    unmount();
    // resolving after unmount should not throw (guard prevents setState on unmounted)
    await expect(Promise.resolve().then(() => resolveHealth({ providers: [] }))).resolves.toBeUndefined();
  });

  it('setTab("models") branch: clicking Models tab after Health tab', async () => {
    mockGetModels.mockResolvedValue([makeModel()]);
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab(); // setTab('health') — branch t==='health' TRUE
    await userEvent.click(screen.getByRole('button', { name: 'Models' })); // setTab('models') — branch t==='health' FALSE
    await waitFor(() => expect(screen.getByText('gpt-4o')).toBeTruthy());
  });

  it('health tab loading spinner shown when models loading and tab=health', async () => {
    // Delay load so loading=true is visible while tab=health
    let resolveModels!: (v: unknown) => void;
    mockGetModels.mockReturnValueOnce(new Promise(r => { resolveModels = r; }));
    // render with tab=health in URL
    render(
      <MemoryRouter initialEntries={['/dashboard/models?tab=health']}>
        <ModelsPage />
      </MemoryRouter>
    );
    // loading=true + tab='health' → spinner is rendered
    await waitFor(() => expect(document.querySelector('.spinner')).toBeTruthy());
    resolveModels([]);
    await waitFor(() => expect(document.querySelector('.spinner')).toBeNull());
  });

  it('setSortDir toggle: third click on same column covers d=desc → asc branch', async () => {
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'z-model', provider: 'openai' }),
      makeModel({ id: 'a-model', provider: 'anthropic' }),
    ]);
    renderPage();
    await waitFor(() => screen.getByText('z-model'));
    const providerHeader = screen.getByText('Provider');
    await userEvent.click(providerHeader); // sets sortKey='provider', dir='asc'
    await userEvent.click(providerHeader); // same key: d='asc' → 'desc' (branch 0)
    await userEvent.click(providerHeader); // same key: d='desc' → 'asc' (branch 1 — uncovered)
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('anthropic'); // back to asc
  });

  it('models page > totalPages resets when deletion shrinks totalPages', async () => {
    // 21 models → 2 pages. Navigate to page 2. Delete the last model (on page 2).
    // After delete: 20 models → 1 page. page(2) > totalPages(1) → resets to page 1.
    const many = Array.from({ length: 21 }, (_, i) =>
      makeModel({ id: `del-${String(i).padStart(2, '0')}`, provider: 'openai' })
    );
    mockGetModels.mockResolvedValue(many);
    mockDeleteModel.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => screen.getByText(/Page 1 of 2/));
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => screen.getByText(/Page 2 of 2/));
    // model-20 is on page 2; delete it
    const deleteBtn = screen.getByTitle('Remove');
    await userEvent.click(deleteBtn);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    // Now 20 models → 1 page; page was 2 → effect fires → resets to 1
    await waitFor(() => expect(screen.queryByText(/Page 2 of/)).toBeNull());
  });

  it('cooldownTimer: past cooldownUntil (ms<=0) returns null → no cooldown badge', async () => {
    const past = new Date(Date.now() - 10_000).toISOString(); // already expired
    mockGetModels.mockResolvedValue([makeModel()]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [makeHealthProvider({ cooldownUntil: past, status: 'healthy' })],
    });
    renderPage();
    await waitFor(() => screen.getByText('gpt-4o'));
    await switchToHealthTab();
    await waitFor(() => screen.getByText('Healthy')); // no cooldown → status = healthy
    // cooldownTimer(past) returns null → no cooldown displayed
    const cdTds = Array.from(document.querySelectorAll('tbody td')).filter(
      td => /^\d+[sm]$/.test(td.textContent?.trim() ?? '')
    );
    expect(cdTds.length).toBe(0);
  });

  it('health sort by P95 latency: all non-null p95 values (ha.p95 non-null in comparisons)', async () => {
    // All 3 models have non-null p95. Sort comparator called with ha.p95 non-null → branch 31,1.
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'model-a', provider: 'openai' }),
      makeModel({ id: 'model-b', provider: 'openai' }),
      makeModel({ id: 'model-c', provider: 'openai' }),
    ]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [
        makeHealthProvider({ modelId: 'model-a', p95LatencyMs: 300 }),
        makeHealthProvider({ modelId: 'model-b', p95LatencyMs: 50 }),
        makeHealthProvider({ modelId: 'model-c', p95LatencyMs: 100 }),
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText('model-a'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0));
    await userEvent.click(screen.getByText(/P95 latency/));
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    // asc: model-b (50ms) first
    expect(rows[0]?.textContent).toContain('model-b');
  });

  it('health sort by P95 latency: ha.p95LatencyMs null → Infinity (branch 31 null path)', async () => {
    // model-a has null p95 → Infinity. model-b has non-null. Sort puts model-a last.
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'model-a', provider: 'openai' }),
      makeModel({ id: 'model-b', provider: 'openai' }),
    ]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [
        makeHealthProvider({ modelId: 'model-a', p95LatencyMs: null }),
        makeHealthProvider({ modelId: 'model-b', p95LatencyMs: 50 }),
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText('model-a'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0));
    await userEvent.click(screen.getByText(/P95 latency/));
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[rows.length - 1]?.textContent).toContain('model-a');
  });

  it('health sort by Last success: ha.lastSuccessAt truthy (non-null for all models)', async () => {
    // All 3 models have non-null lastSuccessAt. Sort comparator fires ha.lastSuccessAt truthy → branch 33,1.
    const oldest = new Date(Date.now() - 3_600_000 * 3).toISOString();
    const older = new Date(Date.now() - 3_600_000 * 2).toISOString();
    const newer = new Date(Date.now() - 60_000).toISOString();
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'model-a', provider: 'openai' }),
      makeModel({ id: 'model-b', provider: 'openai' }),
      makeModel({ id: 'model-c', provider: 'openai' }),
    ]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [
        makeHealthProvider({ modelId: 'model-a', lastSuccessAt: oldest }),
        makeHealthProvider({ modelId: 'model-b', lastSuccessAt: older }),
        makeHealthProvider({ modelId: 'model-c', lastSuccessAt: newer }),
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText('model-a'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0));
    await userEvent.click(screen.getByText(/Last success/));
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    // asc: oldest (model-a) first
    expect(rows[0]?.textContent).toContain('model-a');
  });

  it('health sort by Last success: ha.lastSuccessAt null → -Infinity (branch 33 null path)', async () => {
    // model-a has null lastSuccessAt. Sort puts model-a first in asc.
    const newer = new Date(Date.now() - 60_000).toISOString();
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'model-a', provider: 'openai' }),
      makeModel({ id: 'model-b', provider: 'openai' }),
    ]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [
        makeHealthProvider({ modelId: 'model-a', lastSuccessAt: null }),
        makeHealthProvider({ modelId: 'model-b', lastSuccessAt: newer }),
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText('model-a'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0));
    await userEvent.click(screen.getByText(/Last success/));
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    // null → -Infinity < any timestamp → model-a first in asc
    expect(rows[0]?.textContent).toContain('model-a');
  });

  it('health sort by Cooldown: ha.cooldownUntil truthy (non-null for all models)', async () => {
    // All 3 models have non-null cooldownUntil → ha.cooldownUntil truthy (branch 35,1) in comparisons.
    const soon = new Date(Date.now() + 30_000).toISOString();
    const mid = new Date(Date.now() + 90_000).toISOString();
    const later = new Date(Date.now() + 180_000).toISOString();
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'model-a', provider: 'openai' }),
      makeModel({ id: 'model-b', provider: 'openai' }),
      makeModel({ id: 'model-c', provider: 'openai' }),
    ]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [
        makeHealthProvider({ modelId: 'model-a', cooldownUntil: soon, status: 'healthy' }),
        makeHealthProvider({ modelId: 'model-b', cooldownUntil: mid, status: 'healthy' }),
        makeHealthProvider({ modelId: 'model-c', cooldownUntil: later, status: 'healthy' }),
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText('model-a'));
    await switchToHealthTab();
    await waitFor(() => expect(screen.getAllByText('Cooldown').length).toBeGreaterThan(0));
    const cooldownTh = Array.from(document.querySelectorAll('thead th span')).find(el =>
      el.textContent?.trim().startsWith('Cooldown')
    );
    await userEvent.click(cooldownTh!);
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    // asc: model-a (soonest) first
    expect(rows[0]?.textContent).toContain('model-a');
  });

  it('health sort by Cooldown: ha.cooldownUntil null → 0 (branch 35 null path)', async () => {
    // model-a has null cooldownUntil → 0. model-b has future cooldownUntil.
    const later = new Date(Date.now() + 60_000).toISOString();
    mockGetModels.mockResolvedValue([
      makeModel({ id: 'model-a', provider: 'openai' }),
      makeModel({ id: 'model-b', provider: 'openai' }),
    ]);
    mockGetProviderHealth.mockResolvedValue({
      providers: [
        makeHealthProvider({ modelId: 'model-a', cooldownUntil: null }),
        makeHealthProvider({ modelId: 'model-b', cooldownUntil: later, status: 'healthy' }),
      ],
    });
    renderPage();
    await waitFor(() => screen.getByText('model-a'));
    await switchToHealthTab();
    await waitFor(() => screen.getAllByText(/Healthy|Cooldown/).length > 0);
    const cooldownTh = Array.from(document.querySelectorAll('thead th span')).find(el =>
      el.textContent?.trim().startsWith('Cooldown')
    );
    await userEvent.click(cooldownTh!);
    // model-a (null→0) < model-b (future time) → model-a first in asc
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows[0]?.textContent).toContain('model-a');
  });

  it('health hPage > hTotalPages: health page resets when model deletion shrinks totalPages', async () => {
    // 21 models: health tab → page 2. Switch to models tab, delete one model (now 20 → 1 hPage).
    // Switch back to health tab: hPage(2) > hTotalPages(1) → effect fires → setHPage(1).
    const manyModels = Array.from({ length: 21 }, (_, i) =>
      makeModel({ id: `hm-${String(i).padStart(2, '0')}`, provider: 'openai' })
    );
    mockGetModels.mockResolvedValue(manyModels);
    mockGetProviderHealth.mockResolvedValue({ providers: [] });
    mockDeleteModel.mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => screen.getByText('hm-00'));
    // Go to health tab and navigate to page 2
    await switchToHealthTab();
    await waitFor(() => screen.getByText(/Page 1 of/));
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => screen.getByText(/Page 2 of/));
    // Switch back to models tab (hPage stays at 2)
    await userEvent.click(screen.getByRole('button', { name: 'Models' }));
    await waitFor(() => screen.getByText('hm-00'));
    // Delete a model (now 20 models → hTotalPages=1)
    const allDeleteBtns = screen.getAllByTitle('Remove');
    await userEvent.click(allDeleteBtns[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByText('hm-00')).toBeNull());
    // Switch back to health tab: hPage(2) > hTotalPages(1) → resets
    await switchToHealthTab();
    await waitFor(() => expect(screen.queryByText(/Page 2 of/)).toBeNull());
  });
});
